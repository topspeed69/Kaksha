"use client";

import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import type { Course, Scene } from "@/lib/dsl/types";
import { browserSpeech } from "./browserSpeech";
import {
  flattenCourse,
  getPreparedScene,
  timelineAt,
  type FlatScene,
  type TimelineSegment,
} from "./computeSceneState";

export type PlayerStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "buffering"
  | "ended"
  | "live";

export type NarrationMode = "auto" | "captions" | "browser";

type PlayerState = {
  courseId: string | null;
  course: Course | null;
  flat: FlatScene[];
  sceneIndex: number;
  tMs: number;
  stopAtMs: number | null;
  seekSeq: number;
  visitedScenes: number[];
  rate: number;
  captions: boolean;
  autoscroll: boolean;
  status: PlayerStatus;
  narration: NarrationMode;
  muted: boolean;
  /** True while browser speech is narrating the current segment. */
  speechDriven: boolean;
  /** A real browser/device TTS failure, never a fabricated connection state. */
  speechNotice: string | null;
  speechUnavailable: boolean;
  offlineVoicePreferred: boolean;
  fallbackAudioBySegment: Record<string, { url: string; duration_ms: number }>;
  unavailableAudioUrls: readonly string[];
  nudged: boolean;
};

type PlayerActions = {
  load: (
    course: Course,
    resume?: { sceneIndex: number; tMs: number; scenesDone?: number[] },
  ) => void;
  unload: () => void;
  play: () => void;
  playRange: (startMs: number, endMs: number) => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (ms: number) => void;
  syncFromAudio: (ms: number) => void;
  seekBy: (deltaMs: number) => void;
  goToScene: (sceneIndex: number, ms?: number) => void;
  nextScene: () => void;
  previousScene: () => void;
  setRate: (rate: number) => void;
  toggleCaptions: () => void;
  setAutoscroll: (value: boolean) => void;
  setNarration: (mode: NarrationMode) => void;
  toggleMute: () => void;
  retrySpeech: () => void;
  setStatus: (status: PlayerStatus) => void;
  markAudioUnavailable: (url: string) => void;
  advance: (deltaMs: number) => void;
  markNudged: () => void;
};

export type PlayerStore = PlayerState & PlayerActions;

const initial: PlayerState = {
  courseId: null,
  course: null,
  flat: [],
  sceneIndex: 0,
  tMs: 0,
  stopAtMs: null,
  seekSeq: 0,
  visitedScenes: [],
  rate: 1,
  captions: true,
  autoscroll: true,
  status: "idle",
  narration: "auto",
  muted: false,
  speechDriven: false,
  speechNotice: null,
  speechUnavailable: false,
  offlineVoicePreferred: false,
  fallbackAudioBySegment: {},
  unavailableAudioUrls: [],
  nudged: false,
};

function readLocalProgress(
  courseId: string,
): { sceneIndex: number; tMs: number; scenesDone: number[] } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`kaksha.progress.${courseId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      scene_index?: number;
      t_ms?: number;
      scenes_done?: number[];
    };
    if (typeof parsed.scene_index !== "number") return null;
    return {
      sceneIndex: parsed.scene_index,
      tMs: typeof parsed.t_ms === "number" ? parsed.t_ms : 0,
      scenesDone: Array.isArray(parsed.scenes_done) ? parsed.scenes_done : [],
    };
  } catch {
    return null;
  }
}

function writeLocalProgress(
  courseId: string,
  sceneIndex: number,
  tMs: number,
  scenesDone: number[],
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `kaksha.progress.${courseId}`,
      JSON.stringify({
        scene_index: sceneIndex,
        t_ms: Math.round(tMs),
        scenes_done: scenesDone,
      }),
    );
  } catch {
    /* localStorage may be disabled */
  }
}

const pendingOffline = new Set<string>();

function segmentKey(courseId: string | null, sceneIndex: number, segmentId: string): string {
  return `${courseId}:${sceneIndex}:${segmentId}`;
}

/** Synthesize one segment on demand only after browser voices have failed. */
async function ensureOfflineSegment(
  courseId: string,
  sceneIndex: number,
  segment: TimelineSegment,
  restartCurrent = false,
): Promise<void> {
  const key = segmentKey(courseId, sceneIndex, segment.id);
  const state = usePlayerStore.getState();
  if (state.fallbackAudioBySegment[key] || pendingOffline.has(key)) return;
  pendingOffline.add(key);
  try {
    const response = await fetch("/api/tts/fallback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: segment.text, speed: state.rate }),
    });
    const payload = (await response.json()) as {
      audio?: { url?: string; duration_ms?: number };
      error?: { message?: string };
    };
    if (!response.ok || !payload.audio?.url || !payload.audio.duration_ms) {
      throw new Error(payload.error?.message ?? "Offline narration is not available on this server. Captions continue.");
    }
    const now = usePlayerStore.getState();
    if (now.courseId !== courseId) return;
    usePlayerStore.setState({
      fallbackAudioBySegment: {
        ...now.fallbackAudioBySegment,
        [key]: { url: payload.audio.url, duration_ms: payload.audio.duration_ms },
      },
      speechNotice: "Using the offline voice because your browser has no speech voice.",
      speechDriven: false,
      ...(restartCurrent && now.sceneIndex === sceneIndex &&
        timelineAt(getPreparedScene(now.flat[sceneIndex].scene).timeline, now.tMs)?.id === segment.id
        ? { tMs: segment.startMs, seekSeq: now.seekSeq + 1 }
        : {}),
    });
    // Prepare the next two narrated segments while this one plays. Each request
    // is deduplicated by key and cached on disk, so no segment is re-synthesized.
    const currentScene = now.flat[sceneIndex]?.scene;
    if (restartCurrent && currentScene) {
      const tl = getPreparedScene(currentScene).timeline;
      const idx = tl.segments.findIndex((item) => item.id === segment.id);
      for (const next of tl.segments.slice(idx + 1, idx + 3)) {
        if (!next.audio?.url) void ensureOfflineSegment(courseId, sceneIndex, next);
      }
    }
  } catch (error) {
    const now = usePlayerStore.getState();
    if (now.courseId === courseId) {
      usePlayerStore.setState({
        speechDriven: false,
        speechNotice: (error as Error).message,
      });
    }
  } finally {
    pendingOffline.delete(key);
  }
}

/** Starting here (inside play/toggle) preserves the browser's user gesture. */
function startBrowserNarration(): void {
  const state = usePlayerStore.getState();
  if (state.status !== "playing" || state.muted || state.narration === "captions") return;
  const entry = state.flat[state.sceneIndex];
  if (!entry) return;
  const segment = timelineAt(getPreparedScene(entry.scene).timeline, state.tMs);
  if (!segment) return;
  if (
    state.narration === "auto" &&
    segment.audio?.url &&
    !state.unavailableAudioUrls.includes(segment.audio.url)
  ) {
    browserSpeech()?.stop();
    if (state.speechDriven) usePlayerStore.setState({ speechDriven: false });
    return;
  }
  const fallbackKey = segmentKey(state.courseId, state.sceneIndex, segment.id);
  if (state.fallbackAudioBySegment[fallbackKey]) return;
  if (state.offlineVoicePreferred) {
    if (state.courseId) void ensureOfflineSegment(state.courseId, state.sceneIndex, segment);
    return;
  }
  if (state.speechUnavailable) return;
  const controller = browserSpeech();
  if (!controller) {
    usePlayerStore.setState({
      speechDriven: false,
      speechUnavailable: true,
      offlineVoicePreferred: true,
      speechNotice: "No browser voice was found. Preparing the offline voice...",
    });
    if (state.courseId) void ensureOfflineSegment(state.courseId, state.sceneIndex, segment, true);
    return;
  }
  const key = `${state.courseId}:${state.sceneIndex}:${segment.id}:${state.seekSeq}`;
  controller.start({
    key,
    text: segment.text,
    rate: state.rate,
    onStart: () => {
      if (usePlayerStore.getState().status === "playing") {
        usePlayerStore.setState({ speechDriven: true, speechNotice: null });
      }
    },
    onEnd: () => {
      const now = usePlayerStore.getState();
      if (now.status !== "playing") return;
      usePlayerStore.setState({ speechDriven: false });
      // SpeechSynthesis has no time/duration API. Advance from the actual end,
      // not a word-count estimate, so captions never outrun spoken narration.
      now.advance(Math.max(1, segment.endMs - now.tMs + 1));
    },
    onError: (reason) => {
      const now = usePlayerStore.getState();
      if (now.courseId !== state.courseId) return;
      usePlayerStore.setState({
        speechDriven: false,
        speechUnavailable: true,
        offlineVoicePreferred: true,
        speechNotice: `${reason} Preparing an offline voice...`,
      });
      if (now.courseId) void ensureOfflineSegment(now.courseId, now.sceneIndex, segment, true);
    },
  });
}

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  ...initial,
  load: (course, resume) => {
    browserSpeech()?.stop();
    const flat = flattenCourse(course, 1);
    const local = readLocalProgress(course.id);
    const hasServerResume = Boolean(
      resume && (resume.sceneIndex > 0 || resume.tMs > 0 || (resume.scenesDone?.length ?? 0) > 0),
    );
    const chosen = hasServerResume ? resume : local ?? resume;
    const sceneIndex = Math.min(
      Math.max(0, chosen?.sceneIndex ?? 0),
      Math.max(0, flat.length - 1),
    );
    const visited = new Set<number>([
      ...(resume?.scenesDone ?? []),
      ...(local?.scenesDone ?? []),
    ]);
    set({
      ...initial,
      courseId: course.id,
      course,
      flat,
      sceneIndex,
      tMs: Math.max(0, chosen?.tMs ?? 0),
      visitedScenes: [...visited],
      status: "paused",
      narration: "auto",
    });
  },
  unload: () => {
    browserSpeech()?.stop();
    set({ ...initial });
  },
  play: () => {
    set((state) => ({
      status: "playing",
      stopAtMs: null,
      visitedScenes: state.visitedScenes.includes(state.sceneIndex)
        ? state.visitedScenes
        : [...state.visitedScenes, state.sceneIndex],
    }));
    startBrowserNarration();
  },
  playRange: (startMs, endMs) => {
    set((state) => {
      const entry = state.flat[state.sceneIndex];
      if (!entry) return {};
      const total = entry.endMs - entry.startMs;
      const clampedStart = Math.max(0, Math.min(total, startMs));
      const clampedEnd = Math.max(clampedStart, Math.min(total, endMs));
      return {
        tMs: clampedStart,
        stopAtMs: clampedEnd,
        seekSeq: state.seekSeq + 1,
        status: "playing",
        visitedScenes: state.visitedScenes.includes(state.sceneIndex)
          ? state.visitedScenes
          : [...state.visitedScenes, state.sceneIndex],
      };
    });
    startBrowserNarration();
  },
  pause: () => {
    browserSpeech()?.pause();
    set({ status: "paused", stopAtMs: null, speechDriven: false });
  },
  toggle: () => {
    const playing = get().status === "playing";
    if (playing) {
      get().pause();
      return;
    }
    set((state) => ({
      status: "playing",
      stopAtMs: null,
      tMs: state.status === "ended" ? 0 : state.tMs,
      seekSeq: state.status === "ended" ? state.seekSeq + 1 : state.seekSeq,
      visitedScenes: state.visitedScenes.includes(state.sceneIndex)
        ? state.visitedScenes
        : [...state.visitedScenes, state.sceneIndex],
    }));
    startBrowserNarration();
  },
  seekTo: (ms) => {
    set((state) => {
      const entry = state.flat[state.sceneIndex];
      if (!entry) return {};
      const total = entry.endMs - entry.startMs;
      const clamped = Math.max(0, Math.min(total, Number.isFinite(ms) ? ms : 0));
      return {
        tMs: clamped,
        stopAtMs: null,
        seekSeq: state.seekSeq + 1,
        status: state.status === "ended" ? "paused" : state.status,
      };
    });
    if (get().status === "playing") startBrowserNarration();
  },
  syncFromAudio: (ms) =>
    set((state) => {
      const entry = state.flat[state.sceneIndex];
      if (!entry) return {};
      const total = entry.endMs - entry.startMs;
      const clamped = Math.max(0, Math.min(total, Number.isFinite(ms) ? ms : 0));
      if (state.stopAtMs !== null && clamped >= state.stopAtMs) {
        return { tMs: state.stopAtMs, stopAtMs: null, status: "paused" };
      }
      return { tMs: clamped };
    }),
  seekBy: (deltaMs) => get().seekTo(get().tMs + deltaMs),
  goToScene: (sceneIndex, ms = 0) => {
    set((state) => {
      if (!state.flat.length) return {};
      const index = Math.max(0, Math.min(state.flat.length - 1, sceneIndex));
      const visited = state.visitedScenes.includes(index)
        ? state.visitedScenes
        : [...state.visitedScenes, index];
      return {
        sceneIndex: index,
        tMs: Math.max(0, ms),
        seekSeq: state.seekSeq + 1,
        visitedScenes: visited,
        status: state.status === "playing" ? "playing" : "paused",
      };
    });
    if (get().status === "playing") startBrowserNarration();
  },
  nextScene: () => get().goToScene(get().sceneIndex + 1, 0),
  previousScene: () => get().goToScene(get().sceneIndex - 1, 0),
  setRate: (rate) =>
    set({ rate: Number.isFinite(rate) ? Math.max(0.75, Math.min(2, rate)) : 1 }),
  toggleCaptions: () => set((state) => ({ captions: !state.captions })),
  setAutoscroll: (autoscroll) => set({ autoscroll }),
  setNarration: (narration) => {
    set({ narration, speechDriven: false, speechUnavailable: false, speechNotice: null });
    if (narration === "captions") browserSpeech()?.stop();
    else if (get().status === "playing") startBrowserNarration();
  },
  toggleMute: () => {
    const nextMuted = !get().muted;
    set({ muted: nextMuted, speechDriven: nextMuted ? false : get().speechDriven });
    if (nextMuted) browserSpeech()?.stop();
    else if (get().status === "playing") startBrowserNarration();
  },
  retrySpeech: () => {
    browserSpeech()?.stop();
    set({ speechUnavailable: false, offlineVoicePreferred: false, speechNotice: null });
    if (get().status === "playing") startBrowserNarration();
  },
  setStatus: (status) => set({ status }),
  markAudioUnavailable: (url) =>
    set((state) =>
      state.unavailableAudioUrls.includes(url)
        ? {}
        : { unavailableAudioUrls: [...state.unavailableAudioUrls, url] },
    ),
  markNudged: () => set({ nudged: true }),
  advance: (deltaMs) => {
    const state = get();
    const entry = state.flat[state.sceneIndex];
    if (!entry) return;
    const total = entry.endMs - entry.startMs;
    const next = state.tMs + deltaMs;
    const visitedCurrent = state.visitedScenes.includes(state.sceneIndex)
      ? state.visitedScenes
      : [...state.visitedScenes, state.sceneIndex];
    if (state.speechDriven) {
      const segment = timelineAt(getPreparedScene(entry.scene).timeline, state.tMs);
      if (segment && next >= segment.endMs) {
        const hold = Math.max(segment.startMs, segment.endMs - 1);
        if (state.tMs < hold) set({ tMs: hold, visitedScenes: visitedCurrent });
        return;
      }
    }
    if (state.stopAtMs !== null && next >= state.stopAtMs) {
      set({ tMs: state.stopAtMs, stopAtMs: null, visitedScenes: visitedCurrent, status: "paused" });
      return;
    }
    if (next >= total) {
      if (state.sceneIndex + 1 < state.flat.length) {
        const nextIdx = state.sceneIndex + 1;
        const visitedNext = visitedCurrent.includes(nextIdx)
          ? visitedCurrent
          : [...visitedCurrent, nextIdx];
        set({
          sceneIndex: nextIdx,
          tMs: 0,
          visitedScenes: visitedNext,
          status: state.status === "playing" ? "playing" : "paused",
        });
      } else {
        set({ tMs: total, visitedScenes: visitedCurrent, status: "ended" });
      }
      return;
    }
    if (next < 0) {
      if (state.sceneIndex > 0) {
        const previous = state.flat[state.sceneIndex - 1];
        set({
          sceneIndex: state.sceneIndex - 1,
          tMs: previous.endMs - previous.startMs,
        });
      } else {
        set({ tMs: 0 });
      }
      return;
    }
    set({ tMs: next, visitedScenes: visitedCurrent });
  },
}));

/* --------------------------------- engine --------------------------------- */

export function usePlayerEngine(): void {
  const flat = usePlayerStore((s) => s.flat);
  const sceneIndex = usePlayerStore((s) => s.sceneIndex);
  const seekSeq = usePlayerStore((s) => s.seekSeq);
  const status = usePlayerStore((s) => s.status);
  const rate = usePlayerStore((s) => s.rate);
  const narration = usePlayerStore((s) => s.narration);
  const courseId = usePlayerStore((s) => s.courseId);
  const unavailableAudioUrls = usePlayerStore((s) => s.unavailableAudioUrls);
  const muted = usePlayerStore((s) => s.muted);
  // Subscribe to segment identity, not the 80 ms clock. The returned object is
  // stable for the whole segment, so audio effects do not run on every tick.
  const currentSegment = usePlayerStore((s): TimelineSegment | null => {
    const active = s.flat[s.sceneIndex];
    if (!active) return null;
    return timelineAt(getPreparedScene(active.scene).timeline, s.tMs);
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSegmentRef = useRef<string | null>(null);
  const lastSeekSeqRef = useRef<number>(-1);
  const preloadedUrlsRef = useRef<Set<string>>(new Set());
  const preloadersRef = useRef<HTMLAudioElement[]>([]);

  const entry = flat[sceneIndex];
  const scene: Scene | undefined = entry?.scene;
  const timeline = useMemo(
    () => (scene ? getPreparedScene(scene).timeline : { segments: [], totalMs: 0 }),
    [scene],
  );
  const fallbackAudioBySegment = usePlayerStore((s) => s.fallbackAudioBySegment);
  const activeFallback = currentSegment
    ? fallbackAudioBySegment[segmentKey(courseId, sceneIndex, currentSegment.id)]
    : undefined;
  const activeAudio = narration === "captions"
    ? undefined
    : activeFallback ?? (narration === "browser" ? undefined : currentSegment?.audio);
  const hasAudioSegment = Boolean(
    activeAudio?.url && !unavailableAudioUrls.includes(activeAudio.url),
  );

  /* clock ------------------------------------------------------------------ */
  useEffect(() => {
    if (status !== "playing" || hasAudioSegment) return;
    let last = Date.now();
    const timer = setInterval(() => {
      const now = Date.now();
      const delta = now - last;
      last = now;
      const store = usePlayerStore.getState();
      if (store.status !== "playing") return;
      // Speech is narrating this segment: its own end advances the clock.
      if (store.speechDriven) return;
      const activeEntry = store.flat[store.sceneIndex];
      if (!activeEntry) return;
      const seg = timelineAt(getPreparedScene(activeEntry.scene).timeline, store.tMs);
      const fallback = seg ? store.fallbackAudioBySegment[segmentKey(store.courseId, store.sceneIndex, seg.id)] : undefined;
      const file = store.narration === "captions" ? undefined
        : fallback ?? (store.narration === "browser" ? undefined : seg?.audio);
      if (file?.url && !store.unavailableAudioUrls.includes(file.url)) return;
      store.advance(delta * store.rate);
    }, 80);
    return () => clearInterval(timer);
  }, [hasAudioSegment, status]);

  /* audio ------------------------------------------------------------------ */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = "auto";
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    audio.muted = muted;
    const segment = currentSegment;
    const file = activeAudio;
    if (!segment || !file?.url || unavailableAudioUrls.includes(file.url)) {
      if (!audio.paused) audio.pause();
      audio.removeAttribute("src");
      lastSegmentRef.current = null;
      return;
    }
    const segKey = `${sceneIndex}:${segment.id}`;
    const userSeeked = lastSeekSeqRef.current !== seekSeq;
    lastSeekSeqRef.current = seekSeq;
    const mediaTime = usePlayerStore.getState().tMs;

    if (lastSegmentRef.current === segKey) {
      audio.playbackRate = rate;
      if (userSeeked) {
        const fraction = Math.max(0, Math.min(1, (mediaTime - segment.startMs) / segment.durationMs));
        audio.currentTime = Math.min(
          fraction * file.duration_ms / 1000,
          Math.max(0, file.duration_ms / 1000 - 0.05),
        );
      }
      return;
    }

    lastSegmentRef.current = segKey;
    audio.src = file.url;
    audio.playbackRate = rate;
    audio.preservesPitch = true;
    const fraction = Math.max(0, Math.min(1, (mediaTime - segment.startMs) / segment.durationMs));
    audio.currentTime = Math.min(
      fraction * file.duration_ms / 1000,
      Math.max(0, file.duration_ms / 1000 - 0.05),
    );
    if (usePlayerStore.getState().status === "playing") {
      void audio.play().catch((error: unknown) => {
        if ((error as { name?: string }).name === "NotAllowedError") {
          usePlayerStore.setState({
            status: "paused",
            speechNotice: "Your browser blocked audio. Tap Play again to enable sound.",
          });
          return;
        }
        usePlayerStore.getState().markAudioUnavailable(file.url);
        usePlayerStore.setState({
          speechNotice: "Narration audio could not play. Captions remain available.",
        });
      });
    }

    // Preload the next two segments once per unique URL.
    const index = getPreparedScene(scene!).segmentIndexById.get(segment.id) ?? -1;
    for (const look of [1, 2]) {
      const next = timeline.segments[index + look];
      const nextFile = next
        ? fallbackAudioBySegment[segmentKey(courseId, sceneIndex, next.id)] ?? next.audio
        : undefined;
      if (nextFile?.url && !preloadedUrlsRef.current.has(nextFile.url)) {
        preloadedUrlsRef.current.add(nextFile.url);
        const preloader = new Audio();
        preloader.preload = "auto";
        preloader.src = nextFile.url;
        preloader.load();
        preloadersRef.current.push(preloader);
      }
    }
  }, [currentSegment, rate, scene, sceneIndex, seekSeq, timeline, unavailableAudioUrls, muted, narration, activeAudio, fallbackAudioBySegment, courseId]);

  /* keep the virtual clock in step with the audio clock -------------------- */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSegment || !activeAudio || !hasAudioSegment) return;
    const onTime = () => {
      const state = usePlayerStore.getState();
      if (state.status !== "playing" || state.sceneIndex !== sceneIndex) return;
      const fraction = Math.max(0, Math.min(1, audio.currentTime * 1000 / activeAudio.duration_ms));
      const segmentTime = Math.min(currentSegment.endMs - 1,
        currentSegment.startMs + fraction * currentSegment.durationMs);
      state.syncFromAudio(segmentTime);
    };
    const onEnded = () => {
      const state = usePlayerStore.getState();
      if (state.status !== "playing" || state.sceneIndex !== sceneIndex) return;
      const now = timelineAt(getPreparedScene(state.flat[state.sceneIndex].scene).timeline, state.tMs);
      if (now?.id !== currentSegment.id) return;
      state.advance(Math.max(1, currentSegment.endMs - state.tMs + 1));
    };
    const onError = () => {
      const url = activeAudio.url;
      if (url) {
        usePlayerStore.getState().markAudioUnavailable(url);
        usePlayerStore.setState({
          speechNotice: "Narration audio is unavailable. Captions remain available.",
        });
      }
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [currentSegment, activeAudio, hasAudioSegment, sceneIndex]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = muted;
    const wantsAudio = status === "playing" && hasAudioSegment;
    if (wantsAudio && audio.paused) {
      void audio.play().catch((error: unknown) => {
        if ((error as { name?: string }).name === "NotAllowedError") {
          usePlayerStore.setState({
            status: "paused",
            speechNotice: "Your browser blocked audio. Tap Play again to enable sound.",
          });
        } else {
          const url = activeAudio?.url;
          if (url) usePlayerStore.getState().markAudioUnavailable(url);
        }
      });
    }
    // Muting keeps audio's clock running, but removes its sound.
    if (!wantsAudio && !audio.paused) audio.pause();
  }, [status, currentSegment, activeAudio, muted, hasAudioSegment]);

  /* Browser speech. First start comes from play()/toggle() in the user's
     gesture; this effect only keeps it in sync on segment/scene changes. */
  useEffect(() => {
    if (status !== "playing") {
      browserSpeech()?.pause();
      if (usePlayerStore.getState().speechDriven) {
        usePlayerStore.setState({ speechDriven: false });
      }
      return;
    }
    if (muted || narration === "captions" || hasAudioSegment) {
      browserSpeech()?.stop();
      if (usePlayerStore.getState().speechDriven) {
        usePlayerStore.setState({ speechDriven: false });
      }
      return;
    }
    startBrowserNarration();
  }, [status, currentSegment, sceneIndex, seekSeq, narration, muted, hasAudioSegment]);

  /* persistence: local every second, server at most every five seconds ------ */
  useEffect(() => {
    if (!courseId) return;
    let lastLocal = "";
    let lastServer = "";
    let lastServerAt = 0;
    let saving = false;
    const flush = (force: boolean) => {
      const state = usePlayerStore.getState();
      if (state.courseId !== courseId) return;
      const snapshot = `${state.sceneIndex}:${Math.round(state.tMs)}:${state.visitedScenes.join(",")}`;
      if (snapshot !== lastLocal) {
        lastLocal = snapshot;
        writeLocalProgress(courseId, state.sceneIndex, state.tMs, state.visitedScenes);
      }
      const now = Date.now();
      if (saving || snapshot === lastServer || (!force && now - lastServerAt < 5000)) return;
      saving = true;
      lastServer = snapshot;
      lastServerAt = now;
      void fetch(`/api/courses/${courseId}/progress`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scene_index: state.sceneIndex,
          t_ms: Math.round(state.tMs),
          scenes_done: state.visitedScenes,
        }),
        keepalive: true,
      })
        .catch(() => undefined)
        .finally(() => {
          saving = false;
        });
    };
    const timer = setInterval(() => flush(false), 1000);
    const onHide = () => flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      flush(true);
    };
  }, [courseId]);

  useEffect(() => {
    const preloaders = preloadersRef.current;
    return () => {
      audioRef.current?.pause();
      for (const preloader of preloaders) {
        preloader.pause();
        preloader.removeAttribute("src");
        preloader.load();
      }
      preloaders.length = 0;
      browserSpeech()?.stop();
    };
  }, []);
}

/* ------------------------------- keyboard --------------------------------- */

export function usePlayerKeyboard(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const store = usePlayerStore.getState();
      switch (event.key) {
        case " ":
          event.preventDefault();
          store.toggle();
          break;
        case "ArrowLeft":
          event.preventDefault();
          if (event.shiftKey) store.previousScene();
          else store.seekBy(-10000);
          break;
        case "ArrowRight":
          event.preventDefault();
          if (event.shiftKey) store.nextScene();
          else store.seekBy(10000);
          break;
        case "c":
        case "C":
          store.toggleCaptions();
          break;
        case "m":
        case "M":
          store.toggleMute();
          break;
        case "f":
        case "F": {
          const target =
            document.querySelector<HTMLElement>("[data-player-root]") ?? document.documentElement;
          if (document.fullscreenElement) void document.exitFullscreen();
          else void target.requestFullscreen().catch(() => undefined);
          break;
        }
        case "[":
          store.setRate(Math.max(0.75, Number((store.rate - 0.25).toFixed(2))));
          break;
        case "]":
          store.setRate(Math.min(2, Number((store.rate + 0.25).toFixed(2))));
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

export function useScene(): { entry: FlatScene | undefined; timelineMs: number } {
  const flat = usePlayerStore((s) => s.flat);
  const sceneIndex = usePlayerStore((s) => s.sceneIndex);
  const entry = flat[sceneIndex];
  return { entry, timelineMs: entry ? entry.endMs - entry.startMs : 0 };
}

export function usePlayerActions() {
  return {
    play: usePlayerStore((s) => s.play),
    pause: usePlayerStore((s) => s.pause),
    toggle: usePlayerStore((s) => s.toggle),
    seekTo: usePlayerStore((s) => s.seekTo),
    seekBy: usePlayerStore((s) => s.seekBy),
    goToScene: usePlayerStore((s) => s.goToScene),
    nextScene: usePlayerStore((s) => s.nextScene),
    previousScene: usePlayerStore((s) => s.previousScene),
    setRate: usePlayerStore((s) => s.setRate),
    toggleCaptions: usePlayerStore((s) => s.toggleCaptions),
    setNarration: usePlayerStore((s) => s.setNarration),
  };
}


