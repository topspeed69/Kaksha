import katex from "katex";

export type LatexRenderResult = { html: string | null; error: string | null };

const KATEX_CACHE_MAX = 512;
const MAX_LATEX_LENGTH = 4000;
const katexCache = new Map<string, LatexRenderResult>();

/** Render LaTeX with `trust: false`, no custom macros, bounded expansion, and LRU memoization. */
export function renderLatex(latex: string, display: boolean): LatexRenderResult {
  if (typeof latex !== "string" || !latex.trim()) {
    return { html: null, error: "Formula is empty" };
  }
  if (latex.length > MAX_LATEX_LENGTH) {
    return { html: null, error: "Formula exceeds maximum length" };
  }
  const cacheKey = `${display ? "D" : "I"}:${latex}`;
  const cached = katexCache.get(cacheKey);
  if (cached) {
    katexCache.delete(cacheKey);
    katexCache.set(cacheKey, cached);
    return cached;
  }
  let result: LatexRenderResult;
  try {
    const html = katex.renderToString(latex, {
      displayMode: display,
      trust: false,
      strict: "ignore",
      throwOnError: true,
      macros: {},
      maxSize: 500,
      maxExpand: 100,
    });
    result = { html, error: null };
  } catch (error) {
    result = { html: null, error: (error as Error).message };
  }
  if (katexCache.size >= KATEX_CACHE_MAX) {
    const oldest = katexCache.keys().next().value;
    if (oldest !== undefined) katexCache.delete(oldest);
  }
  katexCache.set(cacheKey, result);
  return result;
}

export type MathSegment =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string; display: boolean };

/**
 * Split prose containing `$$display$$` and `$inline$` math into typed segments.
 * Escaped `\$` and unmatched trailing `$` are preserved as literal text.
 */
export function tokenizeMathText(
  input: string,
): { segments: MathSegment[]; unclosed: boolean } {
  const segments: MathSegment[] = [];
  let textBuf = "";
  let i = 0;
  let unclosed = false;

  const flushText = () => {
    if (textBuf) {
      segments.push({ kind: "text", value: textBuf });
      textBuf = "";
    }
  };

  while (i < input.length) {
    if (input[i] === "\\" && input[i + 1] === "$") {
      textBuf += "$";
      i += 2;
      continue;
    }
    if (input[i] === "$" && input[i + 1] === "$") {
      const end = input.indexOf("$$", i + 2);
      if (end === -1) {
        unclosed = true;
        textBuf += input.slice(i);
        break;
      }
      const formula = input.slice(i + 2, end).trim();
      flushText();
      if (formula) {
        segments.push({ kind: "math", value: formula, display: true });
      }
      i = end + 2;
      continue;
    }
    if (input[i] === "$") {
      let end = -1;
      for (let j = i + 1; j < input.length; j += 1) {
        if (input[j] === "\\" && input[j + 1] === "$") {
          j += 1;
          continue;
        }
        if (input[j] === "$") {
          end = j;
          break;
        }
      }
      if (end === -1) {
        unclosed = true;
        textBuf += input.slice(i);
        break;
      }
      const formula = input.slice(i + 1, end).trim();
      if (formula) {
        flushText();
        segments.push({ kind: "math", value: formula, display: false });
      } else {
        textBuf += "$$";
      }
      i = end + 1;
      continue;
    }
    textBuf += input[i];
    i += 1;
  }

  flushText();
  return { segments, unclosed };
}

/** Extract and validate every math block in a student answer for live KaTeX previewing. */
export function inspectAnswerMath(input: string): {
  formulas: { latex: string; display: boolean; html: string | null; error: string | null }[];
  firstError: string | null;
} {
  const { segments, unclosed } = tokenizeMathText(input);
  const formulas = segments
    .filter((s): s is Extract<MathSegment, { kind: "math" }> => s.kind === "math")
    .map((s) => {
      const rendered = renderLatex(s.value, s.display);
      return {
        latex: s.value,
        display: s.display,
        html: rendered.html,
        error: rendered.error,
      };
    });
  const parseErr = formulas.find((f) => f.error)?.error ?? null;
  const firstError = parseErr ?? (unclosed ? "Unclosed $ math delimiter" : null);
  return { formulas, firstError };
}
