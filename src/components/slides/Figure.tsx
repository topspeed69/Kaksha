"use client";

import { memo, useMemo } from "react";
import type { DiagramSpec, PlotSpec } from "@/lib/dsl/types";
import { safeEvaluate } from "@/lib/dsl/validate";

const W = 100;
const H = 62;
const PAD = 9;

function Plot({ spec, caption }: { spec: PlotSpec; caption?: string }) {
  const [x0, x1] = spec.domain[0] < spec.domain[1] ? spec.domain : [-5, 5];

  const { paths, yZero } = useMemo(() => {
    const samples = 140;

    const sampledSeries = spec.series.map((series) => {
      const values: { x: number; y: number }[] = [];
      for (let i = 0; i <= samples; i += 1) {
        const x = x0 + ((x1 - x0) * i) / samples;
        const y = safeEvaluate(series.expr, x);
        if (y === null) continue;
        values.push({ x, y });
      }
      return { series, values };
    });

    let globalYMin = Infinity;
    let globalYMax = -Infinity;
    for (const item of sampledSeries) {
      for (const pt of item.values) {
        if (pt.y < globalYMin) globalYMin = pt.y;
        if (pt.y > globalYMax) globalYMax = pt.y;
      }
    }

    if (!Number.isFinite(globalYMin) || !Number.isFinite(globalYMax)) {
      globalYMin = 0;
      globalYMax = 1;
    }
    if (globalYMax - globalYMin < 1e-6) {
      globalYMin -= 1;
      globalYMax += 1;
    } else {
      const margin = (globalYMax - globalYMin) * 0.06;
      globalYMin -= margin;
      globalYMax += margin;
    }

    const builtPaths = sampledSeries.map(({ series, values }) => {
      const parts: string[] = [];
      let started = false;
      for (const { x, y } of values) {
        const px = PAD + ((x - x0) / (x1 - x0)) * (W - PAD * 2);
        const py = H - PAD - ((y - globalYMin) / (globalYMax - globalYMin)) * (H - PAD * 2);
        parts.push(`${started ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`);
        started = true;
      }
      return { series, path: parts.join(" ") };
    });

    const zeroPy =
      globalYMin <= 0 && globalYMax >= 0
        ? H - PAD - ((0 - globalYMin) / (globalYMax - globalYMin)) * (H - PAD * 2)
        : null;

    return { paths: builtPaths, yZero: zeroPy };
  }, [spec.series, x0, x1]);

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={caption ?? `${spec.y_label} versus ${spec.x_label}`}
      >
        <rect
          x={PAD}
          y={PAD}
          width={W - PAD * 2}
          height={H - PAD * 2}
          fill="none"
          stroke="var(--rule-strong)"
          strokeWidth={0.4}
        />
        {yZero !== null ? (
          <line
            x1={PAD}
            y1={yZero}
            x2={W - PAD}
            y2={yZero}
            stroke="var(--rule)"
            strokeWidth={0.3}
          />
        ) : null}
        {paths.map(({ series, path }) => (
          <path
            key={series.label}
            d={path}
            fill="none"
            stroke={series.color === "accent" ? "var(--accent)" : "var(--ink)"}
            strokeWidth={0.75}
            strokeDasharray={series.color === "accent" ? undefined : "2 1.5"}
          />
        ))}
        {(spec.annotations ?? []).map((annotation) => {
          const clampedX = Math.max(x0, Math.min(x1, annotation.x));
          const px = PAD + ((clampedX - x0) / (x1 - x0)) * (W - PAD * 2);
          return (
            <g key={`${annotation.x}-${annotation.text}`}>
              <line
                x1={px}
                y1={PAD}
                x2={px}
                y2={H - PAD}
                stroke="var(--accent)"
                strokeWidth={0.3}
                strokeDasharray="1 1"
              />
              <circle cx={px} cy={PAD} r={0.9} fill="var(--accent)" />
            </g>
          );
        })}
        <text x={W - PAD} y={H - 2.2} fontSize={3} fill="var(--muted)" textAnchor="end">
          {spec.x_label}
        </text>
        <text x={PAD} y={PAD - 2.2} fontSize={3} fill="var(--muted)">
          {spec.y_label}
        </text>
      </svg>
      {(spec.annotations ?? []).length ? (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
          {(spec.annotations ?? []).map((annotation) => (
            <li key={`${annotation.x}-${annotation.text}`} className="type-label-sm text-muted">
              <span className="text-accent">x = {annotation.x}</span> {annotation.text}
            </li>
          ))}
        </ul>
      ) : null}
      <figcaption className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2 border-t border-rule pt-1.5">
        <span className="type-label-sm text-muted">{caption ?? "Figure"}</span>
        <span className="type-label text-muted">
          {spec.series.map((s) => s.label).join(" · ")}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Break a label into at most two balanced lines so a diagram reads like a
 * labelled figure instead of a row of truncated words.
 */
function wrapLabel(label: string, maxChars: number): string[] {
  const clean = label.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return [clean];
  const words = clean.split(" ");
  if (words.length === 1) return [clean];
  let best = 1;
  let bestDelta = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const first = words.slice(0, i).join(" ").length;
    const second = words.slice(i).join(" ").length;
    const delta = Math.abs(first - second);
    if (Math.max(first, second) <= maxChars && delta < bestDelta) {
      best = i;
      bestDelta = delta;
    }
  }
  const first = words.slice(0, best).join(" ");
  const second = words.slice(best).join(" ");
  return [first, second.length > maxChars + 4 ? `${second.slice(0, maxChars - 1)}…` : second];
}

/**
 * The model draws on a 0-100 canvas but usually uses a thin band of it. Showing
 * the whole canvas leaves a slide that is mostly blank with a tiny diagram, so
 * the view is cropped to the drawing itself.
 */
function diagramViewBox(spec: DiagramSpec): { x: number; y: number; w: number; h: number } {
  if (!spec.nodes.length) return { x: 0, y: 0, w: 100, h: 100 };
  const hasLabels = spec.edges.some((edge) => edge.label);
  const left = Math.min(...spec.nodes.map((n) => n.x));
  const right = Math.max(...spec.nodes.map((n) => n.x + (n.w ?? 26)));
  const top = Math.min(...spec.nodes.map((n) => n.y));
  const bottom = Math.max(...spec.nodes.map((n) => n.y + (n.h ?? 14)));
  const pad = 4;
  let x = left - pad;
  let w = right - left + pad * 2;
  let y = top - pad - (hasLabels ? 4 : 0);
  let h = bottom - top + pad * 2 + (hasLabels ? 4 : 0);
  // Never zoom a two-box sketch into giant type, and never make a hairline strip.
  const minW = 56;
  if (w < minW) {
    x -= (minW - w) / 2;
    w = minW;
  }
  const minH = Math.min(100, Math.max(h, w * 0.34));
  y -= (minH - h) / 2;
  h = minH;
  x = Math.max(0, Math.min(x, 100 - w));
  y = Math.max(0, Math.min(y, 100 - h));
  w = Math.min(w, 100);
  h = Math.min(h, 100);
  return { x, y, w, h };
}

function Diagram({ spec, caption }: { spec: DiagramSpec; caption?: string }) {
  const byId = new Map(spec.nodes.map((node) => [node.id, node] as const));
  const box = diagramViewBox(spec);
  return (
    <figure className="w-full">
      <svg
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        className="w-full"
        role="img"
        aria-label={caption ?? "Diagram"}
      >
        <defs>
          <marker
            id="diagram-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--ink)" />
          </marker>
          <marker
            id="diagram-arrow-muted"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--rule-strong)" />
          </marker>
        </defs>
        {spec.edges.map((edge, edgeIndex) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          const fw = from.w ?? 26;
          const fh = from.h ?? 14;
          const tw = to.w ?? 26;
          const th = to.h ?? 14;
          const vertical = Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
          const forward = vertical ? to.y >= from.y : to.x >= from.x;
          const x1 = vertical ? from.x + fw / 2 : forward ? from.x + fw : from.x;
          const y1 = vertical ? (forward ? from.y + fh : from.y) : from.y + fh / 2;
          const x2 = vertical ? to.x + tw / 2 : forward ? to.x : to.x + tw;
          const y2 = vertical ? (forward ? to.y : to.y + th) : to.y + th / 2;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          const labelText = edge.label
            ? edge.label.length > 24
              ? `${edge.label.slice(0, 23)}…`
              : edge.label
            : "";
          const labelWidth = labelText ? labelText.length * 1.45 + 2 : 0;
          // Labels sit above the node row (or beside a vertical edge) so they
          // never collide with the boxes they connect.
          const labelX = vertical ? midX + 1.5 + labelWidth / 2 : midX;
          const labelY = vertical ? midY + 0.8 : Math.min(from.y, to.y) - 1.8;
          return (
            <g key={`${edge.from}-${edge.to}-${edgeIndex}`}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={edge.dashed ? "var(--rule-strong)" : "var(--ink)"}
                strokeWidth={0.5}
                strokeDasharray={edge.dashed ? "2 2" : undefined}
                markerEnd={
                  edge.style === "line"
                    ? undefined
                    : `url(#${edge.dashed ? "diagram-arrow-muted" : "diagram-arrow"})`
                }
              />
              {labelText ? (
                <>
                  <rect
                    x={labelX - labelWidth / 2}
                    y={labelY - 2.6}
                    width={labelWidth}
                    height={3.4}
                    fill="var(--stage)"
                  />
                  <text
                    x={labelX}
                    y={labelY}
                    fontSize={2.6}
                    fill="var(--muted)"
                    textAnchor="middle"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {labelText}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
        {spec.nodes.map((node) => {
          const w = node.w ?? 26;
          const h = node.h ?? 14;
          const cx = node.x + w / 2;
          const cy = node.y + h / 2;
          const stroke = node.accent ? "var(--accent)" : node.dashed ? "var(--rule-strong)" : "var(--ink)";
          const lines = wrapLabel(node.label, Math.max(8, Math.floor(w / 1.28)));
          const fontSize = Math.min(3.05, Math.max(1.55, (w - 2) / Math.max(1, lines[0].length * 0.63)));
          const lineGap = fontSize * 1.25;
          const showSub = Boolean(node.sub);
          const blockHeight = lines.length * lineGap + (showSub ? 2.4 : 0);
          const startY = cy - blockHeight / 2 + fontSize * 0.9;
          return (
            <g key={node.id}>
              <title>{`${node.label}${node.sub ? ` — ${node.sub}` : ""}`}</title>
              {node.shape === "circle" ? (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={Math.min(w, h) / 2}
                  ry={Math.min(w, h) / 2}
                  fill="var(--stage)"
                  stroke={stroke}
                  strokeWidth={0.55}
                  strokeDasharray={node.dashed ? "2 2" : undefined}
                />
              ) : node.shape === "diamond" ? (
                <polygon
                  points={`${cx},${node.y} ${node.x + w},${cy} ${cx},${node.y + h} ${node.x},${cy}`}
                  fill="var(--stage)"
                  stroke={stroke}
                  strokeWidth={0.55}
                  strokeDasharray={node.dashed ? "2 2" : undefined}
                />
              ) : (
                <rect
                  x={node.x}
                  y={node.y}
                  width={w}
                  height={h}
                  rx={node.shape === "pill" ? h / 2 : 0.8}
                  fill={node.accent ? "color-mix(in srgb, var(--accent) 6%, var(--stage))" : "var(--stage)"}
                  stroke={stroke}
                  strokeWidth={node.accent ? 0.8 : 0.55}
                  strokeDasharray={node.dashed ? "2 2" : undefined}
                />
              )}
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={cx}
                  y={startY + i * lineGap}
                  fontSize={fontSize}
                  fill="var(--ink)"
                  textAnchor="middle"
                  style={{ fontFamily: "var(--font-display)", fontWeight: 500 }}
                >
                  {line}
                </text>
              ))}
              {showSub ? (
                <text
                  x={cx}
                  y={startY + lines.length * lineGap + 0.6}
                  fontSize={Math.max(1.5, fontSize * 0.7)}
                  fill="var(--muted)"
                  textAnchor="middle"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {node.sub}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {caption ? (
        <figcaption className="type-label-sm mt-1.5 border-t border-rule pt-1.5 text-muted">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export const Figure = memo(function Figure({
  spec,
  caption,
}: {
  spec: PlotSpec | DiagramSpec;
  caption?: string;
}) {
  return spec.kind === "plot" ? (
    <Plot spec={spec} caption={caption} />
  ) : (
    <Diagram spec={spec} caption={caption} />
  );
});
