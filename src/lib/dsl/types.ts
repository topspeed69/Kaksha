/**
 * Lumen lesson format (DSL) — version 1.
 *
 * This file is the single source of truth for the shape of a course, module,
 * scene, slide, whiteboard step and quiz question. Both the generator
 * (server) and the player (client) import from here, so the two sides cannot
 * drift. See docs/architecture.md.
 */

export const DSL_VERSION = 1 as const;

export type Depth = "introductory" | "undergraduate" | "graduate";
export type Background = "beginner" | "familiar" | "advanced";
export type Bloom =
  | "remember"
  | "understand"
  | "apply"
  | "analyze"
  | "evaluate";

export type CourseStatus =
  | "planning"
  | "plan_ready"
  | "generating"
  | "ready"
  | "failed"
  | "archived";

export type SceneStatus = "pending" | "generating" | "ready" | "failed";
export type MaterialStatus =
  | "parsing"
  | "ready"
  | "failed";

export type SourceKind =
  | "topic"
  | "pdf"
  | "epub"
  | "markdown"
  | "text"
  | "url"
  | "syllabus";

export type Course = {
  version: typeof DSL_VERSION;
  id: string;
  title: string;
  source: {
    kind: SourceKind;
    label: string;
    material_ids: string[];
  };
  depth: Depth;
  background: Background;
  minutes_target: number;
  language: string;
  voice: { id: string; speed: number };
  status: CourseStatus;
  generator: { label: string; modelled: boolean };
  modules: Module[];
};

export type Module = {
  id: string;
  index: number;
  title: string;
  objectives: { id: string; text: string; bloom: Bloom }[];
  duration_min: number;
  prerequisites: string[];
  scenes: Scene[];
};

export type SceneBase = {
  id: string;
  index: number;
  title: string;
  segments: Segment[];
  sources: string[];
  /** Review applies only to the scene actually generated, never to whole-course claims. */
  review?: {
    status: "approved" | "format_checked" | "unavailable";
    summary: string;
    reviewed_by?: string;
  };
  /**
   * Visual QA result: the deterministic layout audit merged with the visual
   * agent reviewer. Persisted so the player can show what was checked.
   */
  visual?: {
    score: number;
    verdict: "pass" | "revise";
    findings: {
      severity: "blocking" | "advisory";
      area: string;
      detail: string;
      suggestion: string;
    }[];
    reviewed_by: string;
    saw_screenshot: boolean;
  };
};

export type GenerationOptions = {
  derive_proofs: boolean;
  embed_citations: boolean;
  /** Optional additional model review. Never silently claims to have run. */
  review_agent?: boolean;
  /** Run independent scene writers concurrently within the configured limit. */
  parallel_agents?: boolean;
  /** Use at most two relevant rendered PDF page images in vision-capable models. */
  use_page_images?: boolean;
  /**
   * Escalate to a stronger model after a scene has failed twice, instead of
   * repeating the same request against the same model.
   */
  escalation_model?: boolean;
};

export type Scene = SlideScene | WhiteboardScene | QuizScene;

export type Segment = {
  id: string;
  /** Speakable prose. It is both the caption and the TTS input. */
  text: string;
  audio?: { url: string; duration_ms: number };
  /** When no audio file exists the player derives a duration from the text. */
  estimated_duration_ms: number;
  actions: Action[];
};

export type Action = SlideAction | WhiteboardAction;

export type SlideAction =
  | { op: "reveal"; at: number; target: string }
  | { op: "spotlight"; at: number; target: string }
  | { op: "laser"; at: number; target: string }
  | { op: "clear_focus"; at: number };

/* ------------------------------- slides ---------------------------------- */

export type SlideScene = SceneBase & {
  kind: "slide";
  layout:
    | "title"
    | "text"
    | "text_figure"
    | "equation_focus"
    | "two_column";
  elements: SlideElement[];
};

export type SlideElement =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "bullets"; items: string[] }
  | {
      id: string;
      type: "equation";
      latex: string;
      display: boolean;
      caption?: string;
    }
  | { id: string; type: "figure"; spec: PlotSpec | DiagramSpec; caption?: string }
  | { id: string; type: "callout"; text: string }
  | { id: string; type: "code"; language: string; code: string };

export type PlotSpec = {
  kind: "plot";
  x_label: string;
  y_label: string;
  domain: [number, number];
  series: { label: string; expr: string; color?: "ink" | "accent" }[];
  annotations?: { x: number; text: string }[];
};

export type DiagramNodeShape = "box" | "pill" | "circle" | "diamond";

export type DiagramSpec = {
  kind: "diagram";
  nodes: {
    id: string;
    label: string;
    x: number;
    y: number;
    w?: number;
    h?: number;
    dashed?: boolean;
    /** Optional visual treatment. Defaults to a rectangle. */
    shape?: DiagramNodeShape;
    /** Optional second line, e.g. a symbol or a one-word role. */
    sub?: string;
    /** Draw this part in the accent colour to mark the key step. */
    accent?: boolean;
  }[];
  edges: {
    from: string;
    to: string;
    label?: string;
    dashed?: boolean;
    /** "arrow" (default) draws a head at the target, "line" does not. */
    style?: "arrow" | "line";
  }[];
};

/* ----------------------------- whiteboard -------------------------------- */

export type WhiteboardScene = SceneBase & {
  kind: "whiteboard";
  canvas: { w: number; h: number };
  steps: {
    id: string;
    title: string;
    summary_latex?: string;
    segment_ids: string[];
    /** Optional validated assumptions / variable definitions for this step. */
    assumptions?: string[];
    variables?: { symbol: string; meaning: string }[];
  }[];
};

export type WhiteboardAction =
  | {
      op: "wb.text";
      at: number;
      id: string;
      x: number;
      y: number;
      text: string;
      size?: "sm" | "md" | "lg";
    }
  | {
      op: "wb.latex";
      at: number;
      id: string;
      x: number;
      y: number;
      latex: string;
      size?: "sm" | "md" | "lg";
    }
  | {
      op: "wb.line";
      at: number;
      id: string;
      from: [number, number];
      to: [number, number];
      arrow?: boolean;
      dashed?: boolean;
    }
  | {
      op: "wb.rect";
      at: number;
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      label?: string;
      dashed?: boolean;
    }
  | {
      op: "wb.circle";
      at: number;
      id: string;
      cx: number;
      cy: number;
      r: number;
      label?: string;
    }
  | {
      op: "wb.axes";
      at: number;
      id: string;
      x: number;
      y: number;
      w: number;
      h: number;
      x_label?: string;
      y_label?: string;
    }
  | {
      op: "wb.plot";
      at: number;
      id: string;
      axes: string;
      expr: string;
      domain: [number, number];
      color?: "ink" | "accent";
    }
  | { op: "wb.highlight"; at: number; target: string }
  | { op: "wb.erase"; at: number; target: string };

/* -------------------------------- quiz ----------------------------------- */

export type QuizScene = SceneBase & {
  kind: "quiz";
  pass_mark: number;
  questions: Question[];
};

export type Question = {
  id: string;
  objective_id: string;
  type: "single" | "multi" | "short" | "derivation";
  prompt: string;
  context?: string;
  choices?: { id: string; text: string; detail?: string }[];
  correct?: string[];
  explanation: string;
  rubric?: {
    criteria: {
      id: string;
      label: string;
      weight: number;
      description: string;
    }[];
    key_points: string[];
    reference_answer: string;
  };
  sources: string[];
};

/* --------------------------- grading results ----------------------------- */

export type GradeResult = {
  score: number;
  criteria: { id: string; score: number; comment: string }[];
  matched_points: string[];
  missing_points: string[];
  feedback: string;
  confidence: number;
  graded_by: "deterministic" | "model";
};

export type QuizAnswer =
  | { type: "single" | "multi"; choice_ids: string[] }
  | { type: "short" | "derivation"; text: string };

/* ------------------------------ plan format ------------------------------ */

export type PlanSceneOutline = {
  id: string;
  index: number;
  title: string;
  kind: "slide" | "whiteboard" | "quiz";
  intent: string;
  est_seconds: number;
};

export type PlanModule = {
  id: string;
  index: number;
  title: string;
  objective: string;
  objectives: { id: string; text: string; bloom: Bloom }[];
  prerequisites: string[];
  prerequisite_note?: string;
  duration_min: number;
  est_seconds: number;
  scenes: PlanSceneOutline[];
};

export type CoursePlan = {
  version: typeof DSL_VERSION;
  depth: Depth;
  background: Background;
  minutes_target: number;
  rationale: string;
  concepts: { name: string; definition: string }[];
  modules: PlanModule[];
};
