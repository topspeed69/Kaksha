"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { SlideScene } from "@/lib/dsl/types";
import type { SlideState } from "@/lib/player/computeSceneState";
import { arrangeSlide, fitFor, type SlideElement } from "@/lib/player/slideLayout";
import { useElementGeometry } from "@/lib/player/useElementGeometry";
import { FocusOutline } from "@/components/focus/FocusOutline";
import { Latex, RichText } from "@/components/ui/Latex";
import { Figure } from "./Figure";
import { FitBox } from "./FitBox";
import { cn } from "@/components/ui";


/** Mobile has a reading layout instead of a tiny, clipped 16:9 desktop canvas. */
const MobileSlideElement = memo(function MobileSlideElement({
  element,
  focused,
  lasered,
}: {
  element: SlideElement;
  focused: boolean;
  lasered: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const w = node.clientWidth;
        const h = node.clientHeight;
        setSize((prev) => prev.w === w && prev.h === h ? prev : { w, h });
      });
    });
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <div ref={ref} className="relative min-w-0 py-2" data-mobile-element={element.id}>
      {(() => {
        switch (element.type) {
          case "heading":
            return <h2 className="type-h2 text-ink"><RichText text={element.text} as="span" /></h2>;
          case "paragraph":
            return <RichText text={element.text} className="type-body text-ink" />;
          case "bullets":
            return (
              <ul className="space-y-2">
                {element.items.map((item, i) => (
                  <li key={i} className="type-body-sm flex gap-3 text-ink">
                    <span className="type-label-sm shrink-0 text-accent">{String(i + 1).padStart(2, "0")}</span>
                    <RichText text={item} as="span" />
                  </li>
                ))}
              </ul>
            );
          case "equation":
            return (
              <div className={cn("border-l-2 py-2 pl-3", focused ? "border-accent" : "border-rule-strong")}>
                <div className="max-w-full overflow-x-auto text-[18px] text-ink">
                  <Latex latex={element.latex} display={element.display} />
                </div>
                {element.caption ? <RichText text={element.caption} className="type-body-sm mt-2 text-muted" /> : null}
              </div>
            );
          case "figure":
            return <div className="w-full min-w-0"><Figure spec={element.spec} caption={element.caption} /></div>;
          case "callout":
            return <RichText text={element.text} className="type-body-sm border-t border-rule pt-3 text-muted" />;
          case "code":
            return <pre className="type-mono max-w-full overflow-x-auto border border-rule bg-surface p-3"><code>{element.code}</code></pre>;
        }
      })()}
      {lasered ? (
        <span aria-hidden="true" className="pointer-events-none absolute left-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full bg-accent" />
      ) : null}
      {focused && size.w > 0 && size.h > 0 ? (
        <svg
          viewBox={`0 0 ${size.w} ${size.h}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <FocusOutline box={{ x: 1, y: 1, w: size.w - 2, h: size.h - 2 }} viewport={size} />
        </svg>
      ) : null}
    </div>
  );
});

function MobileSlide({ scene, state }: { scene: SlideScene; state: SlideState }) {
  return (
    <div className="stage-scaler w-full border border-rule bg-stage p-5 md:hidden" data-mobile-slide>
      <div className="flex flex-col gap-2">
        {scene.elements.filter((element) => state.visible.has(element.id)).map((element) => (
          <MobileSlideElement
            key={element.id}
            element={element}
            focused={state.focus === element.id}
            lasered={state.laser === element.id}
          />
        ))}
      </div>
    </div>
  );
}

const SlideElementView = memo(function SlideElementView({
  element,
  layout,
  visible,
  focused,
  dimmed,
}: {
  element: SlideElement;
  layout: SlideScene["layout"];
  visible: boolean;
  focused: boolean;
  dimmed: boolean;
}) {
  return (
    <div
      className={cn(
        "relative h-full min-h-0 w-full transition-opacity duration-300",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
        dimmed ? "opacity-55" : "",
      )}
      aria-hidden={!visible || undefined}
    >
      <FitBox mode={fitFor(element)} focusId={element.id} focusType={element.type}>
        {renderElement(layout, element, focused)}
      </FitBox>
    </div>
  );
});

function ElementStack({
  elements,
  state,
  layout,
}: {
  elements: SlideElement[];
  state: SlideState;
  layout: SlideScene["layout"];
}) {
  if (!elements.length) return null;
  return (
    <div
      className="grid h-full min-h-0 w-full gap-[1.8cqw]"
      style={{ gridTemplateRows: `repeat(${elements.length}, minmax(0, 1fr))` }}
    >
      {elements.map((element) => (
        <SlideElementView
          key={element.id}
          element={element}
          layout={layout}
          visible={state.visible.has(element.id)}
          focused={state.focus === element.id}
          dimmed={Boolean(state.focus) && state.focus !== element.id}
        />
      ))}
    </div>
  );
}

function Region({
  element,
  state,
  layout,
  className,
}: {
  element?: SlideElement;
  state: SlideState;
  layout: SlideScene["layout"];
  className?: string;
}) {
  if (!element) return null;
  return (
    <div className={cn("min-h-0 min-w-0", className)}>
      <SlideElementView
        element={element}
        layout={layout}
        visible={state.visible.has(element.id)}
        focused={state.focus === element.id}
        dimmed={Boolean(state.focus) && state.focus !== element.id}
      />
    </div>
  );
}

/** Reserved-region slide renderer. No generated content can overlap another region. */
export const SlideRenderer = memo(function SlideRenderer({
  scene,
  state,
}: {
  scene: SlideScene;
  state: SlideState;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const plan = useMemo(() => arrangeSlide(scene), [scene]);
  const hasMath = Boolean(plan.math);
  const hasFigure = Boolean(plan.figure);
  const hasFoot = Boolean(plan.callout);

  const elementIds = useMemo(() => scene.elements.map((element) => element.id), [scene.elements]);
  const { rects, viewport } = useElementGeometry(stageRef, scene.id, elementIds);

  // A single hand-drawn mark, not a moving/zooming camera. Its measured box
  // belongs to FitBox's rendered content rather than the full layout region.
  const focusBox = state.focus && state.visible.has(state.focus)
    ? rects.get(state.focus) ?? null
    : null;
  const laserBox = state.laser && state.visible.has(state.laser)
    ? rects.get(state.laser) ?? null
    : null;

  let gridStyle: CSSProperties;
  let body: ReactNode;

  if (plan.layout === "title") {
    gridStyle = {
      display: "grid",
      // FitBox content is absolutely positioned. Auto-sized grid rows would
      // collapse to zero and overlay the next region, so every track is bounded.
      gridTemplateRows: hasFoot
        ? "minmax(0, 1.05fr) minmax(0, 0.85fr) minmax(0, 0.43fr)"
        : "minmax(0, 1.1fr) minmax(0, 0.85fr)",
      gap: "2.2cqw",
    };
    body = (
      <>
        <Region element={plan.heading} state={state} layout={scene.layout} />
        <ElementStack elements={plan.primary} state={state} layout={scene.layout} />
        <Region element={plan.callout} state={state} layout={scene.layout} />
      </>
    );
  } else if (plan.layout === "equation") {
    gridStyle = {
      display: "grid",
      gridTemplateRows: [
        "minmax(0, 0.38fr)",
        ...(hasMath ? ["minmax(0, 1.15fr)"] : []),
        ...(plan.primary.length ? ["minmax(0, 0.8fr)"] : []),
        ...(hasFoot ? ["minmax(0, 0.32fr)"] : []),
      ].join(" "),
      gap: "1.65cqw",
    };
    body = (
      <>
        <Region element={plan.heading} state={state} layout={scene.layout} />
        <Region element={plan.math} state={state} layout={scene.layout} />
        <ElementStack elements={plan.primary} state={state} layout={scene.layout} />
        <Region element={plan.callout} state={state} layout={scene.layout} />
      </>
    );
  } else if (plan.layout === "split") {
    const rightCount = (hasFigure ? 1 : 0) + (hasMath ? 1 : 0);
    const right = hasFigure || hasMath ? (
      <div
        className="grid h-full min-h-0 gap-[1.6cqw]"
        style={{ gridTemplateRows: `repeat(${Math.max(1, rightCount)}, minmax(0, 1fr))` }}
      >
        <Region element={plan.figure} state={state} layout={scene.layout} />
        <Region element={plan.math} state={state} layout={scene.layout} />
      </div>
    ) : (
      <ElementStack elements={plan.secondary} state={state} layout={scene.layout} />
    );
    gridStyle = {
      display: "grid",
      gridTemplateRows: hasFoot
        ? "minmax(0, 0.38fr) minmax(0, 1.45fr) minmax(0, 0.32fr)"
        : "minmax(0, 0.38fr) minmax(0, 1.55fr)",
      gap: "1.65cqw",
    };
    body = (
      <>
        <Region element={plan.heading} state={state} layout={scene.layout} />
        <div
          className="grid min-h-0 gap-[3cqw]"
          style={{ gridTemplateColumns: hasFigure || hasMath ? "5fr 7fr" : "1fr 1fr" }}
        >
          <ElementStack elements={plan.primary} state={state} layout={scene.layout} />
          <div className="min-h-0">{right}</div>
        </div>
        <Region element={plan.callout} state={state} layout={scene.layout} />
      </>
    );
  } else {
    gridStyle = {
      display: "grid",
      gridTemplateRows: hasFoot
        ? "minmax(0, 0.38fr) minmax(0, 1.45fr) minmax(0, 0.32fr)"
        : "minmax(0, 0.38fr) minmax(0, 1.55fr)",
      gap: "1.65cqw",
    };
    body = (
      <>
        <Region element={plan.heading} state={state} layout={scene.layout} />
        <ElementStack elements={plan.primary} state={state} layout={scene.layout} />
        <Region element={plan.callout} state={state} layout={scene.layout} />
      </>
    );
  }

  return (
    <>
    <MobileSlide scene={scene} state={state} />
    <div
      ref={stageRef}
      className="stage-scaler relative hidden w-full overflow-hidden border border-rule bg-stage md:block"
      style={{ aspectRatio: "16 / 9" }}
    >
      <div
        className="absolute inset-0 overflow-hidden px-[5.5cqw] py-[4cqw]"
        style={{ color: "var(--ink)", ...gridStyle }}
      >
        {body}
      </div>
      {focusBox && viewport.w > 0 ? (
        <svg
          viewBox={`0 0 ${viewport.w} ${viewport.h}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <FocusOutline
            key={`${scene.id}-${state.focus}`}
            box={focusBox}
            viewport={viewport}
          />
        </svg>
      ) : null}
      {laserBox ? (
        <span
          aria-hidden="true"
          data-laser-pointer
          className="pointer-events-none absolute z-20 h-2 w-2 rounded-full bg-accent"
          style={{
            left: `${Math.max(5, laserBox.x + Math.min(12, laserBox.w * 0.08))}px`,
            top: `${Math.max(5, laserBox.y + laserBox.h / 2)}px`,
            transform: "translate(-50%, -50%)",
          }}
        />
      ) : null}
    </div>
    </>
  );
});

function renderElement(layout: SlideScene["layout"], element: SlideElement, focused: boolean) {
  switch (element.type) {
    case "heading":
      return (
        <h2
          className="type-h1 max-w-[30ch] text-ink"
          style={{ fontSize: layout === "title" ? "5.2cqw" : "4cqw", lineHeight: 1.12 }}
        >
          <RichText text={element.text} as="span" />
        </h2>
      );
    case "paragraph":
      return (
        <RichText
          text={element.text}
          className="type-body-lg measure max-w-[62ch] text-ink-soft"
          style={{ fontSize: "2.2cqw", lineHeight: 1.45 }}
        />
      );
    case "bullets":
      return (
        <ul className="space-y-[1.2cqw]">
          {element.items.map((item, index) => (
            <li
              key={index}
              className="flex items-baseline gap-[1.4cqw]"
              style={{ fontSize: "2.05cqw", lineHeight: 1.4 }}
            >
              <span className="type-num shrink-0 text-accent" style={{ fontSize: "1.5cqw" }}>
                {String(index + 1).padStart(2, "0")}
              </span>
              <RichText text={item} className="measure max-w-[58ch] text-ink" as="span" />
            </li>
          ))}
        </ul>
      );
    case "equation":
      return (
        <div
          className={cn(
            "border-l-2 py-[0.6cqw] pl-[2.2cqw]",
            focused ? "border-accent" : "border-rule-strong",
          )}
        >
          <div style={{ fontSize: layout === "equation_focus" ? "3cqw" : "2.5cqw" }}>
            <Latex latex={element.latex} display={element.display} />
          </div>
          {element.caption ? (
            <p className="type-label mt-[0.8cqw] text-muted" style={{ fontSize: "1.3cqw" }}>
              {element.caption}
            </p>
          ) : null}
        </div>
      );
    case "figure":
      return <Figure spec={element.spec} caption={element.caption} />;
    case "callout":
      return (
        <RichText
          text={element.text}
          className="type-body measure max-w-[68ch] border-t border-rule pt-[1.4cqw] text-muted"
          style={{ fontSize: "1.85cqw", lineHeight: 1.4 }}
        />
      );
    case "code":
      return (
        <pre
          className="type-mono overflow-x-auto border border-rule bg-surface p-[1.6cqw]"
          style={{ fontSize: "1.55cqw" }}
        >
          <code>{element.code}</code>
        </pre>
      );
    default:
      return null;
  }
}
