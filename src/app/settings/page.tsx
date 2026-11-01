"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { playVoicePreview } from "@/lib/player/voicePreview";
import { useAppearance } from "@/lib/theme";
import {
  Button,
  Checkbox,
  Field,
  NumberedSection,
  SegmentedControl,
  Select,
  Slider,
  TextInput,
  cn,
  useToast,
} from "@/components/ui";
import type { LumenSettings, SlotName } from "@/server/settings";
import { SECRET_CLEAR, SECRET_MASK } from "@/lib/provider-config";

const SLOTS: SlotName[] = ["default", "planner", "content", "reviewer", "grader", "tutor"];

const PROVIDERS = [
  { value: "openai", label: "OpenAI compatible" },
  { value: "nvidia", label: "NVIDIA NIM" },
  { value: "anthropic", label: "Anthropic" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "none", label: "Not set" },
] as const;

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI-compatible",
  nvidia: "NVIDIA NIM",
  anthropic: "Anthropic",
  ollama: "Ollama",
  none: "Not set",
};

const MODEL_PLACEHOLDER: Record<string, string> = {
  openai: "gpt-4o-mini",
  nvidia: "minimaxai/minimax-m3.1-flash",
  anthropic: "claude-sonnet-4-5",
  ollama: "llama3.2",
  none: "gpt-4o-mini",
};

const LLM_BASE_DEFAULTS: Record<string, string> = {
  openai: "",
  nvidia: "https://integrate.api.nvidia.com/v1",
  anthropic: "",
  ollama: "http://127.0.0.1:11434",
  none: "",
};

/** A stored key is never sent back to the browser, so it shows as a mask. */
function SecretField({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  const stored = value === SECRET_MASK;
  const clearing = value === SECRET_CLEAR;
  return (
    <Field
      label={label}
      hint={hint}
      counter={
        stored ? (
          <button
            type="button"
            onClick={() => onChange(SECRET_CLEAR)}
            className="type-label text-muted hover:text-accent"
          >
            Clear stored key
          </button>
        ) : clearing ? (
          <span className="type-label text-accent">Will clear on save</span>
        ) : null
      }
    >
      <TextInput
        type="password"
        autoComplete="off"
        value={stored || clearing ? "" : value}
        placeholder={stored ? "Key stored (paste a new key to replace)" : "No key stored"}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const { appearance, update } = useAppearance();
  const [settings, setSettings] = useState<LumenSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(true);
  const [openSlot, setOpenSlot] = useState<SlotName | null>("default");
  const [tests, setTests] = useState<
    Record<string, { ok: boolean; latency_ms?: number; model?: string; error?: string }>
  >({});

  useEffect(() => {
    void api
      .get<{ settings: LumenSettings }>("/api/settings")
      .then((data) => setSettings(data.settings))
      .catch((error) => toast((error as Error).message, "error"));
  }, [toast]);

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const result = await api.put<{ settings: LumenSettings }>("/api/settings", settings);
      setSettings(result.settings);
      toast("Settings saved");
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const testSlot = async (slot: SlotName) => {
    if (!settings) return;
    setTests((current) => ({ ...current, [slot]: { ok: false, error: "Testing…" } }));
    try {
      const config = settings.llm[slot];
      const result = await api.post<{
        ok: boolean;
        latency_ms?: number;
        model?: string;
        error?: string;
      }>("/api/settings/test-llm", {
        slot,
        config: {
          provider: config.provider,
          model: config.model,
          base_url: config.base_url ?? "",
          api_key: config.api_key ?? "",
        },
      });
      setTests((current) => ({ ...current, [slot]: result }));
    } catch (error) {
      setTests((current) => ({ ...current, [slot]: { ok: false, error: (error as Error).message } }));
    }
  };

  if (!settings) {
    return <p className="type-body text-muted">Loading settings…</p>;
  }

  return (
    <div className="grid12">
      <div className="col-span-4 lg:col-span-8">
        <h1 className="type-display text-ink">Settings</h1>
        <p className="type-body-lg measure mt-4 max-w-[56ch] text-muted">
          Lumen runs on your machine. Provider keys are stored encrypted on the server and never sent
          back to this page.
        </p>
      </div>

      <div className="col-span-4 mt-10 lg:col-span-12">
        <button
          type="button"
          onClick={() => setModelsOpen((open) => !open)}
          aria-expanded={modelsOpen}
          aria-controls={modelsOpen ? "models-section" : undefined}
          className="flex w-full items-baseline justify-between gap-4 border-t border-rule pt-4 text-left"
        >
          <span className="flex items-baseline gap-3">
            <span className="type-num text-accent">01</span>
            <span className="type-h3 text-ink">Models</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="type-label text-muted">
              {modelsOpen ? "Hide" : "Show"}
            </span>
            <ChevronDown
              size={16}
              strokeWidth={1.5}
              className={cn(
                "text-muted transition-transform",
                modelsOpen && "rotate-180",
              )}
            />
          </span>
        </button>
        <p className="type-body-sm measure mt-2 text-muted">
          Each task can use a different provider. A task falls back to the default slot when it is not set.
        </p>
        {modelsOpen && (
        <div id="models-section" className="mt-4 space-y-6">
          {SLOTS.map((slot) => {
            const config = settings.llm[slot];
            return (
              <div key={slot} className="border-b border-rule pb-3">
                <button
                  type="button"
                  onClick={() => setOpenSlot(openSlot === slot ? null : slot)}
                  aria-expanded={openSlot === slot}
                  aria-controls={openSlot === slot ? `model-slot-${slot}` : undefined}
                  className="flex w-full items-start justify-between gap-4 py-3 text-left"
                >
                  <span>
                    <span className="type-h3 block text-ink">
                      {slot === "default" ? "Default model" : slot[0].toUpperCase() + slot.slice(1)}
                    </span>
                    <span className="type-body-sm mt-1 block text-muted">
                      {slot === "planner"
                        ? "Plans the outline and learning objectives."
                        : slot === "content"
                          ? "Writes slides, whiteboard steps and quizzes."
                          : slot === "reviewer"
                            ? "Independently checks teaching quality, sources and correctness when enabled."
                            : slot === "grader"
                              ? "Grades short answers against a rubric."
                              : slot === "tutor"
                                ? "Answers questions during the lesson."
                                : "Used for any task without its own model."}
                    </span>
                    <span className="type-label mt-2 block text-muted">
                      {config.provider === "none" || !config.model
                        ? slot === "default" ? "Not configured" : "Uses the default model when set"
                        : `${PROVIDER_LABEL[config.provider] ?? config.provider} · ${config.model}`}
                    </span>
                  </span>
                  <ChevronDown
                    size={18}
                    strokeWidth={1.5}
                    className={cn("mt-2 shrink-0 text-muted transition-transform", openSlot === slot && "rotate-180")}
                  />
                </button>
                {openSlot === slot && (
                <div id={`model-slot-${slot}`} className="grid gap-4 pb-4 md:grid-cols-2">
                  <p className="type-body-sm measure text-muted">
                    {slot === "reviewer"
                      ? "The reviewer is optional. If its slot is unset, the default model is used. Format checks run even without a model."
                      : "Set a provider, model and optional address. Keys stay encrypted server-side."}
                  </p>
                  <div className="grid gap-3">
                  <Select
                    label="Provider"
                    value={config.provider}
                    onChange={(value) =>
                      setSettings({
                        ...settings,
                        llm: {
                          ...settings.llm,
                          [slot]: {
                            ...config,
                            provider: value,
                            base_url: LLM_BASE_DEFAULTS[value] ?? config.base_url,
                          },
                        },
                      })
                    }
                    options={PROVIDERS.map((provider) => ({
                      value: provider.value,
                      label: provider.label,
                    }))}
                  />
                  <Field label="Model">
                    <TextInput
                      value={config.model}
                      placeholder={MODEL_PLACEHOLDER[config.provider] ?? MODEL_PLACEHOLDER.none}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          llm: { ...settings.llm, [slot]: { ...config, model: event.target.value } },
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Base address"
                    hint={
                      config.provider === "ollama"
                        ? "Local addresses are allowed for providers."
                        : "Optional. Leave empty for the provider's own address."
                    }
                  >
                    <TextInput
                      value={config.base_url ?? ""}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          llm: {
                            ...settings.llm,
                            [slot]: { ...config, base_url: event.target.value },
                          },
                        })
                      }
                    />
                  </Field>
                  <SecretField
                    label="Key"
                    hint="Stored encrypted on the server. Leave blank to keep a stored key."
                    value={config.api_key ?? ""}
                    onChange={(value) =>
                      setSettings({
                        ...settings,
                        llm: {
                          ...settings.llm,
                          [slot]: { ...config, api_key: value },
                        },
                      })
                    }
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="secondary" onClick={() => testSlot(slot)}>
                      Test connection
                    </Button>
                    {tests[slot] ? (
                      <span
                        className={
                          tests[slot].ok ? "type-body-sm text-ink" : "type-body-sm text-accent"
                        }
                      >
                        {tests[slot].ok
                          ? `Connected to ${tests[slot].model}. Reply took ${tests[slot].latency_ms} ms.`
                          : tests[slot].error}
                      </span>
                    ) : null}
                  </div>
                  </div>
                </div>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>

      <div className="col-span-4 mt-12 lg:col-span-12">
        <NumberedSection
          index="02"
          title="Generation defaults"
          hint="These defaults appear on Create. You can change either choice per course before planning."
        />
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <Checkbox
            checked={settings.generation.review_agent_default}
            onChange={(value) => setSettings({
              ...settings,
              generation: { ...settings.generation, review_agent_default: value },
            })}
            label="Independent review agent by default"
            description="Runs one extra model review per scene; blocking findings can trigger a revision call."
          />
          <div>
            <Checkbox
              checked={settings.generation.parallel_agents_default}
              onChange={(value) => setSettings({
                ...settings,
                generation: { ...settings.generation, parallel_agents_default: value },
              })}
              label="Parallel scene agents by default"
              description="Separate scene writers run concurrently. Ollama is capped at one writer."
            />
            {settings.generation.parallel_agents_default ? (
              <div className="mt-4 pl-8">
                <Select
                  label="Maximum concurrent scene writers"
                  value={String(settings.generation.max_parallel_scenes)}
                  onChange={(value) => setSettings({
                    ...settings,
                    generation: { ...settings.generation, max_parallel_scenes: Number(value) },
                  })}
                  options={[2, 3, 4].map((n) => ({ value: String(n), label: `${n} concurrent writers` }))}
                />
              </div>
            ) : null}
          </div>
        </div>
        <p className="type-body-sm mt-5 border-l-2 border-accent pl-3 text-muted">
          Review consumes additional model tokens per scene. Parallel writing increases simultaneous requests and may hit provider limits. Check your provider’s pricing and rate limits.
        </p>
      </div>

      <div className="col-span-4 mt-12 lg:col-span-6">
        <NumberedSection
          index="03"
          title="Speech"
          hint="Kokoro runs as a service you host. Without it, Lumen uses the browser voice when available, with captions timed from the text."
        />
        <div className="mt-4 space-y-4">
          <Select
            label="Speech service"
            value={settings.tts.provider}
            onChange={(value) =>
              setSettings({
                ...settings,
                tts: { ...settings.tts, provider: value },
              })
            }
            options={[
              { value: "none", label: "Browser voice + captions (no service)" },
              { value: "kokoro", label: "Kokoro over HTTP" },
            ]}
          />
          <Field
            label="Service address"
            hint="For example http://127.0.0.1:8880/v1/audio/speech"
          >
            <TextInput
              value={settings.tts.base_url}
              onChange={(event) =>
                setSettings({ ...settings, tts: { ...settings.tts, base_url: event.target.value } })
              }
            />
          </Field>
          <Field label="Default voice">
            <TextInput
              value={settings.tts.default_voice}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  tts: { ...settings.tts, default_voice: event.target.value },
                })
              }
            />
          </Field>
          <Slider
            label="Default speed"
            min={0.75}
            max={2}
            step={0.25}
            value={settings.tts.default_speed}
            onChange={(value) =>
              setSettings({ ...settings, tts: { ...settings.tts, default_speed: value } })
            }
            suffix="×"
          />
          <Button
            variant="secondary"
            onClick={() => playVoicePreview({
              provider: settings.tts.provider,
              voice: settings.tts.default_voice,
              speed: settings.tts.default_speed,
              onError: (message) => toast(message, "error"),
              onInfo: (message) => toast(message),
            })}
          >
            Preview the default voice
          </Button>
        </div>
      </div>

      <div className="col-span-4 mt-12 lg:col-span-6">
        <NumberedSection index="04" title="Appearance" />
        <div className="mt-4 space-y-6">
          <SegmentedControl
            name="Theme"
            value={appearance.theme}
            onChange={(value) => update({ theme: value })}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "Match system" },
            ]}
          />
          <SegmentedControl
            name="Captions"
            value={appearance.caption_size}
            onChange={(value) => update({ caption_size: value })}
            options={[
              { value: "md", label: "Captions: medium" },
              { value: "lg", label: "Captions: large" },
              { value: "xl", label: "Captions: largest" },
            ]}
          />
          <label className="type-body flex items-center gap-3">
            <input
              type="checkbox"
              checked={appearance.reduced_motion}
              onChange={(event) => update({ reduced_motion: event.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Reduce motion (this also follows your system setting)
          </label>
        </div>
      </div>

      <div className="col-span-4 mt-12 border-t border-rule pt-6 lg:col-span-12">
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? "Saving" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}
