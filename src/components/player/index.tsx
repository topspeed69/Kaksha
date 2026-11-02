"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Captions,
  ChevronDown,
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
    <div
      className="flex w-full items-center justify-center border border-rule bg-stage px-5 py-10 md:px-8 md:py-16"
      style={{ aspectRatio: "16 / 9" }}
    >
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
  md: "text-[14px] leading-snug sm:text-[16px] sm:leading-normal",
  lg: "text-[15px] leading-snug sm:text-[20px]",
  xl: "text-[17px] leading-snug sm:text-[24px]",
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
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border border-rule bg-surface px-3 py-2.5 sm:px-4 sm:py-3">
      <span className="type-num shrink-0 text-accent">[{formatClock(seconds * 1000)}]</span>
      <p className={cn("min-w-0 flex-1 font-body font-medium text-ink", sizeClass)}>{segment.text}</p>
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
    <div className="flex flex-col gap-2 border-b border-rule bg-bg pb-2">
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
      <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={status === "playing" ? "Pause" : "Play"}
            className="flex h-11 w-11 items-center justify-center bg-ink text-bg transition-colors hover:bg-accent sm:h-9 sm:w-9"
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
            className="flex h-11 w-11 items-center justify-center border border-rule text-ink hover:bg-surface sm:h-9 sm:w-9"
          >
            <RotateCcw size={16} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => seekBy(10000)}
            aria-label="Forward 10 seconds"
            className="flex h-11 w-11 items-center justify-center border border-rule text-ink hover:bg-surface sm:h-9 sm:w-9"
          >
            <SkipForward size={16} strokeWidth={1.5} />
          </button>
          <span className="type-num ml-2 flex items-baseline gap-1">
            <span className="text-accent">{formatClock(tMs)}</span>
            <span className="text-muted">/</span>
            <span className="text-ink">{formatClock(total)}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="-mx-1 flex overflow-x-auto border border-rule" role="group" aria-label="Playback speed">
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                onClick={() => setRate(speed)}
                aria-pressed={speed === rate}
                className={cn(
                  "type-label-sm shrink-0 border-r border-rule px-2.5 py-2 last:border-r-0 transition-colors sm:px-2 sm:py-1",
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
            className="flex h-11 w-11 items-center justify-center border border-rule text-ink hover:bg-surface sm:h-9 sm:w-9"
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
      <div className="mb-2 flex items-center justify-between gap-3 border-b border-rule pb-2">
        <h3 className="type-label text-ink">Transcript</h3>
        <label className="type-label ml-auto flex cursor-pointer items-center gap-2 text-muted">
          <input
            type="checkbox"
            checked={autoscroll}
            onChange={(event) => setAutoscroll(event.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Autoscroll
        </label>
      </div>
      <div
        ref={containerRef}
        className="max-h-[420px] divide-y divide-[var(--rule)] overflow-y-auto border border-rule bg-bg max-md:max-h-none"
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
              <span className="type-label shrink-0 whitespace-nowrap text-muted">{module.duration_min} min</span>
            </div>
            <ul className="mt-2 flex flex-col md:flex-row md:flex-wrap md:gap-x-4 md:gap-y-2">
              {entries.map((entry) => {
                const active = entry.sceneIndex === sceneIndex;
                return (
                  <li
                    key={entry.scene.id}
                    className="border-b border-rule last:border-b-0 md:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => goToScene(entry.sceneIndex, 0)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "type-body-sm flex min-h-12 w-full items-center gap-3 px-1 py-2.5 text-left transition-colors md:min-h-0 md:w-auto md:gap-2 md:border-b md:px-0 md:py-0 md:pb-1",
                        active
                          ? "text-accent max-md:bg-surface-2 md:border-accent"
                          : "text-muted hover:text-ink md:border-transparent",
                      )}
                    >
                      <span className="type-num">
                        {String(entry.sceneIndex + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 md:flex-none">{entry.scene.title}</span>
                      <span className="type-label ml-auto text-muted md:ml-0">{entry.kind}</span>
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
    <section aria-label="Tools" className="border-t border-rule pt-4 max-md:border-t-0 max-md:pt-0">
      <h3 className="type-label text-muted">Tools</h3>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="type-label text-muted">Ask about this moment</span>
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={3}
            className="mt-2 w-full border border-rule bg-bg px-3 py-2.5 text-ink outline-none focus:border-ink"
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
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2 border-b border-rule pb-3">
      <div className="min-w-0">
        <h2 className="scene-title text-ink">{entry.scene.title}</h2>
        <p className="type-label mt-1 text-muted">
          Module {String(entry.moduleIndex + 1).padStart(2, "0")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Tag tone="outline">{entry.kind}</Tag>
        {entry.scene.review ? (
          <span title={entry.scene.review.summary} className="hidden sm:inline">
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

/* ------------------------- phone: YouTube-style player ------------------------ */

/**
 * Tap the stage to play or pause, double-tap its left or right third to jump
 * ten seconds, like a video app. Sits over the stage on phones only.
 */
export function StageGestures() {
  const status = usePlayerStore((s) => s.status);
  const toggle = usePlayerStore((s) => s.toggle);
  const seekBy = usePlayerStore((s) => s.seekBy);
  const last = useRef<{ t: number; side: "l" | "r" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(status);
  const [started, setStarted] = useState(false);
  if (status === "playing" && !started) {
    setStarted(true);
  }
  const [flash, setFlash] = useState<{ kind: "l" | "r" | "play" | "pause"; key: number } | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // A paused slide stays readable: the big button is only a first-play prompt,
  // and afterwards a tap just flashes the state it switched to.
  const playToggle = () => {
    const wasPlaying = statusRef.current === "playing";
    toggle();
    setFlash({ kind: wasPlaying ? "pause" : "play", key: Date.now() });
  };

  const onTap = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(1, rect.width);
    const side = x < 0.33 ? "l" : x > 0.67 ? "r" : "c";
    if (side === "c") {
      playToggle();
      return;
    }
    const now = Date.now();
    if (last.current && last.current.side === side && now - last.current.t < 320) {
      if (timer.current) clearTimeout(timer.current);
      last.current = null;
      seekBy(side === "l" ? -10000 : 10000);
      setFlash({ kind: side, key: now });
      return;
    }
    last.current = { t: now, side };
    if (timer.current) clearTimeout(timer.current);
    // A lone tap on a side is a play/pause tap; wait to see if it is a double.
    timer.current = setTimeout(() => {
      playToggle();
      last.current = null;
    }, 320);
  };

  const prompt = status !== "playing" && (!started || status === "ended");

  return (
    <div
      onClick={onTap}
      className="absolute inset-0 z-10 md:hidden"
      role="presentation"
      data-stage-gestures
    >
      {prompt ? (
        <span
          aria-hidden="true"
          className="type-label pointer-events-none absolute bottom-3 left-3 flex h-10 items-center gap-2 rounded-full bg-ink/80 pl-3 pr-4 text-bg"
        >
          {status === "ended" ? (
            <><RotateCcw size={16} strokeWidth={1.5} /> Replay</>
          ) : (
            <><Play size={16} strokeWidth={1.5} className="translate-x-[1px]" /> Tap to play</>
          )}
        </span>
      ) : null}
      {flash ? (
        flash.kind === "l" || flash.kind === "r" ? (
          <span
            key={flash.key}
            aria-hidden="true"
            className={cn(
              "tap-flash type-label pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full bg-ink/75 px-4 py-3 text-bg",
              flash.kind === "l" ? "left-[10%]" : "right-[10%]",
            )}
          >
            {flash.kind === "l" ? "−10 s" : "+10 s"}
          </span>
        ) : (
          <span
            key={flash.key}
            aria-hidden="true"
            className="tap-flash pointer-events-none absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-ink/75 text-bg"
          >
            {flash.kind === "pause" ? (
              <Pause size={24} strokeWidth={1.5} />
            ) : (
              <Play size={26} strokeWidth={1.5} className="translate-x-[1px]" />
            )}
          </span>
        )
      ) : null}
    </div>
  );
}

/**
 * One row of controls under the stage: a thin red scrubber on the stage edge,
 * then play, scene back/next, the clock, speed, captions and fullscreen.
 */
export function MobileTransport({ sceneMarkers = true }: { sceneMarkers?: boolean }) {
  const flat = usePlayerStore((s) => s.flat);
  const sceneIndex = usePlayerStore((s) => s.sceneIndex);
  const tMs = usePlayerStore((s) => s.tMs);
  const rate = usePlayerStore((s) => s.rate);
  const captions = usePlayerStore((s) => s.captions);
  const status = usePlayerStore((s) => s.status);
  const toggle = usePlayerStore((s) => s.toggle);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const setRate = usePlayerStore((s) => s.setRate);
  const toggleCaptions = usePlayerStore((s) => s.toggleCaptions);
  const goToScene = usePlayerStore((s) => s.goToScene);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const entry = flat[sceneIndex];
  const total = entry ? entry.endMs - entry.startMs : 0;
  const pct = total > 0 ? Math.min(100, (tMs / total) * 100) : 0;
  const markers = useMemo(
    () => (entry ? getPreparedScene(entry.scene).timeline.segments : []),
    [entry],
  );
  const cycleSpeed = () => {
    const at = SPEEDS.indexOf(rate);
    setRate(SPEEDS[(at + 1) % SPEEDS.length]);
  };
  const iconButton =
    "flex h-11 w-10 shrink-0 items-center justify-center text-ink active:bg-surface-2 disabled:opacity-30 max-[359px]:w-9";

  return (
    <div className="border-b border-rule bg-bg md:hidden" data-mobile-transport>
      <div className="relative mx-3 h-5 touch-none">
        <div className="absolute inset-x-0 top-0 h-[3px] bg-rule-strong">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          {sceneMarkers
            ? markers.map((segment) => (
                <span
                  key={segment.id}
                  className="absolute inset-y-0 w-px bg-bg"
                  style={{ left: `${(segment.startMs / Math.max(1, total)) * 100}%` }}
                />
              ))
            : null}
        </div>
        <span
          aria-hidden="true"
          className="absolute -top-[4px] h-[11px] w-[11px] -translate-x-1/2 rounded-full bg-accent"
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={0}
          max={Math.max(1000, total)}
          step={250}
          value={Math.min(tMs, total)}
          aria-label="Seek within this scene"
          onChange={(event) => seekTo(Number(event.target.value))}
          className="absolute -inset-x-3 -top-2 h-9 w-[calc(100%+1.5rem)] cursor-pointer opacity-0"
        />
      </div>
      <div className="flex items-center px-1 pb-1">
        <button
          type="button"
          onClick={toggle}
          aria-label={status === "playing" ? "Pause" : "Play"}
          className="flex h-11 w-11 shrink-0 items-center justify-center text-ink active:bg-surface-2 max-[359px]:w-10"
        >
          {status === "playing" ? (
            <Pause size={22} strokeWidth={1.5} />
          ) : (
            <Play size={22} strokeWidth={1.5} />
          )}
        </button>
        <button
          type="button"
          onClick={() => goToScene(sceneIndex - 1, 0)}
          disabled={sceneIndex === 0}
          aria-label="Previous scene"
          className={iconButton}
        >
          <SkipBack size={18} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => goToScene(sceneIndex + 1, 0)}
          disabled={sceneIndex >= flat.length - 1}
          aria-label="Next scene"
          className={iconButton}
        >
          <SkipForward size={18} strokeWidth={1.5} />
        </button>
        <span className="type-num ml-1 whitespace-nowrap text-[12px]">
          <span className="text-ink">{formatClock(tMs)}</span>
          <span className="text-muted max-[359px]:hidden"> / {formatClock(total)}</span>
        </span>
        <div className="ml-auto flex items-center">
          <button
            type="button"
            onClick={cycleSpeed}
            aria-label={`Playback speed ${rate}x. Tap to change.`}
            className="type-num flex h-11 min-w-11 shrink-0 items-center justify-center px-2 text-ink active:bg-surface-2 max-[359px]:min-w-9 max-[359px]:px-1"
          >
            {rate}×
          </button>
          <button
            type="button"
            onClick={toggleCaptions}
            aria-pressed={captions}
            aria-label={captions ? "Turn captions off" : "Turn captions on"}
            className={cn(iconButton, captions ? "text-accent" : "text-muted")}
          >
            <Captions size={20} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={(event) => {
              const target =
                event.currentTarget.closest<HTMLElement>("[data-player-root]") ??
                document.querySelector<HTMLElement>("[data-player-root]") ??
                document.documentElement;
              if (document.fullscreenElement) void document.exitFullscreen();
              else void target.requestFullscreen().catch(() => undefined);
            }}
            className={iconButton}
          >
            {fullscreen ? <Minimize size={18} strokeWidth={1.5} /> : <Maximize size={18} strokeWidth={1.5} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export { SkipBack };
