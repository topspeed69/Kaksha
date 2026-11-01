import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import type { SourceKind } from "@/lib/dsl/types";
import { db } from "@/db";
import { chunks, materials } from "@/db/schema";
import type { LumenSettings } from "@/server/settings";
import { embedText } from "@/server/embeddings";
import { ensureStorageDir, uploadPath } from "@/server/storage";
import { checkUrl } from "./ssrf";
import { safeFetch } from "@/server/safe-fetch";
import { parseLimitedPdf } from "./pdf";

export type Section = { title: string; level: number; text: string; page?: number };
export type ParsedDocument = {
  sections: Section[];
  pages?: number;
  warnings: string[];
  label: string;
  /** URL PDFs carry their bytes only until stored under a random server filename. */
  pdfBuffer?: Buffer;
};

const MAX_UPLOAD_BYTES = Number(process.env.LUMEN_MAX_UPLOAD_BYTES ?? 150 * 1024 * 1024);
const MAX_URL_BYTES = 15 * 1024 * 1024;
const MAX_EPUB_UNCOMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_EPUB_FILES = 250;

/** Strip null bytes, control chars and lone UTF-16 surrogates so Postgres UTF-8/JSONB never fails. */
export function sanitizeText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function normalise(text: string): string {
  return sanitizeText(text)
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeCodePoint(cp: number): string {
  if (!Number.isInteger(cp) || cp < 0x20 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return " ";
  }
  try {
    return String.fromCodePoint(cp);
  } catch {
    return " ";
  }
}

export function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]{1,6});/gi, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_m, dec: string) => safeCodePoint(Number(dec)));
}

function stripTags(html: string): string {
  return normalise(
    decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

export function sniffKind(
  buffer: Buffer,
  filename: string,
): "pdf" | "epub" | "markdown" | "text" | "binary" {
  if (buffer.length === 0) return "text";
  const head4 = buffer.subarray(0, 4).toString("latin1");
  if (head4 === "%PDF") return "pdf";
  if (head4 === "PK\x03\x04") return "epub";

  // Reject common binary formats even if renamed to .txt / .md
  if (
    head4.startsWith("\x89PNG") ||
    head4.startsWith("\xff\xd8\xff") ||
    head4.startsWith("GIF8") ||
    head4.startsWith("\x7fELF") ||
    head4.startsWith("\x1f\x8b") ||
    head4.startsWith("RIFF") ||
    head4.startsWith("ID3") ||
    head4.startsWith("OggS")
  ) {
    return "binary";
  }

  // Sample first 8 KB for null bytes or high non-printable byte density
  const sample = buffer.subarray(0, Math.min(8192, buffer.length));
  let suspicious = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const b = sample[i];
    if (b === 0) return "binary";
    if (b < 9 || (b > 13 && b < 32)) suspicious += 1;
  }
  if (sample.length > 0 && suspicious / sample.length > 0.05) {
    return "binary";
  }

  const lower = filename.toLowerCase();
  if (/\.(md|markdown)$/.test(lower)) return "markdown";
  return "text";
}

/* --------------------------------- parsers -------------------------------- */

async function parsePdf(buffer: Buffer, label = "PDF"): Promise<ParsedDocument> {
  return parseLimitedPdf(buffer, label);
}

async function parseEpub(buffer: Buffer): Promise<ParsedDocument> {
  const zip = await JSZip.loadAsync(buffer);
  const allEntries = Object.keys(zip.files);
  if (allEntries.length > 2000) {
    throw new Error("Archive contains too many entries to be a valid EPUB");
  }
  const names = allEntries
    .filter((n) => !zip.files[n].dir && /\.(xhtml|html|htm)$/i.test(n))
    .slice(0, MAX_EPUB_FILES)
    .sort();
  if (!names.length) {
    throw new Error("This ZIP archive does not contain readable EPUB chapters");
  }
  const sections: Section[] = [];
  let totalBytes = 0;
  for (const name of names) {
    const data = await zip.files[name].async("uint8array");
    totalBytes += data.byteLength;
    if (totalBytes > MAX_EPUB_UNCOMPRESSED_BYTES) {
      throw new Error("EPUB uncompressed content exceeds the 25 MB safety limit");
    }
    const html = Buffer.from(data).toString("utf8");
    const titleMatch = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html);
    const title = titleMatch
      ? stripTags(titleMatch[1]).slice(0, 120)
      : (name.split("/").pop() ?? name);
    const body = stripTags(html);
    if (body.split(/\s+/).filter(Boolean).length < 40) continue;
    sections.push({ title: title || name, level: 1, text: body });
  }
  if (!sections.length) {
    return {
      sections: [],
      warnings: ["No readable chapters were found inside this EPUB."],
      label: "EPUB",
    };
  }
  return { sections, warnings: [], label: "EPUB" };
}

export function parseMarkdown(source: string, filename: string): ParsedDocument {
  const safeName = sanitizeText(filename).slice(0, 160) || "Notes";
  const cleanedSource = normalise(source);
  if (!cleanedSource) {
    return {
      sections: [],
      warnings: ["The document was empty."],
      label: safeName,
    };
  }
  const lines = cleanedSource.split("\n");
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      if (current && current.text.trim()) sections.push(current);
      current = {
        title: heading[2].trim().slice(0, 160) || "Untitled section",
        level: heading[1].length,
        text: "",
      };
      continue;
    }
    if (!current) {
      current = { title: safeName, level: 1, text: "" };
    }
    current.text += `${line}\n`;
  }
  if (current && current.text.trim()) sections.push(current);
  if (!sections.length) {
    sections.push({ title: safeName, level: 1, text: cleanedSource });
  }
  return { sections, warnings: [], label: safeName };
}

async function readBoundedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`The remote document is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new Error(`The remote document is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    return buf;
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(
          `The remote document exceeded the ${Math.round(maxBytes / 1024 / 1024)} MB limit`,
        );
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

async function parseUrl(rawUrl: string): Promise<ParsedDocument> {
  const check = await checkUrl(rawUrl);
  if (!check.ok) throw new Error(check.reason);
  const warnings: string[] = [];
  let url = check.url;
  let bodyBuffer: Buffer | null = null;
  let contentType = "";

  for (let hop = 0; hop < 4; hop += 1) {
    const response = await safeFetch(
      url,
      {
        headers: {
          "user-agent": "Lumen/1.0 (course builder)",
          accept: "text/html,application/xhtml+xml,text/plain,text/markdown,application/pdf;q=0.9",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      },
      { kind: "material" },
    );
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("The address redirected without a target");
      const next = new URL(location, url);
      const nextCheck = await checkUrl(next.toString());
      if (!nextCheck.ok) throw new Error(`Refused to follow the redirect: ${nextCheck.reason}`);
      url = nextCheck.url;
      continue;
    }
    if (!response.ok) throw new Error(`The address returned ${response.status}`);
    contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (/^(image|video|audio)\//.test(contentType)) {
      throw new Error(`Cannot extract course text from ${contentType} media`);
    }
    bodyBuffer = await readBoundedBytes(response, MAX_URL_BYTES);
    break;
  }

  if (!bodyBuffer || !bodyBuffer.length) throw new Error("The address could not be read");

  if (contentType.includes("application/pdf") || bodyBuffer.subarray(0, 4).toString("latin1") === "%PDF") {
    const parsed = await parsePdf(bodyBuffer, url.pathname.split("/").pop() || url.hostname);
    return { ...parsed, pdfBuffer: bodyBuffer };
  }

  const html = bodyBuffer.toString("utf8");
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const label = titleMatch ? stripTags(titleMatch[1]).slice(0, 140) : url.hostname;
  const main =
    /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ??
    /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ??
    /<body[\s\S]*?<\/body>/i.exec(html)?.[0] ??
    html;
  const cleaned = main
    .replace(/<(nav|header|footer|aside|form|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|section|blockquote)>/gi, "\n");
  const text = stripTags(cleaned);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 120) {
    warnings.push(
      "Only a short piece of text could be extracted from this page. It may need a different address.",
    );
  }
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const sections: Section[] = [];
  let buffer: string[] = [];
  const flush = (title: string) => {
    if (!buffer.length) return;
    sections.push({ title, level: 2, text: buffer.join("\n\n") });
    buffer = [];
  };
  let heading = label || url.hostname;
  for (const block of blocks) {
    const short = block.length < 90 && !block.endsWith(".");
    if (short && /^[A-Z0-9]/.test(block)) {
      flush(heading);
      heading = block.replace(/\s+/g, " ").slice(0, 120);
      continue;
    }
    buffer.push(block);
    if (buffer.join("\n\n").split(/\s+/).length > 700) flush(heading);
  }
  flush(heading);
  return { sections, warnings, label: label || url.hostname };
}

/* --------------------------------- chunking ------------------------------- */

export type BuiltChunk = {
  ord: number;
  text: string;
  page?: number;
  section_ref: string;
  tokens: number;
};

const TARGET_TOKENS = 700;
const OVERLAP = 0.1;

function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.round(words * 1.3);
}

/** Split any oversized unpunctuated sentence into bounded word slices. */
function splitUnits(text: string, maxWords = 450): string[] {
  const rawSentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const units: string[] = [];
  for (const sentence of rawSentences) {
    const words = sentence.split(/\s+/);
    if (words.length <= maxWords) {
      units.push(sentence);
    } else {
      for (let i = 0; i < words.length; i += maxWords) {
        units.push(words.slice(i, i + maxWords).join(" "));
      }
    }
  }
  return units;
}

export function buildChunks(sections: Section[]): BuiltChunk[] {
  const out: BuiltChunk[] = [];
  let ord = 0;
  for (const section of sections) {
    const units = splitUnits(section.text);
    if (!units.length) continue;
    let current: string[] = [];
    let tokens = 0;
    let dirty = false;

    const emit = (retainOverlap: boolean) => {
      if (!current.length) return;
      const text = current.join(" ");
      out.push({
        ord: ord++,
        text,
        page: section.page,
        section_ref: section.title,
        tokens: estimateTokens(text),
      });
      if (!retainOverlap) {
        current = [];
        tokens = 0;
        dirty = false;
        return;
      }
      // Keep ~10% overlap by token budget, never exceeding 35% of TARGET_TOKENS
      const targetOverlapTokens = Math.round(TARGET_TOKENS * OVERLAP);
      const kept: string[] = [];
      let keptTokens = 0;
      for (let i = current.length - 1; i >= 0; i -= 1) {
        const uTokens = estimateTokens(current[i]);
        if (kept.length > 0 && keptTokens + uTokens > targetOverlapTokens * 2) break;
        if (uTokens > TARGET_TOKENS * 0.5) break;
        kept.unshift(current[i]);
        keptTokens += uTokens;
        if (keptTokens >= targetOverlapTokens) break;
      }
      current = kept;
      tokens = keptTokens;
      dirty = false;
    };

    for (const unit of units) {
      current.push(unit);
      tokens += estimateTokens(unit);
      dirty = true;
      if (tokens >= TARGET_TOKENS) {
        emit(true);
      }
    }
    if (dirty && current.length) {
      emit(false);
    }
  }
  return out;
}

/* ------------------------------- entry points ----------------------------- */

export type IngestOutcome = {
  materialId: string;
  status: "ready" | "failed";
  warnings: string[];
  error?: string;
};

const EMBED_CONCURRENCY = 6;
const INSERT_BATCH_SIZE = 100;

async function persist(
  label: string,
  kind: SourceKind,
  parsed: ParsedDocument,
  settings: LumenSettings,
  pages?: number,
  filePath?: string,
): Promise<string> {
  const safeLabel = sanitizeText(label).slice(0, 200) || "Untitled material";
  const [row] = await db
    .insert(materials)
    .values({
      kind,
      label: safeLabel,
      status: "parsing",
      path: filePath ?? null,
      sections: parsed.sections,
      section_count: parsed.sections.length,
      pages,
      warnings: parsed.warnings,
    })
    .returning({ id: materials.id });

  const built = buildChunks(parsed.sections);
  try {
  if (built.length) {
    const vectors: number[][] = new Array(built.length);
    for (let i = 0; i < built.length; i += EMBED_CONCURRENCY) {
      const slice = built.slice(i, i + EMBED_CONCURRENCY);
      const results = await Promise.all(slice.map((chunk) => embedText(settings, chunk.text)));
      results.forEach((res, idx) => {
        vectors[i + idx] = res.vector;
      });
    }

    const rowsToInsert = built.map((chunk, i) => ({
      material_id: row.id,
      ord: chunk.ord,
      text: chunk.text,
      page: chunk.page ?? null,
      section_ref: chunk.section_ref,
      tokens: chunk.tokens,
      embedding: vectors[i],
    }));

    for (let i = 0; i < rowsToInsert.length; i += INSERT_BATCH_SIZE) {
      await db.insert(chunks).values(rowsToInsert.slice(i, i + INSERT_BATCH_SIZE));
    }
  }

  await db
    .update(materials)
    .set({
      status: "ready",
      chunk_count: built.length,
      section_count: parsed.sections.length,
      updated_at: new Date(),
    })
    .where(eq(materials.id, row.id));
  return row.id;
  } catch (error) {
    // Do not keep an orphaned parsing row if embeddings or insertion failed.
    await db.delete(materials).where(eq(materials.id, row.id));
    throw error;
  }
}

export async function ingestFile(options: {
  file: File;
  settings: LumenSettings;
}): Promise<IngestOutcome> {
  const { file, settings } = options;
  if (file.size === 0) {
    return {
      materialId: "",
      status: "failed",
      warnings: [],
      error: "That file is empty.",
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      materialId: "",
      status: "failed",
      warnings: [],
      error: `That file is ${Math.round(file.size / 1024 / 1024)} MB. The limit is ${Math.round(
        MAX_UPLOAD_BYTES / 1024 / 1024,
      )} MB.`,
    };
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = sniffKind(buffer, file.name);
  if (kind === "binary") {
    return {
      materialId: "",
      status: "failed",
      warnings: [],
      error:
        "That file looks like a binary format that Lumen cannot read. Upload a PDF, EPUB, Markdown or plain-text file.",
    };
  }
  let storedPath: string | undefined;
  try {
    ensureStorageDir();
    // Random UUID filename only — never trust user-supplied filenames on disk
    const ext = kind === "pdf" ? ".pdf" : kind === "epub" ? ".epub" : ".txt";
    storedPath = uploadPath(`${randomUUID()}${ext}`);
    writeFileSync(storedPath, buffer, { mode: 0o600 });
    const parsed =
      kind === "pdf"
        ? await parsePdf(buffer, file.name)
        : kind === "epub"
          ? await parseEpub(buffer)
          : parseMarkdown(buffer.toString("utf8"), file.name);
    if (!parsed.sections.length && parsed.warnings.length === 0) {
      return {
        materialId: "",
        status: "failed",
        warnings: [],
        error: "No readable text could be found in that file.",
      };
    }
    const id = await persist(file.name, kind, parsed, settings, parsed.pages, storedPath);
    return { materialId: id, status: "ready", warnings: parsed.warnings };
  } catch (error) {
    if (storedPath) {
      try { unlinkSync(storedPath); } catch { /* upload may already be removed */ }
    }
    return {
      materialId: "",
      status: "failed",
      warnings: [],
      error: `Could not read that file: ${(error as Error).message}`,
    };
  }
}

export async function ingestUrl(options: {
  url: string;
  settings: LumenSettings;
}): Promise<IngestOutcome> {
  let filePath: string | undefined;
  try {
    const parsed = await parseUrl(options.url);
    if (parsed.pdfBuffer) {
      ensureStorageDir();
      filePath = uploadPath(`${randomUUID()}.pdf`);
      writeFileSync(filePath, parsed.pdfBuffer, { mode: 0o600 });
    }
    const id = await persist(parsed.label, "url", parsed, options.settings, parsed.pages, filePath);
    return { materialId: id, status: "ready", warnings: parsed.warnings };
  } catch (error) {
    if (filePath) {
      try { unlinkSync(filePath); } catch { /* upload may already be removed */ }
    }
    return {
      materialId: "",
      status: "failed",
      warnings: [],
      error: (error as Error).message,
    };
  }
}

export async function ingestText(options: {
  label: string;
  text: string;
  settings: LumenSettings;
  kind?: "markdown" | "text" | "syllabus";
}): Promise<IngestOutcome> {
  const cleaned = sanitizeText(options.text);
  if (!cleaned.trim()) {
    return {
      materialId: "",
      status: "failed",
      warnings: [],
      error: "The submitted text was empty.",
    };
  }
  const parsed = parseMarkdown(cleaned, options.label);
  const id = await persist(
    options.label,
    options.kind ?? "markdown",
    parsed,
    options.settings,
  );
  return { materialId: id, status: "ready", warnings: parsed.warnings };
}
