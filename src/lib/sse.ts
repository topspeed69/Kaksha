/** Incremental SSE frame decoder: network chunks rarely align with `data:` lines. */
export class SseFrameDecoder {
  private buffer = "";
  private readonly maxBytes = 1024 * 1024;

  push(chunk: string): string[] {
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, "\n");
    if (this.buffer.length > this.maxBytes) {
      this.buffer = "";
      throw new Error("The streamed answer exceeded the allowed size");
    }
    const frames: string[] = [];
    let end = this.buffer.indexOf("\n\n");
    while (end >= 0) {
      const raw = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) frames.push(data);
      end = this.buffer.indexOf("\n\n");
    }
    return frames;
  }
}

/** Parse one tutor frame; failures are thrown instead of silently discarded. */
export function parseTutorFrame(payload: string): { text?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("The tutor sent an unreadable reply");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The tutor sent an invalid reply");
  }
  const frame = parsed as { text?: unknown; error?: unknown };
  if (typeof frame.error === "string" && frame.error) throw new Error(frame.error);
  return typeof frame.text === "string" ? { text: frame.text } : {};
}
