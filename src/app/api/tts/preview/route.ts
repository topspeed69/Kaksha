import { getSettings } from "@/server/settings";
import {
  readAudioFile,
  synthesizeSegment,
  ttsProviderFor,
} from "@/server/providers/tts";

export const dynamic = "force-dynamic";

/** One-click voice preview. Served straight from the audio cache on disk. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      text?: string;
      voice?: string;
      speed?: number;
    };
    const settings = await getSettings();
    const provider = ttsProviderFor(settings);
    const text = (body.text ?? "Let us begin with the density matrix.").slice(0, 300);
    const outcome = await synthesizeSegment({
      provider,
      text,
      voice: body.voice ?? settings.tts.default_voice,
      speed: body.speed ?? settings.tts.default_speed,
      estimatedMs: 3000,
    });
    if (outcome.status === "unavailable") {
      return Response.json(
        {
          error: {
            code: "tts_unavailable",
            message: outcome.reason
              ? `${outcome.reason}. Playback will use the browser voice when available, with captions.`
              : "No speech service is configured. Playback will use the browser voice when available, with captions.",
          },
          audio: { duration_ms: outcome.duration_ms },
        },
        { status: 200 },
      );
    }
    const file = readAudioFile(outcome.hash);
    if (!file) {
      return Response.json(
        {
          audio: { url: `/api/media/audio/${outcome.hash}.mp3`, duration_ms: outcome.duration_ms },
          note: "Not on disk; play it from the audio URL.",
        },
        { status: 200 },
      );
    }
    return new Response(new Uint8Array(file.buffer), {
      headers: {
        "content-type": file.mime,
        "content-length": String(file.buffer.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.json(
      { error: { code: "tts_failed", message: "The preview could not be produced" } },
      { status: 500 },
    );
  }
}
