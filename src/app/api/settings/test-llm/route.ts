import { fail, ok, errorResponse } from "@/server/http";
import {
  getSettings,
  mergeSettings,
  resolveSlot,
  type LlmProviderKind,
  type SlotConfig,
  type SlotName,
} from "@/server/settings";
import { providerFor } from "@/server/providers/llm";

export const dynamic = "force-dynamic";

const VALID_SLOTS = new Set<SlotName>([
  "default",
  "planner",
  "content",
  "reviewer",
  "grader",
  "tutor",
  "escalation",
]);
const VALID_PROVIDERS = new Set<LlmProviderKind>(["openai", "nvidia", "anthropic", "ollama", "none"]);

type PendingConfig = {
  provider?: unknown;
  model?: unknown;
  base_url?: unknown;
  api_key?: unknown;
};

/** Keep only the fields a slot owns, so a stray key cannot reach the provider. */
function pickConfig(input: PendingConfig): Partial<SlotConfig> {
  const out: Partial<SlotConfig> = {};
  if (typeof input.provider === "string" && VALID_PROVIDERS.has(input.provider as LlmProviderKind)) {
    out.provider = input.provider as LlmProviderKind;
  }
  if (typeof input.model === "string") out.model = input.model.slice(0, 200);
  if (typeof input.base_url === "string") out.base_url = input.base_url.slice(0, 500);
  if (typeof input.api_key === "string") out.api_key = input.api_key.slice(0, 500);
  return out;
}

/** One real round-trip to the configured provider for the chosen task slot. */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      slot?: unknown;
      config?: PendingConfig;
    };
    const rawSlot = body.slot ?? "default";
    if (typeof rawSlot !== "string" || !VALID_SLOTS.has(rawSlot as SlotName)) {
      return fail("invalid_slot", "Slot must be default, planner, content, reviewer, grader, tutor or escalation", 400);
    }
    const slot = rawSlot as SlotName;
    const settings = await getSettings();
    // The page sends what is currently typed, so a model that is not saved yet
    // is still tested. Nothing is written to the database here.
    const pending = body.config ? pickConfig(body.config) : null;
    const effective = pending ? mergeSettings(settings, { llm: { [slot]: pending } }) : settings;
    const { config, slot: resolved } = resolveSlot(effective, slot);
    if (!config.model || config.provider === "none") {
      return ok({
        ok: false,
        error: `No model is set for ${resolved}. Choose a provider and a model first.`,
      });
    }
    const provider = providerFor(config);
    const started = Date.now();
    try {
      const result = await provider.complete({
        system: 'Reply with a JSON object only: {"status":"ready"}.',
        messages: [{ role: "user", content: 'Return JSON {"status":"ready"}' }],
        temperature: 0,
        maxTokens: 32,
      });
      return ok({
        ok: true,
        latency_ms: Date.now() - started,
        model: result.model,
        provider: result.provider,
        reply: result.text.trim().slice(0, 120),
      });
    } catch (error) {
      return ok({
        ok: false,
        latency_ms: Date.now() - started,
        error: (error as Error).message.slice(0, 400),
      });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
