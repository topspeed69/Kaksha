import { eq } from "drizzle-orm";
import { rm } from "node:fs/promises";
import path from "node:path";
import { storageRoot, uploadDir } from "@/server/storage";
import { db } from "@/db";
import { materials } from "@/db/schema";
import { fail, ok, errorResponse } from "@/server/http";
import { isUuid } from "@/server/courses";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "That material does not exist", 404);
    const [row] = await db.select().from(materials).where(eq(materials.id, id)).limit(1);
    if (!row) return fail("not_found", "That material does not exist", 404);
    return ok({
      id: row.id,
      label: row.label,
      status: row.status,
      section_count: row.section_count,
      chunk_count: row.chunk_count,
      pages: row.pages,
      processed_pages: row.pages === null
        ? null : row.sections.filter((section) => section.page !== undefined).length,
      warnings: row.warnings ?? [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return fail("not_found", "That material does not exist", 404);
    const deleted = await db
      .delete(materials)
      .where(eq(materials.id, id))
      .returning({ id: materials.id, path: materials.path });
    if (!deleted.length) return fail("not_found", "That material does not exist", 404);
    const storedPath = deleted[0].path;
    if (storedPath && path.resolve(storedPath).startsWith(`${path.resolve(uploadDir)}${path.sep}`)) {
      await rm(storedPath, { force: true }).catch(() => undefined);
    }
    await rm(path.join(storageRoot, "pages", id), { recursive: true, force: true }).catch(() => undefined);
    return ok({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
