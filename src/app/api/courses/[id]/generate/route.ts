import { fail, ok, errorResponse } from "@/server/http";
import { isUuid } from "@/server/courses";
import { startGeneration } from "@/server/pipeline/runner";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "Course not found", 404);
    const result = await startGeneration(id);
    if (!result.started) {
      const status = result.reason === "Course not found" ? 404 : 409;
      return fail("cannot_generate", result.reason ?? "Cannot generate", status);
    }
    return ok({ started: true }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
