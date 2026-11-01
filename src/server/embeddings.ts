import type { LumenSettings } from "@/server/settings";
import { safeFetch } from "@/server/safe-fetch";

export type Embedded = { vector: number[]; model: string };

const DIM = 256;

/** Fast deterministic FNV-1a 32-bit hash for lexical token bucketing. */
function fnv1a(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Lexical fallback index used when no embedding model is configured. It is a
 * real hashed bag-of-words vector (deterministic, no external claims), not a
 * semantic model — the UI calls it a keyword index.
 */
export function lexicalVector(text: string): number[] {
  const vector = new Array<number>(DIM).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  for (const token of tokens) {
    const h = fnv1a(token);
    const index = h % DIM;
    vector[index] += 1;
  }
  let sumSq = 0;
  for (let i = 0; i < DIM; i += 1) sumSq += vector[i] * vector[i];
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < DIM; i += 1) vector[i] /= norm;
  return vector;
}

export function cosine(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

export async function embedText(
  settings: LumenSettings,
  text: string,
): Promise<Embedded> {
  const config = settings.embeddings;
  const trimmed = text.slice(0, 6000);
  try {
    if (config.provider === "ollama" && config.model) {
      const base = (config.base_url || "http://127.0.0.1:11434").replace(/\/+$/, "");
      const endpoint = `${base}/api/embed`;
      {
        const response = await safeFetch(endpoint, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: config.model, input: trimmed }),
          signal: AbortSignal.timeout(60_000),
        });
        if (response.ok) {
          const data = (await response.json()) as { embeddings?: number[][] };
          const vector = data.embeddings?.[0];
          if (vector?.length) return { vector, model: config.model };
        }
      }
    } else if (config.provider === "openai" && config.model) {
      const base = (config.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
      const endpoint = `${base}/embeddings`;
      {
        const response = await safeFetch(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            ...(config.api_key ? { authorization: `Bearer ${config.api_key}` } : {}),
          },
          body: JSON.stringify({ model: config.model, input: trimmed }),
          signal: AbortSignal.timeout(60_000),
        });
        if (response.ok) {
          const data = (await response.json()) as { data?: { embedding: number[] }[] };
          const vector = data.data?.[0]?.embedding;
          if (vector?.length) return { vector, model: config.model };
        }
      }
    }
  } catch {
    /* fall through to the lexical index */
  }
  return { vector: lexicalVector(trimmed), model: "keyword-index" };
}

export function embeddingsAreSemantic(model: string): boolean {
  return model !== "keyword-index";
}
