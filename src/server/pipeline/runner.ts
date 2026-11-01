import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { courses, jobs, scenes as scenesTable } from "@/db/schema";
import type { CoursePlan, GenerationOptions, Scene, Segment } from "@/lib/dsl/types";
import { estimateSegmentMs, sceneDurationMs } from "@/lib/dsl/validate";
import { embedText } from "@/server/embeddings";
import { buildCourseDocument, isUuid, planSceneDbIndex, sourceChunksFor } from "@/server/courses";
import { generateScene, speakable, type SourceChunk } from "./scenes";
import { buildPlan, moduleCount } from "./planner";
import { synthesizeSegment, ttsProviderFor } from "@/server/providers/tts";
import { getSettings, hasModel, resolveSlot, type LumenSettings } from "@/server/settings";
import { imagesForChunks } from "@/server/ingest/pdf";
import { reviewScene } from "./review";

/* ------------------------------- event bus -------------------------------- */

export type GenerationEvent =
  | { type: "step"; course_id: string; step: string; current: number; total: number }
  | {
      type: "scene_ready";
      course_id: string;
      scene_index: number;
      title: string;
      kind: string;
      current: number;
      total: number;
    }
  | {
      type: "scene_failed";
      course_id: string;
      scene_index: number;
      title: string;
      error: string;
    }
  | { type: "done"; course_id: string; status: string }
  | { type: "error"; course_id: string; error: string };

type Listener = (event: GenerationEvent) => void;

const globalBus = globalThis as typeof globalThis & {
  __lumenListeners?: Map<string, Set<Listener>>;
  __lumenRunningCourses?: Set<string>;
};

const listeners: Map<string, Set<Listener>> =
  globalBus.__lumenListeners ?? new Map();
globalBus.__lumenListeners = listeners;

const runningCourses: Set<string> =
  globalBus.__lumenRunningCourses ?? new Set();
globalBus.__lumenRunningCourses = runningCourses;

export function subscribe(courseId: string, listener: Listener): () => void {
  const set = listeners.get(courseId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(courseId, set);
  return () => {
    set.delete(listener);
    if (!set.size) listeners.delete(courseId);
  };
}

function emit(event: GenerationEvent): void {
  const set = listeners.get(event.course_id);
  if (!set) return;
  for (const listener of set) {
    try {
      listener(event);
    } catch {
      /* a dead SSE stream must not break generation */
    }
  }
}

/* ------------------------------ scene rows -------------------------------- */

export async function ensureSceneRows(
  courseId: string,
  plan: CoursePlan,
  options: { syncEdits?: boolean } = {},
): Promise<void> {
  if (!isUuid(courseId)) return;
  const existing = await db
    .select()
    .from(scenesTable)
    .where(eq(scenesTable.course_id, courseId));

  if (!options.syncEdits) {
    const have = new Set(existing.map((row) => row.index));
    const usesLegacyStride =
      existing.length > 0 &&
      existing.some((r) => r.index >= 10 && r.index < 100 && r.index % 100 !== 0);
    const rows: (typeof scenesTable.$inferInsert)[] = [];
    plan.modules.forEach((moduleBlock, moduleIndex) => {
      moduleBlock.scenes.forEach((outline, sceneIndex) => {
        const index = usesLegacyStride
          ? moduleIndex * 10 + sceneIndex
          : planSceneDbIndex(moduleIndex, sceneIndex);
        const legacyIdx = moduleIndex * 10 + sceneIndex;
        if (have.has(index) || (sceneIndex < 10 && have.has(legacyIdx))) return;
        rows.push({
          course_id: courseId,
          module_id: moduleBlock.id,
          index,
          kind: outline.kind,
          title: outline.title,
          status: "pending",
          plan_intent: outline.intent,
        });
      });
    });
    if (rows.length) await db.insert(scenesTable).values(rows);
    return;
  }

  // Full plan sync (reorder, rename, remove, scene kind changes):
  // Match existing ready scenes when unchanged so already-generated scenes survive minor edits.
  const unusedReady = [...existing.filter((r) => r.status === "ready" && r.json)];
  const nextRows: (typeof scenesTable.$inferInsert)[] = [];

  plan.modules.forEach((moduleBlock, moduleIndex) => {
    moduleBlock.scenes.forEach((outline, sceneIndex) => {
      const index = planSceneDbIndex(moduleIndex, sceneIndex);
      const matchIdx = unusedReady.findIndex(
        (r) =>
          r.kind === outline.kind &&
          r.title === outline.title &&
          (r.plan_intent ?? "") === (outline.intent ?? ""),
      );
      if (matchIdx >= 0) {
        const matched = unusedReady.splice(matchIdx, 1)[0];
        const updatedJson = matched.json
          ? ({ ...matched.json, index, title: outline.title } as Scene)
          : null;
        nextRows.push({
          course_id: courseId,
          module_id: moduleBlock.id,
          index,
          kind: outline.kind,
          title: outline.title,
          status: "ready",
          json: updatedJson,
          plan_intent: outline.intent,
          attempts: matched.attempts,
        });
      } else {
        nextRows.push({
          course_id: courseId,
          module_id: moduleBlock.id,
          index,
          kind: outline.kind,
          title: outline.title,
          status: "pending",
          plan_intent: outline.intent,
        });
      }
    });
  });

  await db.delete(scenesTable).where(eq(scenesTable.course_id, courseId));
  if (nextRows.length) {
    await db.insert(scenesTable).values(nextRows);
  }
}

async function retrieveFor(
  courseId: string,
  materialIds: string[],
  query: string,
): Promise<SourceChunk[]> {
  void courseId;
  if (!materialIds.length) return [];
  const settings = await getSettings();
  const embedded = await embedText(settings, `${query}\n${speakable(query, 600)}`);
  return sourceChunksFor(materialIds, query, 6, embedded);
}

/* ------------------------------- planning --------------------------------- */

export async function runPlanning(courseId: string): Promise<void> {
  if (!isUuid(courseId)) return;
  const settings = await getSettings();
  const [row] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!row) return;
  await db
    .update(courses)
    .set({ status: "planning", updated_at: new Date() })
    .where(eq(courses.id, courseId));
  const topic = row.topic?.trim() || row.title;
  const materialIds = row.material_ids;
  const chunksForExcerpt = materialIds.length
    ? await retrieveFor(courseId, materialIds, topic)
    : [];
  const sectionTitles = chunksForExcerpt.map((c) => c.section_ref ?? "").filter(Boolean);
  const planImages = row.options.use_page_images !== false &&
    hasModel(resolveSlot(settings, "planner").config)
      ? await imagesForChunks(chunksForExcerpt)
      : [];
  const outcome = await buildPlan({
    settings,
    images: planImages,
    topic,
    title: row.title,
    depth: row.depth as "introductory",
    background: row.background as "beginner",
    minutes: row.minutes_target,
    sourceExcerpt: chunksForExcerpt
      .map((c) => `[${c.id}] ${c.text.slice(0, 700)}`)
      .join("\n\n")
      .slice(0, 9000),
    sectionTitles,
  });
  await ensureSceneRows(courseId, outcome.plan, { syncEdits: true });
  await db
    .update(courses)
    .set({
      plan: outcome.plan,
      status: "plan_ready",
      title: outcome.title || row.title,
      generator_label: outcome.generatorLabel,
      modelled: outcome.modelled,
      updated_at: new Date(),
    })
    .where(eq(courses.id, courseId));
  emit({ type: "step", course_id: courseId, step: "plan_ready", current: 0, total: 0 });
}

/* ------------------------------- generation ------------------------------- */

/** Parallel "agents" are independent scene writers, never hidden model calls. */
export function sceneConcurrency(options: GenerationOptions, settings: LumenSettings): number {
  if (options.parallel_agents !== true) return 1;
  const content = resolveSlot(settings, "content").config;
  // A local Ollama or no model should not queue competing writes or be called
  // "multiple agents" when only a deterministic local writer is running.
  if (content.provider === "ollama" || content.provider === "none" || !content.model) return 1;
  const requested = Number(settings.generation.max_parallel_scenes);
  const configured = Number.isFinite(requested) ? Math.min(4, Math.max(2, Math.round(requested))) : 2;
  const limit = Number(process.env.LUMEN_SCENE_CONCURRENCY);
  return Number.isFinite(limit) && limit > 0 ? Math.min(configured, Math.max(1, Math.floor(limit))) : configured;
}

async function synthesiseScene(
  settings: LumenSettings,
  voice: string,
  speed: number,
  scene: Scene,
): Promise<Scene> {
  const provider = ttsProviderFor(settings);
  if (provider.name === "none") {
    return {
      ...scene,
      segments: scene.segments.map((segment: Segment) => ({
        ...segment,
        estimated_duration_ms: estimateSegmentMs(segment.text, speed),
      })),
    };
  }
  const next: Scene = JSON.parse(JSON.stringify(scene));
  for (const segment of next.segments) {
    const outcome = await synthesizeSegment({
      provider,
      text: segment.text,
      voice,
      speed,
      estimatedMs: segment.estimated_duration_ms,
    });
    if (outcome.status === "unavailable") continue;
    segment.audio = { url: outcome.url, duration_ms: outcome.duration_ms };
  }
  return next;
}

export type GenerateResult = { started: boolean; reason?: string };

export async function startGeneration(courseId: string): Promise<GenerateResult> {
  if (!isUuid(courseId)) return { started: false, reason: "Course not found" };
  if (runningCourses.has(courseId)) {
    return { started: true };
  }
  const [row] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!row) return { started: false, reason: "Course not found" };
  const plan = row.plan as CoursePlan | null;
  if (!plan) return { started: false, reason: "This course has no plan yet" };
  await ensureSceneRows(courseId, plan);
  const allRows = await db
    .select({ id: scenesTable.id, status: scenesTable.status })
    .from(scenesTable)
    .where(eq(scenesTable.course_id, courseId));
  // Failed scenes are retryable individually; never silently regenerate every
  // failed scene when the learner asks for just one retry.
  const pending = allRows.filter((s) =>
    s.status === "pending" || s.status === "generating",
  );
  const total = allRows.length;
  if (!pending.length) {
    await finishCourse(courseId);
    return { started: true };
  }
  runningCourses.add(courseId);
  await db
    .update(courses)
    .set({ status: "generating", updated_at: new Date() })
    .where(eq(courses.id, courseId));
  await db.insert(jobs).values({
    course_id: courseId,
    kind: "generate",
    state: "running",
    step: "generating",
    current: total - pending.length,
    total,
  });
  emit({
    type: "step",
    course_id: courseId,
    step: "generating",
    current: total - pending.length,
    total,
  });
  void runGeneration(courseId)
    .catch(async (error: unknown) => {
      await db
        .update(jobs)
        .set({ state: "failed", error: (error as Error).message, updated_at: new Date() })
        .where(and(eq(jobs.course_id, courseId), eq(jobs.state, "running")));
      emit({ type: "error", course_id: courseId, error: (error as Error).message });
    })
    .finally(() => {
      runningCourses.delete(courseId);
      // A learner may have retried a scene while this job was already writing.
      // That newly-pending scene was not in the job's original snapshot.
      void db.select({ id: scenesTable.id }).from(scenesTable)
        .where(and(eq(scenesTable.course_id, courseId), eq(scenesTable.status, "pending")))
        .then((rows) => {
          if (rows.length) void startGeneration(courseId);
        })
        .catch(() => undefined);
    });
  return { started: true };
}

function findOutlineForSceneRow(
  plan: CoursePlan,
  sceneRow: { module_id: string; index: number; title: string },
) {
  const moduleIndex = plan.modules.findIndex((m) => m.id === sceneRow.module_id);
  const modulePlan = moduleIndex >= 0 ? plan.modules[moduleIndex] : undefined;
  if (!modulePlan) return { modulePlan: undefined, outline: undefined };

  const slot100 = sceneRow.index - moduleIndex * 100;
  if (slot100 >= 0 && slot100 < modulePlan.scenes.length) {
    return { modulePlan, outline: modulePlan.scenes[slot100] };
  }
  const slot10 = sceneRow.index - moduleIndex * 10;
  if (slot10 >= 0 && slot10 < modulePlan.scenes.length) {
    return { modulePlan, outline: modulePlan.scenes[slot10] };
  }
  const byTitle = modulePlan.scenes.find((s) => s.title === sceneRow.title);
  return { modulePlan, outline: byTitle ?? modulePlan.scenes[0] };
}

async function runGeneration(courseId: string): Promise<void> {
  const [row] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!row || !row.plan) return;
  const plan = row.plan as CoursePlan;
  const all = await db
    .select()
    .from(scenesTable)
    .where(eq(scenesTable.course_id, courseId))
    .orderBy(scenesTable.index);
  const todo = all.filter((s) => s.status === "pending" || s.status === "generating");
  const settings = await getSettings();
  const concurrency = sceneConcurrency(row.options, settings);
  let done = all.length - todo.length;
  for (let i = 0; i < todo.length; i += concurrency) {
    const batch = todo.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (sceneRow) => {
        try {
        const { modulePlan, outline } = findOutlineForSceneRow(plan, sceneRow);
        if (!modulePlan || !outline) {
          await db
            .update(scenesTable)
            .set({
              status: "failed",
              error: "This scene is no longer in the plan",
              updated_at: new Date(),
            })
            .where(eq(scenesTable.id, sceneRow.id));
          emit({
            type: "scene_failed",
            course_id: courseId,
            scene_index: sceneRow.index,
            title: sceneRow.title,
            error: "This scene is no longer in the plan",
          });
          return;
        }
        await db
          .update(scenesTable)
          .set({
            status: "generating",
            attempts: sceneRow.attempts + 1,
            updated_at: new Date(),
          })
          .where(eq(scenesTable.id, sceneRow.id));
        const chunks = await retrieveFor(
          courseId,
          row.material_ids,
          `${modulePlan.title}: ${outline.title}. ${outline.intent}`,
        );
        const wantImages = row.options.use_page_images !== false &&
          (hasModel(resolveSlot(settings, "content").config) ||
            (row.options.review_agent === true && hasModel(resolveSlot(settings, "reviewer").config)));
        const images = wantImages ? await imagesForChunks(chunks) : [];
        const context = {
          settings,
          images,
          courseTitle: row.title,
          topic: row.topic ?? row.title,
          depth: row.depth as "introductory" | "undergraduate" | "graduate",
          background: row.background as "beginner" | "familiar" | "advanced",
          module: modulePlan,
          outline,
          chunks,
          index: sceneRow.index,
        };
        let outcome = await generateScene(context);
        // A model's first answer can contain malformed KaTeX or a bad plot.
        // Make one correction call before marking only this scene retryable.
        if (!outcome.ok && resolveSlot(settings, "content").config.provider !== "none") {
          outcome = await generateScene({
            ...context,
            reviewFeedback: outcome.issues.slice(0, 6).join("; "),
          });
        }
        if (!outcome.ok) throw new Error(outcome.error);

        let review = await reviewScene({
          scene: outcome.scene,
          courseTitle: row.title,
          objective: modulePlan.objective,
          depth: row.depth,
          chunks,
          images,
          settings,
          modelReview: row.options.review_agent === true,
        });
        if (!review.ok) {
          const revision = await generateScene({
            ...context,
            reviewFeedback: review.findings
              .filter((finding) => finding.severity === "blocking")
              .map((finding) => `${finding.detail} Fix: ${finding.suggestion}`)
              .join("; ")
              .slice(0, 1700),
          });
          if (!revision.ok) {
            throw new Error(`The revised scene failed format checks: ${revision.error}`);
          }
          const secondReview = await reviewScene({
            scene: revision.scene,
            courseTitle: row.title,
            objective: modulePlan.objective,
            depth: row.depth,
            chunks,
            images,
            settings,
            modelReview: row.options.review_agent === true,
          });
          if (!secondReview.ok) {
            throw new Error(`Independent review still found a blocking issue: ${secondReview.findings.map((f) => f.detail).join("; ").slice(0, 450)}`);
          }
          review = secondReview;
          outcome = revision;
        }
        outcome.scene.review = {
          status: review.status,
          summary: [review.summary, ...outcome.notes].join(" ").slice(0, 850),
          ...(review.reviewedBy ? { reviewed_by: review.reviewedBy } : {}),
        };
        const withAudio = await synthesiseScene(
          settings,
          row.voice_id,
          row.voice_speed,
          outcome.scene,
        );
        await db
          .update(scenesTable)
          .set({ status: "ready", json: withAudio, error: null, updated_at: new Date() })
          .where(eq(scenesTable.id, sceneRow.id));
        done += 1;
        await db
          .update(jobs)
          .set({ current: done, updated_at: new Date() })
          .where(and(eq(jobs.course_id, courseId), eq(jobs.state, "running")));
        emit({
          type: "scene_ready",
          course_id: courseId,
          scene_index: sceneRow.index,
          title: withAudio.title,
          kind: withAudio.kind,
          current: done,
          total: all.length,
        });
        } catch (error) {
          const message = (error as Error).message.slice(0, 1200);
          await db.update(scenesTable)
            .set({ status: "failed", error: message, updated_at: new Date() })
            .where(eq(scenesTable.id, sceneRow.id));
          emit({
            type: "scene_failed",
            course_id: courseId,
            scene_index: sceneRow.index,
            title: sceneRow.title,
            error: message,
          });
        }
      }),
    );
  }
  await finishCourse(courseId);
}

async function finishCourse(courseId: string): Promise<void> {
  const document = await buildCourseDocument(courseId);
  const [row] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!row) return;
  const sceneRows = await db
    .select({ status: scenesTable.status })
    .from(scenesTable)
    .where(eq(scenesTable.course_id, courseId));
  const ready = sceneRows.filter((s) => s.status === "ready").length;
  const status = ready > 0 ? "ready" : "failed";
  await db
    .update(courses)
    .set({ status, document, updated_at: new Date() })
    .where(eq(courses.id, courseId));
  await db
    .update(jobs)
    .set({ state: "done", step: "done", updated_at: new Date() })
    .where(and(eq(jobs.course_id, courseId), eq(jobs.state, "running")));
  emit({ type: "done", course_id: courseId, status });
}

/** Retry a single failed scene. */
export async function retryScene(courseId: string, sceneId: string): Promise<boolean> {
  if (!isUuid(courseId) || !isUuid(sceneId)) return false;
  const [sceneRow] = await db
    .select()
    .from(scenesTable)
    .where(and(eq(scenesTable.id, sceneId), eq(scenesTable.course_id, courseId)))
    .limit(1);
  if (!sceneRow) return false;
  await db
    .update(scenesTable)
    .set({ status: "pending", error: null, updated_at: new Date() })
    .where(eq(scenesTable.id, sceneId));
  await startGeneration(courseId);
  return true;
}

/** Re-plan after the learner changed depth, time or background. */
export async function replan(courseId: string): Promise<void> {
  if (!isUuid(courseId)) return;
  await db.delete(scenesTable).where(eq(scenesTable.course_id, courseId));
  await runPlanning(courseId);
}

/* --------------------------- resume after restart ------------------------- */

const globalResume = globalThis as typeof globalThis & { __lumenResumed?: boolean };

export async function resumePendingWork(): Promise<void> {
  if (globalResume.__lumenResumed) return;
  globalResume.__lumenResumed = true;
  try {
    const rows = await db.select().from(courses).where(eq(courses.status, "generating"));
    for (const row of rows) {
      const pending = await db
        .select({ id: scenesTable.id })
        .from(scenesTable)
        .where(
          and(
            eq(scenesTable.course_id, row.id),
            inArray(scenesTable.status, ["pending", "generating"]),
          ),
        );
      if (pending.length) await startGeneration(row.id);
      else await finishCourse(row.id);
    }
    const planning = await db.select().from(courses).where(eq(courses.status, "planning"));
    for (const row of planning) {
      await runPlanning(row.id);
    }
  } catch {
    globalResume.__lumenResumed = false;
  }
}

export function estimatePlan(minutes: number, depth: string) {
  const modules = moduleCount(minutes);
  const narration = Math.round(minutes * 60 * 0.85);
  const teachScenes = Math.min(5, Math.max(1, Math.round(narration / modules / 90)));
  const whiteboards =
    depth === "graduate" ? modules : depth === "undergraduate" ? Math.min(2, modules) : 1;
  return {
    modules,
    scenes: modules * (teachScenes + 1),
    steps: whiteboards * 3,
    quizzes: modules,
  };
}

export function courseDuration(sceneList: Scene[]): number {
  return sceneList.reduce((acc, scene) => acc + sceneDurationMs(scene), 0);
}
