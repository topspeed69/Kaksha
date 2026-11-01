"use client";

import { memo, type CSSProperties } from "react";
import { renderLatex, tokenizeMathText, type MathSegment } from "@/lib/katex";
import { cn } from "@/components/ui";

/** Typeset a single latex string. Memoized; KaTeX output is cached by content. */
export const Latex = memo(function Latex({
  latex,
  display = false,
  className,
}: {
  latex: string;
  display?: boolean;
  className?: string;
}) {
  const { html, error } = renderLatex(latex, display);
  if (!html) {
    return (
      <span
        className={cn("type-body-sm border border-rule bg-surface px-2 py-1 text-muted", className)}
        title={error ?? undefined}
      >
        This formula could not be displayed
      </span>
    );
  }
  return (
    <span
      className={cn(display ? "block my-1" : "inline", className)}
      // KaTeX output with trust disabled and macros empty is the only injected
      // HTML in the app; everything else is rendered as React nodes.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export function parseInlineMath(input: string): MathSegment[] {
  return tokenizeMathText(input).segments;
}

export const RichText = memo(function RichText({
  text,
  className,
  style,
  as = "p",
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
  as?: "p" | "span" | "div";
}) {
  const parts = parseInlineMath(text);
  const Tag = as;
  return (
    <Tag className={className} style={style}>
      {parts.map((part, index) =>
        part.kind === "math" ? (
          <Latex key={index} latex={part.value} display={part.display} />
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </Tag>
  );
});
