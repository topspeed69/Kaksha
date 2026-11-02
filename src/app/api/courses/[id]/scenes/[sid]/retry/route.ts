import { fail, ok, errorResponse } from "@/server/http";
import { retryScene } from "@/server/pipeline/runner";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sid: string }> }) {
  try {
    const { id, sid } = await params;
    let strong = false;
    try {
      const body = (await request.json()) as { strong?: unknown };
      strong = body?.strong === true;
    } catch {
      // no body is fine; the default is a normal retry
    }
    const started = await retryScene(id, sid, strong);
    if (!started) return fail("not_found", "That scene does not exist", 404);
    return ok({ started: true, escalated: strong }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
