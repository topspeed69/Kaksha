"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Link as LinkIcon, Type, Upload, X } from "lucide-react";
import type { Background, Depth } from "@/lib/dsl/types";
import type { LumenSettings } from "@/server/settings";
import { api } from "@/lib/api";
import { playVoicePreview } from "@/lib/player/voicePreview";
import {
  Button,
  Checkbox,
  Field,
  NumberedSection,
  SegmentedControl,
  Select,
  Slider,
  Tag,
  TextArea,
  TextInput,
  cn,
  useToast,
} from "@/components/ui";

type Staged = {
  id: string;
  label: string;
  section_count: number;
  chunk_count: number;
  pages: number | null;
  processed_pages?: number | null;
  warnings: string[];
};

type Voice = { id: string; name: string; language: string; description?: string };

const DEPTH_HINTS: Record<Depth, string> = {
  introductory: "No prior knowledge assumed. Every term is defined, mathematics kept to a minimum.",
  undergraduate: "The standard prerequisites of the field are assumed, and derivations are sketched.",
  graduate:
    "Full derivations, the assumptions behind them, their limits and the edge cases where they fail.",
};

const BACKGROUND_HINTS: Record<Background, string> = {
  beginner: "Prerequisite ideas are added as explicit early scenes.",
  familiar: "Prerequisites are named briefly, then used.",
  advanced: "Prerequisites are assumed; the time goes on the new material.",
};

export default function CreatePage() {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"upload" | "link" | "topic">("topic");
  const [staged, setStaged] = useState<Staged[]>([]);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState("");
  const [depth, setDepth] = useState<Depth>("undergraduate");
  const [minutes, setMinutes] = useState(30);
  const [background, setBackground] = useState<Background>("familiar");
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [deriveProofs, setDeriveProofs] = useState(true);
  const [embedCitations, setEmbedCitations] = useState(true);
  const [usePageImages, setUsePageImages] = useState(true);
  const [reviewOverride, setReviewOverride] = useState<boolean | null>(null);
  const [parallelOverride, setParallelOverride] = useState<boolean | null>(null);
  const [escalationOverride, setEscalationOverride] = useState<boolean | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const voices = useQuery({
    queryKey: ["voices"],
    queryFn: () => api.get<{ provider: string; voices: Voice[]; note?: string }>("/api/tts/voices"),
  });
  const pdfLimits = useQuery({
    queryKey: ["pdf-limits"],
    queryFn: () => api.get<{ limits: { max_pdf_pages: number } }>("/api/materials"),
  });
  const defaults = useQuery({
    queryKey: ["generation-settings"],
    queryFn: () => api.get<{ settings: LumenSettings }>("/api/settings"),
  });
  const reviewAgent = reviewOverride ?? defaults.data?.settings.generation?.review_agent_default ?? false;
  const parallelAgents = parallelOverride ?? defaults.data?.settings.generation?.parallel_agents_default ?? false;
  const escalationModel =
    escalationOverride ?? defaults.data?.settings.generation?.escalation_model_default ?? true;
  const escalationConfigured = Boolean(
    defaults.data?.settings.llm.escalation?.provider !== "none" &&
    defaults.data?.settings.llm.escalation?.model,
  );
  const reviewerConfigured = Boolean(
    (defaults.data?.settings.llm.reviewer?.provider !== "none" && defaults.data?.settings.llm.reviewer?.model) ||
    (defaults.data?.settings.llm.default?.provider !== "none" && defaults.data?.settings.llm.default?.model),
  );

  const voice =
    selectedVoice && voices.data?.voices.some((v) => v.id === selectedVoice)
      ? selectedVoice
      : voices.data?.voices[0]?.id ?? "captions";

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api.upload<Staged>("/api/materials", form);
      setStaged((current) => [
        ...current,
        {
          id: result.id,
          label: result.label ?? file.name,
          section_count: result.section_count ?? 0,
          chunk_count: result.chunk_count ?? 0,
          pages: result.pages ?? null,
          processed_pages: result.processed_pages ?? null,
          warnings: result.warnings ?? [],
        },
      ]);
      toast(`Parsed ${result.section_count ?? 0} sections from ${file.name}`);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const resolveLink = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const result = await api.post<{ id: string; warnings: string[] }>("/api/materials", {
        url: url.trim(),
      });
      const detail = await api.get<{
        label: string;
        section_count: number;
        chunk_count: number;
        pages: number | null;
        processed_pages?: number | null;
        warnings: string[];
      }>(`/api/materials/${result.id}`);
      setStaged((current) => [
        ...current,
        {
          id: result.id,
          label: detail.label,
          section_count: detail.section_count,
          chunk_count: detail.chunk_count,
          pages: detail.pages,
          processed_pages: detail.processed_pages ?? null,
          warnings: detail.warnings ?? [],
        },
      ]);
      toast(`Parsed ${detail.section_count} sections from the page`);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const plan = async () => {
    if (!topic.trim() && !staged.length) {
      toast("Enter a topic or attach some material first", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ id: string }>("/api/courses", {
        topic: topic.trim() || undefined,
        material_ids: staged.map((item) => item.id),
        depth,
        background,
        minutes,
        voice: { id: voice, speed },
        options: {
          derive_proofs: deriveProofs,
          embed_citations: embedCitations,
          review_agent: reviewAgent,
          parallel_agents: parallelAgents,
          use_page_images: usePageImages,
          escalation_model: escalationModel,
        },
      });
      router.push(`/courses/${result.id}/plan`);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const modules = Math.min(8, Math.max(1, Math.round(minutes / 10)));
  const teachScenes = Math.min(5, Math.max(1, Math.round((minutes * 0.85 * 60) / modules / 90)));
  const whiteboards =
    depth === "graduate" ? modules : depth === "undergraduate" ? Math.min(2, modules) : 1;

  return (
    <div className="grid12">
      <div className="col-span-4 lg:col-span-8">
        <h1 className="type-display text-ink">Create a new course</h1>
        <p className="type-body-lg measure mt-3 max-w-[56ch] text-muted md:mt-4">
          Start from a document, a link, or just a topic. Lumen plans the outline first, and you can
          edit it before any lesson is generated.
        </p>
      </div>

      <div className="col-span-4 mt-4 md:mt-10 lg:col-span-12">
        <div role="tablist" aria-label="Source" className="grid grid-cols-3 border-b border-rule md:flex">
          {[
            { key: "upload" as const, label: "Upload document", short: "Upload", icon: Upload },
            { key: "link" as const, label: "Paste link", short: "Link", icon: LinkIcon },
            { key: "topic" as const, label: "Enter topic", short: "Topic", icon: Type },
          ].map((item) => (
            <button
              key={item.key}
              role="tab"
              type="button"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                "type-label -mb-px flex min-h-14 flex-col items-center justify-center gap-1 border-b-2 px-2 py-2 text-center transition-colors md:min-h-0 md:flex-row md:gap-2 md:px-4 md:py-3",
                tab === item.key
                  ? "border-accent text-accent"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              <item.icon size={14} strokeWidth={1.5} />
              <span className="md:hidden">{item.short}</span>
              <span className="hidden md:inline">{item.label}</span>
            </button>
          ))}
        </div>

        <div className="border border-t-0 border-rule p-6">
          {tab === "upload" ? (
            <div>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) void upload(file);
                }}
                className={cn(
                  "flex flex-col items-center justify-center border border-dashed px-6 py-12 text-center transition-colors",
                  dragging ? "border-accent bg-surface" : "border-rule-strong bg-surface",
                )}
              >
                <FileText size={22} strokeWidth={1.5} className="text-muted" />
                <p className="type-body mt-3 text-ink">Drop a PDF, EPUB or Markdown file</p>
                <p className="type-body-sm mt-1 text-muted">
                  Academic papers, textbook chapters, monographs and lecture notes. Up to 150 MB.
                  {pdfLimits.data?.limits.max_pdf_pages
                    ? ` PDFs use up to ${pdfLimits.data.limits.max_pdf_pages} pages; relevant page images are shown to vision-capable models.`
                    : ""}
                </p>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.epub,.md,.markdown,.txt"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
                <Button
                  variant="secondary"
                  className="mt-5"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                >
                  Choose a file
                </Button>
              </div>
            </div>
          ) : null}

          {tab === "link" ? (
            <Field
              label="Link to an article or paper page"
              hint="The page is fetched once, on the server, and only its main text is kept."
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <TextInput
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://en.wikipedia.org/wiki/Quantum_decoherence"
                  type="url"
                />
                <Button variant="secondary" onClick={resolveLink} disabled={busy || !url.trim()}>
                  Read page
                </Button>
              </div>
            </Field>
          ) : null}

          {tab === "topic" ? (
            <Field
              label="Topic"
              counter={<span className="type-label-sm text-muted">{topic.length} / 400</span>}
              hint="One or two sentences works best. Say what you want to be able to do afterwards."
            >
              <TextArea
                rows={4}
                maxLength={400}
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="For example: quantum decoherence, up to the pointer-state picture, with the standard estimates"
              />
            </Field>
          ) : null}

          {staged.length ? (
            <div className="mt-6">
              <p className="type-label text-muted">Attached material ({staged.length})</p>
              <ul className="mt-3 divide-y divide-[var(--rule)] border border-rule">
                {staged.map((item) => (
                  <li key={item.id} className="flex items-start gap-4 px-4 py-3">
                    <div className="flex-1">
                      <p className="type-body text-ink">{item.label}</p>
                      <p className="type-body-sm mt-1 text-muted">
                        Parsed {item.section_count} sections · {item.chunk_count} chunks
                        {item.pages
                          ? ` · ${item.processed_pages ?? item.pages} of ${item.pages} pages processed`
                          : ""}
                      </p>
                      {item.warnings.map((warning) => (
                        <p key={warning} className="type-body-sm mt-1 text-accent">
                          {warning}
                        </p>
                      ))}
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${item.label}`}
                      onClick={() => setStaged((current) => current.filter((s) => s.id !== item.id))}
                      className="text-muted hover:text-ink"
                    >
                      <X size={14} strokeWidth={1.5} />
                    </button>
                  </li>
                ))}
              </ul>
              {staged.some((item) => item.warnings.length) ? (
                <p className="type-body-sm mt-3 text-muted">
                  Warnings come from the parser. Nothing has been verified beyond reading the text.
                </p>
              ) : null}
            </div>
          ) : null}

          {!staged.length && tab === "topic" ? (
            <p className="type-body-sm mt-4 border-l border-rule pl-3 text-muted">
              With no material attached, the content comes from the model’s general knowledge and
              should be checked. Lumen will say so on the course page.
            </p>
          ) : null}
        </div>
      </div>

      <div className="col-span-4 mt-8 md:mt-12 lg:col-span-12">
        <NumberedSection index="01" title="Depth" hint={DEPTH_HINTS[depth]} />
        <div className="mt-4">
          <SegmentedControl
            name="Depth"
            value={depth}
            onChange={setDepth}
            options={[
              { value: "introductory", label: "Introductory", hint: "Key ideas and intuition" },
              { value: "undergraduate", label: "Undergraduate", hint: "Ideas plus sketched derivations" },
              { value: "graduate", label: "Graduate", hint: "Full derivations and limits" },
            ]}
          />
        </div>
      </div>

      <div className="col-span-4 mt-8 md:mt-12 lg:col-span-6">
        <NumberedSection index="02" title="Time available" />
        <div className="mt-4">
          <Slider
            label="Time available"
            min={15}
            max={90}
            step={5}
            value={minutes}
            onChange={setMinutes}
            ticks={[15, 30, 45, 60, 90]}
            suffix="min"
          />
          <p className="type-body-sm mt-4 text-muted">
            Estimated: {modules} module{modules === 1 ? "" : "s"}, {modules * (teachScenes + 1)} scenes,{" "}
            {whiteboards * 3} whiteboard steps, {modules} quiz{modules === 1 ? "" : "zes"}. About 15%
            of the time is set aside for questions.
          </p>
        </div>
      </div>

      <div className="col-span-4 mt-8 md:mt-12 lg:col-span-6">
        <NumberedSection index="03" title="Your background" hint={BACKGROUND_HINTS[background]} />
        <div className="mt-4">
          <SegmentedControl
            name="Background"
            value={background}
            onChange={setBackground}
            options={[
              { value: "beginner", label: "Beginner" },
              { value: "familiar", label: "Familiar" },
              { value: "advanced", label: "Advanced" },
            ]}
          />
        </div>
      </div>

      <div className="col-span-4 mt-8 md:mt-12 lg:col-span-6">
        <NumberedSection
          index="04"
          title="Voice"
          hint={
            voices.data?.note ??
            "Narration is synthesised once and cached. Changing the voice re-records it."
          }
        />
        <div className="mt-4 space-y-4">
          <Select
            label="Voice"
            value={voice}
            onChange={setSelectedVoice}
            options={(
              voices.data?.voices ?? [
                { id: "captions", name: "Browser voice (your device)", language: "en" },
              ] as Voice[]
            ).map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
          <Slider
            label="Speaking speed"
            min={0.75}
            max={2}
            step={0.25}
            value={speed}
            onChange={setSpeed}
            suffix="×"
          />
          <Button
            variant="secondary"
            onClick={() => playVoicePreview({
              provider: voices.data?.provider === "kokoro" ? "kokoro" : "none",
              voice,
              speed,
              onError: (message) => toast(message, "error"),
              onInfo: (message) => toast(message),
            })}
          >
            Preview this voice
          </Button>
        </div>
      </div>

      <div className="col-span-4 mt-8 md:mt-12 lg:col-span-6">
        <NumberedSection index="Options" title="What to include" />
        <div className="mt-4 space-y-4">
          <Checkbox
            checked={deriveProofs}
            onChange={setDeriveProofs}
            label="Derive formal results"
            description="Whiteboard scenes carry the steps, not just the result."
          />
          <Checkbox
            checked={embedCitations}
            onChange={setEmbedCitations}
            label="Attach citations to scenes"
            description="Each scene lists the parts of your material it was built from."
          />
          <Checkbox
            checked={usePageImages}
            onChange={setUsePageImages}
            label="Use PDF page images with the model"
            description="Alongside extracted text, send at most two relevant page previews per model request. Requires a vision-capable model; may use more tokens."
          />
          <div className="border-t border-rule pt-4">
            <Checkbox
              checked={reviewAgent}
              onChange={setReviewOverride}
              label="Independent review agent"
              description="An additional model checks each slide, whiteboard step and quiz, and requests one revision for blocking issues."
            />
            {reviewAgent && !reviewerConfigured ? (
              <p className="type-body-sm mt-2 pl-8 text-muted">
                No reviewer or default model is set. Only deterministic format checks will run until you configure one in Settings.
              </p>
            ) : null}
          </div>
          <div className="border-t border-rule pt-4">
            <Checkbox
              checked={parallelAgents}
              onChange={setParallelOverride}
              label="Parallel scene agents"
              description="Write separate scenes concurrently using the content model. Local Ollama stays serial to avoid overloading it."
            />
          </div>
          <div className="border-t border-rule pt-4">
            <Checkbox
              checked={escalationModel}
              onChange={setEscalationOverride}
              label="Escalate to a smarter model after 2 retries"
              description="If a scene fails twice, that one request goes to the stronger escalation model with the exact failure list, instead of repeating the same call. No extra models to configure: it uses your provider's stronger variant."
            />
            {escalationModel && !escalationConfigured ? (
              <p className="type-body-sm mt-2 pl-8 text-muted">
                No escalation model is set. Choose one in Settings → Models → Escalation, or this course will keep using the content model for retries.
              </p>
            ) : null}
          </div>
          {(reviewAgent || parallelAgents || escalationModel) ? (
            <p className="type-body-sm border-l-2 border-accent pl-3 text-muted">
              Model usage: review adds at least one extra model call per scene and may add revision calls. Parallel agents make concurrent calls and may reach provider rate limits. Escalation only costs an extra call when a scene actually fails twice; check your provider’s token costs.
            </p>
          ) : null}
        </div>
      </div>

      <div className="col-span-4 mt-8 border-t border-rule pt-6 md:mt-12 lg:col-span-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Tag tone="outline">Estimated {modules} modules</Tag>
            <Tag tone="outline">{modules * (teachScenes + 1)} scenes</Tag>
            <Tag tone="outline">{whiteboards * 3} steps</Tag>
            <Tag tone="outline">{modules} quizzes</Tag>
            <span className="type-label text-muted">You review the outline before generation</span>
          </div>
          <Button variant="primary" onClick={plan} disabled={busy}>
            {busy ? "Working" : "Plan my course"}
          </Button>
        </div>
      </div>
    </div>
  );
}
