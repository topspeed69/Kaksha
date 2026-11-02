import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { ensureStorageDir, secretKeyPath } from "@/server/storage";
import { safeFetch } from "@/server/safe-fetch";
import { SECRET_CLEAR, SECRET_MASK } from "@/lib/provider-config";

export { SECRET_CLEAR, SECRET_MASK };

export type LlmProviderKind = "openai" | "nvidia" | "anthropic" | "ollama" | "none";
export type SlotName =
  | "default"
  | "planner"
  | "content"
  | "reviewer"
  | "grader"
  | "tutor"
  /** Stronger model used for retries after two failures. */
  | "escalation";

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
    /** Default for "escalate to a smarter model after two retries". */
    escalation_model_default: boolean;
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
    escalation: { provider: "none", model: "" },
  },
  generation: {
    review_agent_default: false,
    parallel_agents_default: false,
    escalation_model_default: true,
    max_parallel_scenes: 3,
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
    escalation_model_default: merged.generation?.escalation_model_default !== false,
    max_parallel_scenes: Number.isFinite(workers)
      ? Math.min(6, Math.max(2, Math.round(workers)))
      : 3,
  };
  return merged;
}

export async function getSettings(): Promise<LumenSettings> {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!rows.length) return settingsFromEnv() ?? DEFAULT_SETTINGS;
  const stored = mergeSettings(DEFAULT_SETTINGS, decryptTree(rows[0].data));
  // Stored settings win. Environment only fills slots the user never configured,
  // so a sandbox secret (API_KEY / BASE_URL / MODEL_NAME) works out of the box.
  return fillFromEnv(stored);
}

/**
 * Deployment-provided model credentials. Platforms commonly inject
 * API_KEY / BASE_URL / MODEL_NAME (or the OPENAI_-prefixed equivalents).
 * Every slot uses the same endpoint unless the user edits Settings.
 */
function envLlmConfig(): SlotConfig | null {
  const apiKey = (
    process.env.API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.LUMEN_API_KEY ??
    ""
  ).trim();
  const baseUrl = (
    process.env.BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    process.env.LUMEN_BASE_URL ??
    ""
  ).trim();
  const model = (
    process.env.MODEL_NAME ??
    process.env.OPENAI_MODEL ??
    process.env.LUMEN_MODEL ??
    ""
  ).trim();
  if (!model || !apiKey) return null;
  const nvidia = /nvidia/i.test(baseUrl) || /nvidia/i.test(model);
  return {
    provider: nvidia ? "nvidia" : "openai",
    base_url: baseUrl || undefined,
    api_key: apiKey,
    model,
    temperature: 0.3,
  };
}

function sameSlot(config: SlotConfig, env: SlotConfig): boolean {
  return (
    config.provider === env.provider &&
    (config.base_url ?? "") === (env.base_url ?? "") &&
    config.model === env.model
  );
}

/**
 * Pick a stronger variant of the deployment model for escalation. Providers
 * expose no capability metadata, so this uses well-known family conventions
 * and otherwise falls back to the same endpoint's default model with a higher
 * reasoning budget (temperature and max tokens are raised at the call site).
 */
export function escalationModel(model: string): string {
  const m = model.trim();
  if (!m) return m;
  const override = (
    process.env.ESCALATION_MODEL ??
    process.env.STRONG_MODEL_NAME ??
    ""
  ).trim();
  if (override) return override;
  if (/^nvidia\//i.test(m)) {
    if (/ultra|550b|253b/i.test(m)) return m;
    return "nvidia/nemotron-3-ultra-550b-a55b";
  }
  if (/^gpt-4o-mini|^gpt-4\.1-mini|^gpt-5-mini/i.test(m)) return m.replace(/mini/i, "");
  if (/^gpt-4o$/i.test(m)) return "gpt-4.1";
  if (/haiku/i.test(m)) return m.replace(/haiku/i, "sonnet");
  if (/^llama3\.2|^llama3\.1:8b|^qwen2\.5:7b/i.test(m)) return "llama3.1:70b";
  return m;
}

/**
 * Ask the provider which models this key can actually use and pick the
 * strongest one. Avoids hard-coding an id that may be retired, and means the
 * user never has to add a second model by hand.
 */
export async function discoverEscalationModel(
  env: SlotConfig,
): Promise<SlotConfig> {
  const fallback: SlotConfig = { ...env, model: escalationModel(env.model) };
  const base = env.base_url?.trim();
  if (!base || !env.api_key) return fallback;
  try {
    // safeFetch blocks private ranges for material URLs and allows loopback
    // only for providers, so a hostile base_url cannot be used to probe the
    // network or the cloud metadata service.
    const response = await safeFetch(`${base.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${env.api_key}` },
      signal: AbortSignal.timeout(8000),
    }, { kind: "provider" });
    if (!response.ok) return fallback;
    const json = (await response.json()) as { data?: { id?: string }[] };
    const ids = (json.data ?? [])
      .map((item) => String(item.id ?? ""))
      .filter((id) => id && id !== env.model);
    if (!ids.length) return fallback;

    const currentSize = Number(/(\d{2,3})b/i.exec(env.model)?.[1] ?? 0);
    const score = (id: string): number => {
      const lower = id.toLowerCase();
      if (/embed|guard|safety|reward|parse|rerank|nano|flash|lightning|bolt|ocr|image|tts|speech|vision-embed/i.test(lower)) {
        return -1;
      }
      const size = Number(/(\d{2,3})b/i.exec(lower)?.[1] ?? 0);
      let value = size;
      if (/ultra|reasoning|r1|thinking/i.test(lower)) value += 400;
      if (/pro|opus|sonnet|large/i.test(lower)) value += 120;
      if (/super/i.test(lower)) value += 60;
      if (/mini|small|nano|lite/i.test(lower)) value -= 200;
      // A same-family bigger sibling is the safest "smarter" choice.
      const family = env.model.replace(/^[^/]+\//, "").split(/[-.]/)[0];
      if (family && lower.includes(family)) value += 80;
      if (size && currentSize && size < currentSize) value -= 300;
      return value;
    };
    const ranked = ids
      .map((id) => ({ id, value: score(id) }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
    return ranked.length ? { ...env, model: ranked[0].id } : fallback;
  } catch {
    return fallback;
  }
}

function settingsFromEnv(): LumenSettings | null {
  const env = envLlmConfig();
  if (!env) return null;
  const slot = (): SlotConfig => ({ ...env });
  const base: LumenSettings = {
    ...DEFAULT_SETTINGS,
    llm: {
      default: slot(),
      planner: slot(),
      content: slot(),
      reviewer: slot(),
      grader: slot(),
      tutor: slot(),
      escalation: { ...slot(), model: escalationModel(env.model) },
    },
    generation: {
      // The visual/independent reviewer is the point of this release: on by
      // default, with the deterministic audit always running regardless.
      review_agent_default: true,
      parallel_agents_default: true,
      escalation_model_default: true,
      max_parallel_scenes: env.provider === "ollama" ? 1 : 3,
    },
    appearance: DEFAULT_SETTINGS.appearance,
    embeddings: { provider: "local", model: "" },
  };
  return base;
}

/** Fill empty slots from the environment without overwriting user choices. */
function fillFromEnv(stored: LumenSettings): LumenSettings {
  const env = envLlmConfig();
  if (!env) return stored;
  let changed = false;
  const llm = { ...stored.llm };
  for (const slot of Object.keys(llm) as SlotName[]) {
    const current = llm[slot];
    if (!current || current.provider === "none" || !current.model.trim()) {
      llm[slot] = { ...env, ...(current?.temperature !== undefined ? { temperature: current.temperature } : {}) };
      changed = true;
    }
  }
  return changed ? { ...stored, llm } : stored;
}

/**
 * Persist environment credentials once so the Settings screen shows the real
 * configuration, while keeping the key encrypted at rest.
 */
export async function seedSettingsFromEnv(): Promise<void> {
  const env = envLlmConfig();
  if (!env) return;
  let rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  if (!rows.length) {
    const initial = settingsFromEnv();
    if (!initial) return;
    const encrypted = encryptTree(initial);
    await db
      .insert(settings)
      .values({ id: 1, data: encrypted as Record<string, unknown> })
      .onConflictDoNothing();
    rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
    if (!rows.length) return;
  }

  let stored = mergeSettings(DEFAULT_SETTINGS, decryptTree(rows[0].data));
  const patch: Partial<Record<SlotName, SlotConfig>> = {};
  for (const name of Object.keys(stored.llm) as SlotName[]) {
    const current = stored.llm[name];
    if (!current || current.provider === "none" || !current.model.trim()) {
      patch[name] = name === "escalation"
        ? { ...env, model: escalationModel(env.model) }
        : env;
    }
  }
  if (!sameSlot(stored.llm.default, env) || !stored.llm.default.api_key) {
    patch.default = env;
  }
  if (Object.keys(patch).length) {
    await saveSettings({ llm: patch });
    stored = await getSettings();
  }

  // The escalation slot must point at a genuinely stronger model, never the
  // same one as the default. Ask the provider's catalogue once, then persist.
  const escalation = stored.llm.escalation;
  if (
    !escalation?.model ||
    !escalation.api_key ||
    escalation.model === stored.llm.default.model
  ) {
    const stronger = await discoverEscalationModel(env);
    if (stronger.model !== stored.llm.default.model) {
      await saveSettings({ llm: { escalation: stronger } });
    }
  }
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
      escalation: mask(input.llm.escalation ?? input.llm.default),
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
