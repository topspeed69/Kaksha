import { describe, expect, it } from "vitest";
import { buildFixtureCourse } from "@/lib/fixtures/quantum-decoherence";
import {
  computeSceneState,
  findSceneAt,
  flattenCourse,
  getPreparedCourse,
  getPreparedScene,
  timelineAt,
} from "@/lib/player/computeSceneState";
import type { Scene, Segment } from "@/lib/dsl/types";

const course = buildFixtureCourse();
const board = course.modules.flatMap((m) => m.scenes).find((s) => s.kind === "whiteboard")!;
const slide = course.modules.flatMap((m) => m.scenes).find((s) => s.kind === "slide")!;

describe("prepared player performance", () => {
  it("returns the same prepared indexes for the same scene object", () => {
    expect(getPreparedScene(board)).toBe(getPreparedScene(board));
    expect(getPreparedCourse(course)).toBe(getPreparedCourse(course));
    expect(flattenCourse(course)).toBe(getPreparedCourse(course).flat);
  });

  it("keeps completed whiteboard item identities stable between ticks", () => {
    const prepared = getPreparedScene(board);
    const end = prepared.timeline.totalMs;
    const a = computeSceneState(board, end);
    const b = computeSceneState(board, end);
    if (a.kind !== "whiteboard" || b.kind !== "whiteboard") throw new Error("expected whiteboard");
    expect(a.items).toBe(b.items);
    expect(a.erased).toBe(b.erased);
    expect(a.items.every((item) => item.progress === 1)).toBe(true);
  });

  it("does not change segment boundaries when playback rate changes", () => {
    const prepared = getPreparedScene(slide);
    const t = prepared.timeline.segments[1].startMs + 100;
    const normal = computeSceneState(slide, t, 1);
    const fast = computeSceneState(slide, t, 2);
    expect(normal.currentSegmentId).toBe(fast.currentSegmentId);
    expect(normal.timeline).toBe(fast.timeline);
    expect(timelineAt(prepared.timeline, t)?.id).toBe(normal.currentSegmentId);
  });

  it("computes 10,000 random seeks over a large synthetic scene quickly", () => {
    const segments: Segment[] = Array.from({ length: 240 }, (_, index) => ({
      id: `s${index + 1}`,
      text: `Segment ${index + 1} explains one idea in plain spoken language.`,
      estimated_duration_ms: 4000,
      actions: [
        { op: "wb.text", at: 0.1, id: `t${index}`, x: 40, y: 40 + (index % 12) * 50, text: `Step ${index}` },
        { op: "wb.highlight", at: 0.5, target: `t${index}` },
      ],
    }));
    const large: Scene = {
      kind: "whiteboard",
      id: "large",
      index: 0,
      title: "Large derivation",
      canvas: { w: 1280, h: 720 },
      steps: [{ id: "step1", title: "All", segment_ids: segments.map((s) => s.id) }],
      segments,
      sources: [],
    };
    const prepared = getPreparedScene(large);
    const start = performance.now();
    let checksum = 0;
    for (let i = 0; i < 10_000; i += 1) {
      const t = (i * 7919) % prepared.timeline.totalMs;
      const state = computeSceneState(large, t);
      if (state.kind === "whiteboard") checksum += state.items.length;
    }
    const elapsed = performance.now() - start;
    expect(checksum).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(400);
  });

  it("finds scenes by binary search at course boundaries", () => {
    const flat = flattenCourse(course);
    expect(findSceneAt(flat, -100)?.sceneIndex).toBe(0);
    expect(findSceneAt(flat, flat[3].startMs)?.sceneIndex).toBe(3);
    expect(findSceneAt(flat, Number.MAX_SAFE_INTEGER)?.sceneIndex).toBe(flat.length - 1);
  });
});
