import { readJson, errorResponse, fail, ok } from "@/server/http";
import { synthesizeSegment } from "@/server/providers/tts";
import { OfflineSpeechProvider, offlineSpeechAvailable } from "@/server/providers/system-speech";

export const dynamic = "force-dynamic";

/** Last resort when this browser has no installed speech voice. */
export async function POST(request: Request) {
  try {
    if (!offlineSpeechAvailable()) {
      return fail(
        "offline_voice_unavailable",
        "This browser has no speech voice, and no offline voice is installed on the server. Connect Kokoro for narration; captions remain available.",
        503,
      );
    }
    const body = await readJson<{ text?: unknown; speed?: unknown }>(request, 4096);
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 320) {
      return fail("invalid_text", "Narration must be between 1 and 320 characters", 400);
    }
    const rawSpeed = Number(body.speed ?? 1);
    if (!Number.isFinite(rawSpeed) || rawSpeed < 0.75 || rawSpeed > 2) {
      return fail("invalid_speed", "Speaking speed must be between 0.75 and 2", 400);
    }
    const outcome = await synthesizeSegment({
      provider: new OfflineSpeechProvider(),
      text: body.text,
      voice: "en-us",
      speed: rawSpeed,
      estimatedMs: 0,
    });
    if (outcome.status === "unavailable") {
      return fail("offline_voice_failed", outcome.reason.slice(0, 220), 503);
    }
    return ok({
      audio: { url: outcome.url, duration_ms: outcome.duration_ms },
      label: "Offline voice",
    });
  } catch (error) {
    return errorResponse(error);
  }
}
