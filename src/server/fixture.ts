import { eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, scenes as scenesTable } from "@/db/schema";
import { buildFixtureCourse } from "@/lib/fixtures/quantum-decoherence";
import type { CoursePlan } from "@/lib/dsl/types";

/**
 * Seeds the hand authored reference course so a fresh install has something to
 * play. Runs once per database.
 */
export async function seedFixtureCourse(): Promise<string | null> {
  const existing = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.source_label, "Lumen reference fixture"))
    .limit(1);
  if (existing.length) return existing[0].id;
  const course = buildFixtureCourse();
  const plan: CoursePlan = {
    version: 1,
    depth: course.depth,
    background: course.background,
    minutes_target: course.minutes_target,
    rationale:
      "Hand authored reference course used to develop and test the player, whiteboard and grader.",
    concepts: [
      { name: "Density operator", definition: "A probability mixture of pure states." },
      { name: "Partial trace", definition: "Summing out the environment's degrees of freedom." },
      { name: "Pointer states", definition: "States that survive environmental monitoring." },
    ],
    modules: course.modules.map((module, moduleIndex) => ({
      id: module.id,
      index: moduleIndex,
      title: module.title,
      objective: module.objectives[0]?.text ?? "",
      objectives: module.objectives,
      prerequisites: module.prerequisites,
      duration_min: module.duration_min,
      est_seconds: module.scenes.reduce(
        (acc, scene) => acc + sceneDurationMsSafe(scene),
        0,
      ),
      scenes: module.scenes.map((scene, sceneIndex) => ({
        id: scene.id,
        index: sceneIndex,
        title: scene.title,
        kind: scene.kind,
        intent: scene.segments[0]?.text.slice(0, 200) ?? "",
        est_seconds: sceneDurationMsSafe(scene),
      })),
    })),
  };
  const [row] = await db
    .insert(courses)
    .values({
      title: course.title,
      topic: "Quantum decoherence",
      status: "ready",
      depth: course.depth,
      background: course.background,
      minutes_target: course.minutes_target,
      voice_id: "captions",
      voice_speed: 1,
      source_kind: "topic",
      source_label: "Lumen reference fixture",
      plan,
      document: course,
      generator_label: "Hand authored reference fixture",
      modelled: false,
    })
    .returning({ id: courses.id });
  await db.insert(scenesTable).values(
    course.modules.flatMap((module, moduleIndex) =>
      module.scenes.map((scene, sceneIndex) => ({
        course_id: row.id,
        module_id: module.id,
        index: moduleIndex * 10 + sceneIndex,
        kind: scene.kind,
        title: scene.title,
        status: "ready",
        json: scene,
        plan_intent: plan.modules[moduleIndex].scenes[sceneIndex].intent,
      })),
    ),
  );
  return row.id;
}

function sceneDurationMsSafe(scene: { segments: { estimated_duration_ms: number }[] }): number {
  return scene.segments.reduce((acc, s) => acc + (s.estimated_duration_ms ?? 0), 0) / 1000;
}
