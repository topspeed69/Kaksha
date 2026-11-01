import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chunks, materials } from "@/db/schema";
import { getPdfPageImage, imagesForChunks } from "@/server/ingest/pdf";

const materialId = process.env.LUMEN_DB_TEST_MATERIAL_ID;
const integrationTest = materialId ? it : it.skip;

describe("PDF image cache integration (opt-in: LUMEN_DB_TEST_MATERIAL_ID)", () => {
  integrationTest("renders a stored page, encodes bounded JPEG, deduplicates", async () => {
    const [material] = await db.select().from(materials).where(eq(materials.id, materialId!)).limit(1);
    expect(material?.path?.endsWith(".pdf")).toBe(true);
    const image = await getPdfPageImage(materialId!, 1);
    expect(image).not.toBeNull();
    expect(image?.mime).toBe("image/jpeg");
    const bytes = Buffer.from(image!.data, "base64");
    expect(bytes.subarray(0, 3).toString("hex")).toBe("ffd8ff");
    expect(bytes.byteLength).toBeLessThanOrEqual(900_000);
    const again = await getPdfPageImage(materialId!, 1);
    expect(again?.data).toBe(image?.data);
  });

  integrationTest("selects only relevant retrieved PDF pages and enforces the image cap", async () => {
    const rows = await db.select().from(chunks).where(eq(chunks.material_id, materialId!));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const evidence = await imagesForChunks(rows.map((row) => ({
      material_id: row.material_id,
      page: row.page,
    })), 2);
    expect(evidence).toHaveLength(2);
    expect(evidence.map((image) => image.page)).toEqual([1, 2]);
  });

  integrationTest("refuses page numbers outside the configured cap", async () => {
    const previous = process.env.LUMEN_MAX_PDF_PAGES;
    process.env.LUMEN_MAX_PDF_PAGES = "2";
    try {
      expect(await getPdfPageImage(materialId!, 3)).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.LUMEN_MAX_PDF_PAGES;
      else process.env.LUMEN_MAX_PDF_PAGES = previous;
    }
  });
});
