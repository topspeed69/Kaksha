"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { isUsableRect, type CameraViewport, type Rect } from "./focusCamera";

export type ElementGeometry = {
  rects: ReadonlyMap<string, Rect>;
  viewport: CameraViewport;
};

const EMPTY: ElementGeometry = { rects: new Map(), viewport: { w: 0, h: 0 } };

/**
 * Measure fitted slide content, never its reserved grid row. The stage no longer
 * transforms/zooms, so getBoundingClientRect includes FitBox's actual text
 * scale; the mark lands around the visible glyphs instead of the empty row.
 */
export function useElementGeometry(
  containerRef: RefObject<HTMLElement | null>,
  sceneKey: string,
  elementIds: readonly string[],
): ElementGeometry {
  const [geometry, setGeometry] = useState<ElementGeometry>(EMPTY);
  const frame = useRef(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    const byId = new Map(
      [...container.querySelectorAll<HTMLElement>("[data-element-id]")]
        .map((node) => [node.dataset.elementId, node] as const)
        .filter((entry): entry is readonly [string, HTMLElement] => Boolean(entry[0])),
    );
    const nodes = elementIds
      .map((id) => [id, byId.get(id)] as const)
      .filter((entry): entry is readonly [string, HTMLElement] => Boolean(entry[1]));
    const measure = () => {
      if (disposed) return;
      const origin = container.getBoundingClientRect();
      if (!origin.width || !origin.height) return;
      const rects = new Map<string, Rect>();
      for (const [id, node] of nodes) {
        let r = node.getBoundingClientRect();
        if (["heading", "paragraph", "bullets", "callout"].includes(node.dataset.focusType ?? "")) {
          const content = node.firstElementChild;
          if (content) {
            const range = document.createRange();
            range.selectNodeContents(content);
            const glyphs = range.getBoundingClientRect();
            if (glyphs.width > 1 && glyphs.height > 1) r = glyphs;
            range.detach();
          }
        }
        const box = {
          x: r.left - origin.left,
          y: r.top - origin.top,
          w: r.width,
          h: r.height,
        };
        if (isUsableRect(box)) rects.set(id, box);
      }
      setGeometry({ rects, viewport: { w: origin.width, h: origin.height } });
    };
    const schedule = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(measure);
    };
    // KaTeX and self-hosted fonts can settle a frame after layout.
    frame.current = requestAnimationFrame(() => {
      frame.current = requestAnimationFrame(measure);
    });
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    nodes.forEach(([, node]) => observer.observe(node));
    return () => {
      disposed = true;
      cancelAnimationFrame(frame.current);
      observer.disconnect();
    };
  }, [containerRef, sceneKey, elementIds]);
  return geometry;
}
