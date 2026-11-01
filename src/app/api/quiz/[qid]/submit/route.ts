import { db } from "@/db";
import { quizAttempts } from "@/db/schema";
import { fail, ok, errorResponse, readJson } from "@/server/http";
import { gradeAnswer } from "@/server/grading";
import { findQuestion } from "@/server/questions";
import { getSettings } from "@/server/settings";
import { sanitizeText } from "@/server/ingest";
import type { QuizAnswer } from "@/lib/dsl/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ qid: string }> }) {
  try {
    const { qid } = await params;
    const body = await readJson<{
      course_id?: unknown;
      scene_id?: unknown;
      answer?: { choice_ids?: unknown; text?: unknown };
    }>(request);

    const courseId = typeof body.course_id === "string" ? body.course_id : undefined;
    const sceneId = typeof body.scene_id === "string" ? body.scene_id : undefined;
    const found = await findQuestion(qid, courseId, sceneId);
    if (!found) return fail("not_found", "That question does not exist", 404);
    const question = found.question;

    const rawChoices = Array.isArray(body.answer?.choice_ids)
      ? body.answer!.choice_ids
          .filter((c): c is string => typeof c === "string")
          .slice(0, 12)
      : [];
    const rawText =
      typeof body.answer?.text === "string"
        ? sanitizeText(body.answer.text).slice(0, 20_000)
        : "";

    const choiceAnswer: { type: "single" | "multi"; choice_ids: string[] } | null =
      question.type === "single" || question.type === "multi"
        ? { type: question.type, choice_ids: [...new Set(rawChoices)] }
        : null;
    const textAnswer: { type: "short" | "derivation"; text: string } | null =
      question.type === "short" || question.type === "derivation"
        ? { type: question.type, text: rawText }
        : null;
    if (choiceAnswer && !choiceAnswer.choice_ids.length) {
      return fail("empty_answer", "Choose an option before submitting");
    }
    if (textAnswer && !textAnswer.text.trim()) {
      return fail("empty_answer", "Write an answer before submitting");
    }
    const answer: QuizAnswer = (choiceAnswer ?? textAnswer) as QuizAnswer;
    const result = await gradeAnswer({
      settings: await getSettings(),
      question,
      answer,
      sourceExcerpt: found.sourceExcerpt,
    });
    await db.insert(quizAttempts).values({
      course_id: found.courseId,
      question_id: qid,
      answer,
      result,
      final: true,
    });
    return ok({ result });
  } catch (error) {
    return errorResponse(error);
  }
}
