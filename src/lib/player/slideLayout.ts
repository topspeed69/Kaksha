import type { SlideScene } from "@/lib/dsl/types";

export type SlideElement = SlideScene["elements"][number];
export type SlideLayoutKind = "title" | "equation" | "split" | "stack";
export type FitMode = "text" | "contain";

export type SlideArrangement = {
  layout: SlideLayoutKind;
  heading?: SlideElement;
  callout?: SlideElement;
  math?: SlideElement;
  figure?: SlideElement;
  primary: SlideElement[];
  secondary: SlideElement[];
};

export function fitFor(element: SlideElement): FitMode {
  return element.type === "equation" ? "contain" : "text";
}

/**
 * Assign every slide element to a reserved region. The renderer owns layout;
 * generated content never positions itself, so regions cannot overlap.
 */
export function arrangeSlide(scene: SlideScene): SlideArrangement {
  const elements = scene.elements;
  const heading = elements.find((element) => element.type === "heading");
  const callouts = elements.filter((element) => element.type === "callout");
  const callout = callouts[callouts.length - 1];
  const equation = elements.find((element) => element.type === "equation");
  const figure = elements.find((element) => element.type === "figure");
  const reserved = new Set(
    [heading?.id, callout?.id, equation?.id, figure?.id].filter(Boolean) as string[],
  );
  const rest = elements.filter((element) => !reserved.has(element.id));

  if (scene.layout === "title") {
    return { layout: "title", heading, callout, primary: rest, secondary: [] };
  }
  // A figure and an equation need separate regions. The equation-first branch
  // used to reserve the figure but never render it.
  if (!figure && (scene.layout === "equation_focus" || equation)) {
    return { layout: "equation", heading, callout, math: equation, primary: rest, secondary: [] };
  }
  if (scene.layout === "text_figure" || scene.layout === "two_column" || figure) {
    if (figure || equation) {
      return {
        layout: "split",
        heading,
        callout,
        figure,
        math: equation,
        primary: rest,
        secondary: [],
      };
    }
    const midpoint = Math.ceil(rest.length / 2);
    return {
      layout: "split",
      heading,
      callout,
      primary: rest.slice(0, midpoint),
      secondary: rest.slice(midpoint),
    };
  }
  return { layout: "stack", heading, callout, primary: rest, secondary: [] };
}
