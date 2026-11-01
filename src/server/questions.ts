import type { Question, QuizScene, Scene } from "@/lib/dsl/types";
import { chunksByIds } from "@/server/courses";

export type FoundQuestion = {
  question: Question;
  courseId: string;
  scene: QuizScene;
  sourceExcerpt: string;
};

/** Look up a question by id inside a course (and optionally a scene). */
export async function findQuestion(
  questionId: string,
  courseId?: string,
  sceneId?: string,
): Promise<FoundQuestion | null> {
  const detail = courseId
    ? await (await import("@/server/courses")).getCourseDetail(courseId)
    : null;
  if (!detail) return null;
  const scenes: Scene[] = detail.course?.modules.flatMap((m) => m.scenes) ?? [];
  const quizScenes = scenes.filter((scene): scene is QuizScene => scene.kind === "quiz");
  for (const scene of quizScenes) {
    if (sceneId && scene.id !== sceneId) continue;
    const question = scene.questions.find((item) => item.id === questionId);
    if (question) {
      const chunks = await chunksByIds(question.sources);
      return {
        question,
        courseId: detail.course?.id ?? courseId ?? "",
        scene,
        sourceExcerpt: chunks
          .map((chunk) => `[${chunk.id}] ${chunk.text.slice(0, 800)}`)
          .join("\n\n")
          .slice(0, 6000),
      };
    }
  }
  return null;
}
