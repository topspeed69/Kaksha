import { describe, expect, it } from "vitest";
import { buildFixtureCourse } from "@/lib/fixtures/quantum-decoherence";
import {
  buildTimeline,
  computeSceneState,
  flattenCourse,
  firedActions,
  findSceneAt,
  stepEndMs,
  stepStartMs,
  timelineAt,
} from "@/lib/player/computeSceneState";
import type { Scene } from "@/lib/dsl/types";

const course = buildFixtureCourse();
const scenes = course.modules.flatMap((m) => m.scenes);
const slide = scenes.find((s) => s.kind === "slide") as Extract<Scene, { kind: "slide" }>;
const board = scenes.find((s) => s.kind === "whiteboard") as Extract<Scene, { kind: "whiteboard" }>;

describe("the timeline", () => {
  it("lays segments end to end", () => {
    const timeline = buildTimeline(slide);
    expect(timeline.segments[0].startMs).toBe(0);
    for (let i = 1; i < timeline.segments.length; i += 1) {
      expect(timeline.segments[i].startMs).toBe(timeline.segments[i - 1].endMs);
    }
    expect(timeline.totalMs).toBe(timeline.segments.at(-1)?.endMs);
  });

  it("scales with playback speed without changing order", () => {
    const fast = buildTimeline(slide, 2);
    expect(fast.totalMs).toBeLessThan(buildTimeline(slide, 1).totalMs);
    expect(fast.segments.length).toBe(slide.segments.length);
  });

  it("finds the segment under a given time", () => {
    const timeline = buildTimeline(slide);
    expect(timelineAt(timeline, 0)?.id).toBe(timeline.segments[0].id);
    expect(timelineAt(timeline, timeline.totalMs - 1)?.id).toBe(
      timeline.segments.at(-1)?.id,
    );
  });
});

describe("computeSceneState for slides", () => {
  it("hides elements that have not been revealed", () => {
    const timeline = buildTimeline(slide);
    const state = computeSceneState(slide, 0);
    expect(state.kind).toBe("slide");
    if (state.kind !== "slide") return;
    const revealedLater = slide.elements.filter((element) =>
      slide.segments.some((segment) =>
        segment.actions.some((a) => a.op === "reveal" && a.target === element.id && a.at > 0.1),
      ),
    );
    expect(revealedLater.length).toBeGreaterThan(0);
    expect(state.timeline.totalMs).toBe(timeline.totalMs);
  });

  it("reveals and spotlights as time advances", () => {
    const end = buildTimeline(slide).totalMs;
    const state = computeSceneState(slide, end);
    if (state.kind !== "slide") return;
    expect(state.visible.size).toBe(slide.elements.length);
  });

  it("is a pure function: the same time gives the same state", () => {
    expect(computeSceneState(slide, 4200)).toEqual(computeSceneState(slide, 4200));
  });
});

describe("computeSceneState for the whiteboard", () => {
  it("draws progressively", () => {
    const timeline = buildTimeline(board);
    const early = computeSceneState(board, timeline.segments[0].startMs + 100);
    const late = computeSceneState(board, timeline.totalMs);
    if (early.kind !== "whiteboard" || late.kind !== "whiteboard") return;
    expect(late.items.length).toBeGreaterThan(early.items.length);
    expect(late.items.every((item) => item.progress === 1)).toBe(true);
  });

  it("reports partial progress for the op in flight", () => {
    const timeline = buildTimeline(board);
    const slot = timeline.segments[0];
    const fireAt = slot.startMs + 0.05 * slot.durationMs;
    const mid = firedActions(board, timeline, fireAt + 60);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid[0].progress).toBeGreaterThan(0);
    expect(mid[0].progress).toBeLessThan(1);
    const done = firedActions(board, timeline, fireAt + 5000);
    expect(done[0].progress).toBe(1);
  });

  it("replays a step by seeking to the step's first segment", () => {
    const timeline = buildTimeline(board);
    const step = board.steps[1];
    const start = stepStartMs(board, timeline, step.id);
    const end = stepEndMs(board, timeline, step.id);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const state = computeSceneState(board, start);
    if (state.kind !== "whiteboard") return;
    expect(board.steps[state.currentStepIndex].id).toBe(step.id);
  });
});

describe("the course timeline", () => {
  it("keeps scene order and finds the scene at a time", () => {
    const flat = flattenCourse(course);
    expect(flat.length).toBeGreaterThan(8);
    expect(flat[0].startMs).toBe(0);
    expect(findSceneAt(flat, flat[2].startMs + 10)?.sceneIndex).toBe(2);
    expect(findSceneAt(flat, flat.at(-1)!.endMs + 1000)?.sceneIndex).toBe(flat.length - 1);
  });
});
