import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { quizAttempts } from "@/db/schema";
import { bootstrap } from "@/server/bootstrap";
import { getPlayerPayload, isUuid, touchCourse } from "@/server/courses";
import { CourseTabs } from "@/components/ui";
import { QuizView } from "@/components/quiz/QuizView";

export const dynamic = "force-dynamic";

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  await bootstrap();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [payload, attempts] = await Promise.all([
    getPlayerPayload(id),
    db
      .select({ question_id: quizAttempts.question_id, result: quizAttempts.result })
      .from(quizAttempts)
      .where(and(eq(quizAttempts.course_id, id), eq(quizAttempts.final, true))),
  ]);
  if (!payload) notFound();
  await touchCourse(id);
  const course = payload.course;
  const quizScene = course.modules.flatMap((module) => module.scenes).find((scene) => scene.kind === "quiz");
  return (
    <div className="grid12">
      <div className="col-span-4 lg:col-span-12">
        <nav className="type-label text-muted">
          <Link href="/library" className="hover:text-ink">
            Courses
          </Link>{" "}
          / <span className="text-ink">{course.title}</span>
        </nav>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <h1 className="type-h1 max-w-[24ch] text-ink">Assessment</h1>
          <p className="type-body-sm text-muted">
            Source: {course.source.label}
          </p>
        </div>
        <div className="mt-4">
          <CourseTabs courseId={id} active="quiz" />
        </div>
      </div>
      {!quizScene || quizScene.kind !== "quiz" ? (
        <div className="col-span-4 mt-8 lg:col-span-8">
          <p className="type-body border border-rule bg-surface p-6 text-muted">
            This course has no quiz scene yet. Quizzes appear when the plan includes them.
          </p>
          <Link
            href={`/courses/${id}/plan`}
            className="type-label mt-6 inline-flex items-center gap-2 border border-ink px-6 py-3 text-ink hover:bg-ink hover:text-bg"
          >
            Review the plan
          </Link>
        </div>
      ) : (
        <div id="quiz" className="col-span-4 mt-8 lg:col-span-12">
          <QuizView
            course={course}
            scene={quizScene}
            courseId={id}
            initialAttempts={attempts.map((attempt) => ({
              question_id: attempt.question_id,
              result: attempt.result ?? null,
            }))}
          />
        </div>
      )}
    </div>
  );
}
