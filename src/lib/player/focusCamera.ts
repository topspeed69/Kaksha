/**
 * Focus camera math. Pure functions only, so the camera is deterministic and
 * testable: the same scene state and geometry always give the same transform.
 *
 * The camera pans and zooms so the element being explained fills a target share
 * of the stage, exactly like a camera operator following a lecturer.
 */

export type Rect = { x: number; y: number; w: number; h: number };
export type CameraViewport = { w: number; h: number };

export type CameraTransform = {
  /** 1 = no zoom. Values above 1 magnify. */
  scale: number;
  /** Translation in stage pixels, applied before scaling. */
  x: number;
  y: number;
};

export type CameraOptions = {
  /** Share of the stage the focused element should fill. 0.6 = 60%. */
  targetFill?: number;
  /** Never magnify beyond this, to keep text crisp. */
  maxScale?: number;
  /** Never magnify below 1: the camera never shrinks content. */
  minScale?: number;
  /** Stage padding in pixels kept around the focused element. */
  padding?: number;
};

const DEFAULTS: Required<CameraOptions> = {
  targetFill: 0.72,
  maxScale: 1.9,
  minScale: 1,
  padding: 28,
};

export function isUsableRect(rect: Rect | null | undefined): rect is Rect {
  if (!rect) return false;
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.w) &&
    Number.isFinite(rect.h) &&
    rect.w > 1 &&
    rect.h > 1
  );
}

export function isUsableViewport(viewport: CameraViewport | null | undefined): viewport is CameraViewport {
  if (!viewport) return false;
  return (
    Number.isFinite(viewport.w) &&
    Number.isFinite(viewport.h) &&
    viewport.w > 1 &&
    viewport.h > 1
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Camera that centres `focus` inside `viewport`.
 * Returns the identity camera when the input is unusable or the element already
 * fills the viewport, so callers can always apply the result.
 */
export function computeCamera(
  viewport: CameraViewport,
  focus: Rect | null | undefined,
  options: CameraOptions = {},
): CameraTransform {
  const settings = { ...DEFAULTS, ...options };
  if (!isUsableViewport(viewport) || !isUsableRect(focus)) {
    return { scale: settings.minScale, x: 0, y: 0 };
  }

  // Scale so the element's larger dimension fills the target share.
  const usableW = Math.max(1, viewport.w - settings.padding * 2);
  const usableH = Math.max(1, viewport.h - settings.padding * 2);
  const scaleForWidth = usableW / Math.max(1, focus.w);
  const scaleForHeight = usableH / Math.max(1, focus.h);
  const scale = clamp(
    Math.min(scaleForWidth, scaleForHeight) / settings.targetFill,
    settings.minScale,
    settings.maxScale,
  );

  // Centre the element, then clamp so the camera never shows empty stage.
  const centreX = focus.x + focus.w / 2;
  const centreY = focus.y + focus.h / 2;
  const rawX = viewport.w / 2 - centreX * scale;
  const rawY = viewport.h / 2 - centreY * scale;

  const scaledStageW = viewport.w * scale;
  const scaledStageH = viewport.h * scale;
  const maxX = 0;
  const minX = Math.min(0, viewport.w - scaledStageW);
  const maxY = 0;
  const minY = Math.min(0, viewport.h - scaledStageH);

  return {
    scale,
    x: clamp(rawX, minX, maxX),
    y: clamp(rawY, minY, maxY),
  };
}

/** True when the camera would not move the stage at all. */
export function isIdentityCamera(camera: CameraTransform): boolean {
  return Math.abs(camera.scale - 1) < 0.001 && Math.abs(camera.x) < 0.5 && Math.abs(camera.y) < 0.5;
}

/**
 * True when zooming would help. Objects that already fill most of the stage are
 * better left in full view: cropping a plot or a large diagram hides context the
 * narration still depends on.
 */
export function isWorthFocusing(
  viewport: CameraViewport,
  focus: Rect | null | undefined,
  options: { maxDimensionShare?: number; maxAreaShare?: number } = {},
): boolean {
  if (!isUsableViewport(viewport) || !isUsableRect(focus)) return false;
  const maxDimensionShare = options.maxDimensionShare ?? 0.62;
  const maxAreaShare = options.maxAreaShare ?? 0.42;
  const dimensionShare = Math.max(focus.w / viewport.w, focus.h / viewport.h);
  const areaShare = (focus.w * focus.h) / (viewport.w * viewport.h);
  return dimensionShare <= maxDimensionShare && areaShare <= maxAreaShare;
}

/**
 * CSS transform for a camera that scales around the stage origin.
 * Uses transform only, so it stays on the compositor and never triggers layout.
 */
export function cameraToTransform(camera: CameraTransform): string {
  if (!Number.isFinite(camera.scale) || !Number.isFinite(camera.x) || !Number.isFinite(camera.y)) {
    return "translate3d(0, 0, 0) scale(1)";
  }
  return `translate3d(${camera.x.toFixed(2)}px, ${camera.y.toFixed(2)}px, 0) scale(${camera.scale.toFixed(4)})`;
}

/**
 * Transition duration for a camera move, in milliseconds. Larger moves take
 * slightly longer, which reads as a camera operator settling rather than a jump.
 */
export function cameraTransitionMs(from: CameraTransform, to: CameraTransform): number {
  const distance =
    Math.abs(to.x - from.x) + Math.abs(to.y - from.y) + Math.abs(to.scale - from.scale) * 400;
  return Math.round(clamp(220 + distance * 0.22, 220, 620));
}

/** Merge two rects. Used to focus several targets at once. */
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}
