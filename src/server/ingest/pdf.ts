import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/db";
import { materials } from "@/db/schema";
import { isUuid } from "@/server/courses";
import { storageRoot, uploadDir } from "@/server/storage";
import type { ParsedDocument, Section } from "./index";

export const DEFAULT_MAX_PDF_PAGES = 24;
const MAX_PAGE_IMAGE_BYTES = 900_000;
const MAX_IMAGE_PIXELS = 16_777_216;
const MAX_PAGE_EDGE = 1200;
const IMAGE_CACHE_LIMIT = 12;

/** Page limit is bounded even if an env var is mistyped or maliciously huge. */
export function maxPdfPages(): number {
  const n = Number(process.env.KAKSHA_MAX_PDF_PAGES);
  return Number.isFinite(n) && n >= 1
    ? Math.max(1, Math.min(80, Math.floor(n)))
    : DEFAULT_MAX_PDF_PAGES;
}

function flattenPageText(items: readonly unknown[]): string {
  let out = "";
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const textItem = item as { str?: unknown; hasEOL?: unknown };
    if (typeof textItem.str !== "string") continue;
    out += `${textItem.str}${textItem.hasEOL ? "\n" : " "}`;
  }
  return out
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Process ONLY the first N pages. `extractText(pdf)` processes every page and
 * can pin the event loop for a long document, so we deliberately call getPage
 * one at a time and destroy the document proxy when done.
 */
export async function parseLimitedPdf(buffer: Buffer, label: string): Promise<ParsedDocument> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer), {
    maxImageSize: MAX_IMAGE_PIXELS,
  });
  const totalPages = pdf.numPages;
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    await pdf.cleanup();
    throw new Error("This PDF does not contain readable pages");
  }
  const limit = Math.min(totalPages, maxPdfPages());
  const sections: Section[] = [];
  const warnings: string[] = [];
  let pagesWithoutText = 0;
  try {
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const body = flattenPageText(content.items);
        if (body.length < 35) pagesWithoutText += 1;
        sections.push({
          title: `Page ${pageNumber}`,
          level: 1,
          page: pageNumber,
          // Image-only pages still get a grounding chunk. The model must look
          // at the image; this is not a fabricated transcription.
          text: body || "No extractable text on this page; refer to its page image if available.",
        });
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await pdf.cleanup();
  }
  if (totalPages > limit) {
    warnings.push(`Processed the first ${limit} of ${totalPages} pages. Remaining pages were not read.`);
  }
  if (pagesWithoutText) {
    warnings.push(
      `${pagesWithoutText} of ${limit} processed pages have little extractable text. Page images are used when a vision-capable model is available.`,
    );
  }
  return { sections, pages: totalPages, warnings, label };
}

export type VisionPageImage = {
  page: number;
  materialId: string;
  mime: "image/jpeg";
  /** Base64 encoded JPEG; never returned to a browser or stored in the DB. */
  data: string;
};

function imageCachePath(materialId: string, page: number): string {
  return path.join(storageRoot, "pages", materialId, `${page}.jpg`);
}

const pending = new Map<string, Promise<Buffer | null>>();
const memory = new Map<string, Buffer>();

async function renderPage(materialId: string, pageNumber: number): Promise<Buffer | null> {
  const [row] = await db.select({ path: materials.path, pages: materials.pages })
    .from(materials).where(eq(materials.id, materialId)).limit(1);
  if (!row?.path || !row.path.endsWith(".pdf") || !existsSync(row.path) ||
      !path.resolve(row.path).startsWith(`${path.resolve(uploadDir)}${path.sep}`) ||
      pageNumber > Math.min(row.pages ?? 0, maxPdfPages())) return null;

  const cacheFile = imageCachePath(materialId, pageNumber);
  if (existsSync(cacheFile)) {
    const cached = await readFile(cacheFile);
    if (cached.byteLength > 0 && cached.byteLength <= MAX_PAGE_IMAGE_BYTES) return cached;
  }

  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const bytes = await readFile(row.path);
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { maxImageSize: MAX_IMAGE_PIXELS });
  let png: Buffer;
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(1.4, MAX_PAGE_EDGE / Math.max(viewport.width, viewport.height));
    page.cleanup();
    const rendered = await renderPageAsImage(pdf, pageNumber, {
      canvasImport: () => import("@napi-rs/canvas"),
      scale: Math.max(0.1, scale),
    });
    png = Buffer.from(rendered);
  } finally {
    await pdf.cleanup();
  }
  let jpeg = await sharp(png).jpeg({ quality: 75, mozjpeg: true }).toBuffer();
  if (jpeg.byteLength > MAX_PAGE_IMAGE_BYTES) {
    jpeg = await sharp(png).resize({ width: 880, height: 880, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 60, mozjpeg: true }).toBuffer();
  }
  if (jpeg.byteLength > MAX_PAGE_IMAGE_BYTES) return null;
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, jpeg, { mode: 0o600 });
  return jpeg;
}

/** Generate a page preview at most once across concurrent scene writers. */
export async function getPdfPageImage(materialId: string, pageNumber: number): Promise<VisionPageImage | null> {
  if (!isUuid(materialId) || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > maxPdfPages()) {
    return null;
  }
  const key = `${materialId}:${pageNumber}`;
  let bytes = memory.get(key);
  if (!bytes) {
    let task = pending.get(key);
    if (!task) {
      task = renderPage(materialId, pageNumber)
        .catch(() => null)
        .finally(() => pending.delete(key));
      pending.set(key, task);
    }
    bytes = (await task) ?? undefined;
    if (!bytes) return null;
    memory.set(key, bytes);
    while (memory.size > IMAGE_CACHE_LIMIT) {
      const oldest = memory.keys().next().value;
      if (oldest) memory.delete(oldest);
    }
  }
  return { page: pageNumber, materialId, mime: "image/jpeg", data: bytes.toString("base64") };
}

/** Ground at most two distinct retrieved PDF pages per call, not the entire paper. */
export async function imagesForChunks(
  chunks: readonly { material_id?: string; page: number | null }[],
  maxImages = 2,
): Promise<VisionPageImage[]> {
  const picked = new Set<string>();
  const out: VisionPageImage[] = [];
  for (const chunk of chunks) {
    if (out.length >= maxImages) break;
    if (!chunk.material_id || !chunk.page) continue;
    const key = `${chunk.material_id}:${chunk.page}`;
    if (picked.has(key)) continue;
    picked.add(key);
    const image = await getPdfPageImage(chunk.material_id, chunk.page);
    if (image) out.push(image);
  }
  return out;
}
