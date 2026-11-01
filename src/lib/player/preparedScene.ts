import type {
  Action,
  Course,
  Scene,
  Segment,
  SlideScene,
  WhiteboardAction,
  WhiteboardScene,
} from "@/lib/dsl/types";

/** Animation length per operation in media milliseconds at 1× playback. */
const OP_DURATION_MS: Record<string, number> = {
  "wb.text": 400,
  "wb.latex": 400,
  "wb.line": 700,
  "wb.rect": 500,
  "wb.circle": 500,
  "wb.axes": 600,
  "wb.plot": 800,
  "wb.highlight": 200,
  "wb.erase": 300,
  reveal: 300,
  spotlight: 200,
  laser: 160,
  clear_focus: 120,
};

export function opDurationMs(op: string): number {
  return OP_DURATION_MS[op] ?? 400;
}

/**
 * How long a focus or highlight stays on screen, in media milliseconds.
 * Attention cues are deliberately transient: a ring or a zoom that lingers
 * stops reading as "the teacher is pointing here right now".
 */
export const HIGHLIGHT_WINDOW_MS = 1600;

export type TimelineSegment = {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  audio: Segment["audio"];
};

export type Timeline = {
  segments: TimelineSegment[];
  totalMs: number;
};

export function segmentDurationMs(segment: Segment, speed = 1): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const raw = segment.audio?.duration_ms ?? segment.estimated_duration_ms;
  return Math.max(400, Math.round(raw / safeSpeed));
}

export function buildTimeline(scene: Scene, speed = 1): Timeline {
  if (speed === 1) return getPreparedScene(scene).timeline;
  let cursor = 0;
  const segments = scene.segments.map((segment) => {
    const durationMs = segmentDurationMs(segment, speed);
    const entry: TimelineSegment = {
      id: segment.id,
      text: segment.text,
      startMs: cursor,
      endMs: cursor + durationMs,
      durationMs,
      audio: segment.audio,
    };
    cursor += durationMs;
    return entry;
  });
  return { segments, totalMs: cursor };
}

/** Last segment whose start is <= t; O(log n). */
export function segmentIndexAt(timeline: Timeline, tMs: number): number {
  const segments = timeline.segments;
  if (!segments.length) return -1;
  const t = Math.max(0, Math.min(timeline.totalMs, Number.isFinite(tMs) ? tMs : 0));
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (segments[mid].startMs <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function timelineAt(timeline: Timeline, tMs: number): TimelineSegment | null {
  const index = segmentIndexAt(timeline, tMs);
  return index >= 0 ? timeline.segments[index] : null;
}

const DRAW_OPS = new Set([
  "wb.text",
  "wb.latex",
  "wb.line",
  "wb.rect",
  "wb.circle",
  "wb.axes",
  "wb.plot",
]);

export type DrawAction = Extract<WhiteboardAction, { id: string }>;

export function isDrawAction(action: Action): action is DrawAction {
  return DRAW_OPS.has(action.op);
}

export type ActionEvent = {
  action: Action;
  atMs: number;
  durationMs: number;
  order: number;
};

export type PreparedDrawItem = {
  action: DrawAction;
  progress: number;
};

export type SlideSnapshot = {
  visible: ReadonlySet<string>;
  focus: string | null;
  /** Media time after which the focus cue is gone. 0 = no expiry. */
  focusUntilMs: number;
  laser: string | null;
  laserUntilMs: number;
};

export type WhiteboardSnapshot = {
  items: readonly PreparedDrawItem[];
  erased: ReadonlySet<string>;
  highlight: string | null;
  highlightUntilMs: number;
};

export type StepRange = {
  id: string;
  startMs: number;
  endMs: number;
};

export type ObjectBox = { id: string; x: number; y: number; w: number; h: number };

export type PreparedScene = {
  scene: Scene;
  timeline: Timeline;
  events: readonly ActionEvent[];
  eventStarts: readonly number[];
  slideSnapshots: readonly SlideSnapshot[];
  whiteboardSnapshots: readonly WhiteboardSnapshot[];
  segmentIndexById: ReadonlyMap<string, number>;
  stepIndexBySegmentId: ReadonlyMap<string, number>;
  stepRanges: ReadonlyMap<string, StepRange>;
  /** Canvas-space bounding box for every drawn whiteboard object. */
  objectBoxes: ReadonlyMap<string, ObjectBox>;
  canvas: { w: number; h: number };
};

const sceneCache = new WeakMap<Scene, PreparedScene>();

function upperBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function prepareSlide(scene: SlideScene, events: readonly ActionEvent[]): SlideSnapshot[] {
  const revealTargets = new Set<string>();
  for (const event of events) {
    if (event.action.op === "reveal") revealTargets.add(event.action.target);
  }
  const visible = new Set<string>(
    scene.elements.filter((element) => !revealTargets.has(element.id)).map((element) => element.id),
  );
  let focus: string | null = null;
  let focusUntilMs = 0;
  let laser: string | null = null;
  let laserUntilMs = 0;
  const snapshots: SlideSnapshot[] = [
    { visible: new Set(visible), focus, focusUntilMs, laser, laserUntilMs },
  ];
  for (const event of events) {
    const action = event.action;
    if (action.op === "reveal") visible.add(action.target);
    else if (action.op === "spotlight") {
      focus = action.target;
      focusUntilMs = event.atMs + HIGHLIGHT_WINDOW_MS;
    } else if (action.op === "laser") {
      laser = action.target;
      laserUntilMs = event.atMs + HIGHLIGHT_WINDOW_MS;
    } else if (action.op === "clear_focus") {
      focus = null;
      focusUntilMs = 0;
      laser = null;
      laserUntilMs = 0;
    }
    snapshots.push({ visible: new Set(visible), focus, focusUntilMs, laser, laserUntilMs });
  }
  return snapshots;
}

function prepareWhiteboard(events: readonly ActionEvent[]): WhiteboardSnapshot[] {
  let items: PreparedDrawItem[] = [];
  const indexById = new Map<string, number>();
  const erased = new Set<string>();
  let highlight: string | null = null;
  let highlightUntilMs = 0;
  const snapshots: WhiteboardSnapshot[] = [
    { items, erased: new Set(erased), highlight, highlightUntilMs },
  ];
  for (const event of events) {
    const action = event.action;
    if (action.op === "wb.erase") {
      erased.add(action.target);
      if (highlight === action.target) {
        highlight = null;
        highlightUntilMs = 0;
      }
    } else if (action.op === "wb.highlight") {
      highlight = action.target;
      highlightUntilMs = event.atMs + HIGHLIGHT_WINDOW_MS;
    } else if (isDrawAction(action)) {
      const existing = indexById.get(action.id);
      const item = { action, progress: 1 };
      if (existing === undefined) {
        indexById.set(action.id, items.length);
        items = [...items, item];
      } else {
        items = items.map((old, index) => (index === existing ? item : old));
      }
    }
    snapshots.push({ items, erased: new Set(erased), highlight, highlightUntilMs });
  }
  return snapshots;
}

/** Prepare immutable playback indexes once per scene object. */
export function getPreparedScene(scene: Scene): PreparedScene {
  const cached = sceneCache.get(scene);
  if (cached) return cached;

  let cursor = 0;
  const segments: TimelineSegment[] = [];
  const events: ActionEvent[] = [];
  const segmentIndexById = new Map<string, number>();
  let order = 0;
  scene.segments.forEach((segment, segmentIndex) => {
    const durationMs = segmentDurationMs(segment, 1);
    const slot: TimelineSegment = {
      id: segment.id,
      text: segment.text,
      startMs: cursor,
      endMs: cursor + durationMs,
      durationMs,
      audio: segment.audio,
    };
    segments.push(slot);
    segmentIndexById.set(segment.id, segmentIndex);
    for (const action of segment.actions) {
      const fraction = Math.max(0, Math.min(1, Number.isFinite(action.at) ? action.at : 0));
      events.push({
        action,
        atMs: cursor + fraction * durationMs,
        durationMs: opDurationMs(action.op),
        order: order++,
      });
    }
    cursor += durationMs;
  });
  events.sort((a, b) => a.atMs - b.atMs || a.order - b.order);
  const timeline: Timeline = { segments, totalMs: cursor };
  const eventStarts = events.map((event) => event.atMs);
  const stepIndexBySegmentId = new Map<string, number>();
  const stepRanges = new Map<string, StepRange>();
  if (scene.kind === "whiteboard") {
    scene.steps.forEach((step, stepIndex) => {
      let startMs = Number.POSITIVE_INFINITY;
      let endMs = 0;
      for (const segmentId of step.segment_ids) {
        stepIndexBySegmentId.set(segmentId, stepIndex);
        const index = segmentIndexById.get(segmentId);
        if (index !== undefined) {
          startMs = Math.min(startMs, segments[index].startMs);
          endMs = Math.max(endMs, segments[index].endMs);
        }
      }
      stepRanges.set(step.id, {
        id: step.id,
        startMs: Number.isFinite(startMs) ? startMs : 0,
        endMs,
      });
    });
  }
  const objectBoxes = new Map<string, ObjectBox>();
  const canvas =
    scene.kind === "whiteboard" ? { w: scene.canvas.w, h: scene.canvas.h } : { w: 0, h: 0 };

  const addObjectBox = (id: string, box: ObjectBox) => {
    const existing = objectBoxes.get(id);
    if (!existing) {
      objectBoxes.set(id, box);
      return;
    }
    const x = Math.min(existing.x, box.x);
    const y = Math.min(existing.y, box.y);
    objectBoxes.set(id, {
      id,
      x,
      y,
      w: Math.max(existing.x + existing.w, box.x + box.w) - x,
      h: Math.max(existing.y + existing.h, box.y + box.h) - y,
    });
  };

  if (scene.kind === "whiteboard") {
    scene.segments.forEach((segment) => {
      for (const action of segment.actions) {
        if (action.op === "wb.text" || action.op === "wb.latex") {
          const size =
            action.size === "lg" ? 44 : action.size === "sm" ? 22 : 32;
          const lines = Math.max(
            1,
            Math.ceil(
              (action.op === "wb.latex" ? action.latex.length * 0.55 : action.text.length) /
                Math.max(12, canvas.w - action.x),
            ),
          );
          const w = Math.min(
            canvas.w - action.x,
            Math.max(
              40,
              (action.op === "wb.latex" ? action.latex.length * 0.55 : action.text.length) * (size * 0.42),
            ),
          );
          addObjectBox(action.id, { id: action.id, x: action.x, y: action.y, w, h: size * lines });
        } else if (action.op === "wb.rect") {
          addObjectBox(action.id, { id: action.id, x: action.x, y: action.y, w: action.w, h: action.h });
        } else if (action.op === "wb.circle") {
          addObjectBox(action.id, {
            id: action.id,
            x: action.cx - action.r,
            y: action.cy - action.r,
            w: action.r * 2,
            h: action.r * 2,
          });
        } else if (action.op === "wb.axes") {
          addObjectBox(action.id, { id: action.id, x: action.x, y: action.y, w: action.w, h: action.h });
        } else if (action.op === "wb.plot") {
          const axes = objectBoxes.get(action.axes);
          if (axes) addObjectBox(action.id, { ...axes, id: action.id });
        } else if (action.op === "wb.line") {
          addObjectBox(action.id, {
            id: action.id,
            x: Math.min(action.from[0], action.to[0]),
            y: Math.min(action.from[1], action.to[1]),
            w: Math.abs(action.to[0] - action.from[0]),
            h: Math.abs(action.to[1] - action.from[1]),
          });
        }
      }
    });
  }

  const prepared: PreparedScene = {
    scene,
    timeline,
    events,
    eventStarts,
    slideSnapshots: scene.kind === "slide" ? prepareSlide(scene, events) : [],
    whiteboardSnapshots: scene.kind === "whiteboard" ? prepareWhiteboard(events) : [],
    segmentIndexById,
    stepIndexBySegmentId,
    stepRanges,
    objectBoxes,
    canvas,
  };
  sceneCache.set(scene, prepared);
  return prepared;
}

export function firedEventCount(prepared: PreparedScene, tMs: number): number {
  return upperBound(prepared.eventStarts, Math.max(0, tMs));
}

/** Events still animating at t. Usually zero or one; never scans future events. */
export function activeEvents(
  prepared: PreparedScene,
  tMs: number,
  firedCount: number,
  animationRate = 1,
): ActionEvent[] {
  const rate = Number.isFinite(animationRate) && animationRate > 0 ? animationRate : 1;
  const active: ActionEvent[] = [];
  // Longest operation is 800 ms. At 0.75× it can remain active for ~1067 ms.
  const lookbackMs = 1200 / rate;
  for (let index = firedCount - 1; index >= 0; index -= 1) {
    const event = prepared.events[index];
    if (tMs - event.atMs > lookbackMs) break;
    if ((tMs - event.atMs) * rate < event.durationMs) active.push(event);
  }
  return active;
}

export type FlatScene = {
  scene: Scene;
  sceneIndex: number;
  moduleIndex: number;
  moduleTitle: string;
  startMs: number;
  endMs: number;
  kind: Scene["kind"];
};

export type PreparedCourse = {
  flat: FlatScene[];
  modules: { module: Course["modules"][number]; entries: FlatScene[] }[];
  totalMs: number;
};

const courseCache = new WeakMap<Course, PreparedCourse>();

export function getPreparedCourse(course: Course): PreparedCourse {
  const cached = courseCache.get(course);
  if (cached) return cached;
  const flat: FlatScene[] = [];
  const modules: PreparedCourse["modules"] = [];
  let cursor = 0;
  course.modules.forEach((module, moduleIndex) => {
    const entries: FlatScene[] = [];
    module.scenes.forEach((scene) => {
      const durationMs = getPreparedScene(scene).timeline.totalMs;
      const entry: FlatScene = {
        scene,
        sceneIndex: flat.length,
        moduleIndex,
        moduleTitle: module.title,
        startMs: cursor,
        endMs: cursor + durationMs,
        kind: scene.kind,
      };
      flat.push(entry);
      entries.push(entry);
      cursor += durationMs;
    });
    modules.push({ module, entries });
  });
  const prepared = { flat, modules, totalMs: cursor };
  courseCache.set(course, prepared);
  return prepared;
}

export function flattenCourse(course: Course, speed = 1): FlatScene[] {
  if (speed === 1) return getPreparedCourse(course).flat;
  const out: FlatScene[] = [];
  let cursor = 0;
  course.modules.forEach((module, moduleIndex) => {
    module.scenes.forEach((scene) => {
      const durationMs = buildTimeline(scene, speed).totalMs;
      out.push({
        scene,
        sceneIndex: out.length,
        moduleIndex,
        moduleTitle: module.title,
        startMs: cursor,
        endMs: cursor + durationMs,
        kind: scene.kind,
      });
      cursor += durationMs;
    });
  });
  return out;
}

export function stepStartMs(scene: WhiteboardScene, _timeline: Timeline, stepId: string): number {
  return getPreparedScene(scene).stepRanges.get(stepId)?.startMs ?? 0;
}

export function stepEndMs(scene: WhiteboardScene, timeline: Timeline, stepId: string): number {
  return getPreparedScene(scene).stepRanges.get(stepId)?.endMs ?? timeline.totalMs;
}
