import { describe, expect, it } from "vitest";
import { buildFixtureCourse } from "@/lib/fixtures/quantum-decoherence";
import { arrangeSlide, fitFor } from "@/lib/player/slideLayout";
import { usePlayerStore } from "@/lib/player/store";
import type { SlideScene } from "@/lib/dsl/types";

const course = buildFixtureCourse();
const slides = course.modules.flatMap((m) => m.scenes).filter((s): s is SlideScene => s.kind === "slide");

describe("reserved slide layout", () => {
  it("assigns every element exactly once", () => {
    for (const slide of slides) {
      const plan = arrangeSlide(slide);
      const ids = [
        plan.heading?.id,
        plan.callout?.id,
        plan.math?.id,
        plan.figure?.id,
        ...plan.primary.map((e) => e.id),
        ...plan.secondary.map((e) => e.id),
      ].filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.sort()).toEqual(slide.elements.map((e) => e.id).sort());
    }
  });

  it("reserves equations and figures away from body text", () => {
    const equationSlide = slides.find((s) => s.elements.some((e) => e.type === "equation"));
    const figureSlide = slides.find((s) => s.elements.some((e) => e.type === "figure"));
    expect(equationSlide).toBeTruthy();
    expect(figureSlide).toBeTruthy();
    if (equationSlide) {
      const plan = arrangeSlide(equationSlide);
      const equation = equationSlide.elements.find((e) => e.type === "equation")!;
      expect(plan.math?.id ?? plan.secondary.find((e) => e.id === equation.id)?.id).toBe(equation.id);
      expect(plan.primary.some((e) => e.id === equation.id)).toBe(false);
      expect(fitFor(equation)).toBe("contain");
    }
    if (figureSlide) {
      const plan = arrangeSlide(figureSlide);
      const figure = figureSlide.elements.find((e) => e.type === "figure")!;
      expect(plan.figure?.id).toBe(figure.id);
      expect(plan.primary.some((e) => e.id === figure.id)).toBe(false);
    }
  });

  it("defaults narration to automatic browser fallback when no audio exists", () => {
    usePlayerStore.getState().load(course);
    expect(usePlayerStore.getState().narration).toBe("auto");
  });
});
