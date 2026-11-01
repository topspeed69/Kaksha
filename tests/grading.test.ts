import { describe, expect, it } from "vitest";
import { buildFixtureCourse } from "@/lib/fixtures/quantum-decoherence";
import { draftFeedback, gradeAnswer } from "@/server/grading";
import { DEFAULT_SETTINGS } from "@/server/settings";
import type { Question, QuizScene } from "@/lib/dsl/types";

const course = buildFixtureCourse();
const quiz = course.modules[1].scenes.find(
  (scene) => scene.kind === "quiz",
) as QuizScene;
const single = quiz.questions.find((q) => q.type === "single") as Question;
const multi = quiz.questions.find((q) => q.type === "multi") as Question;
const short = quiz.questions.find((q) => q.type === "short") as Question;
const derivation = quiz.questions.find((q) => q.type === "derivation") as Question;
const settings = DEFAULT_SETTINGS;

describe("deterministic marking", () => {
  it("marks a single choice question", async () => {
    const right = await gradeAnswer({
      settings,
      question: single,
      answer: { type: "single", choice_ids: single.correct! },
      sourceExcerpt: "",
    });
    expect(right.score).toBe(1);
    const wrong = await gradeAnswer({
      settings,
      question: single,
      answer: { type: "single", choice_ids: [single.choices!.find((c) => c.id !== single.correct![0])!.id] },
      sourceExcerpt: "",
    });
    expect(wrong.score).toBe(0);
  });

  it("gives partial credit on multi select and floors at zero", async () => {
    const partial = await gradeAnswer({
      settings,
      question: multi,
      answer: { type: "multi", choice_ids: [multi.correct![0]] },
      sourceExcerpt: "",
    });
    expect(partial.score).toBeGreaterThan(0);
    expect(partial.score).toBeLessThan(1);
    const wrong = await gradeAnswer({
      settings,
      question: multi,
      answer: {
        type: "multi",
        choice_ids: multi.choices!.filter((c) => !multi.correct!.includes(c.id)).map((c) => c.id),
      },
      sourceExcerpt: "",
    });
    expect(wrong.score).toBe(0);
    expect(wrong.missing_points.length).toBe(multi.correct!.length);
  });

  it("refuses to mark an empty answer", async () => {
    const result = await gradeAnswer({
      settings,
      question: short,
      answer: { type: "short", text: "   " },
      sourceExcerpt: "",
    });
    expect(result.score).toBe(0);
    expect(result.feedback).toContain("nothing to mark");
  });
});

describe("marking without a model", () => {
  it("labels itself clearly and keeps a low confidence", async () => {
    const answer = short.rubric!.key_points.slice(0, 2).join(". ");
    const result = await gradeAnswer({
      settings,
      question: short,
      answer: { type: "short", text: answer },
      sourceExcerpt: "",
    });
    expect(result.graded_by).toBe("deterministic");
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.feedback).toContain("No grading model is configured");
  });

  it("marks a derivation with the rubric weights it has", async () => {
    const result = await gradeAnswer({
      settings,
      question: derivation,
      answer: { type: "derivation", text: derivation.rubric!.reference_answer },
      sourceExcerpt: "",
    });
    expect(result.score).toBeGreaterThan(0.3);
    expect(result.criteria.length).toBe(derivation.rubric!.criteria.length);
  });

  it("gives hints instead of a score in draft feedback", async () => {
    const draft = await draftFeedback({
      settings,
      question: derivation,
      answer: { type: "derivation", text: "It is about decoherence and it happens fast." },
      sourceExcerpt: "",
    });
    expect(draft.confidence).toBeLessThan(0.6);
    expect(draft.hints.length).toBeGreaterThan(0);
  });
});

describe("topic-only generation (no source chunks)", () => {
  it("produces a quiz that still validates", async () => {
    const { generateScene } = await import("@/server/pipeline/scenes");
    const { validateScene } = await import("@/lib/dsl/validate");
    const outcome = await generateScene({
      settings,
      courseTitle: "Bayesian reasoning",
      topic: "Bayesian reasoning",
      depth: "introductory",
      background: "beginner",
      module: {
        id: "mod1",
        index: 0,
        title: "What Bayesian reasoning is",
        objective: "Understand Bayesian updating at an introductory level",
        objectives: [{ id: "obj1", text: "Explain what a prior is", bloom: "understand" }],
        prerequisites: [],
        duration_min: 5,
        est_seconds: 300,
        scenes: [],
      },
      outline: {
        id: "sc1",
        index: 0,
        title: "Check yourself",
        kind: "quiz",
        intent: "Quiz on the module objectives",
        est_seconds: 120,
      },
      chunks: [],
      index: 0,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(validateScene(outcome.scene)).toEqual([]);
      const quiz = outcome.scene as QuizScene;
      expect(quiz.questions.length).toBeGreaterThan(0);
      for (const q of quiz.questions) {
        if (q.rubric) expect(q.rubric.key_points.length).toBeGreaterThan(0);
      }
    }
  });

  it("produces a whiteboard that still validates", async () => {
    const { generateScene } = await import("@/server/pipeline/scenes");
    const { validateScene } = await import("@/lib/dsl/validate");
    const outcome = await generateScene({
      settings,
      courseTitle: "Bayesian reasoning",
      topic: "Bayesian reasoning",
      depth: "introductory",
      background: "beginner",
      module: {
        id: "mod1",
        index: 0,
        title: "What Bayesian reasoning is",
        objective: "Understand Bayesian updating",
        objectives: [{ id: "obj1", text: "Explain what a prior is", bloom: "understand" }],
        prerequisites: [],
        duration_min: 5,
        est_seconds: 300,
        scenes: [],
      },
      outline: {
        id: "sc1",
        index: 0,
        title: "Worked example",
        kind: "whiteboard",
        intent: "Derive Bayes' rule step by step",
        est_seconds: 120,
      },
      chunks: [],
      index: 0,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(validateScene(outcome.scene)).toEqual([]);
  });
});
