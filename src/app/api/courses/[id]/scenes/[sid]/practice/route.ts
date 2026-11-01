import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenes } from "@/db/schema";
import { fail, ok, errorResponse } from "@/server/http";
import { isUuid } from "@/server/courses";
import { generateStructured, resolveLLM } from "@/server/providers/llm";
import { practicePrompt } from "@/server/prompts";
import { getSettings } from "@/server/settings";
import type { WhiteboardScene } from "@/lib/dsl/types";

export const dynamic = "force-dynamic";

/** One practice problem generated from a whiteboard step. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  try {
    const { id, sid } = await params;
    if (!isUuid(id)) return fail("not_found", "That course does not exist", 404);
    const body = (await request.json().catch(() => ({}))) as { step_id?: string };

    // `sid` may be the database UUID OR the DSL scene id (e.g. "sc3") from the player!
    const rows = isUuid(sid)
      ? await db
          .select()
          .from(scenes)
          .where(and(eq(scenes.course_id, id), eq(scenes.id, sid)))
          .limit(1)
      : await db.select().from(scenes).where(eq(scenes.course_id, id));

    const row = isUuid(sid)
      ? rows[0]
      : rows.find((r) => r.json?.id === sid || (r.kind === "whiteboard" && !sid));

    if (!row?.json || row.json.kind !== "whiteboard") {
      return fail("not_whiteboard", "Practice problems come from whiteboard scenes", 422);
    }
    const scene = row.json as WhiteboardScene;
    const step =
      scene.steps.find((item) => item.id === body.step_id) ?? scene.steps[0];
    if (!step) return fail("no_steps", "This scene has no steps", 422);
    const settings = await getSettings();
    const slot = resolveLLM(settings, "tutor");
    if (!slot.available) {
      return ok({
        modelled: false,
        problem: {
          prompt: `Try this yourself: redo the step “${step.title}” without looking at the board, then check your result against the summary below.`,
          context: step.summary_latex ? `$${step.summary_latex}$` : undefined,
          reference: step.summary_latex ?? undefined,
          criteria: (step.assumptions ?? []).map((assumption) => ({
            label: "Assumption used correctly",
            description: assumption,
          })),
        },
      });
    }
    const outcome = await generateStructured<{
      prompt?: string;
      context?: string;
      expected_approach?: string;
      rubric?: {
        criteria?: { id?: string; label?: string; weight?: number; description?: string }[];
        key_points?: string[];
        reference_answer?: string;
      };
    }>({
      slot,
      system: "You write one practice problem. You output JSON only.",
      prompt: practicePrompt({
        stepTitle: step.title,
        summaryLatex: step.summary_latex ?? "",
        narration: scene.segments.map((s) => s.text).join(" ").slice(0, 1200),
        depth: "undergraduate",
      }),
      temperature: 0.4,
      maxTokens: 1200,
      validate: (value) => {
        const raw = value as { prompt?: string };
        if (!raw.prompt) return { ok: false, issues: ["the reply needs a prompt"] };
        return { ok: true, value: raw as never };
      },
    });
    if (!outcome.ok) return fail("generation_failed", outcome.error, 502);
    return ok({
      modelled: true,
      problem: {
        prompt: outcome.value.prompt,
        context: outcome.value.context,
        expected_approach: outcome.value.expected_approach,
        rubric: outcome.value.rubric,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
