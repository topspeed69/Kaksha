"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";
import type { FitMode } from "@/lib/player/slideLayout";

/**
 * Scales content down until it fits its reserved region. Text wraps at the
 * region width and is fitted by height; equations are fitted by width+height.
 * Content is never allowed to overflow into a neighbouring region.
 */
export function FitBox({
  mode = "text",
  children,
  className,
  focusId,
  focusType,
}: {
  mode?: FitMode;
  children: ReactNode;
  className?: string;
  focusId?: string;
  focusType?: string;
}) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const content = contentRef.current;
    if (!slot || !content) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const cw = slot.clientWidth;
        const ch = slot.clientHeight;
        if (cw <= 0 || ch <= 0) return;
        const sw = content.scrollWidth;
        const sh = content.scrollHeight;
        if (sw <= 0 || sh <= 0) return;
        const next =
          mode === "text"
            ? Math.min(1, ch / sh)
            : Math.min(1, cw / sw, ch / sh);
        // Long display equations may need more reduction than prose. Avoid
        // clipping formulas while retaining a readable minimum for text.
        const minFit = mode === "contain" ? 0.20 : 0.40;
        const clamped = Math.max(minFit, Math.min(1, next));
        setScale((current) => (Math.abs(current - clamped) > 0.01 ? clamped : current));
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    observer.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [mode, children]);

  return (
    <div ref={slotRef} className={cn("relative h-full w-full min-h-0 overflow-hidden", className)}>
      <div
        ref={contentRef}
        data-element-id={focusId}
        data-focus-type={focusType}
        className="absolute left-0 top-0"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width: mode === "text" ? "100%" : "max-content",
          maxWidth: mode === "text" ? "100%" : "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
