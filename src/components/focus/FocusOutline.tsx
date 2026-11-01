"use client";

import { memo } from "react";
import { useAppearance } from "@/lib/theme";
import { isUsableRect, type Rect } from "@/lib/player/focusCamera";

/**
 * A single, quiet hand-drawn outline around the thing being explained.
 * No dashed rings, zoom, glow, or second decorative stroke. The SVG uses
 * stable geometry so seeking to the same moment produces the same outline.
 */
export const FocusOutline = memo(function FocusOutline({
  box,
  viewport,
  coordinateSpace = "pixels",
}: {
  box: Rect | null;
  viewport: { w: number; h: number };
  coordinateSpace?: "pixels" | "canvas";
}) {
  const { appearance } = useAppearance();
  if (!isUsableRect(box) || viewport.w <= 0 || viewport.h <= 0) return null;
  const pad = coordinateSpace === "canvas" ? 13 : Math.max(7, Math.min(15, viewport.w * 0.012));
  const x = Math.max(3, box.x - pad);
  const y = Math.max(3, box.y - pad);
  const right = Math.min(viewport.w - 3, box.x + box.w + pad);
  const bottom = Math.min(viewport.h - 3, box.y + box.h + pad);
  const w = right - x;
  const h = bottom - y;
  if (w < 8 || h < 8) return null;
  const oval = w / h > 0.69 && w / h < 1.65 && w < viewport.w * 0.52;
  // One deliberately imperfect path. The slight asymmetry reads as a mark made
  // by hand, without the repeated circles that obscure slide content.
  const path = oval
    ? `M ${x + w * 0.51} ${y + 1} C ${x + w * 0.82} ${y - 1}, ${x + w + 1} ${y + h * 0.19}, ${x + w - 1} ${y + h * 0.53} C ${x + w + 1} ${y + h * 0.84}, ${x + w * 0.73} ${y + h + 2}, ${x + w * 0.48} ${y + h - 1} C ${x + w * 0.14} ${y + h + 2}, ${x - 1} ${y + h * 0.74}, ${x + 1} ${y + h * 0.47} C ${x - 2} ${y + h * 0.18}, ${x + w * 0.22} ${y}, ${x + w * 0.51} ${y + 1}`
    : `M ${x + 5} ${y + 1} Q ${x + w * 0.45} ${y - 1}, ${x + w - 5} ${y + 1} Q ${x + w + 2} ${y + 2}, ${x + w - 1} ${y + h * 0.45} L ${x + w} ${y + h - 5} Q ${x + w - 2} ${y + h + 2}, ${x + w * 0.52} ${y + h - 1} L ${x + 5} ${y + h} Q ${x - 2} ${y + h - 1}, ${x + 1} ${y + h * 0.5} L ${x} ${y + 6} Q ${x + 1} ${y}, ${x + 5} ${y + 1}`;

  return (
    <path
      data-focus-outline
      d={path}
      fill="none"
      stroke="var(--accent)"
      strokeWidth={coordinateSpace === "canvas" ? 3 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      pathLength={1}
      strokeDasharray={1}
      className={appearance.reduced_motion ? "" : "focus-outline-draw"}
      style={{ pointerEvents: "none" }}
      aria-hidden="true"
    />
  );
});
