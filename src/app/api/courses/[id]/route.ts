import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses } from "@/db/schema";
import { fail, ok, errorResponse, readJson } from "@/server/http";
import { attachAudio, getCourseDetail, getCourseStatus, isUuid } from "@/server/courses";
import { sanitizeText } from "@/server/ingest";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await bootstrap();
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "That course does not exist", 404);
    const url = new URL(request.url);
    if (url.searchParams.get("view") === "status") {
      const status = await getCourseStatus(id);
      if (!status) return fail("not_found", "That course does not exist", 404);
      return ok(status, { headers: { "cache-control": "no-store" } });
    }
    if (url.searchParams.get("view") === "plan") {
      // Lightweight poll used by the plan editor while the planner works.
      const [row] = await db
        .select({
          status: courses.status,
          plan: courses.plan,
          title: courses.title,
          generator_label: courses.generator_label,
        })
        .from(courses)
        .where(eq(courses.id, id))
        .limit(1);
      if (!row) return fail("not_found", "That course does not exist", 404);
      return ok(
        {
          status: row.status,
          plan: row.plan,
          title: row.title,
          generator_label: row.generator_label,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    const detail = await getCourseDetail(id);
    if (!detail) return fail("not_found", "That course does not exist", 404);
    const withAudio = detail.course ? await attachAudio(detail.course) : null;
    if (url.searchParams.get("view") === "player" && withAudio) {
      return ok(withAudio);
    }
    return ok({ ...detail, course: withAudio });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "That course does not exist", 404);
    const body = await readJson<{
      title?: unknown;
      archived?: unknown;
    }>(request);
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (typeof body.title === "string" && sanitizeText(body.title).trim()) {
      patch.title = sanitizeText(body.title).trim().slice(0, 160);
    }
    if (typeof body.archived === "boolean") {
      patch.archived = body.archived;
    }
    const updated = await db
      .update(courses)
      .set(patch)
      .where(eq(courses.id, id))
      .returning({ id: courses.id });
    if (!updated.length) return fail("not_found", "That course does not exist", 404);
    return ok({ updated: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "That course does not exist", 404);
    const deleted = await db
      .delete(courses)
      .where(eq(courses.id, id))
      .returning({ id: courses.id });
    if (!deleted.length) return fail("not_found", "That course does not exist", 404);
    return ok({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
