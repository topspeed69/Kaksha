import { db } from "@/db";
import { quizAttempts } from "@/db/schema";
import { fail, ok, errorResponse, readJson } from "@/server/http";
import { draftFeedback } from "@/server/grading";
import { findQuestion } from "@/server/questions";
import { getSettings } from "@/server/settings";
import { sanitizeText } from "@/server/ingest";

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
    const answerText =
      typeof body.answer?.text === "string"
        ? sanitizeText(body.answer.text).slice(0, 20_000)
        : "";
    const result = await draftFeedback({
      settings: await getSettings(),
      question: found.question,
      answer: { type: "short", text: answerText },
      sourceExcerpt: found.sourceExcerpt,
    });
    if (answerText.trim().length > 20) {
      await db.insert(quizAttempts).values({
        course_id: found.courseId,
        question_id: qid,
        answer: {
          type: "short",
          text: answerText,
        },
        final: false,
      });
    }
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  return fail("method_not_allowed", "Use POST", 405);
}
