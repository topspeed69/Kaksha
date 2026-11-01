"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Captions,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Pause,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
} from "lucide-react";
import type { Course, Scene } from "@/lib/dsl/types";
import { formatClock } from "@/lib/format";
import {
  computeSceneState,
  getPreparedCourse,
  getPreparedScene,
  stepEndMs,
  stepStartMs,
  timelineAt,
  type FlatScene,
  type TimelineSegment,
} from "@/lib/player/computeSceneState";
import {
  usePlayerEngine,
  usePlayerKeyboard,
  usePlayerStore,
} from "@/lib/player/store";
import { streamTutor } from "@/lib/api";
import { cachePlayerPayload } from "@/lib/course-cache";
import { useAppearance } from "@/lib/theme";
import { Button, cn, KeyboardHint, Tag } from "@/components/ui";
import { Latex } from "@/components/ui/Latex";
import { SlideRenderer } from "@/components/slides/SlideRenderer";
import { Whiteboard } from "@/components/whiteboard/Whiteboard";

/* ---------------------------------- stage --------------------------------- */

export function Stage({ scene }: { scene: Scene }) {
  const tMs = usePlayerStore((s) => s.tMs);
  const rate = usePlayerStore((s) => s.rate);
  const courseId = usePlayerStore((s) => s.courseId);
  const state = useMemo(() => computeSceneState(scene, tMs, rate), [scene, tMs, rate]);
  if (scene.kind === "slide" && state.kind === "slide") {
    return <SlideRenderer scene={scene} state={state} />;
  }
  if (scene.kind === "whiteboard" && state.kind === "whiteboard") {
    return <Whiteboard scene={scene} state={state} />;
  }
  return (
    <div className="flex w-full items-center justify-center border border-rule bg-stage px-8 py-16" style={{ aspectRatio: "16 / 9" }}>
      <div className="max-w-[52ch]">
        <p className="type-label text-accent">Quiz scene</p>
        <h3 className="type-h2 mt-2 text-ink">{scene.title}</h3>
        <p className="type-body mt-3 text-muted">
          This scene is a set of questions. Open the Quiz tab to answer them.
        </p>
        <div className="mt-6">
          <Link
            href={courseId ? `/courses/${courseId}/quiz` : "#quiz"}
            className="type-label inline-flex items-center gap-2 border border-ink px-4 py-3 text-ink hover:bg-ink hover:text-bg"
          >
            Go to the quiz <ArrowRight size={14} strokeWidth={1.5} />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- captions -------------------------------- */

const CAPTION_FONT_CLASS: Record<"md" | "lg" | "xl", string> = {
  md: "text-[16px] leading-normal",
  lg: "text-[20px] leading-snug",
  xl: "text-[24px] leading-snug",
};

export function CaptionBar() {
  const captions = usePlayerStore((s) => s.captions);
  const rate = usePlayerStore((s) => s.rate);
  const seconds = usePlayerStore((s) => Math.floor(Math.max(0, s.tMs) / 1000));
  const segment = usePlayerStore((s): TimelineSegment | null => {
    const entry = s.flat[s.sceneIndex];
    return entry ? timelineAt(getPreparedScene(entry.scene).timeline, s.tMs) : null;
  });
  const { appearance } = useAppearance();
  if (!captions || !segment) return null;
  const sizeClass = CAPTION_FONT_CLASS[appearance.caption_size] ?? CAPTION_FONT_CLASS.lg;
  return (
    <div className="flex items-baseline gap-3 border border-rule bg-surface px-4 py-3">
      <span className="type-num shrink-0 text-accent">[{formatClock(seconds * 1000)}]</span>
      <p className={cn("font-body font-medium text-ink", sizeClass)}>{segment.text}</p>
      <span className="type-label ml-auto hidden shrink-0 text-muted sm:block">{rate}×</span>
    </div>
  );
}

/* -------------------------------- transport ------------------------------- */

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export function TransportBar({ sceneMarkers = true }: { sceneMarkers?: boolean }) {
  const flat = usePlayerStore((s) => s.flat);
  const sceneIndex = usePlayerStore((s) => s.sceneIndex);
  const tMs = usePlayerStore((s) => s.tMs);
  const rate = usePlayerStore((s) => s.rate);
  const captions = usePlayerStore((s) => s.captions);
  const status = usePlayerStore((s) => s.status);
  const toggle = usePlayerStore((s) => s.toggle);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const seekBy = usePlayerStore((s) => s.seekBy);
  const setRate = usePlayerStore((s) => s.setRate);
  const toggleCaptions = usePlayerStore((s) => s.toggleCaptions);
  const muted = usePlayerStore((s) => s.muted);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const speechNotice = usePlayerStore((s) => s.speechNotice);
  const speechUnavailable = usePlayerStore((s) => s.speechUnavailable);
  const offlineAudioBySegment = usePlayerStore((s) => s.fallbackAudioBySegment);
  const courseId = usePlayerStore((s) => s.courseId);
  const retrySpeech = usePlayerStore((s) => s.retrySpeech);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const entry = flat[sceneIndex];
  const total = entry ? entry.endMs - entry.startMs : 0;
  const pct = total > 0 ? Math.min(100, (tMs / total) * 100) : 0;
  const activeSegment = entry ? timelineAt(getPreparedScene(entry.scene).timeline, tMs) : null;
  const offlineReady = Boolean(activeSegment &&
    offlineAudioBySegment[`${courseId}:${sceneIndex}:${activeSegment.id}`]);
  const markers = useMemo(
    () => (entry ? getPreparedScene(entry.scene).timeline.segments : []),
    [entry],
  );

  return (
    <div className="flex flex-col gap-3 border border-rule bg-surface-2 p-3">
      <div className="relative h-[6px] w-full bg-surface-3">
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
        <div
          className="absolute -top-1 h-3.5 w-3.5 -translate-x-1/2 border border-bg bg-accent"
          style={{ left: `${pct}%` }}
        />
        {sceneMarkers
          ? markers.map((segment) => (
              <span
                key={segment.id}
                className="absolute inset-y-0 w-px bg-[var(--rule-strong)]"
                style={{ left: `${(segment.startMs / Math.max(1, total)) * 100}%` }}
                title={segment.text.slice(0, 80)}
              />
            ))
          : null}
        <input
          type="range"
          min={0}
          max={Math.max(1000, total)}
          step={250}
          value={Math.min(tMs, total)}
          aria-label="Seek within this scene"
          onChange={(event) => seekTo(Number(event.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={status === "playing" ? "Pause" : "Play"}
            className="flex h-9 w-9 items-center justify-center bg-ink text-bg transition-colors hover:bg-accent"
          >
            {status === "playing" ? (
              <Pause size={18} strokeWidth={1.5} />
            ) : (
              <Play size={18} strokeWidth={1.5} />
            )}
          </button>
          <button
            type="button"
            onClick={() => seekBy(-10000)}
            aria-label="Back 10 seconds"
            className="flex h-9 w-9 items-center justify-center border border-rule text-ink hover:bg-surface"
          >
            <RotateCcw size={16} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => seekBy(10000)}
            aria-label="Forward 10 seconds"
            className="flex h-9 w-9 items-center justify-center border border-rule text-ink hover:bg-surface"
          >
            <SkipForward size={16} strokeWidth={1.5} />
          </button>
          <span className="type-num ml-2 flex items-baseline gap-1">
            <span className="text-accent">{formatClock(tMs)}</span>
            <span className="text-muted">/</span>
            <span className="text-ink">{formatClock(total)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-rule" role="group" aria-label="Playback speed">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => setRate(speed)}
                aria-pressed={speed === rate}
                className={cn(
                  "type-label-sm border-r border-rule px-2 py-1 last:border-r-0 transition-colors",
                  speed === rate
                    ? "bg-ink text-bg"
                    : "bg-bg text-muted hover:text-ink",
                )}
              >
                {speed}×
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={toggleMute}
            aria-pressed={muted}
            aria-label={muted ? "Unmute narration" : "Mute narration"}
            title={`${muted ? "Unmute" : "Mute"} narration (M)`}
            className={cn(
              "type-label flex items-center gap-2 border px-3 py-1 transition-colors",
              muted
                ? "border-accent text-accent"
                : "border-rule text-muted hover:text-ink",
            )}
          >
            {muted ? <VolumeX size={14} strokeWidth={1.5} /> : <Volume2 size={14} strokeWidth={1.5} />}
            {muted ? "Muted" : "Sound"}
          </button>
          <button
            type="button"
            onClick={toggleCaptions}
            aria-pressed={captions}
            className={cn(
              "type-label flex items-center gap-2 border px-3 py-1 transition-colors",
              captions ? "border-accent text-accent" : "border-rule text-muted hover:text-ink",
            )}
          >
            <Captions size={14} strokeWidth={1.5} />
            Captions {captions ? "on" : "off"}
          </button>
          <button
            type="button"
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen lecture player"}
            title={fullscreen ? "Exit fullscreen (F)" : "Fullscreen lecture player (F)"}
            onClick={(event) => {
              const target =
                event.currentTarget.closest<HTMLElement>("[data-player-root]") ??
                document.querySelector<HTMLElement>("[data-player-root]") ??
                document.documentElement;
              if (document.fullscreenElement) void document.exitFullscreen();
              else void target.requestFullscreen().catch(() => undefined);
            }}
            className="flex h-9 w-9 items-center justify-center border border-rule text-ink hover:bg-surface"
          >
            {fullscreen ? <Minimize size={16} strokeWidth={1.5} /> : <Maximize size={16} strokeWidth={1.5} />}
          </button>
        </div>
      </div>
      {speechNotice && !muted ? (
        <div role="status" className="type-body-sm flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-2 text-muted">
          <span>{speechNotice}</span>
          {speechUnavailable && !offlineReady ? (
            <button
              type="button"
              onClick={retrySpeech}
              className="type-label border-b border-ink py-1 text-ink hover:text-accent"
            >
              Try browser voice again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------- transcript ------------------------------ */

const TranscriptRow = memo(function TranscriptRow({
  segment,
  active,
  onSeek,
}: {
  segment: TimelineSegment;
  active: boolean;
  onSeek: (ms: number) => void;
}) {
  return (
    <button
      data-segment={segment.id}
      type="button"
      onClick={() => onSeek(segment.startMs + 20)}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
        active
          ? "border-l-4 border-l-accent bg-surface-2 text-ink"
          : "border-l-4 border-l-transparent text-muted hover:bg-surface-2",
      )}
    >
      <span className={cn("type-num w-14 shrink-0", active ? "text-accent" : "text-muted")}>
        {formatClock(segment.startMs)}
      </span>
      <span className="type-body-sm">{segment.text}</span>
    </button>
  );
});

export function TranscriptPanel() {
  const flat = usePlayerStore((s) => s.flat);
  const sceneIndex = usePlayerStore((s) => s.sceneIndex);
  const autoscroll = usePlayerStore((s) => s.autoscroll);
  const setAutoscroll = usePlayerStore((s) => s.setAutoscroll);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const activeId = usePlayerStore((s) => {
    const entry = s.flat[s.sceneIndex];
    return entry ? (timelineAt(getPreparedScene(entry.scene).timeline, s.tMs)?.id ?? null) : null;
  });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const entry = flat[sceneIndex];
  const timeline = useMemo(
    () => (entry ? getPreparedScene(entry.scene).timeline : { segments: [], totalMs: 0 }),
    [entry],
  );
  const onSeek = useCallback((ms: number) => seekTo(ms), [seekTo]);

  useEffect(() => {
    if (!autoscroll || !containerRef.current || !activeId) return;
    const node = containerRef.current.querySelector(`[data-segment="${activeId}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId, autoscroll]);

  return (
    <section aria-label="Transcript">
      <div className="mb-2 flex items-center justify-between border-b border-rule pb-2">
        <h3 className="type-label text-ink">Transcript</h3>
        <label className="type-label flex cursor-pointer items-center gap-2 text-muted">
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(event) => setAutoscroll(event.target.checked)}
            className="h-3 w-3 accent-[var(--accent)]"
          />
          Autoscroll
        </label>
      </div>
      <div
        ref={containerRef}
        className="max-h-[420px] divide-y divide-[var(--rule)] overflow-y-auto border border-rule bg-bg"
      >
        {timeline.segments.map((segment) => (
          <TranscriptRow key={segment.id} segment={segment} active={segment.id === activeId} onSeek={onSeek} />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------- module track ----------------------------- */

export function ModuleTrack() {
  const flat = usePlayerStore((s) => s.flat);
  const sceneIndex = usePlayerStore((s) => s.sceneIndex);
  const goToScene = usePlayerStore((s) => s.goToScene);
  const course = usePlayerStore((s) => s.course);
  const modules = useMemo(() => (course ? getPreparedCourse(course).modules : []), [course]);
  if (!flat.length || !course) return null;
  return (
    <section aria-label="Modules" className="border-t border-rule pt-4">
      <div className="flex items-baseline justify-between">
        <h3 className="type-label text-muted">Modules</h3>
        <span className="type-label-sm text-muted">
          Scene {sceneIndex + 1} of {flat.length}
        </span>
      </div>
      <div className="mt-3 space-y-4">
        {modules.map(({ module, entries }) => (
          <div key={module.id}>
            <div className="flex items-baseline justify-between gap-4">
              <p className="type-body-sm text-ink">
                <span className="type-num mr-2 text-accent">
                  {String(module.index + 1).padStart(2, "0")}
                </span>
                {module.title}
              </p>
              <span className="type-label text-muted">{module.duration_min} min</span>
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {entries.map((entry) => {
                const active = entry.sceneIndex === sceneIndex;
                return (
                  <li key={entry.scene.id}>
                    <button
                      type="button"
                      onClick={() => goToScene(entry.sceneIndex, 0)}
                      className={cn(
                        "type-body-sm flex items-center gap-2 border-b pb-1 transition-colors",
                        active
                          ? "border-accent text-accent"
                          : "border-transparent text-muted hover:text-ink",
                      )}
                    >
                      <span className="type-num">
                        {String(entry.sceneIndex + 1).padStart(2, "0")}
                      </span>
                      {entry.scene.title}
                      <span className="type-label text-muted">{entry.kind}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------- tools ---------------------------------- */

export function ToolsPanel() {
  const course = usePlayerStore((s) => s.course);
  const flat = usePlayerStore((s) => s.flat);
  const sceneIndex = usePlayerStore((s) => s.sceneIndex);
  const pause = usePlayerStore((s) => s.pause);
  const play = usePlayerStore((s) => s.play);
  const [question, setQuestion] = useState("Explain this step in different words.");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entry = flat[sceneIndex];
  const segment = usePlayerStore((s): TimelineSegment | null => {
    const active = s.flat[s.sceneIndex];
    return active ? timelineAt(getPreparedScene(active.scene).timeline, s.tMs) : null;
  });

  const ask = async () => {
    if (!course || !entry) return;
    setBusy(true);
    setAnswer("");
    setError(null);
    pause();
    try {
      await streamTutor(
        {
          course_id: course.id,
          scene_id: entry.scene.id,
          segment_id: segment?.id,
          question,
        },
        (chunk) => setAnswer((current) => current + chunk),
      );
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Tools" className="border-t border-rule pt-4">
      <h3 className="type-label text-muted">Tools</h3>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="type-label text-muted">Ask about this moment</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={3}
            className="mt-2 w-full border border-rule bg-bg px-3 py-2 text-ink"
          />
        </label>
        <Button variant="secondary" onClick={ask} disabled={busy} full>
          <Sparkles size={14} strokeWidth={1.5} />
          {busy ? "Asking" : "Explain this step"}
        </Button>
        {answer ? (
          <div className="border border-rule bg-surface-2 p-3">
            <p className="type-label text-accent">Tutor</p>
            <p className="type-body-sm mt-2 text-ink">{answer}</p>
            <Button variant="ghost" onClick={play} className="mt-3">
              Resume lecture
            </Button>
          </div>
        ) : null}
        {error ? <p className="type-body-sm text-accent">{error}</p> : null}
        {entry?.kind === "whiteboard" ? (
          <Link
            href={`/courses/${course?.id ?? ""}/whiteboard`}
            className="type-label inline-flex items-center gap-2 border border-ink px-4 py-3 text-ink hover:bg-ink hover:text-bg"
          >
            Open the whiteboard
            <ArrowRight size={14} strokeWidth={1.5} />
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/* --------------------------------- shell ---------------------------------- */

export function PlayerShell({
  course,
  resume,
  children,
  keyboard = true,
}: {
  course: Course;
  resume?: { scene_index: number; t_ms: number; scenes_done?: number[] };
  children?: React.ReactNode;
  keyboard?: boolean;
}) {
  const load = usePlayerStore((s) => s.load);
  const loadedId = usePlayerStore((s) => s.courseId);
  useEffect(() => {
    if (loadedId !== course.id) {
      load(course, {
        sceneIndex: resume?.scene_index ?? 0,
        tMs: resume?.t_ms ?? 0,
        scenesDone: resume?.scenes_done,
      });
      void cachePlayerPayload({
        course,
        progress: {
          scene_index: resume?.scene_index ?? 0,
          t_ms: resume?.t_ms ?? 0,
          scenes_done: resume?.scenes_done ?? [],
        },
      });
    }
  }, [course, load, loadedId, resume]);
  usePlayerEngine();
  usePlayerKeyboard(keyboard);
  return <>{children}</>;
}

/** The scene the player is currently on, for pages that need it directly. */
export function useCurrentEntry(): FlatScene | undefined {
  const flat = usePlayerStore((s) => s.flat);
  const sceneIndex = usePlayerStore((s) => s.sceneIndex);
  return flat[sceneIndex];
}

export function SceneIntro() {
  const entry = useCurrentEntry();
  const flat = usePlayerStore((s) => s.flat);
  if (!entry || !flat.length) return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3">
      <div>
        <p className="type-label text-accent">
          Module {String(entry.moduleIndex + 1).padStart(2, "0")}
        </p>
        <h2 className="type-h1 mt-1 text-ink">{entry.scene.title}</h2>
      </div>
      <div className="flex items-center gap-2">
        <Tag tone="outline">{entry.kind}</Tag>
        {entry.scene.review ? (
          <span title={entry.scene.review.summary}>
            <Tag tone="quiet">
              {entry.scene.review.status === "approved"
                ? "Model reviewed"
                : entry.scene.review.status === "unavailable"
                  ? "Review unavailable"
                  : "Format checked"}
            </Tag>
          </span>
        ) : null}
        <Tag>{formatClock(entry.endMs - entry.startMs)}</Tag>
      </div>
    </div>
  );
}

/* --------------------------- whiteboard helpers --------------------------- */

export function WhiteboardSteps() {
  const entry = useCurrentEntry();
  const activeIndex = usePlayerStore((s) => {
    const active = s.flat[s.sceneIndex];
    if (!active || active.scene.kind !== "whiteboard") return -1;
    const prepared = getPreparedScene(active.scene);
    const segment = timelineAt(prepared.timeline, s.tMs);
    return segment ? (prepared.stepIndexBySegmentId.get(segment.id) ?? -1) : -1;
  });
  const seekTo = usePlayerStore((s) => s.seekTo);
  const goToScene = usePlayerStore((s) => s.goToScene);
  const flat = usePlayerStore((s) => s.flat);
  if (!entry || entry.scene.kind !== "whiteboard") return null;
  const scene = entry.scene;
  const timeline = getPreparedScene(scene).timeline;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="type-label text-muted">Derivation steps</h3>
        <span className="type-label-sm text-muted">
          {Math.max(0, activeIndex) + 1} of {scene.steps.length}
        </span>
      </div>
      <ol className="divide-y divide-[var(--rule)] border border-rule">
        {scene.steps.map((step, index) => {
          const active = index === activeIndex;
          const done = activeIndex > index;
          return (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => seekTo(stepStartMs(scene, timeline, step.id))}
                className={cn(
                  "w-full px-4 py-4 text-left transition-colors",
                  active
                    ? "border-l-4 border-l-accent bg-surface-2"
                    : "border-l-4 border-l-transparent hover:bg-surface-2",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn("type-body-sm", active ? "text-ink" : "text-muted")}>
                    {index + 1}. {step.title}
                  </span>
                  {done ? <span className="type-label text-ink">Done</span> : null}
                  {active ? <span className="type-label text-accent">Now</span> : null}
                </div>
                {step.summary_latex ? (
                  <div className="mt-2 text-ink">
                    <Latex latex={step.summary_latex} />
                  </div>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          full
          onClick={() => {
            const next = scene.steps[activeIndex + 1];
            if (next) seekTo(stepStartMs(scene, timeline, next.id));
            else goToScene(Math.min(flat.length - 1, entry.sceneIndex + 1), 0);
          }}
        >
          Advance to next step <ChevronRight size={14} strokeWidth={1.5} />
        </Button>
        <Button
          variant="ghost"
          full
          onClick={() => {
            const step = scene.steps[Math.max(0, activeIndex)];
            if (!step) return;
            usePlayerStore
              .getState()
              .playRange(
                stepStartMs(scene, timeline, step.id),
                stepEndMs(scene, timeline, step.id),
              );
          }}
        >
          <RotateCcw size={14} strokeWidth={1.5} /> Replay this step
        </Button>
      </div>
    </div>
  );
}

export function WhiteboardStepDetails() {
  const entry = useCurrentEntry();
  const stepIndex = usePlayerStore((s) => {
    const active = s.flat[s.sceneIndex];
    if (!active || active.scene.kind !== "whiteboard") return 0;
    const prepared = getPreparedScene(active.scene);
    const segment = timelineAt(prepared.timeline, s.tMs);
    return segment ? (prepared.stepIndexBySegmentId.get(segment.id) ?? 0) : 0;
  });
  if (!entry || entry.scene.kind !== "whiteboard") return null;
  const scene = entry.scene;
  const activeIndex = Math.max(0, stepIndex);
  const step = scene.steps[activeIndex];
  if (!step) return null;
  const hasDetails = (step.assumptions?.length ?? 0) + (step.variables?.length ?? 0) > 0;
  if (!hasDetails) return null;
  return (
    <div className="border-t border-rule pt-4">
      <h3 className="type-label text-muted">Step {String(activeIndex + 1).padStart(2, "0")}</h3>
      {step.assumptions?.length ? (
        <div className="mt-3">
          <p className="type-label-sm text-muted">Assumptions used here</p>
          <ul className="mt-2 space-y-2">
            {step.assumptions.map((assumption) => (
              <li key={assumption} className="type-body-sm border-l border-rule pl-3 text-ink">
                {assumption}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {step.variables?.length ? (
        <div className="mt-4">
          <p className="type-label-sm text-muted">Variables</p>
          <dl className="mt-2 divide-y divide-[var(--rule)] border-y border-rule">
            {step.variables.map((variable) => (
              <div key={variable.symbol} className="flex items-baseline gap-3 py-2">
                <dt className="type-body-sm w-24 shrink-0 text-ink">
                  <Latex latex={variable.symbol} />
                </dt>
                <dd className="type-body-sm text-muted">{variable.meaning}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

export function StepTimeBadge() {
  const entry = useCurrentEntry();
  const tMs = usePlayerStore((s) => s.tMs);
  if (!entry || entry.scene.kind !== "whiteboard") return null;
  const timeline = getPreparedScene(entry.scene).timeline;
  const step = entry.scene.steps.find((item) =>
    item.segment_ids.includes(timelineAt(timeline, tMs)?.id ?? ""),
  );
  if (!step) return null;
  const start = stepStartMs(entry.scene, timeline, step.id);
  const end = stepEndMs(entry.scene, timeline, step.id);
  return (
    <span className="type-label-sm text-muted">
      {formatClock(tMs - start)} / {formatClock(end - start)}
    </span>
  );
}

export function PlayerKeyboardHint() {
  return (
    <KeyboardHint
      items={[
        { keys: "Space", action: "Play or pause" },
        { keys: "← →", action: "10 seconds" },
        { keys: "Shift ← →", action: "Scene" },
        { keys: "C", action: "Captions" },
        { keys: "M", action: "Mute" },
        { keys: "[ ]", action: "Speed" },
        { keys: "F", action: "Fullscreen" },
      ]}
    />
  );
}

export function PrevNextScene() {
  const flat = usePlayerStore((s) => s.flat);
  const sceneIndex = usePlayerStore((s) => s.sceneIndex);
  const goToScene = usePlayerStore((s) => s.goToScene);
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => goToScene(sceneIndex - 1, 0)}
        disabled={sceneIndex === 0}
        aria-label="Previous scene"
        className="flex h-9 w-9 items-center justify-center border border-rule text-ink disabled:opacity-30"
      >
        <ChevronLeft size={16} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        onClick={() => goToScene(sceneIndex + 1, 0)}
        disabled={sceneIndex >= flat.length - 1}
        aria-label="Next scene"
        className="flex h-9 w-9 items-center justify-center border border-rule text-ink disabled:opacity-30"
      >
        <ChevronRight size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export { SkipBack };
