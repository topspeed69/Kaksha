import type {
  Background,
  Bloom,
  CoursePlan,
  Depth,
  PlanModule,
  PlanSceneOutline,
} from "@/lib/dsl/types";
import type { KakshaSettings } from "@/server/settings";
import { resolveLLM, type LLMImage } from "@/server/providers/llm";
import { generateStructured } from "@/server/providers/llm";
import { plannerPrompt } from "@/server/prompts";

export const WORDS_PER_MINUTE = 150;
export const QUIZ_TIME_SHARE = 0.15;

export function moduleCount(minutes: number): number {
  return Math.min(8, Math.max(1, Math.round(minutes / 10)));
}

export function quizMixFor(depth: Depth): string {
  if (depth === "introductory") return "single choice only";
  if (depth === "undergraduate") return "single choice plus short answer";
  return "multi-select, short answer and one derivation";
}

const MODULE_TITLES: Record<Depth, string[]> = {
  introductory: [
    "What {topic} is",
    "How it works",
    "Where you meet it",
    "Checking your understanding",
  ],
  undergraduate: [
    "Foundations of {topic}",
    "The core formalism",
    "A worked derivation",
    "Consequences and limits",
  ],
  graduate: [
    "Formal setup and assumptions",
    "Main derivation",
    "Limits and edge cases",
    "Critique and open questions",
  ],
};

const SCENE_INTENTS: Record<Depth, string[]> = {
  introductory: [
    "Give the plain-language idea and one everyday analogy.",
    "Show the few symbols the learner really needs, and what each one means.",
    "Walk through one simple example, step by step, with no shortcuts.",
    "Summarise what to remember and what is still ahead.",
  ],
  undergraduate: [
    "Set up the objects and the notation the rest of the module uses.",
    "State the main result and what each term contributes.",
    "Sketch the derivation: the strategy, then the key step, then the result.",
    "Show where the result applies and where it breaks down.",
  ],
  graduate: [
    "State the assumptions precisely and flag which are load-bearing.",
    "Carry out the derivation in full, keeping every step justified.",
    "Examine a limiting case and check the result against it.",
    "Discuss failure modes, edge cases and what the literature disagrees about.",
  ],
};

const BLOOM_BY_POSITION: Bloom[] = ["remember", "understand", "apply", "analyze"];

function id(prefix: string, n: number): string {
  return `${prefix}${n}`;
}

/** Narration seconds available for slides and whiteboards after quizzes. */
export function narrationBudget(minutes: number): number {
  return Math.round(minutes * 60 * (1 - QUIZ_TIME_SHARE));
}

function scenesForModule(
  depth: Depth,
  shortTopic: string,
  moduleIndex: number,
  moduleCountValue: number,
  narrationSeconds: number,
): { kind: "slide" | "whiteboard" | "quiz"; est_seconds: number; title: string; intent: string }[] {
  const perModule = Math.max(1, Math.round(narrationSeconds / moduleCountValue));
  // Scenes are 60-120 s of narration; aim for the middle of that band.
  const sceneSeconds = 90;
  const teachScenes = Math.min(5, Math.max(1, Math.round(perModule / sceneSeconds)));
  const out: PlanSceneOutline[] = [];
  const intents = SCENE_INTENTS[depth];
  const titles = MODULE_TITLES[depth];
  const baseTitle = titles[moduleIndex % titles.length].replace("{topic}", shortTopic);
  for (let i = 0; i < teachScenes; i += 1) {
    const wantsWhiteboard =
      (depth === "graduate" && i === teachScenes - 1) ||
      (depth === "undergraduate" && i === Math.min(1, teachScenes - 1) && moduleIndex < 2);
    out.push({
      id: "",
      index: out.length,
      kind: wantsWhiteboard ? "whiteboard" : "slide",
      title: wantsWhiteboard
        ? `Worked through: ${baseTitle}`
        : i === 0
          ? baseTitle
          : `${baseTitle} — part ${i + 1}`,
      intent: intents[(i + moduleIndex) % intents.length],
      est_seconds: wantsWhiteboard ? 120 : 90,
    });
  }
  out.push({
    id: "",
    index: out.length,
    kind: "quiz",
    title: `Check yourself: ${baseTitle}`,
    intent: `Short quiz on this module's objectives (${quizMixFor(depth)}).`,
    est_seconds: Math.max(60, Math.round((perModule * QUIZ_TIME_SHARE) / (1 - QUIZ_TIME_SHARE))),
  });
  return out;
}

/** Built-in outline used when no language model is configured. */
export function heuristicPlan(input: {
  topic: string;
  depth: Depth;
  background: Background;
  minutes: number;
  sectionTitles: string[];
}): CoursePlan {
  const modules: PlanModule[] = [];
  // Titles read badly when a topic carries a colon-separated qualifier, so
  // titles use a short phrase and objectives keep the full topic.
  const shortTopic = input.topic.split(/[:;—–,]/)[0].trim() || input.topic;
  const count = moduleCount(input.minutes);
  const narration = narrationBudget(input.minutes);
  const patterns = MODULE_TITLES[input.depth];
  const needsPrereqModule =
    input.background === "beginner" && input.depth !== "introductory" && count > 1;

  const totalModules = needsPrereqModule ? count : count;
  for (let m = 0; m < totalModules; m += 1) {
    const isFirst = m === 0;
    const prereqModule = needsPrereqModule && isFirst;
    const title = prereqModule
      ? `Prerequisites you need for ${shortTopic}`
      : patterns[(m - (needsPrereqModule ? 1 : 0)) % patterns.length].replace(
          "{topic}",
          shortTopic,
        );
    const scenes = prereqModule
      ? [
          {
            kind: "slide" as const,
            est_seconds: 75,
            title: `What you should already know for ${shortTopic}`,
            intent:
              "Cover each prerequisite the learner is assumed to know, in plain language, before the module starts.",
          },
        ]
      : scenesForModule(
          input.depth,
          shortTopic,
          m - (needsPrereqModule ? 1 : 0),
          Math.max(1, totalModules - (needsPrereqModule ? 1 : 0)),
          narration,
        );
    const objectives = scenes
      .filter((s) => s.kind !== "quiz")
      .slice(0, 3)
      .map((s, i) => ({
        id: id("obj", i + 1),
        text:
          input.depth === "introductory"
            ? `Explain ${s.title.toLowerCase()} in your own words`
            : `Work with ${s.title.toLowerCase()}`,
        bloom: BLOOM_BY_POSITION[Math.min(i, BLOOM_BY_POSITION.length - 1)],
      }));
    if (!objectives.length) {
      objectives.push({
        id: "obj1",
        text: `Explain the main idea of ${input.topic}`,
        bloom: "understand",
      });
    }
    modules.push({
      id: id("mod", m + 1),
      index: m,
      title,
      objective:
        input.depth === "introductory"
          ? `Understand ${shortTopic} at an introductory level`
          : `Use the formal treatment of ${shortTopic} correctly`,
      objectives,
      prerequisites: prereqModule
        ? []
        : input.background === "advanced"
          ? [`Assumed: fluency with ${input.topic} notation`]
          : [],
      prerequisite_note: prereqModule
        ? "Added because you selected a beginner background: these ideas are assumed later."
        : input.background === "familiar"
          ? "You said you are familiar with the field, so prerequisites are only named."
          : input.background === "advanced"
            ? "You said you have an advanced background, so prerequisites are assumed."
            : undefined,
      duration_min: Math.max(
        1,
        Math.round(scenes.reduce((acc, s) => acc + s.est_seconds, 0) / 60),
      ),
      est_seconds: scenes.reduce((acc, s) => acc + s.est_seconds, 0),
      scenes: scenes.map((s, i) => ({
        id: `mod${m + 1}-sc${i + 1}`,
        index: i,
        title: s.title,
        kind: s.kind,
        intent: s.intent,
        est_seconds: s.est_seconds,
      })),
    });
  }

  const concepts =
    input.sectionTitles.length > 0
      ? input.sectionTitles.slice(0, 8).map((title) => ({
          name: title,
          definition: "A section found in your material.",
        }))
      : [];

  return {
    version: 1,
    depth: input.depth,
    background: input.background,
    minutes_target: input.minutes,
    rationale: needsPrereqModule
      ? `Drafted for ${input.minutes} minutes at ${input.depth} depth, with prerequisite scenes added for a beginner background.`
      : `Drafted for ${input.minutes} minutes at ${input.depth} depth.`,
    concepts,
    modules,
  };
}

/* ------------------------------ model planning ---------------------------- */

type RawPlan = {
  title?: string;
  rationale?: string;
  concepts?: { name?: string; definition?: string }[];
  modules?: {
    title?: string;
    objective?: string;
    prerequisites?: string[];
    prerequisite_note?: string;
    objectives?: { text?: string; bloom?: string }[];
    scenes?: {
      title?: string;
      kind?: string;
      intent?: string;
      est_seconds?: number;
    }[];
  }[];
};

const BLOOMS: Bloom[] = ["remember", "understand", "apply", "analyze", "evaluate"];
const KINDS = ["slide", "whiteboard", "quiz"] as const;

function normalisePlan(raw: RawPlan, input: {
  depth: Depth;
  background: Background;
  minutes: number;
}): CoursePlan | null {
  if (!raw.modules?.length) return null;
  const modules: PlanModule[] = [];
  raw.modules.slice(0, 8).forEach((rawModule, m) => {
    const scenes: PlanSceneOutline[] = [];
    (rawModule.scenes ?? []).forEach((scene, i) => {
      const kind = KINDS.includes(scene.kind as (typeof KINDS)[number])
        ? (scene.kind as "slide" | "whiteboard" | "quiz")
        : "slide";
      const est =
        typeof scene.est_seconds === "number" && scene.est_seconds > 20
          ? Math.round(scene.est_seconds)
          : kind === "whiteboard"
            ? 120
            : 90;
      scenes.push({
        id: `mod${m + 1}-sc${i + 1}`,
        index: scenes.length,
        title: (scene.title ?? `Scene ${i + 1}`).slice(0, 120),
        kind,
        intent: (scene.intent ?? "Teach this part of the module.").slice(0, 400),
        est_seconds: Math.min(240, Math.max(30, est)),
      });
    });
    if (!scenes.length) return;
    const objectives = (rawModule.objectives ?? [])
      .map((o, i) => ({
        id: id("obj", i + 1),
        text: (o.text ?? "Objective").slice(0, 200),
        bloom: BLOOMS.includes(o.bloom as Bloom) ? (o.bloom as Bloom) : "understand",
      }))
      .slice(0, 5);
    modules.push({
      id: id("mod", m + 1),
      index: modules.length,
      title: (rawModule.title ?? `Module ${m + 1}`).slice(0, 140),
      objective: (rawModule.objective ?? modules.length ? "" : "").slice(0, 300) || "See objectives",
      objectives: objectives.length
        ? objectives
        : [{ id: "obj1", text: "Explain the module's main idea", bloom: "understand" }],
      prerequisites: (rawModule.prerequisites ?? []).slice(0, 6),
      prerequisite_note: rawModule.prerequisite_note?.slice(0, 240),
      duration_min: Math.max(
        1,
        Math.round(scenes.reduce((acc, s) => acc + s.est_seconds, 0) / 60),
      ),
      est_seconds: scenes.reduce((acc, s) => acc + s.est_seconds, 0),
      scenes,
    });
  });
  if (!modules.length) return null;
  return {
    version: 1,
    depth: input.depth,
    background: input.background,
    minutes_target: input.minutes,
    rationale: (raw.rationale ?? "").slice(0, 400),
    concepts: (raw.concepts ?? [])
      .filter((c) => c.name)
      .slice(0, 12)
      .map((c) => ({ name: String(c.name).slice(0, 80), definition: String(c.definition ?? "").slice(0, 240) })),
    modules,
  };
}

/** Bring the plan inside ±15% of the time budget by scaling scene durations. */
export function fitPlanToBudget(plan: CoursePlan, minutes: number): CoursePlan {
  const target = minutes * 60;
  const total = plan.modules.reduce(
    (acc, m) => acc + m.scenes.reduce((a, s) => a + s.est_seconds, 0),
    0,
  );
  if (!total) return plan;
  const ratio = target / total;
  if (ratio > 0.85 && ratio < 1.15) return plan;
  const next: CoursePlan = {
    ...plan,
    modules: plan.modules.map((m) => ({
      ...m,
      scenes: m.scenes.map((s) => ({
        ...s,
        est_seconds: Math.min(240, Math.max(30, Math.round(s.est_seconds * ratio))),
      })),
    })),
  };
  next.modules = next.modules.map((m) => ({
    ...m,
    est_seconds: m.scenes.reduce((a, s) => a + s.est_seconds, 0),
    duration_min: Math.max(1, Math.round(m.scenes.reduce((a, s) => a + s.est_seconds, 0) / 60)),
  }));
  return next;
}

export type PlanOutcome = {
  plan: CoursePlan;
  title: string;
  modelled: boolean;
  generatorLabel: string;
  notes: string[];
};

export async function buildPlan(input: {
  settings: KakshaSettings;
  topic: string;
  title: string;
  depth: Depth;
  background: Background;
  minutes: number;
  sourceExcerpt: string;
  sectionTitles: string[];
  images?: LLMImage[];
}): Promise<PlanOutcome> {
  const slot = resolveLLM(input.settings, "planner");
  const notes: string[] = [];
  if (slot.available) {
    const outcome = await generateStructured<RawPlan>({
      slot,
      system: "You are a careful course planner. You output JSON only.",
      prompt: plannerPrompt({
        topic: input.topic,
        depth: input.depth,
        background: input.background,
        minutes: input.minutes,
        modules: moduleCount(input.minutes),
        sceneBudgetSeconds: input.minutes * 60,
        sourceExcerpt: input.sourceExcerpt,
      }),
      temperature: 0.2,
      maxTokens: 3000,
      images: input.images,
      validate: (value) => {
        const raw = value as RawPlan;
        if (!raw || !Array.isArray(raw.modules) || !raw.modules.length) {
          return { ok: false, issues: ["the reply had no modules"] };
        }
        const bad = raw.modules.filter(
          (m) => !Array.isArray(m.scenes) || !m.scenes.length,
        );
        if (bad.length) {
          return { ok: false, issues: ["a module had no scenes"] };
        }
        return { ok: true, value: raw };
      },
    });
    if (outcome.ok) {
      const normalised = normalisePlan(outcome.value, {
        depth: input.depth,
        background: input.background,
        minutes: input.minutes,
      });
      if (normalised) {
        if (outcome.repairs) notes.push(`The plan needed ${outcome.repairs} repair pass.`);
        return {
          plan: fitPlanToBudget(normalised, input.minutes),
          title: (outcome.value.title ?? input.title).slice(0, 140),
          modelled: true,
          generatorLabel: `Planned with ${outcome.model} (${slot.config.provider})`,
          notes,
        };
      }
      notes.push("The model's plan could not be used, so the built-in outline was used instead.");
    } else {
      notes.push(`The model could not be used for planning: ${outcome.error}`);
    }
  } else {
    notes.push(
      "No language model is configured, so the outline was drafted by Kaksha's built-in planner from your topic and material.",
    );
  }
  const plan = fitPlanToBudget(
    heuristicPlan({
      topic: input.topic,
      depth: input.depth,
      background: input.background,
      minutes: input.minutes,
      sectionTitles: input.sectionTitles,
    }),
    input.minutes,
  );
  return {
    plan,
    title: input.title,
    modelled: false,
    generatorLabel: "Drafted with Kaksha's built-in planner (no language model configured)",
    notes,
  };
}
