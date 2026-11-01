import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { ensureStorageDir, secretKeyPath } from "@/server/storage";
import { SECRET_CLEAR, SECRET_MASK } from "@/lib/provider-config";

export { SECRET_CLEAR, SECRET_MASK };

export type LlmProviderKind = "openai" | "nvidia" | "anthropic" | "ollama" | "none";
export type SlotName = "default" | "planner" | "content" | "reviewer" | "grader" | "tutor";

export type SlotConfig = {
  provider: LlmProviderKind;
  base_url?: string;
  api_key?: string;
  model: string;
  temperature?: number;
  max_tokens?: number;
};

export type LumenSettings = {
  llm: Record<SlotName, SlotConfig>;
  generation: {
    review_agent_default: boolean;
    parallel_agents_default: boolean;
    /** Upper bound on independent scene writers. Ollama is capped to one. */
    max_parallel_scenes: number;
  };
  tts: {
    provider: "kokoro" | "none";
    base_url: string;
    default_voice: string;
    default_speed: number;
  };
  embeddings: {
    provider: "ollama" | "openai" | "local";
    base_url?: string;
    api_key?: string;
    model?: string;
  };
  appearance: {
    theme: "light" | "dark" | "system";
    reduced_motion: boolean;
    caption_size: "md" | "lg" | "xl";
  };
};

export const DEFAULT_SETTINGS: LumenSettings = {
  llm: {
    default: { provider: "none", model: "" },
    planner: { provider: "none", model: "" },
    content: { provider: "none", model: "" },
    reviewer: { provider: "none", model: "" },
    grader: { provider: "none", model: "" },
    tutor: { provider: "none", model: "" },
  },
  generation: {
    review_agent_default: false,
    parallel_agents_default: false,
    max_parallel_scenes: 2,
  },
  tts: {
    provider: "none",
    base_url: "http://127.0.0.1:8880/v1/audio/speech",
    default_voice: "af_heart",
    default_speed: 1,
  },
  embeddings: { provider: "local", model: "" },
  appearance: { theme: "system", reduced_motion: false, caption_size: "lg" },
};

/* ------------------------------- encryption ------------------------------- */

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const envKey = process.env.LUMEN_SECRET_KEY;
  if (envKey && envKey.length >= 16) {
    cachedKey = scryptSync(envKey, "lumen-settings-salt", 32);
    return cachedKey;
  }
  ensureStorageDir();
  const path = secretKeyPath();
  if (existsSync(path)) {
    cachedKey = Buffer.from(readFileSync(path, "utf8"), "hex");
    return cachedKey;
  }
  const generated = randomBytes(32);
  writeFileSync(path, generated.toString("hex"), { mode: 0o600 });
  cachedKey = generated;
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${enc.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptSecret(payload: string): string {
  if (!payload) return "";
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return "";
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(parts[1], "base64url"),
    );
    decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

/* ------------------------------ persistence ------------------------------- */

const SECRET_KEYS = new Set(["api_key"]);
const FORBIDDEN_PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function encryptTree(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(encryptTree);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_PROTO_KEYS.has(k)) continue;
      out[k] =
        SECRET_KEYS.has(k) && typeof v === "string" && v ? encryptSecret(v) : encryptTree(v);
    }
    return out;
  }
  return node;
}

function decryptTree(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(decryptTree);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_PROTO_KEYS.has(k)) continue;
      out[k] =
        SECRET_KEYS.has(k) && typeof v === "string" ? decryptSecret(v) : decryptTree(v);
    }
    return out;
  }
  return node;
}

function clampSpeed(value: unknown, fallback = 1): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(2, Math.max(0.75, n)) : fallback;
}

export function mergeSettings(base: LumenSettings, patch: unknown): LumenSettings {
  const walk = (b: unknown, p: unknown): unknown => {
    if (p === null || p === undefined) return b;
    if (typeof b !== "object" || b === null) return p;
    if (typeof p !== "object" || Array.isArray(p)) return b;
    const out: Record<string, unknown> = { ...(b as Record<string, unknown>) };
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
      if (FORBIDDEN_PROTO_KEYS.has(k)) continue;
      const current = (b as Record<string, unknown>)[k];
      if (SECRET_KEYS.has(k)) {
        if (v === SECRET_CLEAR) out[k] = "";
        else if (v === "" || v === SECRET_MASK || typeof v !== "string") out[k] = current ?? "";
        else out[k] = v;
        continue;
      }
      out[k] = walk(current, v);
    }
    return out;
  };
  const merged = walk(base, patch) as LumenSettings;
  merged.tts.default_speed = clampSpeed(merged.tts.default_speed, 1);
  const workers = Number(merged.generation?.max_parallel_scenes);
  merged.generation = {
    review_agent_default: merged.generation?.review_agent_default === true,
    parallel_agents_default: merged.generation?.parallel_agents_default === true,
    max_parallel_scenes: Number.isFinite(workers)
      ? Math.min(4, Math.max(2, Math.round(workers)))
      : 2,
  };
  return merged;
}

export async function getSettings(): Promise<LumenSettings> {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!rows.length) return DEFAULT_SETTINGS;
  return mergeSettings(DEFAULT_SETTINGS, decryptTree(rows[0].data));
}

export async function saveSettings(patch: unknown): Promise<LumenSettings> {
  const current = await getSettings();
  const next = mergeSettings(current, patch);
  const encrypted = encryptTree(next);
  await db
    .insert(settings)
    .values({ id: 1, data: encrypted as Record<string, unknown> })
    .onConflictDoUpdate({
      target: settings.id,
      set: { data: encrypted as Record<string, unknown>, updated_at: new Date() },
    });
  return next;
}

/** Keys are write-only: responses never carry them back to the browser. */
export function maskSettings(input: LumenSettings): LumenSettings {
  const mask = (slot: SlotConfig): SlotConfig => ({
    ...slot,
    api_key: slot.api_key ? SECRET_MASK : "",
  });
  return {
    ...input,
    llm: {
      default: mask(input.llm.default),
      planner: mask(input.llm.planner),
      content: mask(input.llm.content),
      reviewer: mask(input.llm.reviewer),
      grader: mask(input.llm.grader),
      tutor: mask(input.llm.tutor),
    },
    tts: {
      ...input.tts,
    },
    embeddings: {
      ...input.embeddings,
      api_key: input.embeddings.api_key ? SECRET_MASK : "",
    },
  };
}

/** Resolve the effective config for a slot, falling back to `default`. */
export function resolveSlot(
  all: LumenSettings,
  slot: SlotName,
): { config: SlotConfig; slot: SlotName } {
  const wanted = all.llm[slot];
  const fallback = all.llm.default;
  if (wanted && wanted.provider !== "none" && wanted.model.trim()) {
    return {
      config: {
        ...fallback,
        ...wanted,
        base_url: wanted.base_url?.trim() || (wanted.provider === fallback.provider ? fallback.base_url : undefined),
        api_key: wanted.api_key || (wanted.provider === fallback.provider ? fallback.api_key : ""),
      },
      slot,
    };
  }
  return { config: fallback, slot: "default" };
}

export function hasModel(config: SlotConfig): boolean {
  return Boolean(config.model?.trim() && config.provider !== "none");
}
