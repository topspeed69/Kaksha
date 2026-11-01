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

function Diagram({ spec, caption }: { spec: DiagramSpec; caption?: string }) {
  return (
    <figure className="w-full">
      <svg viewBox="0 0 100 100" className="w-full" role="img" aria-label={caption ?? "Diagram"}>
        {spec.edges.map((edge) => {
          const from = spec.nodes.find((n) => n.id === edge.from);
          const to = spec.nodes.find((n) => n.id === edge.to);
          if (!from || !to) return null;
          const fw = from.w ?? 26;
          const fh = from.h ?? 14;
          const tw = to.w ?? 26;
          const th = to.h ?? 14;
          const vertical = Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
          const x1 = vertical ? from.x + fw / 2 : from.x + fw;
          const y1 = vertical ? from.y + fh : from.y + fh / 2;
          const x2 = vertical ? to.x + tw / 2 : to.x;
          const y2 = vertical ? to.y : to.y + th / 2;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;
          return (
            <g key={`${edge.from}-${edge.to}`}>
              <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={edge.dashed ? "var(--rule-strong)" : "var(--ink)"}
                strokeWidth={0.55}
                strokeDasharray={edge.dashed ? "2 2" : undefined}
              />
              {edge.label ? (
                <text x={midX} y={midY - 1.5} fontSize={3} fill="var(--muted)" textAnchor="middle">
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {spec.nodes.map((node) => {
          const w = node.w ?? 26;
          const h = node.h ?? 14;
          return (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={w}
                height={h}
                fill="var(--stage)"
                stroke={node.dashed ? "var(--rule-strong)" : "var(--ink)"}
                strokeWidth={0.6}
                strokeDasharray={node.dashed ? "2 2" : undefined}
              />
              <text
                x={node.x + w / 2}
                y={node.y + h / 2 + 1.2}
                fontSize={Math.min(3.1, Math.max(1.6, (w - 2) / Math.max(1, node.label.length * 0.62)))}
                fill="var(--ink)"
                textAnchor="middle"
              >
                <title>{node.label}</title>
                {node.label.length > Math.floor((w - 2) / 1.55)
                  ? `${node.label.slice(0, Math.max(3, Math.floor((w - 2) / 1.55) - 1))}…`
                  : node.label}
              </text>
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
