import { bootstrap } from "@/server/bootstrap";
import { getPlayerPayload, isUuid, touchCourse } from "@/server/courses";
import { errorResponse, fail, ok } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await bootstrap();
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "That course does not exist", 404);
    const payload = await getPlayerPayload(id);
    if (!payload) return fail("not_found", "That course does not exist", 404);
    await touchCourse(id);
    return ok(payload, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
