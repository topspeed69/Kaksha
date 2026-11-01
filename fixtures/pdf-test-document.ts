/**
 * Builds a minimal, standards-conforming PDF for ingestion tests.
 * Not shown to learners; every page contains real, extractable text.
 */
export function makeTestPdf(pageCount: number): Buffer {
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 40) {
    throw new Error("Choose between one and forty test pages");
  }
  const pageIds = Array.from({ length: pageCount }, (_, index) => 4 + index * 2);
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  for (let index = 0; index < pageCount; index += 1) {
    const number = index + 1;
    const pageId = pageIds[index];
    const streamId = pageId + 1;
    const sentence = `Page ${number} examines the relationship between a theorem and its proof through a concrete example.`;
    const stream = `BT /F1 14 Tf 36 156 Td (${sentence}) Tj ET`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 240] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  }
  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body, "latin1");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body, "latin1");
}
