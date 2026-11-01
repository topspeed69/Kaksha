import { fail, ok, errorResponse } from "@/server/http";
import { retryScene } from "@/server/pipeline/runner";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { id, sid } = await params;
    const started = await retryScene(id, sid);
    if (!started) return fail("not_found", "That scene does not exist", 404);
    return ok({ started: true }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
