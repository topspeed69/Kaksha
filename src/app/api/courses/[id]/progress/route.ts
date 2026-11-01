import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, progress } from "@/db/schema";
import { fail, ok, errorResponse, readJson } from "@/server/http";
import { getCourseDetail, isUuid, touchCourse } from "@/server/courses";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "Not found", 404);
    const detail = await getCourseDetail(id);
    if (!detail) return fail("not_found", "Not found", 404);
    return ok(detail.progress);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "Not found", 404);
    const [courseExists] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(eq(courses.id, id))
      .limit(1);
    if (!courseExists) return fail("not_found", "Not found", 404);

    const body = await readJson<{
      scene_index?: unknown;
      t_ms?: unknown;
      scenes_done?: unknown;
    }>(request);

    const rawScene = Number(body.scene_index ?? 0);
    const rawTime = Number(body.t_ms ?? 0);
    if (!Number.isFinite(rawScene) || !Number.isFinite(rawTime)) {
      return fail("invalid_progress", "scene_index and t_ms must be finite numbers", 400);
    }
    const sceneIndex = Math.max(0, Math.min(1000, Math.round(rawScene)));
    const tMs = Math.max(0, Math.min(86_400_000, Math.round(rawTime)));

    const [existing] = await db
      .select()
      .from(progress)
      .where(eq(progress.course_id, id))
      .limit(1);

    const mergedDone = new Set<number>(existing?.scenes_done ?? []);
    if (Array.isArray(body.scenes_done)) {
      for (const n of body.scenes_done) {
        const idx = Number(n);
        if (Number.isInteger(idx) && idx >= 0 && idx < 1000) mergedDone.add(idx);
      }
    }
    if (tMs > 0 || sceneIndex > 0) {
      mergedDone.add(sceneIndex);
    }
    const scenesDone = [...mergedDone].sort((a, b) => a - b);

    await db
      .insert(progress)
      .values({
        course_id: id,
        scene_index: sceneIndex,
        t_ms: tMs,
        scenes_done: scenesDone,
        updated_at: new Date(),
      })
      .onConflictDoUpdate({
        target: progress.course_id,
        set: {
          scene_index: sceneIndex,
          t_ms: tMs,
          scenes_done: scenesDone,
          updated_at: new Date(),
        },
      });
    await touchCourse(id);
    return ok({ saved: true, scenes_done: scenesDone });
  } catch (error) {
    return errorResponse(error);
  }
}
