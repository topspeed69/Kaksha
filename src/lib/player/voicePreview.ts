"use client";

import { previewBrowserSpeech } from "./browserSpeech";

type PreviewOptions = {
  provider: "none" | "kokoro";
  voice: string;
  speed: number;
  onError: (message: string) => void;
  onInfo?: (message: string) => void;
};

const PREVIEW_TEXT = "Let us begin with the first idea. Notice how each part connects to the next.";

async function previewOffline(options: PreviewOptions): Promise<void> {
  try {
    const response = await fetch("/api/tts/fallback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: PREVIEW_TEXT, speed: options.speed }),
    });
    const data = (await response.json()) as {
      audio?: { url: string; duration_ms: number };
      error?: { message?: string };
    };
    if (!response.ok || !data.audio?.url) {
      options.onError(data.error?.message ?? "No offline voice is available on this server.");
      return;
    }
    options.onInfo?.("Using the offline voice because your browser voice is unavailable.");
    const audio = new Audio(data.audio.url);
    await audio.play();
  } catch {
    options.onError("Neither this browser nor the server could play the voice sample. Captions remain available.");
  }
}

function previewBrowserOrOffline(options: PreviewOptions): void {
  previewBrowserSpeech(PREVIEW_TEXT, options.speed, () => {
    void previewOffline(options);
  });
}

/**
 * Called from a real click. Browser speech starts synchronously for captions
 * mode, preserving user activation. A Kokoro response is checked by MIME;
 * the API's JSON fallback must never be handed to a new Audio(blob).
 */
export function playVoicePreview(options: PreviewOptions): void {
  if (options.provider === "none" || options.voice === "captions") {
    previewBrowserOrOffline(options);
    return;
  }
  void (async () => {
    try {
      const response = await fetch("/api/tts/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: PREVIEW_TEXT, voice: options.voice, speed: options.speed }),
      });
      const mime = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!response.ok || !mime.startsWith("audio/")) {
        options.onInfo?.("The speech service is unavailable. Trying your browser voice.");
        previewBrowserOrOffline(options);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        options.onError("The audio preview could not be decoded. Try the browser voice.");
      };
      try {
        await audio.play();
      } catch {
        URL.revokeObjectURL(url);
        previewBrowserOrOffline(options);
      }
    } catch {
      options.onInfo?.("The speech service could not be reached. Trying your browser voice.");
      previewBrowserOrOffline(options);
    }
  })();
}
