import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  audio,
  chunks,
  courses,
  materials,
  progress,
  quizAttempts,
  scenes as scenesTable,
  type CourseRow,
  type MaterialRow,
  type SceneRow,
} from "@/db/schema";
import type {
  Background,
  Course,
  CoursePlan,
  Depth,
  GenerationOptions,
  Scene,
} from "@/lib/dsl/types";
import { sceneDurationMs } from "@/lib/dsl/validate";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function planSceneDbIndex(moduleIndex: number, sceneIndex: number): number {
  return moduleIndex * 100 + sceneIndex;
}

export type CourseSummary = {
  id: string;
  title: string;
  status: string;
  depth: Depth;
  source: { kind: string; label: string };
  minutes_target: number;
  generator: { label: string; modelled: boolean };
  scenes_ready: number;
  progress: {
    scenes_done: number;
    scenes_total: number;
    last_quiz_score: number | null;
  };
  last_opened_at: string | null;
  created_at: string;
  scene_kinds: { slide: number; whiteboard: number; quiz: number };
  quiz_count: number;
};

export async function listCourses(): Promise<CourseSummary[]> {
  const rows = await db.select().from(courses).orderBy(desc(courses.updated_at));
  if (!rows.length) return [];

  const courseIds = rows.map((r) => r.id);
  const [allScenes, allAttempts, allProgress] = await Promise.all([
    db
      .select({
        course_id: scenesTable.course_id,
        index: scenesTable.index,
        status: scenesTable.status,
        kind: scenesTable.kind,
      })
      .from(scenesTable)
      .where(inArray(scenesTable.course_id, courseIds)),
    db
      .select({
        course_id: quizAttempts.course_id,
        result: quizAttempts.result,
      })
      .from(quizAttempts)
      .where(and(inArray(quizAttempts.course_id, courseIds), eq(quizAttempts.final, true))),
    db
      .select()
      .from(progress)
      .where(inArray(progress.course_id, courseIds)),
  ]);

  const scenesByCourse = new Map<string, typeof allScenes>();
  for (const s of allScenes) {
    const list = scenesByCourse.get(s.course_id) ?? [];
    list.push(s);
    scenesByCourse.set(s.course_id, list);
  }

  const attemptsByCourse = new Map<string, number[]>();
  for (const a of allAttempts) {
    const score = a.result?.score;
    if (typeof score === "number") {
      const list = attemptsByCourse.get(a.course_id) ?? [];
      list.push(score);
      attemptsByCourse.set(a.course_id, list);
    }
  }

  const progressByCourse = new Map(allProgress.map((p) => [p.course_id, p]));

  return rows.map((row) => {
    const sceneRows = scenesByCourse.get(row.id) ?? [];
    const scores = attemptsByCourse.get(row.id) ?? [];
    const prog = progressByCourse.get(row.id);
    const readyCount = sceneRows.filter((s) => s.status === "ready").length;
    const totalCount = sceneRows.length;
    const watchedSet = new Set<number>(prog?.scenes_done ?? []);
    if (prog && (prog.t_ms > 0 || prog.scene_index > 0) && totalCount > 0) {
      watchedSet.add(Math.min(prog.scene_index, totalCount - 1));
    }
    const watchedCount = Math.min(totalCount, watchedSet.size);
    const effectiveStatus = row.archived ? "archived" : row.status;

    return {
      id: row.id,
      title: row.title,
      status: effectiveStatus,
      depth: row.depth as Depth,
      source: { kind: row.source_kind, label: row.source_label },
      minutes_target: row.minutes_target,
      generator: { label: row.generator_label, modelled: row.modelled },
      scenes_ready: readyCount,
      progress: {
        scenes_done: effectiveStatus === "generating" ? readyCount : watchedCount,
        scenes_total: totalCount,
        last_quiz_score: scores.length
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100)
          : null,
      },
      last_opened_at: row.last_opened_at?.toISOString() ?? null,
      created_at: row.created_at.toISOString(),
      scene_kinds: {
        slide: sceneRows.filter((s) => s.kind === "slide").length,
        whiteboard: sceneRows.filter((s) => s.kind === "whiteboard").length,
        quiz: sceneRows.filter((s) => s.kind === "quiz").length,
      },
      quiz_count: sceneRows.filter((s) => s.kind === "quiz").length,
    };
  });
}

export type MaterialSummary = {
  id: string;
  label: string;
  kind: string;
  status: string;
  section_count: number;
  chunk_count: number;
  pages: number | null;
  processed_pages: number | null;
  warnings: string[];
  error: string | null;
};

export async function listMaterials(): Promise<MaterialSummary[]> {
  const rows = await db.select().from(materials).orderBy(desc(materials.created_at));
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    kind: row.kind,
    status: row.status,
    section_count: row.section_count,
    chunk_count: row.chunk_count,
    pages: row.pages,
    processed_pages: row.pages === null ? null : row.sections.filter((section) => section.page !== undefined).length,
    warnings: row.warnings ?? [],
    error: row.error,
  }));
}

function assembleCourseFromRows(
  row: CourseRow,
  sceneRows: SceneRow[],
  materialRows: MaterialRow[],
): Course {
  const plan = row.plan as CoursePlan | null;
  const readyScenes = sceneRows.filter((s) => s.status === "ready" && s.json);
  const byIndex = new Map(readyScenes.map((s) => [s.index, s.json as Scene]));
  const materialLabels = materialRows.map((m) => m.label);

  const modules = (plan?.modules ?? []).map((modulePlan, moduleIndex) => ({
    id: modulePlan.id,
    index: moduleIndex,
    title: modulePlan.title,
    objectives: modulePlan.objectives,
    duration_min: modulePlan.duration_min,
    prerequisites: modulePlan.prerequisites,
    scenes: modulePlan.scenes
      .map(
        (_outline, i) =>
          byIndex.get(planSceneDbIndex(moduleIndex, i)) ??
          (i < 10 ? byIndex.get(moduleIndex * 10 + i) : undefined),
      )
      .filter((scene): scene is Scene => Boolean(scene)),
  }));

  const assembledModules = modules.filter((m) => m.scenes.length > 0);
  if (!assembledModules.length && row.document) {
    return row.document;
  }

  return {
    version: 1,
    id: row.id,
    title: row.title,
    source: {
      kind: row.source_kind,
      label: materialLabels.length
        ? materialLabels.join(", ")
        : row.source_kind === "topic"
          ? "your topic (no reference material)"
          : row.source_label,
      material_ids: row.material_ids,
    },
    depth: row.depth as Depth,
    background: row.background as Background,
    minutes_target: row.minutes_target,
    language: "en",
    voice: { id: row.voice_id, speed: row.voice_speed },
    status: (row.archived ? "archived" : row.status) as Course["status"],
    generator: { label: row.generator_label, modelled: row.modelled },
    modules: assembledModules,
  };
}

/** Build the playable course document from the plan and the stored scenes. */
export async function buildCourseDocument(courseId: string): Promise<Course | null> {
  if (!isUuid(courseId)) return null;
  const [row] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!row) return null;
  const validMaterialIds = (row.material_ids ?? []).filter(isUuid);
  const [sceneRows, materialRows] = await Promise.all([
    db
      .select()
      .from(scenesTable)
      .where(eq(scenesTable.course_id, courseId))
      .orderBy(scenesTable.index),
    validMaterialIds.length
      ? db.select().from(materials).where(inArray(materials.id, validMaterialIds))
      : Promise.resolve([] as MaterialRow[]),
  ]);
  return assembleCourseFromRows(row, sceneRows, materialRows);
}

export type CourseDetail = {
  course: Course | null;
  plan: CoursePlan | null;
  status: string;
  title: string;
  topic: string | null;
  minutes_target: number;
  depth: Depth;
  background: Background;
  voice: { id: string; speed: number };
  options: GenerationOptions;
  scenes: {
    id: string;
    index: number;
    module_id: string;
    kind: string;
    title: string;
    status: string;
    error: string | null;
    attempts: number;
    duration_ms: number | null;
  }[];
  materials: MaterialSummary[];
  progress: { scene_index: number; t_ms: number; scenes_done: number[] };
  source_kind: string;
};

export async function getCourseDetail(courseId: string): Promise<CourseDetail | null> {
  if (!isUuid(courseId)) return null;
  const [row] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!row) return null;
  const validMaterialIds = (row.material_ids ?? []).filter(isUuid);
  const [sceneRows, progressRows, materialRows] = await Promise.all([
    db
      .select()
      .from(scenesTable)
      .where(eq(scenesTable.course_id, courseId))
      .orderBy(scenesTable.index),
    db.select().from(progress).where(eq(progress.course_id, courseId)).limit(1),
    validMaterialIds.length
      ? db.select().from(materials).where(inArray(materials.id, validMaterialIds))
      : Promise.resolve([] as MaterialRow[]),
  ]);
  const progressRow = progressRows[0];
  const document = assembleCourseFromRows(row, sceneRows, materialRows);
  return {
    course: document,
    plan: row.plan as CoursePlan | null,
    status: row.archived ? "archived" : row.status,
    title: row.title,
    topic: row.topic,
    minutes_target: row.minutes_target,
    depth: row.depth as Depth,
    background: row.background as Background,
    voice: { id: row.voice_id, speed: row.voice_speed },
    options: row.options,
    scenes: sceneRows.map((s) => ({
      id: s.id,
      index: s.index,
      module_id: s.module_id,
      kind: s.kind,
      title: s.title,
      status: s.status,
      error: s.error,
      attempts: s.attempts,
      duration_ms: s.json ? sceneDurationMs(s.json as Scene) : null,
    })),
    materials: materialRows.map((m) => ({
      id: m.id,
      label: m.label,
      kind: m.kind,
      status: m.status,
      section_count: m.section_count,
      chunk_count: m.chunk_count,
      pages: m.pages,
      processed_pages: m.pages === null ? null : m.sections.filter((section) => section.page !== undefined).length,
      warnings: m.warnings ?? [],
      error: m.error,
    })),
    progress: {
      scene_index: progressRow?.scene_index ?? 0,
      t_ms: progressRow?.t_ms ?? 0,
      scenes_done: progressRow?.scenes_done ?? [],
    },
    source_kind: row.source_kind,
  };
}

/** Attach real audio to every segment that has a cached file. */
export async function attachAudio(course: Course): Promise<Course> {
  const all = course.modules.flatMap((m) => m.scenes.flatMap((s) => s.segments));
  // Durations are persisted with the scene. Only repair missing/zero durations.
  const hashes = [
    ...new Set(
      all
        .filter((s) => s.audio && (!s.audio.duration_ms || s.audio.duration_ms <= 0))
        .map((s) => s.audio?.url.match(/([a-f0-9]{8,64})\.mp3$/)?.[1])
        .filter((h): h is string => Boolean(h)),
    ),
  ];
  if (!hashes.length) return course;
  const rows = await db.select().from(audio).where(inArray(audio.hash, hashes));
  const byHash = new Map(rows.map((r) => [r.hash, r]));
  const next: Course = JSON.parse(JSON.stringify(course));
  for (const moduleBlock of next.modules) {
    for (const scene of moduleBlock.scenes) {
      for (const segment of scene.segments) {
        const hash = segment.audio?.url.match(/([a-f0-9]{8,64})\.mp3$/)?.[1];
        if (hash) {
          const row = byHash.get(hash);
          if (row) segment.audio = { url: `/api/media/audio/${hash}.mp3`, duration_ms: row.duration_ms };
        }
      }
    }
  }
  return next;
}

export async function touchCourse(courseId: string): Promise<void> {
  if (!isUuid(courseId)) return;
  await db
    .update(courses)
    .set({ last_opened_at: new Date() })
    .where(eq(courses.id, courseId));
}

export async function sourceChunksFor(
  materialIds: string[],
  query: string,
  k: number,
  embeddings: { vector: number[]; model: string },
): Promise<{ id: string; text: string; section_ref: string | null; page: number | null }[]> {
  void query;
  const validIds = materialIds.filter(isUuid);
  if (!validIds.length) return [];
  const rows = await db
    .select()
    .from(chunks)
    .where(inArray(chunks.material_id, validIds));
  if (!rows.length) return [];
  const scored = rows.map((row) => ({
    row,
    score:
      row.embedding && row.embedding.length === embeddings.vector.length
        ? row.embedding.reduce((acc, v, i) => acc + v * embeddings.vector[i], 0)
        : 0,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(({ row }) => ({
    id: row.id,
    text: row.text,
    section_ref: row.section_ref,
    page: row.page,
    material_id: row.material_id,
  }));
}

export async function chunksByIds(ids: string[]): Promise<
  { id: string; text: string; section_ref: string | null; page: number | null; material_id: string }[]
> {
  const validIds = ids.filter(isUuid);
  if (!validIds.length) return [];
  const rows = await db.select().from(chunks).where(inArray(chunks.id, validIds));
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    section_ref: row.section_ref,
    page: row.page,
    material_id: row.material_id,
  }));
}

export type CourseStatusSummary = {
  status: string;
  scenes: {
    id: string;
    index: number;
    module_id: string;
    kind: string;
    title: string;
    status: string;
    error: string | null;
    attempts: number;
  }[];
  counts: { ready: number; failed: number; total: number };
  updated_at: string;
};

/** Metadata-only polling payload. Never reads scene JSON or the assembled document. */
export async function getCourseStatus(courseId: string): Promise<CourseStatusSummary | null> {
  if (!isUuid(courseId)) return null;
  const [row] = await db
    .select({ id: courses.id, status: courses.status, archived: courses.archived, updated_at: courses.updated_at })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  if (!row) return null;
  const sceneRows = await db
    .select({
      id: scenesTable.id,
      index: scenesTable.index,
      module_id: scenesTable.module_id,
      kind: scenesTable.kind,
      title: scenesTable.title,
      status: scenesTable.status,
      error: scenesTable.error,
      attempts: scenesTable.attempts,
    })
    .from(scenesTable)
    .where(eq(scenesTable.course_id, courseId))
    .orderBy(scenesTable.index);
  return {
    status: row.archived ? "archived" : row.status,
    scenes: sceneRows,
    counts: {
      ready: sceneRows.filter((scene) => scene.status === "ready").length,
      failed: sceneRows.filter((scene) => scene.status === "failed").length,
      total: sceneRows.length,
    },
    updated_at: row.updated_at.toISOString(),
  };
}

export type PlayerPayload = {
  course: Course;
  progress: { scene_index: number; t_ms: number; scenes_done: number[] };
};

/** Lean player read: reuse the assembled document for ready courses. */
export async function getPlayerPayload(courseId: string): Promise<PlayerPayload | null> {
  if (!isUuid(courseId)) return null;
  const [row] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!row) return null;
  let document: Course | null = null;
  if ((row.status === "ready" || row.archived) && row.document?.modules?.length) {
    document = row.document;
  } else {
    document = await buildCourseDocument(courseId);
  }
  if (!document) return null;
  const [progressRow] = await db
    .select()
    .from(progress)
    .where(eq(progress.course_id, courseId))
    .limit(1);
  return {
    course: await attachAudio(document),
    progress: {
      scene_index: progressRow?.scene_index ?? 0,
      t_ms: progressRow?.t_ms ?? 0,
      scenes_done: progressRow?.scenes_done ?? [],
    },
  };
}

export async function quizScoreFor(courseId: string): Promise<number | null> {
  if (!isUuid(courseId)) return null;
  const attempts = await db
    .select({ result: quizAttempts.result })
    .from(quizAttempts)
    .where(and(eq(quizAttempts.course_id, courseId), eq(quizAttempts.final, true)));
  const scores = attempts
    .map((a) => a.result?.score)
    .filter((s): s is number => typeof s === "number");
  if (!scores.length) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100);
}
