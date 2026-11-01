"use client";

import { memo, useMemo } from "react";
import type { WhiteboardScene } from "@/lib/dsl/types";
import { safeEvaluate } from "@/lib/dsl/validate";
import type { DrawAction, WhiteboardState } from "@/lib/player/computeSceneState";
import { getPreparedScene } from "@/lib/player/computeSceneState";
import { FocusOutline } from "@/components/focus/FocusOutline";
import { Latex } from "@/components/ui/Latex";
import { FitBox } from "@/components/slides/FitBox";


const FONT_SIZE = { sm: 22, md: 32, lg: 44 } as const;
const PLOT_PATH_CACHE_MAX = 256;
const plotPathCache = new Map<string, string>();

function plotPath(action: Extract<DrawAction, { op: "wb.plot" }>): string {
  const [x0, x1] = action.domain[0] < action.domain[1] ? action.domain : [-5, 5];
  const key = `${action.expr}|${x0}|${x1}`;
  const cached = plotPathCache.get(key);
  if (cached !== undefined) return cached;
  const samples = 140;
  const values: { x: number; y: number }[] = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let index = 0; index <= samples; index += 1) {
    const x = x0 + ((x1 - x0) * index) / samples;
    const y = safeEvaluate(action.expr, x);
    if (y === null) continue;
    values.push({ x, y });
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }
  let result = "";
  if (values.length) {
    if (yMax - yMin < 1e-6) {
      yMin -= 1;
      yMax += 1;
    }
    const parts: string[] = [];
    values.forEach(({ x, y }, index) => {
      const px = ((x - x0) / (x1 - x0)) * 100;
      const py = 100 - ((y - yMin) / (yMax - yMin)) * 100;
      parts.push(`${index === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`);
    });
    result = parts.join(" ");
  }
  if (plotPathCache.size >= PLOT_PATH_CACHE_MAX) {
    const oldest = plotPathCache.keys().next().value;
    if (oldest !== undefined) plotPathCache.delete(oldest);
  }
  plotPathCache.set(key, result);
  return result;
}

function arrowPoints(x1: number, y1: number, x2: number, y2: number, progress: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const tipX = x1 + (x2 - x1) * progress;
  const tipY = y1 + (y2 - y1) * progress;
  const baseX = tipX - 16 * Math.cos(angle);
  const baseY = tipY - 16 * Math.sin(angle);
  const px = -Math.sin(angle) * 7;
  const py = Math.cos(angle) * 7;
  return `${tipX.toFixed(1)},${tipY.toFixed(1)} ${(baseX + px).toFixed(1)},${(baseY + py).toFixed(1)} ${(baseX - px).toFixed(1)},${(baseY - py).toFixed(1)}`;
}

const WhiteboardItemView = memo(function WhiteboardItemView({
  action,
  progress,
  highlighted,
  canvasWidth,
  axes,
}: {
  action: DrawAction;
  progress: number;
  highlighted: boolean;
  canvasWidth: number;
  axes?: Extract<DrawAction, { op: "wb.axes" }>;
}) {
  const colour = highlighted ? "var(--accent)" : "var(--ink)";
  switch (action.op) {
    case "wb.text":
      return (
        <text
          x={action.x}
          y={action.y + FONT_SIZE[action.size ?? "md"] * 0.8}
          fontSize={FONT_SIZE[action.size ?? "md"]}
          fill={colour}
          opacity={progress}
          fontFamily="var(--font-display)"
        >
          {action.text}
        </text>
      );
    case "wb.latex":
      return (
        <foreignObject
          x={action.x}
          y={action.y}
          width={Math.max(24, canvasWidth - action.x - 24)}
          height={FONT_SIZE[action.size ?? "md"] * 1.85}
          style={{ opacity: progress, overflow: "hidden" }}
        >
          <div style={{
            width: "100%",
            height: "100%",
            color: colour,
            fontSize: FONT_SIZE[action.size ?? "md"],
            lineHeight: 1.2,
          }}>
            <FitBox mode="contain">
              <Latex latex={action.latex} />
            </FitBox>
          </div>
        </foreignObject>
      );
    case "wb.line": {
      const [x1, y1] = action.from;
      const [x2, y2] = action.to;
      const length = Math.hypot(x2 - x1, y2 - y1) || 1;
      return (
        <g>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={colour}
            strokeWidth={2}
            strokeDasharray={action.dashed ? "10 8" : `${length} ${length}`}
            strokeDashoffset={action.dashed ? undefined : length * (1 - progress)}
          />
          {action.arrow && progress > 0.05 ? (
            <polygon points={arrowPoints(x1, y1, x2, y2, progress)} fill={colour} opacity={progress} />
          ) : null}
        </g>
      );
    }
    case "wb.rect":
      return (
        <g>
          <rect
            x={action.x}
            y={action.y}
            width={action.w}
            height={action.h}
            fill="none"
            stroke={colour}
            strokeWidth={2}
            pathLength={action.dashed ? undefined : 1}
            strokeDasharray={action.dashed ? "12 8" : 1}
            strokeDashoffset={action.dashed ? undefined : 1 - progress}
            style={action.dashed ? { opacity: progress } : undefined}
          />
          {action.label ? (
            <text
              x={action.x + action.w / 2}
              y={action.y + action.h / 2 + 8}
              textAnchor="middle"
              fontSize={22}
              fill={colour}
              opacity={progress}
            >
              {action.label}
            </text>
          ) : null}
        </g>
      );
    case "wb.circle":
      return (
        <g>
          <circle
            cx={action.cx}
            cy={action.cy}
            r={action.r}
            fill="none"
            stroke={colour}
            strokeWidth={2}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - progress}
          />
          {action.label ? (
            <text
              x={action.cx}
              y={action.cy + action.r + 30}
              textAnchor="middle"
              fontSize={22}
              fill={colour}
              opacity={progress}
            >
              {action.label}
            </text>
          ) : null}
        </g>
      );
    case "wb.axes": {
      const d = `M${action.x},${action.y + action.h} L${action.x},${action.y} M${action.x},${action.y + action.h} L${action.x + action.w},${action.y + action.h}`;
      return (
        <g>
          <path
            d={d}
            fill="none"
            stroke="var(--rule-strong)"
            strokeWidth={2}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - progress}
          />
          {action.x_label ? (
            <text x={action.x + action.w} y={action.y + action.h + 28} textAnchor="end" fontSize={20} fill="var(--muted)">
              {action.x_label}
            </text>
          ) : null}
          {action.y_label ? (
            <text x={action.x + 10} y={action.y - 10} fontSize={20} fill="var(--muted)">
              {action.y_label}
            </text>
          ) : null}
        </g>
      );
    }
    case "wb.plot": {
      const d = plotPath(action);
      if (!d) return null;
      return (
        <g
          transform={
            axes
              ? `translate(${axes.x}, ${axes.y}) scale(${axes.w / 100}, ${axes.h / 100})`
              : undefined
          }
        >
          <path
            d={d}
            fill="none"
            stroke={action.color === "accent" || highlighted ? "var(--accent)" : "var(--ink)"}
            strokeWidth={4}
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - progress}
          />
        </g>
      );
    }
    default:
      return null;
  }
});

export const Whiteboard = memo(function Whiteboard({
  scene,
  state,
}: {
  scene: WhiteboardScene;
  state: WhiteboardState;
}) {
  const axesById = useMemo(() => {
    const map = new Map<string, Extract<DrawAction, { op: "wb.axes" }>>();
    for (const item of state.items) {
      if (item.action.op === "wb.axes") map.set(item.action.id, item.action);
    }
    return map;
  }, [state.items]);

  const highlightBox = useMemo(() => {
    if (!state.highlight || state.erased.has(state.highlight)) return null;
    const drawn = state.items.some((item) => item.action.id === state.highlight);
    return drawn ? getPreparedScene(scene).objectBoxes.get(state.highlight) ?? null : null;
  }, [scene, state.highlight, state.items, state.erased]);

  return (
    <div
      className="whiteboard-stage relative w-full overflow-hidden border border-rule bg-stage"
      style={{ aspectRatio: "16 / 9" }}
    >
      <svg
        viewBox={`0 0 ${scene.canvas.w} ${scene.canvas.h}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={`Whiteboard: ${scene.title}`}
      >
        {state.items.map((item) =>
          state.erased.has(item.action.id) ? null : (
            <WhiteboardItemView
              key={item.action.id}
              action={item.action}
              progress={item.progress}
              highlighted={state.highlight === item.action.id}
              canvasWidth={scene.canvas.w}
              axes={item.action.op === "wb.plot" ? axesById.get(item.action.axes) : undefined}
            />
          ),
        )}
        {highlightBox ? (
          <FocusOutline
            key={`${scene.id}-${state.highlight}`}
            box={highlightBox}
            viewport={scene.canvas}
            coordinateSpace="canvas"
          />
        ) : null}
      </svg>
    </div>
  );
});
