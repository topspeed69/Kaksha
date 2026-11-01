import { parse, type EvalFunction, type MathNode } from "mathjs";
import { renderLatex, tokenizeMathText } from "@/lib/katex";
import type {
  Action,
  Course,
  Module,
  Question,
  Scene,
  Segment,
  SlideScene,
  WhiteboardScene,
} from "./types";

export const NARRATION_WPM = 150;
export const MAX_SLIDE_WORDS = 40;
export const MAX_BULLETS = 5;
export const MAX_SEGMENT_CHARS = 320;

export type Issue = { path: string; message: string };

export class ValidationError extends Error {
  issues: Issue[];
  constructor(issues: Issue[]) {
    super(
      `Validation failed: ${issues
        .map((i) => `${i.path} ${i.message}`)
        .join("; ")}`,
    );
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/* ------------------------------ helpers ---------------------------------- */

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function stripLatex(text: string): string {
  return text
    .replace(/\$\$[^$]*\$\$/g, " ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ");
}

/** Narration duration derived from the text: 150 words per minute at 1.0×. */
export function estimateSegmentMs(text: string, speed = 1): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const words = Math.max(1, countWords(text));
  const ms = (words / NARRATION_WPM) * 60_000;
  const floorMs = 1200;
  return Math.max(floorMs, Math.round(ms / safeSpeed));
}

/** Words that are spoken aloud are not part of the on-slide budget. */
export function spoken(text: string): boolean {
  return !/[$\\]/.test(text);
}

const ALLOWED_VARS = new Set(["x", "pi", "e"]);
const ALLOWED_FUNCTIONS = new Set([
  "sin",
  "cos",
  "tan",
  "exp",
  "log",
  "sqrt",
  "abs",
  "sinh",
  "cosh",
  "tanh",
  "atan",
  "asin",
  "acos",
  "pow",
  "min",
  "max",
  "sign",
]);
const ALLOWED_NODE_TYPES = new Set([
  "ConstantNode",
  "SymbolNode",
  "OperatorNode",
  "ParenthesisNode",
  "FunctionNode",
]);
const ALLOWED_OPERATORS = new Set(["+", "-", "*", "/", "^"]);

/** Whitelisted plot expression check. Only `x`, `pi`, `e` and scalar math ops may appear. */
export function checkPlotExpression(expr: string): Issue[] {
  if (typeof expr !== "string" || !expr.trim()) {
    return [{ path: "expr", message: "is empty" }];
  }
  if (expr.length > 200) {
    return [{ path: "expr", message: "is longer than 200 characters" }];
  }
  let ast: MathNode;
  try {
    ast = parse(expr);
  } catch (error) {
    return [
      { path: "expr", message: `does not parse (${(error as Error).message})` },
    ];
  }

  const problems: string[] = [];
  let nodeCount = 0;

  const visit = (node: MathNode, isCallee = false) => {
    nodeCount += 1;
    if (nodeCount > 120) {
      problems.push("expression is too complex");
      return;
    }
    if (!ALLOWED_NODE_TYPES.has(node.type)) {
      problems.push(`disallowed syntax ${node.type}`);
      return;
    }
    if (node.type === "ConstantNode") {
      const val = (node as unknown as { value: unknown }).value;
      if (typeof val !== "number" && typeof val !== "bigint") {
        problems.push("only numeric constants are allowed");
      }
      return;
    }
    if (node.type === "SymbolNode") {
      const name = (node as unknown as { name?: string }).name ?? "";
      if (isCallee) {
        if (!ALLOWED_FUNCTIONS.has(name)) {
          problems.push(`function ${name} is not allowed`);
        }
      } else if (!ALLOWED_VARS.has(name)) {
        problems.push(`unknown symbol ${name}`);
      }
      return;
    }
    if (node.type === "OperatorNode") {
      const opNode = node as unknown as { op?: string; args?: MathNode[] };
      if (!opNode.op || !ALLOWED_OPERATORS.has(opNode.op)) {
        problems.push(`operator ${opNode.op ?? "unknown"} is not allowed`);
      }
      for (const arg of opNode.args ?? []) visit(arg, false);
      return;
    }
    if (node.type === "ParenthesisNode") {
      const content = (node as unknown as { content?: MathNode }).content;
      if (content) visit(content, false);
      return;
    }
    if (node.type === "FunctionNode") {
      const fnNode = node as unknown as { fn?: MathNode; args?: MathNode[] };
      if (!fnNode.fn || fnNode.fn.type !== "SymbolNode") {
        problems.push("indirect function calls are not allowed");
        return;
      }
      visit(fnNode.fn, true);
      for (const arg of fnNode.args ?? []) visit(arg, false);
    }
  };

  visit(ast, false);

  if (problems.length) {
    return [{ path: "expr", message: [...new Set(problems)].join(", ") }];
  }
  return [];
}

const COMPILED_CACHE_MAX = 256;
const compiledPlotCache = new Map<string, EvalFunction | null>();

function getCompiledPlot(expr: string): EvalFunction | null {
  if (compiledPlotCache.has(expr)) {
    const hit = compiledPlotCache.get(expr) ?? null;
    // Refresh LRU order
    compiledPlotCache.delete(expr);
    compiledPlotCache.set(expr, hit);
    return hit;
  }
  let compiled: EvalFunction | null = null;
  if (checkPlotExpression(expr).length === 0) {
    try {
      compiled = parse(expr).compile();
    } catch {
      compiled = null;
    }
  }
  if (compiledPlotCache.size >= COMPILED_CACHE_MAX) {
    const oldest = compiledPlotCache.keys().next().value;
    if (oldest !== undefined) compiledPlotCache.delete(oldest);
  }
  compiledPlotCache.set(expr, compiled);
  return compiled;
}

/** Sample a plot expression safely using a validated, cached compiled evaluator. */
export function safeEvaluate(expr: string, x: number): number | null {
  if (!Number.isFinite(x)) return null;
  const compiled = getCompiledPlot(expr);
  if (!compiled) return null;
  try {
    const value = compiled.evaluate({ x, pi: Math.PI, e: Math.E });
    if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e12) {
      return value;
    }
    if (value && typeof value === "object" && "re" in (value as object)) {
      const complex = value as { re: number; im: number };
      return Math.abs(complex.im) < 1e-9 && Number.isFinite(complex.re) ? complex.re : null;
    }
    return null;
  } catch {
    return null;
  }
}

/* ------------------------------ segments --------------------------------- */

export function validateSegment(
  segment: Segment,
  path: string,
  issues: Issue[],
): void {
  if (!segment.id) issues.push({ path: `${path}.id`, message: "is required" });
  if (!segment.text?.trim()) {
    issues.push({ path: `${path}.text`, message: "is required" });
  }
  if ((segment.text ?? "").length > MAX_SEGMENT_CHARS) {
    issues.push({
      path: `${path}.text`,
      message: `is ${segment.text.length} characters; keep segments under ${MAX_SEGMENT_CHARS}`,
    });
  }
  if (/[\\]|(\$[^$]*\$)/.test(segment.text ?? "")) {
    issues.push({
      path: `${path}.text`,
      message: "must be spoken prose (no LaTeX or markdown)",
    });
  }
  for (const [i, action] of (segment.actions ?? []).entries()) {
    if (!Number.isFinite(action.at) || action.at < 0 || action.at > 1) {
      issues.push({
        path: `${path}.actions[${i}].at`,
        message: "must be between 0 and 1",
      });
    }
  }
}

/* ------------------------------- slides ---------------------------------- */

const UNSAFE_MATH_COMMAND = /\\(?:href|url|html[A-Za-z]*|includegraphics|def|gdef|newcommand|catcode)\b/i;

/** KaTeX is strict, untrusted, and has bounded macro expansion in renderLatex. */
export function validateFormula(latex: string, path: string, issues: Issue[]): void {
  if (!latex?.trim()) {
    issues.push({ path, message: "formula is empty" });
    return;
  }
  if (UNSAFE_MATH_COMMAND.test(latex)) {
    issues.push({ path, message: "formula contains a disallowed rendering command" });
    return;
  }
  const result = renderLatex(latex, true);
  if (!result.html) {
    issues.push({ path, message: `KaTeX cannot render this formula: ${result.error?.slice(0, 160) ?? "invalid syntax"}` });
  }
}

function validateInlineMath(text: string, path: string, issues: Issue[]): void {
  const { segments, unclosed } = tokenizeMathText(text);
  if (unclosed) issues.push({ path, message: "contains an unclosed math delimiter" });
  for (const part of segments) {
    if (part.kind === "math") validateFormula(part.value, path, issues);
    // A LaTeX command in visible prose, without $...$, leaks raw markup.
    if (part.kind === "text" && /\\[A-Za-z]{2,}/.test(part.value)) {
      issues.push({ path, message: "contains raw LaTeX outside math delimiters" });
    }
  }
}

function validateFigure(
  element: Extract<SlideScene["elements"][number], { type: "figure" }>,
  path: string,
  issues: Issue[],
): void {
  const spec = element.spec;
  if (spec.kind === "plot") {
    if (!spec.domain || spec.domain.length !== 2 ||
        !spec.domain.every(Number.isFinite) || spec.domain[0] >= spec.domain[1]) {
      issues.push({ path, message: "plot needs a finite increasing domain" });
    }
    if (!spec.series?.length) {
      issues.push({ path, message: "plot needs at least one data series" });
    }
    for (const series of spec.series ?? []) {
      const failures = checkPlotExpression(series.expr);
      issues.push(...failures.map((failure) => ({ path, message: failure.message })));
      if (!failures.length && spec.domain?.length === 2 && spec.domain.every(Number.isFinite)) {
        const anyFinite = Array.from({ length: 17 }, (_, i) =>
          safeEvaluate(series.expr, spec.domain[0] + (spec.domain[1] - spec.domain[0]) * i / 16),
        ).some((value) => value !== null);
        if (!anyFinite) issues.push({ path, message: `plot series "${series.label}" has no finite values in its domain` });
      }
    }
    for (const annotation of spec.annotations ?? []) {
      if (!Number.isFinite(annotation.x) || !annotation.text?.trim()) {
        issues.push({ path, message: "plot annotation needs finite x and a label" });
      }
    }
  } else {
    if (!spec.nodes?.length) issues.push({ path, message: "diagram needs at least one node" });
    const ids = new Set<string>();
    for (const node of spec.nodes ?? []) {
      if (!node.id?.trim() || ids.has(node.id)) issues.push({ path, message: "diagram node IDs must be nonempty and unique" });
      ids.add(node.id);
      const w = node.w ?? 26;
      const h = node.h ?? 14;
      if (![node.x, node.y, w, h].every(Number.isFinite) ||
          node.x < 0 || node.y < 0 || w <= 0 || h <= 0 ||
          node.x + w > 100 || node.y + h > 100) {
        issues.push({ path, message: `diagram node "${node.id}" falls outside its 100×100 canvas` });
      }
    }
    for (const edge of spec.edges ?? []) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) {
        issues.push({ path, message: "diagram edge refers to a missing node" });
      }
    }
  }
  if (element.caption) validateInlineMath(element.caption, `${path}.caption`, issues);
}

export function validateSlide(scene: SlideScene, issues: Issue[]): void {
  const path = `scene ${scene.index} (${scene.title})`;
  if (!scene.elements.length) issues.push({ path: `${path}.elements`, message: "slide has no elements" });
  const ids = new Set<string>();
  for (const element of scene.elements) {
    if (!element.id?.trim() || ids.has(element.id)) {
      issues.push({ path: `${path}.elements`, message: "element IDs must be nonempty and unique" });
    }
    ids.add(element.id);
    if (element.type === "bullets") {
      if (element.items.length > MAX_BULLETS) issues.push({ path, message: `has ${element.items.length} bullets (limit ${MAX_BULLETS})` });
      element.items.forEach((item, idx) => validateInlineMath(item, `${path}.${element.id}.item${idx}`, issues));
    } else if (element.type === "equation") {
      validateFormula(element.latex, `${path}.${element.id}.latex`, issues);
      if (element.caption) validateInlineMath(element.caption, `${path}.${element.id}.caption`, issues);
    } else if (element.type === "figure") {
      validateFigure(element, `${path}.${element.id}.figure`, issues);
    } else if (element.type !== "code") {
      validateInlineMath(element.text, `${path}.${element.id}.text`, issues);
    }
  }
  const onSlide = scene.elements.map((e) => {
    if (e.type === "equation" || e.type === "code") return e.type === "equation" ? e.caption ?? "" : "";
    if (e.type === "figure") return e.caption ?? "";
    return e.type === "bullets" ? e.items.join(" ") : e.text;
  }).join(" ");
  const words = countWords(stripLatex(onSlide));
  if (words > MAX_SLIDE_WORDS) {
    issues.push({ path: `${path}.elements`, message: `${words} words of on-slide text (limit ${MAX_SLIDE_WORDS})` });
  }
  for (const segment of scene.segments) {
    for (const action of segment.actions) {
      if (action.op.startsWith("wb.")) {
        issues.push({ path: `${path}.action ${action.op}`, message: "whiteboard actions are not allowed on slide scenes" });
        continue;
      }
      if ((action.op === "reveal" || action.op === "spotlight" || action.op === "laser") &&
          !ids.has(action.target)) {
        issues.push({ path: `${path}.action ${action.op}`, message: `targets missing element "${action.target}"` });
      }
    }
  }
}

/* ----------------------------- whiteboard -------------------------------- */

const TEXT_SIZE_WIDTH = {
  sm: 7,
  md: 11,
  lg: 16,
} as const;

/** Rough width/height estimate for a text or latex op, used for overlap checks. */
export function estimateTextSize(
  text: string,
  size: "sm" | "md" | "lg" = "md",
): { w: number; h: number } {
  const perChar = TEXT_SIZE_WIDTH[size];
  const lines = text.split("\n").length;
  const h = size === "lg" ? 44 : size === "md" ? 32 : 24;
  return { w: Math.max(40, text.length * perChar), h: h * lines };
}

export function validateWhiteboard(
  scene: WhiteboardScene,
  issues: Issue[],
): void {
  const path = `scene ${scene.index} (${scene.title})`;
  const { w, h } = scene.canvas;
  const boxes: { id: string; x: number; y: number; w: number; h: number }[] = [];
  const activeTextBoxes = new Map<string, { id: string; x: number; y: number; w: number; h: number }>();
  const known = new Set<string>();

  for (const segment of scene.segments) {
    for (const action of segment.actions) {
      if (action.op === "wb.plot") {
        known.add(action.id);
        if (!known.has(action.axes)) {
          issues.push({
            path: `${path}.wb.plot ${action.id}`,
            message: `references unknown axes "${action.axes}"`,
          });
        }
        issues.push(
          ...checkPlotExpression(action.expr).map((i) => ({
            path: `${path}.wb.plot ${action.id} ${i.path}`,
            message: i.message,
          })),
        );
        continue;
      }
      if (action.op === "wb.highlight") {
        if (!known.has(action.target)) {
          issues.push({
            path: `${path}.wb.highlight`,
            message: `targets unknown object "${action.target}"`,
          });
        }
        continue;
      }
      if (action.op === "wb.erase") {
        if (!known.has(action.target)) {
          issues.push({
            path: `${path}.wb.erase`,
            message: `targets unknown object "${action.target}"`,
          });
        } else {
          activeTextBoxes.delete(action.target);
        }
        continue;
      }
      if (action.op === "wb.text" || action.op === "wb.latex") {
        known.add(action.id);
        if (action.op === "wb.latex") validateFormula(action.latex, `${path}.${action.id}.latex`, issues);
        const size = estimateTextSize(
          action.op === "wb.latex" ? action.latex : action.text,
          action.size ?? "md",
        );
        const box = { id: action.id, x: action.x, y: action.y, w: size.w, h: size.h };
        boxes.push(box);
        for (const [otherId, a] of activeTextBoxes.entries()) {
          if (otherId === box.id) continue;
          const overlap =
            a.x < box.x + box.w - 12 &&
            box.x < a.x + a.w - 12 &&
            a.y < box.y + box.h - 8 &&
            box.y < a.y + a.h - 8;
          if (overlap) {
            issues.push({
              path: `${path}.${box.id}`,
              message: `overlaps ${a.id}`,
            });
          }
        }
        activeTextBoxes.set(box.id, box);
      } else if (action.op === "wb.rect") {
        known.add(action.id);
        boxes.push({ id: action.id, x: action.x, y: action.y, w: action.w, h: action.h });
      } else if (action.op === "wb.circle") {
        known.add(action.id);
        boxes.push({
          id: action.id,
          x: action.cx - action.r,
          y: action.cy - action.r,
          w: action.r * 2,
          h: action.r * 2,
        });
      } else if (action.op === "wb.axes") {
        known.add(action.id);
        boxes.push({ id: action.id, x: action.x, y: action.y, w: action.w, h: action.h });
        if ((action.x_label && action.y + action.h + 28 > h) ||
            (action.y_label && action.y - 12 < 0)) {
          issues.push({ path: `${path}.${action.id}`, message: "plot axis label would fall outside the canvas" });
        }
      } else if (action.op === "wb.line") {
        known.add(action.id);
        boxes.push({
          id: action.id,
          x: Math.min(action.from[0], action.to[0]),
          y: Math.min(action.from[1], action.to[1]),
          w: Math.abs(action.to[0] - action.from[0]),
          h: Math.abs(action.to[1] - action.from[1]),
        });
      }
    }
  }
  for (const box of boxes) {
    if (box.x < -8 || box.y < -8 || box.x + box.w > w + 8 || box.y + box.h > h + 8) {
      issues.push({
        path: `${path}.${box.id}`,
        message: `falls outside the ${w}×${h} canvas`,
      });
    }
  }
  const segmentIds = new Set(scene.segments.map((s) => s.id));
  for (const step of scene.steps) {
    if (step.summary_latex) validateFormula(step.summary_latex, `${path}.step ${step.title}.summary_latex`, issues);
    if (!step.segment_ids.length) {
      issues.push({
        path: `${path}.step ${step.title}`,
        message: "has no segments",
      });
    }
    for (const id of step.segment_ids) {
      if (!segmentIds.has(id)) {
        issues.push({
          path: `${path}.step ${step.title}`,
          message: `references unknown segment "${id}"`,
        });
      }
    }
  }
}

/* -------------------------------- quiz ----------------------------------- */

export function validateQuestion(
  question: Question,
  path: string,
  issues: Issue[],
): void {
  if (!question.prompt?.trim()) {
    issues.push({ path: `${path}.prompt`, message: "is required" });
  }
  if (!question.explanation?.trim()) {
    issues.push({ path: `${path}.explanation`, message: "is required" });
  }
  if (question.type === "single" || question.type === "multi") {
    const ids = new Set((question.choices ?? []).map((c) => c.id));
    if ((question.choices ?? []).length < 2) {
      issues.push({ path: `${path}.choices`, message: "needs at least two options" });
    }
    const correct = question.correct ?? [];
    if (!correct.length) {
      issues.push({ path: `${path}.correct`, message: "is required" });
    }
    if (question.type === "single" && correct.length !== 1) {
      issues.push({
        path: `${path}.correct`,
        message: "must name exactly one option for a single-choice question",
      });
    }
    for (const id of correct) {
      if (!ids.has(id)) {
        issues.push({
          path: `${path}.correct`,
          message: `references unknown option "${id}"`,
        });
      }
    }
  } else if (question.rubric) {
    const sum = question.rubric.criteria.reduce((acc, c) => acc + c.weight, 0);
    if (!question.rubric.criteria.length || question.rubric.criteria.some((c) => !Number.isFinite(c.weight) || c.weight < 0)) {
      issues.push({ path: `${path}.rubric.criteria`, message: "rubric weights must be finite nonnegative numbers" });
    }
    if (!Number.isFinite(sum) || Math.abs(sum - 1) > 0.001) {
      issues.push({
        path: `${path}.rubric.criteria`,
        message: `weights sum to ${sum.toFixed(2)}, must sum to 1`,
      });
    }
    if (!question.rubric.key_points.length) {
      issues.push({
        path: `${path}.rubric.key_points`,
        message: "needs at least one checkable key point",
      });
    }
  } else {
    issues.push({
      path: `${path}.rubric`,
      message: "is required for short-answer and derivation questions",
    });
  }
}

/* -------------------------------- scene ---------------------------------- */

export function validateScene(scene: Scene): Issue[] {
  const issues: Issue[] = [];
  if (!scene.id) issues.push({ path: "scene.id", message: "is required" });
  if (!scene.title?.trim()) {
    issues.push({ path: `scene ${scene.index}.title`, message: "is required" });
  }
  if (!scene.segments?.length) {
    issues.push({
      path: `scene ${scene.index} (${scene.title})`,
      message: "has no narration segments",
    });
  }
  (scene.segments ?? []).forEach((segment, i) => {
    validateSegment(segment, `scene ${scene.index} segment ${i}`, issues);
  });
  if (scene.kind === "slide") validateSlide(scene, issues);
  if (scene.kind === "whiteboard") validateWhiteboard(scene, issues);
  if (scene.kind === "quiz") {
    if (!scene.questions.length) {
      issues.push({
        path: `scene ${scene.index}`,
        message: "quiz has no questions",
      });
    }
    scene.questions.forEach((q, i) =>
      validateQuestion(q, `scene ${scene.index} question ${i}`, issues),
    );
  }
  return issues;
}

export function assertValidScene(scene: Scene): void {
  const issues = validateScene(scene);
  if (issues.length) throw new ValidationError(issues);
}

/* -------------------------------- course --------------------------------- */

export function validateCourse(course: Course): Issue[] {
  const issues: Issue[] = [];
  if (course.version !== 1) {
    issues.push({ path: "version", message: "must be 1" });
  }
  if (!course.modules.length) {
    issues.push({ path: "modules", message: "course has no modules" });
  }
  const sceneIds = new Set<string>();
  course.modules.forEach((moduleBlock: Module, mi) => {
    if (!moduleBlock.title?.trim()) {
      issues.push({ path: `module ${mi}.title`, message: "is required" });
    }
    if (!moduleBlock.scenes.length) {
      issues.push({ path: `module ${mi}`, message: "has no scenes" });
    }
    moduleBlock.scenes.forEach((scene) => {
      if (sceneIds.has(scene.id)) {
        issues.push({ path: `scene ${scene.id}`, message: "duplicate scene id" });
      }
      sceneIds.add(scene.id);
      issues.push(...validateScene(scene));
    });
  });
  return issues;
}

/** Total narrated duration of a scene, using real audio when it exists. */
export function sceneDurationMs(scene: Scene): number {
  return scene.segments.reduce(
    (acc, s) => acc + (s.audio?.duration_ms ?? s.estimated_duration_ms),
    0,
  );
}

export function courseDurationMs(course: Course): number {
  return course.modules
    .flatMap((m) => m.scenes)
    .reduce((acc, scene) => acc + sceneDurationMs(scene), 0);
}

export function isFigureAction(action: Action): boolean {
  return action.op.startsWith("wb.");
}
