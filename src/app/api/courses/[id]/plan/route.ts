import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { fail, ok, errorResponse, readJson } from "@/server/http";
import { getCourseDetail, isUuid } from "@/server/courses";
import { ensureSceneRows, replan, runPlanning } from "@/server/pipeline/runner";
import { sanitizeText } from "@/server/ingest";
import type { Background, Bloom, CoursePlan, Depth } from "@/lib/dsl/types";

export const dynamic = "force-dynamic";

const VALID_DEPTHS = new Set<Depth>(["introductory", "undergraduate", "graduate"]);
const VALID_BACKGROUNDS = new Set<Background>(["beginner", "familiar", "advanced"]);
const VALID_SCENE_KINDS = new Set(["slide", "whiteboard", "quiz"] as const);
const VALID_BLOOMS = new Set<Bloom>(["remember", "understand", "apply", "analyze", "evaluate"]);

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "That course does not exist", 404);
    const detail = await getCourseDetail(id);
    if (!detail) return fail("not_found", "That course does not exist", 404);
    return ok({ plan: detail.plan, status: detail.status, title: detail.title });
  } catch (error) {
    return errorResponse(error);
  }
}

function sanitizePlan(raw: CoursePlan, fallback: { depth: Depth; background: Background; minutes: number }): CoursePlan | null {
  if (!raw || !Array.isArray(raw.modules) || !raw.modules.length) return null;
  const modules = raw.modules
    .slice(0, 12)
    .map((m, mi) => {
      if (!m || !Array.isArray(m.scenes)) return null;
      const scenes = m.scenes
        .slice(0, 20)
        .map((s, si) => {
          if (!s || typeof s !== "object") return null;
          const kind = VALID_SCENE_KINDS.has(s.kind) ? s.kind : "slide";
          const estRaw = Number(s.est_seconds);
          const est_seconds = Number.isFinite(estRaw)
            ? Math.min(600, Math.max(30, Math.round(estRaw)))
            : 90;
          return {
            id: typeof s.id === "string" && s.id.trim() ? sanitizeText(s.id).slice(0, 40) : `mod${mi + 1}-sc${si + 1}`,
            index: si,
            title: sanitizeText(String(s.title ?? `Scene ${si + 1}`)).trim().slice(0, 140) || `Scene ${si + 1}`,
            kind,
            intent: sanitizeText(String(s.intent ?? "Teach this part of the module.")).trim().slice(0, 400) || "Teach this part of the module.",
            est_seconds,
          };
        })
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      if (!scenes.length) return null;
      const totalEst = scenes.reduce((acc, s) => acc + s.est_seconds, 0);
      const objectives = (Array.isArray(m.objectives) ? m.objectives : [])
        .slice(0, 6)
        .map((o, oi) => ({
          id: typeof o?.id === "string" && o.id ? sanitizeText(o.id).slice(0, 24) : `obj${oi + 1}`,
          text: sanitizeText(String(o?.text ?? "Understand the key idea")).trim().slice(0, 240) || "Understand the key idea",
          bloom: VALID_BLOOMS.has(o?.bloom) ? o.bloom : ("understand" as Bloom),
        }));
      return {
        id: typeof m.id === "string" && m.id.trim() ? sanitizeText(m.id).slice(0, 40) : `mod${mi + 1}`,
        index: mi,
        title: sanitizeText(String(m.title ?? `Module ${mi + 1}`)).trim().slice(0, 140) || `Module ${mi + 1}`,
        objective: sanitizeText(String(m.objective ?? "Master this module")).trim().slice(0, 300) || "Master this module",
        objectives: objectives.length
          ? objectives
          : [{ id: "obj1", text: "Understand the main concept", bloom: "understand" as Bloom }],
        prerequisites: (Array.isArray(m.prerequisites) ? m.prerequisites : [])
          .slice(0, 8)
          .map((p) => sanitizeText(String(p)).slice(0, 120)),
        prerequisite_note:
          typeof m.prerequisite_note === "string" && m.prerequisite_note.trim()
            ? sanitizeText(m.prerequisite_note).slice(0, 260)
            : undefined,
        duration_min: Math.max(1, Math.round(totalEst / 60)),
        est_seconds: totalEst,
        scenes,
      };
    })
    .filter((m): m is NonNullable<typeof m> => Boolean(m));

  if (!modules.length) return null;
  return {
    version: 1,
    depth: VALID_DEPTHS.has(raw.depth) ? raw.depth : fallback.depth,
    background: VALID_BACKGROUNDS.has(raw.background) ? raw.background : fallback.background,
    minutes_target: Number.isFinite(Number(raw.minutes_target))
      ? Math.min(90, Math.max(15, Math.round(Number(raw.minutes_target))))
      : fallback.minutes,
    rationale: sanitizeText(String(raw.rationale ?? "")).slice(0, 500),
    concepts: (Array.isArray(raw.concepts) ? raw.concepts : [])
      .slice(0, 15)
      .filter((c) => c && typeof c.name === "string" && c.name.trim())
      .map((c) => ({
        name: sanitizeText(c.name).slice(0, 80),
        definition: sanitizeText(String(c.definition ?? "")).slice(0, 240),
      })),
    modules,
  };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "That course does not exist", 404);
    const existing = await getCourseDetail(id);
    if (!existing) return fail("not_found", "That course does not exist", 404);

    const body = await readJson<{ plan?: CoursePlan; replan?: boolean }>(request);
    if (body.replan) {
      const nextDepth =
        body.plan?.depth && VALID_DEPTHS.has(body.plan.depth) ? body.plan.depth : existing.depth;
      const nextBg =
        body.plan?.background && VALID_BACKGROUNDS.has(body.plan.background)
          ? body.plan.background
          : existing.background;
      const rawMin = Number(body.plan?.minutes_target);
      const nextMin = Number.isFinite(rawMin)
        ? Math.min(90, Math.max(15, Math.round(rawMin)))
        : existing.minutes_target;

      await db
        .update(courses)
        .set({
          depth: nextDepth,
          background: nextBg,
          minutes_target: nextMin,
          updated_at: new Date(),
        })
        .where(eq(courses.id, id));
      await replan(id);
      const detail = await getCourseDetail(id);
      return ok({ plan: detail?.plan ?? null, status: detail?.status });
    }
    if (!body.plan) {
      return fail("invalid_plan", "A plan object is required");
    }
    const cleaned = sanitizePlan(body.plan, {
      depth: existing.depth,
      background: existing.background,
      minutes: existing.minutes_target,
    });
    if (!cleaned) {
      return fail("invalid_plan", "A plan needs at least one module with at least one scene");
    }
    await ensureSceneRows(id, cleaned, { syncEdits: true });
    await db
      .update(courses)
      .set({ plan: cleaned, status: "plan_ready", updated_at: new Date() })
      .where(eq(courses.id, id));
    return ok({ plan: cleaned, status: "plan_ready" });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "That course does not exist", 404);
    const existing = await getCourseDetail(id);
    if (!existing) return fail("not_found", "That course does not exist", 404);
    await runPlanning(id);
    const detail = await getCourseDetail(id);
    return ok({ plan: detail?.plan ?? null, status: detail?.status });
  } catch (error) {
    return errorResponse(error);
  }
}
