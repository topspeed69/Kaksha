import { readAudioFile } from "@/server/providers/tts";

export const dynamic = "force-dynamic";

/** Serves cached narration with RFC 9110 range requests so seeking works reliably. */
export async function GET(request: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const name = hash.replace(/\.(mp3|wav)$/i, "");
  const file = readAudioFile(name);
  if (!file) {
    return Response.json(
      { error: { code: "not_found", message: "That audio file is not stored here" } },
      { status: 404 },
    );
  }
  const total = file.buffer.byteLength;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (match[1] === "" && match[2] === "")) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${total}`, "accept-ranges": "bytes" },
      });
    }
    let start: number;
    let end: number;
    if (match[1] === "") {
      // Suffix byte-range-spec: bytes=-N (last N bytes)
      const suffixLen = Number(match[2]);
      if (!Number.isFinite(suffixLen) || suffixLen <= 0) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${total}`, "accept-ranges": "bytes" },
        });
      }
      start = Math.max(0, total - suffixLen);
      end = total - 1;
    } else {
      start = Number(match[1]);
      end = match[2] !== "" ? Math.min(Number(match[2]), total - 1) : total - 1;
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      start >= total ||
      start > end
    ) {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${total}`, "accept-ranges": "bytes" },
      });
    }
    const slice = file.buffer.subarray(start, end + 1);
    return new Response(new Uint8Array(slice), {
      status: 206,
      headers: {
        "content-type": file.mime,
        "content-length": String(slice.byteLength),
        "content-range": `bytes ${start}-${end}/${total}`,
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  }
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "content-type": file.mime,
      "content-length": String(total),
      "accept-ranges": "bytes",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
