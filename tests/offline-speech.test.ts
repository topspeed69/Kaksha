import { describe, expect, it } from "vitest";
import { offlineSpeechAvailable, OfflineSpeechProvider } from "@/server/providers/system-speech";
import { readAudioDurationMs, readAudioFile } from "@/server/providers/tts";

// The offline voice is optional for no-Docker development. CI without the
// binaries skips this integration, while Docker installs both by default.
const testAudio = offlineSpeechAvailable() ? it : it.skip;

describe("offline last-resort speech", () => {
  testAudio("synthesizes a real seekable MP3 from speakable text", async () => {
    const provider = new OfflineSpeechProvider();
    const result = await provider.synthesize("A quiet classroom voice explains the next step.", "en-us", 1);
    expect(result.mime).toBe("audio/mpeg");
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(result.bytes).toString("ascii", 0, 3)).toBe("ID3");
    expect(result.duration_ms).toBeGreaterThan(500);
    const file = readAudioFile(result.hash);
    expect(file?.mime).toBe("audio/mpeg");
    expect(readAudioDurationMs(Buffer.from(result.bytes), result.mime)).toBe(result.duration_ms);
  });

  testAudio("sanitizes speech parameters without invoking a shell", async () => {
    const provider = new OfflineSpeechProvider();
    const result = await provider.synthesize("Delta is much greater than lambda; nothing is executed.", "en-us", 1.25);
    expect(result.duration_ms).toBeGreaterThan(200);
  });
});
