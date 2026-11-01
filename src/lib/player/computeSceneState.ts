import type { Action, Course, Scene, SlideScene, WhiteboardScene } from "@/lib/dsl/types";
import {
  activeEvents,
  buildTimeline,
  firedEventCount,
  HIGHLIGHT_WINDOW_MS,
  flattenCourse,
  getPreparedCourse,
  getPreparedScene,
  isDrawAction,
  opDurationMs,
  segmentDurationMs,
  segmentIndexAt,
  stepEndMs,
  stepStartMs,
  timelineAt,
  type DrawAction,
  type FlatScene,
  type Timeline,
  type TimelineSegment,
} from "./preparedScene";

export {
  buildTimeline,
  flattenCourse,
  getPreparedCourse,
  getPreparedScene,
  HIGHLIGHT_WINDOW_MS,
  isDrawAction,
  opDurationMs,
  segmentDurationMs,
  segmentIndexAt,
  stepEndMs,
  stepStartMs,
  timelineAt,
};
export type { DrawAction, FlatScene, Timeline, TimelineSegment };

export type FiredAction = { action: Action; firedAtMs: number; progress: number };

/** Compatibility helper. Uses the pre-sorted event schedule; no per-call sort. */
export function firedActions(scene: Scene, _timeline: Timeline, tMs: number): FiredAction[] {
  const prepared = getPreparedScene(scene);
  const count = firedEventCount(prepared, tMs);
  const out: FiredAction[] = [];
  for (let index = 0; index < count; index += 1) {
    const event = prepared.events[index];
    out.push({
      action: event.action,
      firedAtMs: event.atMs,
      progress: Math.max(0, Math.min(1, (tMs - event.atMs) / event.durationMs)),
    });
  }
  return out;
}

export type SlideState = {
  kind: "slide";
  visible: ReadonlySet<string>;
  focus: string | null;
  laser: string | null;
  currentSegmentId: string | null;
};

export function computeSlideState(scene: SlideScene, _timeline: Timeline, tMs: number): SlideState {
  const prepared = getPreparedScene(scene);
  const count = firedEventCount(prepared, tMs);
  const snapshot = prepared.slideSnapshots[count] ?? prepared.slideSnapshots[0];
  const segment = timelineAt(prepared.timeline, tMs);
  // Focus and laser are transient: the cue expires on its own so the stage
  // returns to the whole slide, the way a real lecturer's pointer does.
  const focus = snapshot.focus && tMs < snapshot.focusUntilMs ? snapshot.focus : null;
  const laser = snapshot.laser && tMs < snapshot.laserUntilMs ? snapshot.laser : null;
  return {
    kind: "slide",
    visible: snapshot.visible,
    focus,
    laser,
    currentSegmentId: segment?.id ?? null,
  };
}

export type DrawnItem = {
  action: DrawAction;
  progress: number;
};

export type WhiteboardState = {
  kind: "whiteboard";
  items: readonly DrawnItem[];
  erased: ReadonlySet<string>;
  highlight: string | null;
  currentStepIndex: number;
  currentSegmentId: string | null;
};

const EMPTY_ERASED: ReadonlySet<string> = new Set<string>();

export function computeWhiteboardState(
  scene: WhiteboardScene,
  _timeline: Timeline,
  tMs: number,
  animationRate = 1,
): WhiteboardState {
  const prepared = getPreparedScene(scene);
  const count = firedEventCount(prepared, tMs);
  const snapshot = prepared.whiteboardSnapshots[count] ?? prepared.whiteboardSnapshots[0];
  const active = activeEvents(prepared, tMs, count, animationRate);
  let items = snapshot.items;
  if (active.length) {
    const progressById = new Map<string, number>();
    for (const event of active) {
      if (isDrawAction(event.action)) {
        const rate = Number.isFinite(animationRate) && animationRate > 0 ? animationRate : 1;
        progressById.set(
          event.action.id,
          Math.max(0, Math.min(1, ((tMs - event.atMs) * rate) / event.durationMs)),
        );
      }
    }
    if (progressById.size) {
      items = snapshot.items.map((item) => {
        const progress = progressById.get(item.action.id);
        return progress === undefined || progress === 1 ? item : { ...item, progress };
      });
    }
  }
  const segment = timelineAt(prepared.timeline, tMs);
  const currentSegmentId = segment?.id ?? null;
  const highlight =
    snapshot.highlight && tMs < snapshot.highlightUntilMs ? snapshot.highlight : null;
  return {
    kind: "whiteboard",
    items,
    erased: snapshot.erased,
    highlight,
    currentStepIndex: currentSegmentId
      ? (prepared.stepIndexBySegmentId.get(currentSegmentId) ?? 0)
      : 0,
    currentSegmentId,
  };
}

export type SceneState =
  | (SlideState & { timeline: Timeline })
  | (WhiteboardState & { timeline: Timeline });

/**
 * Pure scene state at media time `tMs`.
 * `animationRate` only affects the progress of in-flight strokes; segment
 * boundaries remain in media time, so seeking is identical at every speed.
 */
export function computeSceneState(scene: Scene, tMs: number, animationRate = 1): SceneState {
  const prepared = getPreparedScene(scene);
  if (scene.kind === "whiteboard") {
    return {
      ...computeWhiteboardState(scene, prepared.timeline, tMs, animationRate),
      timeline: prepared.timeline,
    };
  }
  if (scene.kind === "slide") {
    return {
      ...computeSlideState(scene, prepared.timeline, tMs),
      timeline: prepared.timeline,
    };
  }
  const segment = timelineAt(prepared.timeline, tMs);
  return {
    kind: "whiteboard",
    items: [],
    erased: EMPTY_ERASED,
    highlight: null,
    currentStepIndex: 0,
    currentSegmentId: segment?.id ?? null,
    timeline: prepared.timeline,
  };
}

export function courseDurationMs(course: Course, speed = 1): number {
  if (speed === 1) return getPreparedCourse(course).totalMs;
  return flattenCourse(course, speed).reduce((acc, entry) => acc + (entry.endMs - entry.startMs), 0);
}

export function findSceneAt(flat: FlatScene[], tMs: number): FlatScene | null {
  if (!flat.length) return null;
  const t = Number.isFinite(tMs) ? tMs : 0;
  if (t < flat[0].startMs) return flat[0];
  let lo = 0;
  let hi = flat.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (flat[mid].startMs <= t) lo = mid;
    else hi = mid - 1;
  }
  return flat[lo];
}
