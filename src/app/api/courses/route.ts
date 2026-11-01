import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { courses, materials } from "@/db/schema";
import { fail, ok, errorResponse, readJson } from "@/server/http";
import { isUuid, listCourses } from "@/server/courses";
import { runPlanning } from "@/server/pipeline/runner";
import { getSettings } from "@/server/settings";
import { bootstrap } from "@/server/bootstrap";
import { ttsProviderFor } from "@/server/providers/tts";
import { sanitizeText } from "@/server/ingest";
import type { Background, Depth, SourceKind } from "@/lib/dsl/types";

export const dynamic = "force-dynamic";

const VALID_DEPTHS = new Set<Depth>(["introductory", "undergraduate", "graduate"]);
const VALID_BACKGROUNDS = new Set<Background>(["beginner", "familiar", "advanced"]);

export async function GET() {
  await bootstrap();
  return ok({ courses: await listCourses() });
}

type CreateBody = {
  topic?: unknown;
  title?: unknown;
  material_ids?: unknown;
  depth?: unknown;
  background?: unknown;
  minutes?: unknown;
  voice?: { id?: unknown; speed?: unknown };
  options?: { derive_proofs?: unknown; embed_citations?: unknown; review_agent?: unknown; parallel_agents?: unknown; use_page_images?: unknown };
};

export async function POST(request: Request) {
  await bootstrap();
  try {
    const body = await readJson<CreateBody>(request);
    const topic =
      typeof body.topic === "string" ? sanitizeText(body.topic).trim().slice(0, 600) : "";
    const rawMaterialIds = Array.isArray(body.material_ids) ? body.material_ids : [];
    if (rawMaterialIds.some((id) => !isUuid(id))) {
      return fail("invalid_material_id", "One or more material IDs are not valid UUIDs", 400);
    }
    const materialIds = [...new Set(rawMaterialIds.filter(isUuid))];
    if (!topic && !materialIds.length) {
      return fail("no_input", "Enter a topic or attach some material first", 400);
    }

    if (body.depth !== undefined && !VALID_DEPTHS.has(body.depth as Depth)) {
      return fail(
        "invalid_depth",
        "Depth must be introductory, undergraduate, or graduate",
        400,
      );
    }
    if (
      body.background !== undefined &&
      !VALID_BACKGROUNDS.has(body.background as Background)
    ) {
      return fail("invalid_background", "Background must be beginner, familiar, or advanced", 400);
    }
    const depth: Depth = VALID_DEPTHS.has(body.depth as Depth)
      ? (body.depth as Depth)
      : "undergraduate";
    const background: Background = VALID_BACKGROUNDS.has(body.background as Background)
      ? (body.background as Background)
      : "familiar";

    const rawMinutes = body.minutes !== undefined ? Number(body.minutes) : 30;
    if (!Number.isFinite(rawMinutes)) {
      return fail("invalid_minutes", "Minutes must be a finite number between 15 and 90", 400);
    }
    const minutesTarget = Math.min(90, Math.max(15, Math.round(rawMinutes)));

    let attachedMaterials: { id: string; label: string; kind: SourceKind }[] = [];
    if (materialIds.length) {
      attachedMaterials = await db
        .select({ id: materials.id, label: materials.label, kind: materials.kind })
        .from(materials)
        .where(inArray(materials.id, materialIds));
      if (attachedMaterials.length !== materialIds.length) {
        return fail("material_not_found", "One or more attached materials do not exist", 404);
      }
    }

    const settings = await getSettings();
    if ((body.options?.review_agent !== undefined && typeof body.options.review_agent !== "boolean") ||
        (body.options?.parallel_agents !== undefined && typeof body.options.parallel_agents !== "boolean")) {
      return fail("invalid_options", "Review agent and parallel agents must be true or false", 400);
    }
    const provider = ttsProviderFor(settings);
    const voices = await provider.voices().catch(() => []);
    const requestedVoice =
      typeof body.voice?.id === "string" ? body.voice.id.trim().slice(0, 64) : undefined;
    const voiceId =
      requestedVoice &&
      (voices.some((v) => v.id === requestedVoice) || requestedVoice === "captions")
        ? requestedVoice
        : settings.tts.default_voice;
    const rawSpeed =
      body.voice?.speed !== undefined ? Number(body.voice.speed) : settings.tts.default_speed;
    const voiceSpeed = Number.isFinite(rawSpeed) ? Math.min(2, Math.max(0.75, rawSpeed)) : 1;

    const rawTitle =
      typeof body.title === "string" && body.title.trim()
        ? sanitizeText(body.title).trim()
        : topic || attachedMaterials[0]?.label || "New course";

    const sourceKind: SourceKind = attachedMaterials.length
      ? attachedMaterials[0].kind
      : "topic";
    const sourceLabel = attachedMaterials.length
      ? attachedMaterials.map((m) => m.label).join(", ")
      : "your topic (no reference material)";

    const [row] = await db
      .insert(courses)
      .values({
        title: rawTitle.slice(0, 160),
        topic: topic || null,
        status: "planning",
        depth,
        background,
        minutes_target: minutesTarget,
        voice_id: voiceId,
        voice_speed: voiceSpeed,
        options: {
          derive_proofs:
            typeof body.options?.derive_proofs === "boolean" ? body.options.derive_proofs : true,
          embed_citations:
            typeof body.options?.embed_citations === "boolean"
              ? body.options.embed_citations
              : true,
          review_agent: typeof body.options?.review_agent === "boolean"
            ? body.options.review_agent : settings.generation.review_agent_default,
          parallel_agents: typeof body.options?.parallel_agents === "boolean"
            ? body.options.parallel_agents : settings.generation.parallel_agents_default,
          use_page_images: typeof body.options?.use_page_images === "boolean"
            ? body.options.use_page_images : true,
        },
        source_kind: sourceKind,
        source_label: sourceLabel,
        material_ids: materialIds,
      })
      .returning({ id: courses.id });

    void runPlanning(row.id).catch(async (error: unknown) => {
      // A course that fails to plan is removed entirely so no orphaned entry
      // shows up in the library. Scenes are cascade-deleted by the schema.
      await db.delete(courses).where(eq(courses.id, row.id));
      console.error("[lumen] planning failed", (error as Error).message);
    });
    return ok({ id: row.id, status: "planning" }, { status: 202 });
  } catch (error) {
    return errorResponse(error);
  }
}
