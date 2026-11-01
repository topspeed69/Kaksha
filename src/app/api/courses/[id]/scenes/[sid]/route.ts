import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenes } from "@/db/schema";
import { fail, ok, errorResponse } from "@/server/http";
import { isUuid } from "@/server/courses";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  try {
    const { id, sid } = await params;
    if (!isUuid(id) || !isUuid(sid)) {
      return fail("not_found", "That scene does not exist", 404);
    }
    const [row] = await db
      .select()
      .from(scenes)
      .where(and(eq(scenes.course_id, id), eq(scenes.id, sid)))
      .limit(1);
    if (!row) return fail("not_found", "That scene does not exist", 404);
    return ok({ scene: row.json, status: row.status, error: row.error });
  } catch (error) {
    return errorResponse(error);
  }
}
