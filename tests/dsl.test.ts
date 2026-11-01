import { describe, expect, it } from "vitest";
import { buildFixtureCourse } from "@/lib/fixtures/quantum-decoherence";
import {
  checkPlotExpression,
  courseDurationMs,
  estimateSegmentMs,
  sceneDurationMs,
  validateCourse,
  validateQuestion,
  validateScene,
} from "@/lib/dsl/validate";
import type { Question, Scene } from "@/lib/dsl/types";

const course = buildFixtureCourse();

describe("the reference fixture course", () => {
  it("has two modules and at least eight scenes", () => {
    expect(course.modules).toHaveLength(2);
    const scenes = course.modules.flatMap((m) => m.scenes);
    expect(scenes.length).toBeGreaterThanOrEqual(8);
    expect(new Set(scenes.map((s) => s.kind))).toEqual(
      new Set(["slide", "whiteboard", "quiz"]),
    );
  });

  it("passes DSL validation", () => {
    expect(validateCourse(course)).toEqual([]);
  });

  it("narrates for roughly the stated time", () => {
    const minutes = courseDurationMs(course) / 60000;
    expect(minutes).toBeGreaterThan(8);
    expect(minutes).toBeLessThan(40);
  });

  it("keeps every segment speakable", () => {
    for (const scene of course.modules.flatMap((m) => m.scenes)) {
      for (const segment of scene.segments) {
        expect(segment.text.length).toBeLessThanOrEqual(320);
        expect(segment.text).not.toMatch(/\$|\\/);
      }
    }
  });
});

describe("scene validation", () => {
  const slide = course.modules[0].scenes[1] as Scene;

  it("rejects an action that targets a missing element", () => {
    const broken = JSON.parse(JSON.stringify(slide)) as Scene;
    broken.segments[0].actions.push({ op: "reveal", at: 0.5, target: "nope" });
    const issues = validateScene(broken);
    expect(issues.some((i) => i.message.includes("missing element"))).toBe(true);
  });

  it("rejects overlong slides", () => {
    const broken = JSON.parse(JSON.stringify(slide)) as Scene;
    for (const element of broken.kind === "slide" ? broken.elements : []) {
      if (element.type === "bullets") {
        element.items = [
          "this bullet is deliberately padded with a great many unnecessary words so that the slide as a whole passes the on slide word budget and the validator has to reject it outright",
          ...element.items,
        ];
      }
    }
    expect(validateScene(broken).some((i) => i.message.includes("words of on-slide text"))).toBe(
      true,
    );
  });

  it("rejects bad plot expressions", () => {
    expect(checkPlotExpression("sin(x) + pi")).toEqual([]);
    expect(checkPlotExpression("process.exit(1)").length).toBeGreaterThan(0);
    expect(checkPlotExpression("y + 3").length).toBeGreaterThan(0);
    expect(checkPlotExpression("import('fs')").length).toBeGreaterThan(0);
  });
});

describe("quiz validation", () => {
  const quiz = course.modules[1].scenes.find(
    (s) => s.kind === "quiz",
  ) as Extract<Scene, { kind: "quiz" }>;
  const derivation = quiz.questions.find((q) => q.type === "derivation") as Question;

  it("accepts the fixture questions", () => {
    quiz.questions.forEach((question, i) => {
      const issues: { path: string; message: string }[] = [];
      validateQuestion(question, `q${i}`, issues);
      expect(issues).toEqual([]);
    });
  });

  it("rejects rubric weights that do not sum to one", () => {
    const broken = JSON.parse(JSON.stringify(derivation)) as Question;
    broken.rubric!.criteria[0].weight = 0.9;
    const issues: { path: string; message: string }[] = [];
    validateQuestion(broken, "q", issues);
    expect(issues.some((i) => i.message.includes("weights sum to"))).toBe(true);
  });

  it("rejects a single choice question with two answers", () => {
    const broken = JSON.parse(JSON.stringify(quiz.questions[0])) as Question;
    broken.correct = ["c1", "c2"];
    const issues: { path: string; message: string }[] = [];
    validateQuestion(broken, "q", issues);
    expect(issues.some((i) => i.message.includes("exactly one option"))).toBe(true);
  });
});

describe("timing helpers", () => {
  it("derives segment durations from the word count", () => {
    expect(estimateSegmentMs("one two three four five")).toBe(2000);
    expect(estimateSegmentMs("a")).toBe(1200);
  });

  it("prefers real audio duration over the estimate", () => {
    const scene = JSON.parse(
      JSON.stringify(course.modules[0].scenes[0]),
    ) as Scene;
    scene.segments[0].audio = { url: "/api/media/audio/x.mp3", duration_ms: 9000 };
    expect(sceneDurationMs(scene)).toBe(
      9000 + scene.segments.slice(1).reduce((acc, s) => acc + s.estimated_duration_ms, 0),
    );
  });
});
