import { resolveSlot, hasModel, type SlotConfig, type SlotName, type LumenSettings } from "@/server/settings";
import { safeFetch } from "@/server/safe-fetch";
import { ESCALATION_SYSTEM, retryPrompt } from "@/server/prompts";

export type Msg = { role: "system" | "user" | "assistant"; content: string };

export type LLMResult = {
  text: string;
  model: string;
  provider: string;
};

export type LLMImage = {
  mime: "image/jpeg" | "image/png";
  data: string;
  page: number;
  materialId: string;
};

export type LLMRequest = {
  system: string;
  messages: Msg[];
  temperature: number;
  maxTokens: number;
  /** At most two relevant server-side PDF page previews; never exposed to clients. */
  images?: LLMImage[];
};

export interface LLMProvider {
  readonly name: string;
  complete(request: LLMRequest): Promise<LLMResult>;
  stream(request: LLMRequest): AsyncIterable<string>;
}

export class LLMError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "LLMError";
    this.code = code;
  }
}


/** Provider-specific image blocks, using the currently documented API shapes. */
export function openAiMessages(request: LLMRequest): unknown[] {
  return [
    { role: "system", content: request.system },
    ...request.messages.map((msg, index) => ({
      role: msg.role,
      content: msg.role === "user" && index === request.messages.length - 1 && request.images?.length
        ? [
            { type: "text", text: msg.content },
            ...request.images.slice(0, 2).map((image) => ({
              type: "image_url",
              image_url: { url: `data:${image.mime};base64,${image.data}`, detail: "high" },
            })),
          ]
        : msg.content,
    })),
  ];
}

export function anthropicMessages(request: LLMRequest): unknown[] {
  return request.messages.map((msg, index) => ({
    role: msg.role,
    content: msg.role === "user" && index === request.messages.length - 1 && request.images?.length
      ? [
          { type: "text", text: msg.content },
          ...request.images.slice(0, 2).map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mime, data: image.data },
          })),
        ]
      : msg.content,
  }));
}

export function ollamaMessages(request: LLMRequest): unknown[] {
  return [
    { role: "system", content: request.system },
    ...request.messages.map((msg, index) => ({
      role: msg.role,
      content: msg.content,
      ...(msg.role === "user" && index === request.messages.length - 1 && request.images?.length
        ? { images: request.images.slice(0, 2).map((image) => image.data) }
        : {}),
    })),
  ];
}

/* --------------------------- openai-compatible ---------------------------- */

type ChatChoice = {
  message?: { content?: string | null; reasoning_content?: string | null };
  finish_reason?: string;
};
type ChatResponse = { choices?: ChatChoice[]; error?: { message?: string } };

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  constructor(
    private readonly config: SlotConfig,
    name = "openai",
    private readonly defaultBaseUrl = "https://api.openai.com/v1",
    private readonly timeoutMs = 180_000,
  ) {
    this.name = name;
  }

  private get baseUrl(): string {
    const raw = this.config.base_url?.trim() || this.defaultBaseUrl;
    return raw.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.api_key) headers.authorization = `Bearer ${this.config.api_key}`;
    return headers;
  }

  private async post(body: Record<string, unknown>, stream: boolean) {
    const endpoint = `${this.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await safeFetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { ...this.headers(), accept: stream ? "text/event-stream" : "application/json" },
        body: JSON.stringify({ ...body, stream }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new LLMError(
          "provider_http_error",
          `${this.name} returned ${response.status}: ${text.slice(0, 300)}`,
        );
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const maxTokens =
      this.config.max_tokens ??
      (this.name === "nvidia" ? 131072 : request.maxTokens);
    const body: Record<string, unknown> = {
      model: this.config.model,
      temperature: request.temperature,
      max_tokens: maxTokens,
      messages: openAiMessages(request),
    };
    // NVIDIA NIM returns an empty 200 body when JSON mode is refused instead of
    // an HTTP error, so skip response_format for it entirely and parse the
    // plain-text reply for JSON like any other response.
    const useJsonMode = this.name !== "nvidia";
    let response: Response;
    try {
      response = await this.post(
        { ...body, ...(useJsonMode ? { response_format: { type: "json_object" } } : {}) },
        false,
      );
    } catch (error) {
      const message = (error as Error).message;
      if (useJsonMode && /response_format|json_object|json mode/i.test(message)) {
        response = await this.post(body, false);
      } else if (/max[ _-]?tokens/i.test(message) && request.maxTokens && maxTokens !== request.maxTokens) {
        response = await this.post(
          {
            ...body,
            max_tokens: request.maxTokens,
            ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
          },
          false,
        );
      } else {
        throw error;
      }
    }
    const data = (await response.json()) as ChatResponse;
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text) {
      if (choice?.finish_reason === "length") {
        throw new LLMError(
          "empty_response",
          `${this.name} hit max_tokens limit (${maxTokens}) before generating content`,
        );
      }
      throw new LLMError("empty_response", `${this.name} returned no text`);
    }
    return { text, model: this.config.model, provider: this.name };
  }

  async *stream(request: LLMRequest): AsyncIterable<string> {
    const maxTokens =
      this.config.max_tokens ??
      (this.name === "nvidia" ? 131072 : request.maxTokens);
    const streamBody: Record<string, unknown> = {
      model: this.config.model,
      temperature: request.temperature,
      max_tokens: maxTokens,
      messages: openAiMessages(request),
      stream: true,
    };
    let response: Response;
    try {
      response = await this.post(streamBody, true);
    } catch (error) {
      const message = (error as Error).message;
      if (/max[ _-]?tokens/i.test(message) && request.maxTokens && maxTokens !== request.maxTokens) {
        response = await this.post({ ...streamBody, max_tokens: request.maxTokens }, true);
      } else {
        throw error;
      }
    }
    if (!response.body) throw new LLMError("no_body", "empty stream body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* ignore malformed keep-alive lines */
        }
      }
    }
  }
}

/* -------------------------------- anthropic ------------------------------- */

type AnthropicResponse = {
  content?: { type: string; text?: string }[];
  error?: { message?: string };
};

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  constructor(private readonly config: SlotConfig) {}

  private get baseUrl(): string {
    return (this.config.base_url?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
  }

  private async call(body: Record<string, unknown>, stream: boolean) {
    const endpoint = `${this.baseUrl}/v1/messages`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    try {
      const response = await safeFetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.api_key ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ ...body, stream }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new LLMError(
          "provider_http_error",
          `anthropic returned ${response.status}: ${text.slice(0, 300)}`,
        );
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const response = await this.call(
      {
        model: this.config.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        messages: [...anthropicMessages(request), { role: "assistant", content: "{" }],
      },
      false,
    );
    const data = (await response.json()) as AnthropicResponse;
    const text = (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    if (!text) throw new LLMError("empty_response", "anthropic returned no text");
    const trimmed = text.trimStart();
    return {
      text: trimmed.startsWith("{") ? trimmed : `{${text}`,
      model: this.config.model,
      provider: this.name,
    };
  }

  async *stream(request: LLMRequest): AsyncIterable<string> {
    const response = await this.call(
      {
        model: this.config.model,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
        system: request.system,
        messages: anthropicMessages(request),
      },
      true,
    );
    if (!response.body) throw new LLMError("no_body", "empty stream body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        try {
          const parsed = JSON.parse(trimmed.slice(5).trim()) as {
            delta?: { text?: string };
          };
          if (parsed.delta?.text) yield parsed.delta.text;
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/* ------------------------------ ollama native ----------------------------- */

type OllamaResponse = {
  message?: { content?: string };
  error?: string;
  response?: string;
};

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  constructor(private readonly config: SlotConfig) {}

  private get baseUrl(): string {
    return (this.config.base_url?.trim() || "http://127.0.0.1:11434").replace(/\/+$/, "");
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const endpoint = `${this.baseUrl}/api/chat`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 300_000);
    try {
      const response = await safeFetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          stream: false,
          format: "json",
          options: {
            temperature: request.temperature,
            num_predict: request.maxTokens,
          },
          messages: ollamaMessages(request),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new LLMError(
          "provider_http_error",
          `ollama returned ${response.status}: ${text.slice(0, 300)}`,
        );
      }
      const data = (await response.json()) as OllamaResponse;
      const text = data.message?.content ?? data.response ?? "";
      if (!text) throw new LLMError("empty_response", "ollama returned no text");
      return { text, model: this.config.model, provider: this.name };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(request: LLMRequest): AsyncIterable<string> {
    const endpoint = `${this.baseUrl}/api/chat`;
    const response = await safeFetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        stream: true,
        options: { temperature: request.temperature, num_predict: request.maxTokens },
        messages: ollamaMessages(request),
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok || !response.body) {
      throw new LLMError("provider_http_error", `ollama stream failed (${response.status})`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string } };
          if (parsed.message?.content) yield parsed.message.content;
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/* --------------------------------- registry ------------------------------- */

class UnconfiguredProvider implements LLMProvider {
  readonly name = "unconfigured";
  async complete(): Promise<LLMResult> {
    throw new LLMError("no_provider", "No language model is configured for this task");
  }
  async *stream(): AsyncIterable<string> {
    throw new LLMError("no_provider", "No language model is configured for this task");
  }
}

export function providerFor(config: SlotConfig): LLMProvider {
  switch (config.provider) {
    case "openai":
      return new OpenAICompatibleProvider(config, "openai-compatible");
    case "nvidia":
      return new OpenAICompatibleProvider(
        config,
        "nvidia",
        "https://integrate.api.nvidia.com/v1",
        600_000,
      );
    case "anthropic":
      return new AnthropicProvider(config);
    case "ollama":
      return new OllamaProvider(config);
    default:
      return new UnconfiguredProvider();
  }
}

export type SlotResolution = {
  provider: LLMProvider;
  config: SlotConfig;
  slot: SlotName;
  available: boolean;
};

export function resolveLLM(all: LumenSettings, slot: SlotName): SlotResolution {
  const { config, slot: resolved } = resolveSlot(all, slot);
  return {
    provider: providerFor(config),
    config,
    slot: resolved,
    available: hasModel(config),
  };
}

/* --------------------------- structured output ---------------------------- */

/** Extract the first balanced JSON object from a model reply, ignoring prose/fences. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  let start = trimmed.indexOf("{");
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = trimmed.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }
    start = trimmed.indexOf("{", start + 1);
  }
  throw new LLMError("no_json", "reply contained no valid JSON object");
}

export type JsonOutcome<T> =
  | { ok: true; value: T; repairs: number; model: string; imagesDropped?: boolean }
  | { ok: false; error: string; repairs: number; issues: string[]; model: string; imagesDropped?: boolean };

/**
 * Ask a slot for JSON that satisfies `validate`. One repair round-trip that
 * includes the validation errors; a second failure is a typed error.
 */
export async function generateStructured<T>(options: {
  slot: SlotResolution;
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  images?: LLMImage[];
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; issues: string[] };
  maxRepairs?: number;
  /** Higher reasoning budget for a stronger escalation model. */
  escalation?: boolean;
}): Promise<JsonOutcome<T>> {
  if (options.escalation) {
    options = {
      ...options,
      temperature: Math.max(options.temperature, 0.35),
      maxTokens: Math.max(options.maxTokens, 3200),
    };
  }
  const { slot } = options;
  if (!slot.available) {
    return {
      ok: false,
      error: "No language model is configured for this task",
      repairs: 0,
      issues: [],
      model: "",
    };
  }
  let lastReply = "";
  const attempt = async (extra: string, escalation = false): Promise<JsonOutcome<T>> => {
    const request: LLMRequest = {
      system: escalation ? ESCALATION_SYSTEM : options.system,
      messages: [{ role: "user", content: `${options.prompt}${extra}` }],
      temperature: escalation ? Math.min(0.4, options.temperature + 0.1) : options.temperature,
      maxTokens: options.maxTokens,
      images: options.images?.slice(0, 2),
    };
    let result: LLMResult;
    let imagesDropped = false;
    try {
      result = await slot.provider.complete(request);
    } catch (error) {
      // Only retry without images when the provider explicitly says it cannot
      // accept them. Do not hide auth, quota or connectivity errors.
      const message = (error as Error).message;
      if (request.images?.length && /(?:image|vision|multimodal|content.part|base64)/i.test(message) &&
          /(?:unsupported|not supported|invalid|cannot|unrecognized|does not|not allowed)/i.test(message)) {
        result = await slot.provider.complete({ ...request, images: [] });
        imagesDropped = true;
      } else throw error;
    }
    lastReply = result.text;
    let parsed: unknown;
    try {
      parsed = extractJson(result.text);
    } catch (error) {
      return {
        ok: false,
        error: `Reply was not valid JSON: ${(error as Error).message}`,
        repairs: 0,
        issues: [],
        model: result.model,
        imagesDropped,
      };
    }
    const checked = options.validate(parsed);
    if (checked.ok) {
      return { ok: true, value: checked.value, repairs: 0, model: result.model, imagesDropped };
    }
    return {
      ok: false,
      error: checked.issues.join("; "),
      repairs: 0,
      issues: checked.issues,
      model: result.model,
      imagesDropped,
    };
  };

  let current = await attempt("");
  if (current.ok) return current;

  // One focused repair is enough when the prompt is specific. A second is only
  // used when the first was a parse failure (models usually recover on a clean
  // re-write), otherwise the caller escalates to a stronger model instead of
  // burning more calls on the same one.
  const budget = options.maxRepairs ?? 1;
  for (let i = 0; i < budget && !current.ok; i += 1) {
    const parseFailure = /not valid JSON|no_json|invalid JSON/i.test(current.error);
    if (i > 0 && !parseFailure) break;
    const repaired = await attempt(
      retryPrompt(current.issues, current.error, i + 1, parseFailure ? "" : lastReply),
      options.escalation,
    );
    repaired.repairs = i + 1;
    if (repaired.ok) return repaired;
    current = repaired;
  }
  return current;
}
