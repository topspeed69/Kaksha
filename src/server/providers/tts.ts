import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { audio } from "@/db/schema";
import type { LumenSettings } from "@/server/settings";
import { audioPath, ensureStorageDir } from "@/server/storage";
import { safeFetch } from "@/server/safe-fetch";

export type Voice = {
  id: string;
  name: string;
  language: string;
  description?: string;
};

export type AudioResult = {
  hash: string;
  bytes: Uint8Array;
  duration_ms: number;
  mime: string;
};

export class TTSError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TTSError";
    this.code = code;
  }
}

/* -------------------------- speech normalisation -------------------------- */

const SYMBOL_MAP: [RegExp, string][] = [
  [/ħ/g, "h-bar"],
  [/ψ/g, "psi"],
  [/ρ/g, "rho"],
  [/Δ/g, "delta"],
  [/δ/g, "delta"],
  [/λ/g, "lambda"],
  [/γ/g, "gamma"],
  [/Γ/g, "capital gamma"],
  [/τ/g, "tau"],
  [/ω/g, "omega"],
  [/θ/g, "theta"],
  [/π/g, "pi"],
  [/σ/g, "sigma"],
  [/Σ/g, "sum over"],
  [/∫/g, "the integral of"],
  [/∂/g, "partial"],
  [/≈/g, "approximately equals"],
  [/≫/g, "is much greater than"],
  [/≪/g, "is much less than"],
  [/≤/g, "is less than or equal to"],
  [/≥/g, "is greater than or equal to"],
  [/→/g, "tends to"],
  [/×/g, "times"],
  [/·/g, " dot "],
  [/∀/g, "for all"],
  [/∈/g, "in"],
  [/∞/g, "infinity"],
  [/√/g, "the square root of"],
  [/†/g, "dagger"],
  [/⊗/g, "tensor product with"],
  [/⟨/g, "bra "],
  [/⟩/g, " ket"],
  [/°/g, " degrees"],
];

/** Safety net: narration is written to be spoken, this fixes stragglers. */
export function normalizeSpeech(input: string): string {
  let out = ` ${input} `;
  for (const [pattern, replacement] of SYMBOL_MAP) out = out.replace(pattern, replacement);
  out = out
    .replace(/\be\.g\./gi, "for example")
    .replace(/\bi\.e\./gi, "that is")
    .replace(/\betc\./gi, "and so on")
    .replace(/\bEq\.\s*/g, "equation ")
    .replace(/\bFig\.\s*/g, "figure ")
    .replace(/(\d)\s?ms\b/g, "$1 milliseconds")
    .replace(/(\d)\s?Hz\b/g, "$1 hertz")
    .replace(/\s+/g, " ")
    .trim();
  return out;
}

export function segmentHash(
  text: string,
  voice: string,
  speed: number,
  provider: string,
): string {
  const normalized = normalizeSpeech(text).toLowerCase();
  return createHash("sha256")
    .update(`v1|${provider}|${voice}|${speed}|${normalized}`)
    .digest("hex")
    .slice(0, 40);
}

/* ----------------------------- duration reading --------------------------- */

export function readWavDurationMs(buffer: Buffer): number | null {
  if (buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "fmt " && chunkSize >= 16 && offset + 20 <= buffer.length) {
      byteRate = buffer.readUInt32LE(offset + 16);
    } else if (chunkId === "data") {
      dataSize = Math.min(chunkSize, buffer.length - (offset + 8));
      break;
    }
    const next = offset + 8 + chunkSize + (chunkSize % 2);
    if (next <= offset) break;
    offset = next;
  }
  if (!byteRate || dataSize <= 0) return null;
  return Math.round((dataSize / byteRate) * 1000);
}

const MP3_BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000, 0], // MPEG-1
  2: [22050, 24000, 16000, 0], // MPEG-2
  0: [11025, 12000, 8000, 0],  // MPEG-2.5
};

/** Walk MPEG Layer III frames and sum their durations. Exact for CBR and VBR files. */
export function readMp3DurationMs(buffer: Buffer): number | null {
  let offset = 0;
  if (buffer.length > 10 && buffer.toString("ascii", 0, 3) === "ID3") {
    const size =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f);
    offset = 10 + size;
  }
  let frames = 0;
  let durationSec = 0;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
      offset += 1;
      continue;
    }
    const versionBits = (buffer[offset + 1] >> 3) & 0x03;
    const layerBits = (buffer[offset + 1] >> 1) & 0x03;
    if (versionBits === 1 || layerBits !== 1) {
      offset += 1;
      continue;
    }
    const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f;
    const sampleIndex = (buffer[offset + 2] >> 2) & 0x03;
    const padding = (buffer[offset + 2] >> 1) & 0x01;
    const rates = MP3_SAMPLE_RATES[versionBits];
    const sampleRate = rates?.[sampleIndex] ?? 0;
    const bitrateTable = versionBits === 3 ? MP3_BITRATES_V1 : MP3_BITRATES_V2;
    const bitrate = (bitrateTable[bitrateIndex] ?? 0) * 1000;
    if (!sampleRate || !bitrate) {
      offset += 1;
      continue;
    }
    const samplesPerFrame = versionBits === 3 ? 1152 : 576;
    const coeff = versionBits === 3 ? 144 : 72;
    const frameLength = Math.floor((coeff * bitrate) / sampleRate) + padding;
    if (frameLength <= 0) {
      offset += 1;
      continue;
    }
    frames += 1;
    durationSec += samplesPerFrame / sampleRate;
    offset += frameLength;
  }
  if (!frames || durationSec <= 0) return null;
  return Math.round(durationSec * 1000);
}

export function readAudioDurationMs(buffer: Buffer, mime: string): number {
  const wav = readWavDurationMs(buffer);
  if (wav !== null) return wav;
  const mp3 = readMp3DurationMs(buffer);
  if (mp3 !== null) return mp3;
  void mime;
  return 0;
}

/* -------------------------------- providers ------------------------------- */

export interface TTSProvider {
  readonly name: string;
  voices(): Promise<Voice[]>;
  synthesize(text: string, voice: string, speed: number): Promise<AudioResult>;
}

class KokoroHttpProvider implements TTSProvider {
  readonly name = "kokoro";
  constructor(
    private readonly baseUrl: string,
    private readonly fallbackVoice: string,
  ) {}

  private get speechUrl(): string {
    const base = this.baseUrl.trim();
    if (base.endsWith("/v1/audio/speech")) return base;
    return `${base.replace(/\/+$/, "")}/v1/audio/speech`;
  }

  private get origin(): string {
    const url = new URL(this.speechUrl);
    return url.origin;
  }

  async voices(): Promise<Voice[]> {
    for (const path of ["/voices", "/v1/voices", "/v1/models"]) {
      try {
        const response = await safeFetch(`${this.origin}${path}`, {
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) continue;
        const data = (await response.json()) as unknown;
        const list = Array.isArray(data)
          ? data
          : ((data as { voices?: unknown[] }).voices ?? []);
        const voices = list
          .map((entry): Voice | null => {
            if (typeof entry === "string") {
              return {
                id: entry,
                name: entry,
                language: entry.match(/^[a-z]{2}_/) ? entry.slice(0, 2) : "en",
              };
            }
            if (entry && typeof entry === "object") {
              const record = entry as Record<string, unknown>;
              const id = String(record.id ?? record.name ?? "");
              if (!id) return null;
              return {
                id,
                name: String(record.name ?? id),
                language: String(record.language ?? "en"),
                description: record.description ? String(record.description) : undefined,
              };
            }
            return null;
          })
          .filter((v): v is Voice => Boolean(v));
        if (voices.length) return voices;
      } catch {
        /* try the next path */
      }
    }
    return [{ id: this.fallbackVoice, name: this.fallbackVoice, language: "en" }];
  }

  async synthesize(text: string, voice: string, speed: number): Promise<AudioResult> {
    const response = await safeFetch(this.speechUrl, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: normalizeSpeech(text),
        voice,
        speed,
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(120_000),
    }).catch((error) => {
      throw new TTSError(
        "tts_unreachable",
        `Could not reach the speech service: ${(error as Error).message}`,
      );
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new TTSError(
        "tts_error",
        `Speech service returned ${response.status}: ${detail.slice(0, 200)}`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mime = response.headers.get("content-type") ?? "audio/mpeg";
    const buffer = Buffer.from(bytes);
    const duration = readAudioDurationMs(buffer, mime);
    if (duration <= 0) {
      throw new TTSError("invalid_audio", "Speech service returned unreadable audio data");
    }
    const hash = segmentHash(text, voice, speed, this.name);
    ensureStorageDir();
    writeFileSync(audioPath(hash), buffer);
    return {
      hash,
      bytes,
      duration_ms: duration,
      mime: mime.includes("wav") ? "audio/wav" : "audio/mpeg",
    };
  }
}

export class NoSpeechProvider implements TTSProvider {
  readonly name = "none";
  async voices(): Promise<Voice[]> {
    return [
      {
        id: "captions",
        name: "Browser voice (your device)",
        language: "en",
        description:
          "Uses speech synthesis in your browser. If your device has no voice, captions remain available.",
      },
    ];
  }
  async synthesize(): Promise<AudioResult> {
    throw new TTSError("tts_disabled", "No speech service is configured");
  }
}

export function ttsProviderFor(settings: LumenSettings): TTSProvider {
  if (settings.tts.provider === "kokoro") {
    return new KokoroHttpProvider(
      settings.tts.base_url,
      settings.tts.default_voice,
    );
  }
  return new NoSpeechProvider();
}

/* ---------------------------------- cache --------------------------------- */

export type SynthesisOutcome =
  | { status: "hit"; hash: string; duration_ms: number; url: string }
  | { status: "synthesised"; hash: string; duration_ms: number; url: string }
  | { status: "unavailable"; reason: string; duration_ms: number };

const urlFor = (hash: string) => `/api/media/audio/${hash}.mp3`;

/**
 * Synthesise one narration segment. Identical text, voice, speed and provider
 * always resolve to the same hash, so nothing is ever synthesised twice.
 */
export async function synthesizeSegment(options: {
  provider: TTSProvider;
  text: string;
  voice: string;
  speed: number;
  estimatedMs: number;
}): Promise<SynthesisOutcome> {
  const hash = segmentHash(
    options.text,
    options.voice,
    options.speed,
    options.provider.name,
  );
  const rows = await db.select().from(audio).where(eq(audio.hash, hash)).limit(1);
  if (rows.length && rows[0].duration_ms > 0 && existsSync(audioPath(hash))) {
    return {
      status: "hit",
      hash,
      duration_ms: rows[0].duration_ms,
      url: urlFor(hash),
    };
  }
  try {
    const result = await options.provider.synthesize(
      options.text,
      options.voice,
      options.speed,
    );
    await db
      .insert(audio)
      .values({
        hash: result.hash,
        path: audioPath(result.hash),
        duration_ms: result.duration_ms,
        voice: options.voice,
        speed: options.speed,
        bytes: result.bytes.byteLength,
        mime: result.mime,
      })
      .onConflictDoNothing();
    return {
      status: "synthesised",
      hash: result.hash,
      duration_ms: result.duration_ms,
      url: urlFor(result.hash),
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: (error as Error).message,
      duration_ms: options.estimatedMs,
    };
  }
}

export function readAudioFile(hash: string): { buffer: Buffer; mime: string } | null {
  if (!/^[a-f0-9]{8,64}$/.test(hash)) return null;
  const path = audioPath(hash);
  if (!existsSync(path)) return null;
  const buffer = readFileSync(path);
  const mime =
    buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF"
      ? "audio/wav"
      : "audio/mpeg";
  return { buffer, mime };
}
