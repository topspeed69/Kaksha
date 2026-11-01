import { eq } from "drizzle-orm";
import { db } from "@/db";
import { materials } from "@/db/schema";
import { fail, ok, errorResponse, readJson } from "@/server/http";
import { ingestFile, ingestText, ingestUrl } from "@/server/ingest";
import { getSettings } from "@/server/settings";
import { listMaterials } from "@/server/courses";
import { bootstrap } from "@/server/bootstrap";
import { maxPdfPages } from "@/server/ingest/pdf";

export const dynamic = "force-dynamic";

export async function GET() {
  await bootstrap();
  return ok({ materials: await listMaterials(), limits: { max_pdf_pages: maxPdfPages() } });
}

export async function POST(request: Request) {
  await bootstrap();
  try {
    const settings = await getSettings();
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return fail("no_file", "No file was uploaded");
      const outcome = await ingestFile({ file, settings });
      if (outcome.status === "failed") {
        return fail("ingest_failed", outcome.error ?? "The file could not be read", 422);
      }
      const [row] = await db
        .select()
        .from(materials)
        .where(eq(materials.id, outcome.materialId))
        .limit(1);
      return ok({
        id: outcome.materialId,
        status: "ready",
        warnings: outcome.warnings,
        label: row?.label ?? file.name,
        section_count: row?.section_count ?? 0,
        chunk_count: row?.chunk_count ?? 0,
        pages: row?.pages ?? null,
        processed_pages: row?.pages === null || row?.pages === undefined
          ? null : row.sections.filter((section) => section.page !== undefined).length,
      });
    }
    const body = await readJson<{ url?: unknown; text?: unknown; label?: unknown }>(request);
    if (typeof body.url === "string" && body.url.trim()) {
      const outcome = await ingestUrl({ url: body.url.trim(), settings });
      if (outcome.status === "failed") {
        return fail("ingest_failed", outcome.error ?? "Could not fetch that address", 422);
      }
      const [row] = await db
        .select()
        .from(materials)
        .where(eq(materials.id, outcome.materialId))
        .limit(1);
      return ok({
        id: outcome.materialId,
        status: "ready",
        warnings: outcome.warnings,
        label: row?.label ?? body.url,
        section_count: row?.section_count ?? 0,
        chunk_count: row?.chunk_count ?? 0,
        pages: row?.pages ?? null,
        processed_pages: row?.pages === null || row?.pages === undefined
          ? null : row.sections.filter((section) => section.page !== undefined).length,
      });
    }
    if (typeof body.text === "string" && body.text.trim()) {
      const label =
        typeof body.label === "string" && body.label.trim()
          ? body.label.slice(0, 120)
          : "Pasted text";
      const outcome = await ingestText({
        label,
        text: body.text.slice(0, 400_000),
        settings,
        kind: label.toLowerCase().includes("syllabus") ? "syllabus" : "markdown",
      });
      if (outcome.status === "failed") {
        return fail("ingest_failed", outcome.error ?? "Could not read that text", 422);
      }
      return ok({ id: outcome.materialId, status: "ready", warnings: outcome.warnings });
    }
    return fail("no_source", "Provide a file, a link, or some text");
  } catch (error) {
    return errorResponse(error);
  }
}
