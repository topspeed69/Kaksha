import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { AudioResult, TTSProvider, Voice } from "./tts";
import { normalizeSpeech, readAudioDurationMs, segmentHash, TTSError } from "./tts";
import { audioPath, ensureStorageDir } from "@/server/storage";

const VERSION = "system-offline-v1";
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 320;

let availability: boolean | undefined;

export function offlineSpeechAvailable(): boolean {
  if (availability !== undefined) return availability;
  availability = ["espeak-ng", "ffmpeg"].every((name) => {
    try {
      const result = spawnSync(name, ["-version"], { timeout: 1500, stdio: "ignore" });
      return !result.error;
    } catch {
      return false;
    }
  });
  return availability;
}

/** Never uses a shell; bounded input, output and execution time. */
async function run(
  binary: string,
  args: string[],
  stdin: Buffer | null,
  timeoutMs: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let total = 0;
    let failure = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new TTSError("offline_timeout", "The offline voice took too long to speak this segment"));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_AUDIO_BYTES) {
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (failure.length < 500) failure += chunk.toString("utf8").slice(0, 500 - failure.length);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new TTSError("offline_unavailable", error.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 || total === 0 || total > MAX_AUDIO_BYTES) {
        reject(new TTSError("offline_failed", `Offline voice could not produce audio${failure ? `: ${failure.slice(0, 120)}` : ""}`));
      } else resolve(Buffer.concat(chunks));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin ?? undefined);
  });
}

export class OfflineSpeechProvider implements TTSProvider {
  readonly name = VERSION;
  async voices(): Promise<Voice[]> {
    return [{ id: "en-us", name: "Offline device voice", language: "en" }];
  }

  async synthesize(text: string, _voice: string, speed: number): Promise<AudioResult> {
    if (!offlineSpeechAvailable()) {
      throw new TTSError("offline_unavailable", "An offline speech voice is not installed on this server");
    }
    const spoken = normalizeSpeech(text).trim().slice(0, MAX_TEXT_LENGTH);
    if (!spoken) throw new TTSError("empty_text", "There is nothing to speak");
    const safeSpeed = Number.isFinite(speed) ? Math.min(2, Math.max(0.75, speed)) : 1;
    const hash = segmentHash(spoken, "en-us", safeSpeed, VERSION);
    const wpm = Math.round(165 * safeSpeed);
    const wav = await run(
      "espeak-ng",
      ["--stdout", "-v", "en-us", "-s", String(wpm), spoken],
      null,
      15000,
    );
    const mp3 = await run(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-codec:a", "libmp3lame", "-q:a", "6", "-f", "mp3", "pipe:1"],
      wav,
      15000,
    );
    const durationMs = readAudioDurationMs(mp3, "audio/mpeg");
    if (durationMs < 200) throw new TTSError("invalid_audio", "Offline voice produced unreadable audio");
    ensureStorageDir();
    writeFileSync(audioPath(hash), mp3, { mode: 0o600 });
    return { hash, bytes: mp3, duration_ms: durationMs, mime: "audio/mpeg" };
  }
}
