import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { courses, scenes } from "@/db/schema";
import { fail, ok, errorResponse } from "@/server/http";
import { isUuid } from "@/server/courses";
import { getSettings } from "@/server/settings";
import {
  parseDataUrl,
  visualReview,
  auditSceneVisuals,
} from "@/server/pipeline/visual-review";
import type { Scene } from "@/lib/dsl/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function loadScene(courseId: string, sceneId: string) {
  if (!isUuid(courseId)) return null;
  // Accept either the database row id or the lesson-format scene id ("sc3"),
  // because the player only knows the latter.
  const [row] = await db
    .select()
    .from(scenes)
    .where(
      isUuid(sceneId)
        ? and(eq(scenes.course_id, courseId), eq(scenes.id, sceneId))
        : and(
            eq(scenes.course_id, courseId),
            sql`${scenes.json}->>'id' = ${sceneId}`,
          ),
    )
    .limit(1);
  if (!row?.json) return null;
  const [course] = await db
    .select()
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  return {
    row,
    scene: row.json as Scene,
    topic: course?.topic ?? course?.title ?? "this lesson",
    depth: course?.depth,
  };
}

/** Fast, model-free audit. Safe to call on every scene render. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  try {
    const { id, sid } = await params;
    const loaded = await loadScene(id, sid);
    if (!loaded) return fail("not_found", "That scene does not exist", 404);
    const audit = auditSceneVisuals(loaded.scene, {
      topic: loaded.topic,
      depth: loaded.depth,
    });
    return ok({ audit });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Visual agent review. Optionally accepts a rendered screenshot of the scene
 * from the browser (`image`: a PNG/JPEG data URL) so a vision model can inspect
 * the actual pixels, not just the scene JSON.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  try {
    const { id, sid } = await params;
    const loaded = await loadScene(id, sid);
    if (!loaded) return fail("not_found", "That scene does not exist", 404);

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const rawImage = typeof body.image === "string" ? body.image : "";
    // A screenshot is a few hundred kilobytes; anything larger is refused
    // rather than decoded.
    if (rawImage.length > 4_000_000) {
      return fail("payload_too_large", "The screenshot is too large to review", 413);
    }
    const screenshot = rawImage ? parseDataUrl(rawImage) : null;
    if (rawImage && !screenshot) {
      return fail("bad_request", "image must be a PNG or JPEG data URL", 400);
    }

    const settings = await getSettings();
    const audit = await visualReview({
      scene: loaded.scene,
      topic: loaded.topic,
      depth: loaded.depth,
      settings,
      screenshot,
      deterministicOnly: body.model === false,
    });

    // Persist the audit on the scene document so the player can show it later
    // without paying for another review.
    if (body.persist !== false) {
      const nextScene = { ...loaded.scene, visual: audit } as Scene;
      await db
        .update(scenes)
        .set({ json: nextScene })
        .where(eq(scenes.id, loaded.row.id));
    }

    return ok({ audit, screenshot: audit.saw_screenshot });
  } catch (error) {
    return errorResponse(error);
  }
}
