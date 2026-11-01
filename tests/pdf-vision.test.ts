import { describe, expect, it } from "vitest";
import { makeTestPdf } from "../fixtures/pdf-test-document";
import { maxPdfPages, parseLimitedPdf } from "@/server/ingest/pdf";
import {
  anthropicMessages,
  generateStructured,
  ollamaMessages,
  openAiMessages,
  type LLMImage,
  type LLMRequest,
  type LLMProvider,
} from "@/server/providers/llm";

const image: LLMImage = {
  mime: "image/jpeg",
  data: Buffer.from("test-image-bytes").toString("base64"),
  page: 2,
  materialId: "11111111-1111-4111-8111-111111111111",
};

const request: LLMRequest = {
  system: "Use these pages as source data.",
  messages: [{ role: "user", content: "Explain the diagram on page 2." }],
  temperature: 0.1,
  maxTokens: 900,
  images: [image],
};

describe("bounded PDF preparation", () => {
  it("only processes the first configured pages and reports the real total", async () => {
    const previous = process.env.LUMEN_MAX_PDF_PAGES;
    process.env.LUMEN_MAX_PDF_PAGES = "2";
    try {
      const pdf = makeTestPdf(4);
      const result = await parseLimitedPdf(pdf, "paper.pdf");
      expect(result.pages).toBe(4);
      expect(result.sections.map((section) => section.page)).toEqual([1, 2]);
      expect(result.sections[0].text).toContain("Page 1 examines");
      expect(result.sections[1].text).toContain("Page 2 examines");
      expect(result.warnings.some((warning) => warning.includes("first 2 of 4"))).toBe(true);
      expect(JSON.stringify(result)).not.toContain("Page 3 examines");
    } finally {
      if (previous === undefined) delete process.env.LUMEN_MAX_PDF_PAGES;
      else process.env.LUMEN_MAX_PDF_PAGES = previous;
    }
  });

  it("bounds misconfigured limits instead of processing unlimited pages", () => {
    const previous = process.env.LUMEN_MAX_PDF_PAGES;
    try {
      process.env.LUMEN_MAX_PDF_PAGES = "9999999";
      expect(maxPdfPages()).toBe(80);
      process.env.LUMEN_MAX_PDF_PAGES = "NaN";
      expect(maxPdfPages()).toBe(24);
      process.env.LUMEN_MAX_PDF_PAGES = "0";
      expect(maxPdfPages()).toBe(24);
    } finally {
      if (previous === undefined) delete process.env.LUMEN_MAX_PDF_PAGES;
      else process.env.LUMEN_MAX_PDF_PAGES = previous;
    }
  });

  it("renders a page as real PNG bytes using the installed canvas API", async () => {
    const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(makeTestPdf(1)), { maxImageSize: 16_777_216 });
    try {
      const raw = await renderPageAsImage(pdf, 1, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: 1,
      });
      const png = Buffer.from(raw);
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.byteLength).toBeGreaterThan(100);
    } finally {
      await pdf.cleanup();
    }
  });
});

describe("bounded provider vision request shapes", () => {
  it("sends OpenAI-compatible image_url data blocks paired with text", () => {
    const messages = openAiMessages(request) as { role: string; content: unknown }[];
    expect(messages).toHaveLength(2);
    const parts = messages[1].content as { type: string; text?: string; image_url?: { url: string } }[];
    expect(parts[0]).toEqual({ type: "text", text: request.messages[0].content });
    expect(parts[1].image_url?.url).toBe(`data:image/jpeg;base64,${image.data}`);
  });

  it("uses Anthropic base64 image source blocks without a client URL", () => {
    const messages = anthropicMessages(request) as { content: unknown }[];
    const parts = messages[0].content as { type: string; source?: { media_type: string; data: string } }[];
    expect(parts[1].source).toEqual({ type: "base64", media_type: "image/jpeg", data: image.data });
  });

  it("uses Ollama images array on the last user message", () => {
    const messages = ollamaMessages(request) as { content: string; images?: string[] }[];
    expect(messages[1].images).toEqual([image.data]);
    expect(messages[1].content).toBe("Explain the diagram on page 2.");
  });

  it("caps each request to two page images regardless of input size", () => {
    const many = openAiMessages({ ...request, images: Array.from({ length: 8 }, (_, i) => ({ ...image, page: i + 1 })) }) as { content: unknown }[];
    const parts = many[1].content as { type: string }[];
    expect(parts.filter((part) => part.type === "image_url")).toHaveLength(2);
  });

  it("retries text-only only on explicit image incompatibility", async () => {
    const seen: number[] = [];
    const fakeProvider: LLMProvider = {
      name: "fake-vision",
      async complete(req) {
        seen.push(req.images?.length ?? 0);
        if (req.images?.length) throw new Error("image input is not supported by this model");
        return { text: '{"ok":true}', model: "fake", provider: "fake-vision" };
      },
      async *stream() { yield ""; },
    };
    const outcome = await generateStructured<{ ok: boolean }>({
      slot: { available: true, provider: fakeProvider, slot: "content", config: { provider: "openai", model: "fake" } },
      system: "Return JSON.", prompt: "Check this page.",
      images: [image], temperature: 0, maxTokens: 100,
      validate: (value) => ({ ok: true, value: value as { ok: boolean } }),
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.imagesDropped).toBe(true);
    expect(seen).toEqual([1, 0]);
  });
});
