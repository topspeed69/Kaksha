import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, scenes } from "@/db/schema";
import { fail, ok, errorResponse } from "@/server/http";
import { isUuid } from "@/server/courses";
import { getSettings } from "@/server/settings";
import { visualReview, auditSceneVisuals } from "@/server/pipeline/visual-review";
import type { Scene } from "@/lib/dsl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Visual review for a whole course.
 *
 * Runs the deterministic audit for every scene (free and instant), then asks
 * the reviewer model about the scenes in parallel. A model that cannot see
 * images is never sent one: the request carries the scene JSON only.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "That course does not exist", 404);

    const body = (await request.json().catch(() => ({}))) as {
      model?: unknown;
      sceneIds?: unknown;
    };
    const useModel = body.model !== false;

    const [course] = await db
      .select({ topic: courses.topic, title: courses.title, depth: courses.depth })
      .from(courses)
      .where(eq(courses.id, id))
      .limit(1);
    if (!course) return fail("not_found", "That course does not exist", 404);

    const rows = await db
      .select()
      .from(scenes)
      .where(and(eq(scenes.course_id, id), eq(scenes.status, "ready")))
      .orderBy(scenes.index);

    const wanted = Array.isArray(body.sceneIds)
      ? new Set(body.sceneIds.filter((value): value is string => typeof value === "string"))
      : null;
    const targets = wanted ? rows.filter((row) => wanted.has(row.id)) : rows;
    if (!targets.length) {
      return ok({ audits: [], reviewed: 0, model: false });
    }

    const settings = await getSettings();
    const topic = course.topic ?? course.title ?? "this lesson";

    // The reviewer model is called a few scenes at a time so a long lesson
    // cannot blow through the provider's rate limit.
    const concurrency = 3;
    const audits: { sceneId: string; index: number; audit: Awaited<ReturnType<typeof auditSceneVisuals>> }[] = [];
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      audits.push(
        ...(await Promise.all(
          batch.map(async (row) => {
        const scene = row.json as Scene;
        const deterministic = auditSceneVisuals(scene, {
          topic,
          depth: course.depth,
        });
        if (!useModel) return { sceneId: row.id, index: row.index, audit: deterministic };
        const audit = await visualReview({
          scene,
          topic,
          depth: course.depth,
          settings,
          screenshot: null,
        });
        await db
          .update(scenes)
          .set({ json: { ...scene, visual: audit } })
          .where(eq(scenes.id, row.id));
        return { sceneId: row.id, index: row.index, audit };
          }),
        )),
      );
    }

    const blocking = audits.filter(
      (entry) => entry.audit.findings.some((finding) => finding.severity === "blocking"),
    ).length;

    return ok({
      audits,
      reviewed: audits.length,
      blocking,
      model: useModel,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
