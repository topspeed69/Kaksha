import { describe, expect, it, vi } from "vitest";
import { buildFixtureCourse } from "@/lib/fixtures/quantum-decoherence";
import { validateScene } from "@/lib/dsl/validate";
import type { Question, QuizScene, SlideScene } from "@/lib/dsl/types";
import { DEFAULT_SETTINGS, mergeSettings } from "@/server/settings";
import { reviewScene } from "@/server/pipeline/review";
import { sceneConcurrency } from "@/server/pipeline/runner";
import type { LLMProvider, LLMRequest } from "@/server/providers/llm";
import { usePlayerStore } from "@/lib/player/store";
import { getPreparedScene } from "@/lib/player/computeSceneState";

const fixture = buildFixtureCourse();
const slide = fixture.modules[0].scenes.find((scene) => scene.kind === "slide") as SlideScene;
const quiz = fixture.modules[1].scenes.find((scene) => scene.kind === "quiz") as QuizScene;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function fakeReviewer(reply: string) {
  const complete = vi.fn(async (_request: LLMRequest) => ({ text: reply, model: "review-test-model", provider: "fake" }));
  const provider: LLMProvider = {
    name: "fake",
    complete,
    async *stream() { yield ""; },
  };
  return {
    complete,
    slot: {
      provider,
      config: { provider: "openai" as const, model: "review-test-model" },
      slot: "reviewer" as const,
      available: true,
    },
  };
}

function reviewInput(scene = slide) {
  return {
    scene,
    courseTitle: "Quantum decoherence",
    objective: "Explain the density operator",
    depth: "undergraduate",
    settings: DEFAULT_SETTINGS,
    modelReview: true,
    chunks: [] as { id: string; text: string; page: number | null; section_ref: string | null }[],
  };
}

describe("deterministic slide/math validation", () => {
  it("rejects unrenderable equations before any model review", () => {
    const bad = clone(fixture.modules[0].scenes[1]) as SlideScene;
    const equation = bad.elements.find((e) => e.type === "equation");
    if (!equation || equation.type !== "equation") throw new Error("fixture equation missing");
    equation.latex = "\\notarealcommand{unbalanced";
    expect(validateScene(bad).some((issue) => issue.message.includes("KaTeX"))).toBe(true);
  });

  it("rejects raw and unclosed inline math instead of showing LaTeX source", () => {
    const bad = clone(slide);
    const paragraph = bad.elements.find((e) => e.type === "paragraph");
    if (!paragraph || paragraph.type !== "paragraph") throw new Error("paragraph missing");
    paragraph.text = "We have $\\rho + here";
    expect(validateScene(bad).some((issue) => issue.message.includes("unclosed"))).toBe(true);
    paragraph.text = "The matrix is \\rho and should never be raw.";
    expect(validateScene(bad).some((issue) => issue.message.includes("raw LaTeX"))).toBe(true);
    paragraph.text = "Try $\\unknowncommand{z}$";
    expect(validateScene(bad).some((issue) => issue.message.includes("KaTeX"))).toBe(true);
    paragraph.text = "Click $\\href{javascript:alert(1)}{bad}$";
    expect(validateScene(bad).some((issue) => issue.message.includes("disallowed"))).toBe(true);
  });

  it("rejects diagram nodes outside the canvas and missing edges", () => {
    const figureSlide = clone(fixture.modules[1].scenes.find((s) => s.kind === "slide" && s.elements.some((e) => e.type === "figure" && e.spec.kind === "diagram"))!) as SlideScene;
    const figure = figureSlide.elements.find((e) => e.type === "figure");
    if (!figure || figure.type !== "figure" || figure.spec.kind !== "diagram") throw new Error("fixture diagram missing");
    figure.spec.nodes[0].x = 99;
    figure.spec.edges[0].to = "missing-node";
    const issues = validateScene(figureSlide);
    expect(issues.some((i) => i.message.includes("outside"))).toBe(true);
    expect(issues.some((i) => i.message.includes("missing node"))).toBe(true);
  });

  it("rejects NaN rubric weights rather than accidentally passing the sum check", () => {
    const bad = clone(quiz);
    const derivation = bad.questions.find((q) => q.type === "derivation") as Question;
    derivation.rubric!.criteria[0].weight = Number.NaN;
    expect(validateScene(bad).some((i) => i.message.includes("finite"))).toBe(true);
  });
});

describe("independent reviewer", () => {
  it("approves a scene only after deterministic checks and an independent model verdict", async () => {
    const fake = fakeReviewer(JSON.stringify({ approved: true, summary: "Claims and narration align.", findings: [] }));
    const result = await reviewScene({ ...reviewInput(), slot: fake.slot });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("approved");
      expect(result.reviewedBy).toBe("review-test-model");
    }
    expect(fake.complete).toHaveBeenCalledTimes(1);
  });

  it("does not spend reviewer tokens if the scene fails deterministic math checks", async () => {
    const fake = fakeReviewer(JSON.stringify({ approved: true, summary: "fine", findings: [] }));
    const bad = clone(fixture.modules[0].scenes[1]) as SlideScene;
    const equation = bad.elements.find((e) => e.type === "equation");
    if (!equation || equation.type !== "equation") throw new Error("no equation");
    equation.latex = "\\invalidcommand";
    const result = await reviewScene({ ...reviewInput(bad), slot: fake.slot });
    expect(result.ok).toBe(false);
    expect(fake.complete).not.toHaveBeenCalled();
  });

  it("does not claim to have reviewed a scene when review is switched off", async () => {
    const fake = fakeReviewer(JSON.stringify({ approved: true, summary: "fine", findings: [] }));
    const result = await reviewScene({ ...reviewInput(), modelReview: false, slot: fake.slot });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("format_checked");
    expect(fake.complete).not.toHaveBeenCalled();
  });

  it("treats a blocking finding as rejection even if the model says approved", async () => {
    const fake = fakeReviewer(JSON.stringify({
      approved: true,
      summary: "One false claim needs correction.",
      findings: [{ severity: "blocking", detail: "Narration misstates the equation.", suggestion: "Correct the spoken claim." }],
    }));
    const result = await reviewScene({ ...reviewInput(), slot: fake.slot });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.findings[0].suggestion).toMatch(/spoken claim/);
  });

  it("rejects non-actionable model verdicts instead of accepting them as approved", async () => {
    const fake = fakeReviewer(JSON.stringify({ approved: false, summary: "Wrong", findings: [] }));
    const result = await reviewScene({ ...reviewInput(), slot: fake.slot });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("unavailable");
  });
});

describe("parallel scene writers", () => {
  const options = { derive_proofs: false, embed_citations: false, parallel_agents: true };
  it("runs serial by default, including a course with parallel off", () => {
    expect(sceneConcurrency({ ...options, parallel_agents: false }, DEFAULT_SETTINGS)).toBe(1);
    expect(sceneConcurrency(options, DEFAULT_SETTINGS)).toBe(1); // no configured model
  });

  it("respects configured concurrency and caps local Ollama at one", () => {
    const cloud = mergeSettings(DEFAULT_SETTINGS, {
      llm: { content: { provider: "openai", model: "model-one" } },
      generation: { max_parallel_scenes: 3 },
    });
    expect(sceneConcurrency(options, cloud)).toBe(3);
    const local = mergeSettings(cloud, { llm: { content: { provider: "ollama", model: "llama3.2" } } });
    expect(sceneConcurrency(options, local)).toBe(1);
    const absurd = mergeSettings(cloud, { generation: { max_parallel_scenes: 10_000 } });
    // The cap protects the provider from a flood of simultaneous writers.
    expect(absurd.generation.max_parallel_scenes).toBe(6);
    expect(sceneConcurrency(options, absurd)).toBe(6);
  });
});

describe("browser speech clock and mute", () => {
  it("holds the segment while browser speech is still speaking, then moves on", () => {
    usePlayerStore.getState().load(fixture);
    const store = usePlayerStore.getState();
    const first = getPreparedScene(store.flat[0].scene).timeline.segments[0];
    usePlayerStore.setState({ speechDriven: true, status: "playing" });
    store.advance(first.durationMs + 200);
    expect(usePlayerStore.getState().sceneIndex).toBe(0);
    expect(usePlayerStore.getState().tMs).toBe(first.endMs - 1);
    usePlayerStore.setState({ speechDriven: false });
    store.advance(2);
    expect(usePlayerStore.getState().tMs).toBeGreaterThanOrEqual(first.endMs);
    usePlayerStore.getState().load(fixture);
  });

  it("M mute flips state without changing the caption setting", () => {
    usePlayerStore.getState().load(fixture);
    const captions = usePlayerStore.getState().captions;
    usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().muted).toBe(true);
    expect(usePlayerStore.getState().captions).toBe(captions);
    usePlayerStore.getState().toggleMute();
    expect(usePlayerStore.getState().muted).toBe(false);
  });
});

describe("reviewer provider integration", () => {
  it("calls the reviewer slot over the OpenAI-compatible protocol", async () => {
    const http = await import("node:http");
    const server = http.createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (chunk: Buffer) => parts.push(chunk));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(parts).toString("utf8")) as {
          messages: { role: string; content: string }[];
          response_format: { type: string };
        };
        expect(body.response_format.type).toBe("json_object");
        expect(body.messages.some((message) => message.content.includes("density operator"))).toBe(true);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            approved: true,
            summary: "The terminology and narration are consistent with the objective.",
            findings: [],
          }) } }],
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No TCP address");
    const previous = process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
    process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS = "1";
    try {
      const config = mergeSettings(DEFAULT_SETTINGS, {
        llm: { reviewer: {
          provider: "openai",
          model: "review-test-model",
          base_url: `http://127.0.0.1:${address.port}/v1`,
        } },
      });
      const result = await reviewScene({ ...reviewInput(), settings: config });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.status).toBe("approved");
        expect(result.reviewedBy).toBe("review-test-model");
      }
    } finally {
      if (previous === undefined) delete process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
      else process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS = previous;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
