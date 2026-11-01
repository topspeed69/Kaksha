import { describe, expect, it } from "vitest";
import {
  cameraToTransform,
  cameraTransitionMs,
  computeCamera,
  isIdentityCamera,
  isUsableRect,
  isWorthFocusing,
  unionRect,
  type CameraTransform,
  type Rect,
} from "@/lib/player/focusCamera";
import { buildFixtureCourse } from "@/lib/fixtures/quantum-decoherence";
import {
  computeSlideState,
  computeSceneState,
  getPreparedScene,
  HIGHLIGHT_WINDOW_MS,
} from "@/lib/player/computeSceneState";
import type { Scene, Segment, SlideScene, WhiteboardScene } from "@/lib/dsl/types";

const VIEWPORT = { w: 1600, h: 900 };

function segment(id: string, actions: Segment["actions"]): Segment {
  return { id, text: `Segment ${id}`, estimated_duration_ms: 5000, actions };
}

describe("focus camera adversarial inputs", () => {
  it("returns the identity camera for unusable input", () => {
    const bad: (Rect | null | undefined)[] = [
      null,
      undefined,
      { x: 0, y: 0, w: 0, h: 0 },
      { x: Number.NaN, y: 0, w: 10, h: 10 },
      { x: 0, y: Number.POSITIVE_INFINITY, w: 10, h: 10 },
      { x: -100, y: -100, w: -5, h: -5 },
    ];
    for (const rect of bad) {
      const camera = computeCamera(VIEWPORT, rect);
      expect(isIdentityCamera(camera), `expected identity for ${JSON.stringify(rect)}`).toBe(true);
    }
    expect(isUsableRect({ x: 0, y: 0, w: 0, h: 0 })).toBe(false);
    expect(isUsableRect({ x: 1, y: 1, w: 10, h: 10 })).toBe(true);
  });

  it("rejects unusable viewports instead of producing NaN", () => {
    for (const viewport of [
      { w: 0, h: 0 },
      { w: Number.NaN, h: 900 },
      { w: -1600, h: -900 },
    ]) {
      const camera = computeCamera(viewport, { x: 10, y: 10, w: 100, h: 100 });
      expect(camera.scale).toBe(1);
      expect(camera.x).toBe(0);
      expect(camera.y).toBe(0);
    }
  });

  it("never shows empty stage: the stage always covers the screen", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 40, h: 30 },
      { x: 1560, y: 870, w: 40, h: 30 },
      { x: -200, y: -200, w: 200, h: 200 },
      { x: 1800, y: 1000, w: 200, h: 200 },
      { x: 700, y: 380, w: 200, h: 140 },
      { x: 0, y: 0, w: 1600, h: 900 },
    ];
    for (const rect of rects) {
      const camera = computeCamera(VIEWPORT, rect, { padding: 24 });
      // In screen space the stage spans [camera.x, camera.x + w*scale]. Because
      // the camera only ever zooms in, it must cover the entire screen.
      expect(camera.scale).toBeGreaterThanOrEqual(1);
      expect(camera.x).toBeLessThanOrEqual(0.5);
      expect(camera.y).toBeLessThanOrEqual(0.5);
      expect(camera.x + VIEWPORT.w * camera.scale).toBeGreaterThanOrEqual(VIEWPORT.w - 0.5);
      expect(camera.y + VIEWPORT.h * camera.scale).toBeGreaterThanOrEqual(VIEWPORT.h - 0.5);
      expect(Number.isFinite(camera.scale)).toBe(true);
    }
  });

  it("keeps every on-canvas element fully visible after the camera move", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 40, h: 30 },
      { x: 1560, y: 870, w: 40, h: 30 },
      { x: 700, y: 380, w: 200, h: 140 },
      { x: 0, y: 430, w: 320, h: 40 },
      { x: 1280, y: 820, w: 320, h: 80 },
    ];
    for (const rect of rects) {
      const camera = computeCamera(VIEWPORT, rect, { padding: 24 });
      const screenLeft = camera.x + rect.x * camera.scale;
      const screenTop = camera.y + rect.y * camera.scale;
      const screenRight = screenLeft + rect.w * camera.scale;
      const screenBottom = screenTop + rect.h * camera.scale;
      expect(screenLeft).toBeGreaterThanOrEqual(-0.5);
      expect(screenTop).toBeGreaterThanOrEqual(-0.5);
      expect(screenRight).toBeLessThanOrEqual(VIEWPORT.w + 0.5);
      expect(screenBottom).toBeLessThanOrEqual(VIEWPORT.h + 0.5);
    }
  });

  it("clamps zoom so text is never magnified past the cap", () => {
    const tiny = computeCamera(VIEWPORT, { x: 800, y: 450, w: 8, h: 8 }, { maxScale: 1.9 });
    expect(tiny.scale).toBeLessThanOrEqual(1.9);
    const huge = computeCamera(VIEWPORT, { x: 0, y: 0, w: 5000, h: 5000 });
    expect(huge.scale).toBeGreaterThanOrEqual(1);
    expect(huge.scale).toBeLessThanOrEqual(1.0001);
  });

  it("emits a finite CSS transform even for garbage camera state", () => {
    const cameras: CameraTransform[] = [
      { scale: Number.NaN, x: Number.NaN, y: Number.NaN },
      { scale: Number.POSITIVE_INFINITY, x: -1e9, y: 1e9 },
      { scale: 1.2, x: -30, y: 40 },
    ];
    for (const camera of cameras) {
      const transform = cameraToTransform(camera);
      expect(transform).not.toContain("NaN");
      expect(transform).not.toContain("Infinity");
    }
  });

  it("scales transition duration with camera distance and clamps it", () => {
    const identity = { scale: 1, x: 0, y: 0 };
    const small = { scale: 1.05, x: -10, y: -5 };
    const large = { scale: 1.9, x: -600, y: -400 };
    expect(cameraTransitionMs(identity, identity)).toBe(220);
    expect(cameraTransitionMs(identity, small)).toBeGreaterThan(220);
    expect(cameraTransitionMs(identity, small)).toBeLessThan(cameraTransitionMs(identity, large));
    expect(cameraTransitionMs(identity, large)).toBeLessThanOrEqual(620);
  });

  it("merges rects for multi-target focus", () => {
    const union = unionRect({ x: 10, y: 10, w: 20, h: 20 }, { x: 60, y: 40, w: 20, h: 20 });
    expect(union).toEqual({ x: 10, y: 10, w: 70, h: 50 });
  });
});

describe("whiteboard object geometry", () => {
  const scene: Scene = {
    kind: "whiteboard",
    id: "cam",
    index: 0,
    title: "Camera geometry",
    canvas: { w: 1280, h: 720 },
    steps: [{ id: "step1", title: "Step", segment_ids: ["s1"] }],
    segments: [
      segment("s1", [
        { op: "wb.rect", at: 0.1, id: "box", x: 100, y: 100, w: 300, h: 120 },
        { op: "wb.circle", at: 0.4, id: "dot", cx: 800, cy: 400, r: 40 },
        { op: "wb.axes", at: 0.5, id: "ax", x: 600, y: 300, w: 400, h: 200 },
        { op: "wb.text", at: 0.6, id: "label", x: 120, y: 620, text: "Result", size: "md" },
        { op: "wb.highlight", at: 0.8, target: "box" },
      ]),
    ],
    sources: [],
  };

  it("derives canvas boxes for every drawn object", () => {
    const prepared = getPreparedScene(scene);
    expect(prepared.objectBoxes.get("box")).toEqual({ id: "box", x: 100, y: 100, w: 300, h: 120 });
    expect(prepared.objectBoxes.get("dot")).toEqual({ id: "dot", x: 760, y: 360, w: 80, h: 80 });
    expect(prepared.objectBoxes.get("ax")).toEqual({ id: "ax", x: 600, y: 300, w: 400, h: 200 });
    const label = prepared.objectBoxes.get("label");
    expect(label?.x).toBe(120);
    expect(label?.w).toBeGreaterThan(0);
    expect(label?.h).toBeGreaterThan(0);
    // No object box escapes the canvas.
    for (const box of prepared.objectBoxes.values()) {
      expect(box.x).toBeGreaterThanOrEqual(-8);
      expect(box.y).toBeGreaterThanOrEqual(-8);
      expect(box.x + box.w).toBeLessThanOrEqual(1288);
      expect(box.y + box.h).toBeLessThanOrEqual(728);
    }
  });

  it("focuses the highlighted object inside the canvas without gaps", () => {
    const prepared = getPreparedScene(scene);
    const box = prepared.objectBoxes.get("box")!;
    const camera = computeCamera(prepared.canvas, box, { targetFill: 0.6, maxScale: 2.1, padding: 90 });
    const left = -camera.x / camera.scale;
    const top = -camera.y / camera.scale;
    expect(left).toBeGreaterThanOrEqual(-0.5);
    expect(top).toBeGreaterThanOrEqual(-0.5);
    expect(left + 1280).toBeLessThanOrEqual(1280.5);
    expect(top + 720).toBeLessThanOrEqual(720.5);
  });

  it("keeps the fixture whiteboard measurable end to end", () => {
    const course = buildFixtureCourse();
    const board = course.modules
      .flatMap((m) => m.scenes)
      .find((s) => s.kind === "whiteboard") as WhiteboardScene;
    const prepared = getPreparedScene(board);
    expect(prepared.objectBoxes.size).toBeGreaterThan(0);
    for (const box of prepared.objectBoxes.values()) {
      const camera = computeCamera(prepared.canvas, box);
      expect(Number.isFinite(camera.scale)).toBe(true);
      expect(Number.isFinite(camera.x)).toBe(true);
    }
  });
});

describe("focus guards", () => {
  it("skips zoom for objects that already fill the stage", () => {
    const canvas = { w: 1280, h: 720 };
    // A plot region that covers most of the board: leave it in full view.
    expect(isWorthFocusing(canvas, { x: 40, y: 40, w: 1200, h: 640 })).toBe(false);
    expect(isWorthFocusing(canvas, { x: 0, y: 0, w: 1280, h: 720 })).toBe(false);
    // A small label: worth following.
    expect(isWorthFocusing(canvas, { x: 60, y: 60, w: 240, h: 40 })).toBe(true);
    expect(isWorthFocusing(canvas, { x: 600, y: 300, w: 300, h: 60 })).toBe(true);
    expect(isWorthFocusing(canvas, null)).toBe(false);
  });

  it("never zooms onto an object that has been erased", () => {
    const scene: Scene = {
      kind: "whiteboard",
      id: "erase",
      index: 0,
      title: "Erase then highlight",
      canvas: { w: 1280, h: 720 },
      steps: [{ id: "step1", title: "Step", segment_ids: ["s1", "s2"] }],
      segments: [
        segment("s1", [
          { op: "wb.text", at: 0.1, id: "gone", x: 100, y: 100, text: "Temporary label", size: "md" },
          { op: "wb.highlight", at: 0.3, target: "gone" },
        ]),
        segment("s2", [
          { op: "wb.erase", at: 0.2, target: "gone" },
          { op: "wb.text", at: 0.4, id: "kept", x: 100, y: 400, text: "Kept label", size: "md" },
          { op: "wb.highlight", at: 0.6, target: "kept" },
        ]),
      ],
      sources: [],
    };
    const prepared = getPreparedScene(scene);
    // The erased object is removed from drawn items, so the camera must ignore it.
    const state = {
      kind: "whiteboard" as const,
      items: prepared.whiteboardSnapshots.at(-1)!.items.filter(
        (item) => item.action.id !== "gone",
      ),
      erased: new Set(["gone"]),
      highlight: "gone",
      currentStepIndex: 0,
      currentSegmentId: "s2",
    };
    const stillDrawn = state.items.some((item) => item.action.id === state.highlight);
    expect(stillDrawn).toBe(false);
    expect(isWorthFocusing(prepared.canvas, prepared.objectBoxes.get("gone"))).toBe(true);
    // Guarding on drawn items is what prevents zooming onto empty board.
    const camera = stillDrawn
      ? computeCamera(prepared.canvas, prepared.objectBoxes.get("gone"))
      : { scale: 1, x: 0, y: 0 };
    expect(isIdentityCamera(camera)).toBe(true);
  });
});

describe("transient attention cues", () => {
  const slide: SlideScene = {
    kind: "slide",
    id: "cue",
    index: 0,
    title: "Cues",
    layout: "text",
    elements: [
      { id: "el1", type: "heading", text: "Heading" },
      { id: "el2", type: "paragraph", text: "Body text that is long enough to matter." },
    ],
    segments: [
      {
        id: "s1",
        text: "First segment explains the heading.",
        estimated_duration_ms: 6000,
        actions: [{ op: "spotlight", at: 0.2, target: "el1" }],
      },
      {
        id: "s2",
        text: "Second segment moves on.",
        estimated_duration_ms: 6000,
        actions: [{ op: "laser", at: 0.5, target: "el2" }],
      },
    ],
    sources: [],
  };

  it("expires the spotlight on its own so the camera zooms back out", () => {
    const prepared = getPreparedScene(slide);
    const spotlightAt = 0.2 * prepared.timeline.segments[0].durationMs;
    const state = computeSlideState(slide, getPreparedScene(slide).timeline, spotlightAt + 100);
    expect(state.focus).toBe("el1");
    // After the window the cue is gone: focus clears and the camera resets.
    const later = computeSlideState(slide, getPreparedScene(slide).timeline, spotlightAt + HIGHLIGHT_WINDOW_MS + 200);
    expect(later.focus).toBeNull();
    expect(HIGHLIGHT_WINDOW_MS).toBeGreaterThanOrEqual(1000);
    expect(HIGHLIGHT_WINDOW_MS).toBeLessThanOrEqual(2000);
  });

  it("expires the laser pointer too", () => {
    const prepared = getPreparedScene(slide);
    const laserAt = prepared.timeline.segments[0].durationMs + 0.5 * prepared.timeline.segments[1].durationMs;
    const tl = getPreparedScene(slide).timeline;
    expect(computeSlideState(slide, tl, laserAt + 100).laser).toBe("el2");
    expect(computeSlideState(slide, tl, laserAt + HIGHLIGHT_WINDOW_MS + 200).laser).toBeNull();
  });

  it("keeps the accent highlight for equations while focused", () => {
    const equationSlide: SlideScene = {
      ...slide,
      id: "eq",
      layout: "equation_focus",
      elements: [
        { id: "el1", type: "heading", text: "Equation" },
        { id: "el2", type: "equation", latex: "E = mc^2", display: true },
      ],
      segments: [
        {
          id: "s1",
          text: "This is the mass energy equivalence.",
          estimated_duration_ms: 6000,
          actions: [{ op: "spotlight", at: 0.2, target: "el2" }],
        },
      ],
    };
    const prepared = getPreparedScene(equationSlide);
    const at = 0.2 * prepared.timeline.segments[0].durationMs;
    const state = computeSlideState(equationSlide, getPreparedScene(equationSlide).timeline, at + 100);
    // Focus identity is what drives the accent border on equations.
    expect(state.focus).toBe("el2");
  });
});
