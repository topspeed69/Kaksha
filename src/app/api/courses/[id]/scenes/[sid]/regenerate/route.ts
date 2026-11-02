import { fail, ok, errorResponse, readJson } from "@/server/http";
import { isUuid } from "@/server/courses";
import { regenerateScene } from "@/server/pipeline/runner";

export const dynamic = "force-dynamic";

/**
 * Rewrite one scene that has already been generated. Works whether the scene
 * passed its review or not: the learner can always ask for a better version,
 * and the visual findings are handed to the writer as a focused correction.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { id, sid } = await params;
    if (!isUuid(id) || !isUuid(sid)) {
      return fail("not_found", "That scene does not exist", 404);
    }
    const body = await readJson<{ feedback?: unknown }>(request).catch(() => ({}) as { feedback?: unknown });
    const feedback = typeof body.feedback === "string" ? body.feedback.slice(0, 600) : "";
    const started = await regenerateScene(id, sid, feedback);
    if (!started) return fail("not_found", "That scene does not exist", 404);
    return ok({ started: true }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
