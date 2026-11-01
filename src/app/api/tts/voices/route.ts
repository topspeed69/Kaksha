import { ok, errorResponse } from "@/server/http";
import { getSettings } from "@/server/settings";
import { ttsProviderFor } from "@/server/providers/tts";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  await bootstrap();
  try {
    const settings = await getSettings();
    const provider = ttsProviderFor(settings);
    const voices = await provider.voices();
    return ok({
      provider: provider.name,
      voices,
      note:
        provider.name === "none"
          ? "No speech service is configured. Lumen uses the browser voice when available, with captions timed from the text."
          : undefined,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
