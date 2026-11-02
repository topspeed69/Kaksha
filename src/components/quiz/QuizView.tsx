"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, BookOpen, Check, ChevronDown, Save } from "lucide-react";
import type { Course, GradeResult, Question, QuizAnswer, QuizScene } from "@/lib/dsl/types";
import { api } from "@/lib/api";
import { countWords, formatShortTime } from "@/lib/format";
import { inspectAnswerMath } from "@/lib/katex";
import { Button, Tag, cn } from "@/components/ui";
import { Latex, RichText } from "@/components/ui/Latex";

type Draft = Record<string, { choice_ids: string[]; text: string }>;

export function QuizView({
  course,
  scene,
  courseId,
  initialAttempts,
}: {
  course: Course;
  scene: QuizScene;
  courseId: string;
  initialAttempts: { question_id: string; result: GradeResult | null }[];
}) {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>({});
  const [results, setResults] = useState<Record<string, GradeResult>>(() => {
    const out: Record<string, GradeResult> = {};
    for (const attempt of initialAttempts) {
      if (attempt.result) out[attempt.question_id] = attempt.result;
    }
    return out;
  });
  const [feedback, setFeedback] = useState<{
    text: string;
    confidence: number;
    hints: string[];
  } | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const question = scene.questions[index];
  const answer = draft[question.id] ?? { choice_ids: [], text: "" };
  const result = results[question.id];
  const answered = Object.keys(results).length;
  const score = useMemo(() => {
    const values = Object.values(results);
    if (!values.length) return null;
    return Math.round((values.reduce((acc, r) => acc + r.score, 0) / values.length) * 100);
  }, [results]);

  // Drafts are kept in localStorage so a refresh does not lose work.
  useEffect(() => {
    const key = `kaksha.quiz.${courseId}.${scene.id}`;
    const timer = setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored) setDraft(JSON.parse(stored) as Draft);
      } catch {
        /* ignore */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [courseId, scene.id]);

  const update = useCallback(
    (patch: Partial<{ choice_ids: string[]; text: string }>) => {
      setDraft((current) => {
        const next = {
          ...current,
          [question.id]: {
            choice_ids: patch.choice_ids ?? current[question.id]?.choice_ids ?? [],
            text: patch.text ?? current[question.id]?.text ?? "",
          },
        };
        try {
          const key = `kaksha.quiz.${courseId}.${scene.id}`;
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      setSavedAt(Date.now());
    },
    [courseId, scene.id, question.id],
  );

  // Draft feedback is debounced by at least 1.5 s after typing stops.
  useEffect(() => {
    if (question.type === "single" || question.type === "multi") return;
    if (!answer.text.trim() || answer.text.length < 20 || result) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setDraftBusy(true);
      setError(null);
      try {
        const response = await api.post<{
          feedback: string;
          confidence: number;
          hints: string[];
        }>(`/api/quiz/${question.id}/draft-feedback`, {
          course_id: courseId,
          scene_id: scene.id,
          answer: { type: question.type, text: answer.text },
        });
        setFeedback({
          text: response.feedback,
          confidence: response.confidence,
          hints: response.hints,
        });
      } catch (requestError) {
        setError((requestError as Error).message);
      } finally {
        setDraftBusy(false);
      }
    }, 1600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [answer.text, courseId, question.id, question.type, result, scene.id]);

  const submit = async () => {
    setSubmitBusy(true);
    setError(null);
    try {
      const payload: QuizAnswer =
        question.type === "single" || question.type === "multi"
          ? { type: question.type, choice_ids: answer.choice_ids }
          : { type: question.type, text: answer.text };
      const response = await api.post<{ result: GradeResult }>(
        `/api/quiz/${question.id}/submit`,
        { course_id: courseId, scene_id: scene.id, answer: payload },
      );
      setResults((current) => ({ ...current, [question.id]: response.result }));
      setFeedback(null);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setSubmitBusy(false);
    }
  };

  const mathCheck = useMemo(
    () =>
      answer.text.includes("$")
        ? inspectAnswerMath(answer.text)
        : { formulas: [], firstError: null },
    [answer.text],
  );

  const [showList, setShowList] = useState(false);

  return (
    <div className="grid12">
      <aside className="col-span-4 order-last border-rule lg:order-none lg:col-span-3 lg:border-r lg:pr-6">
        <div className="flex items-start justify-between gap-3 border-b border-rule pb-4 lg:block">
          <div>
            <p className="type-label text-muted">Current score</p>
            <p className="type-display text-ink">{score === null ? "—" : score}</p>
            <p className="type-body-sm text-muted">
              {answered} of {scene.questions.length} answered
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowList((value) => !value)}
            aria-expanded={showList}
            className="type-label flex items-center gap-2 border border-rule px-3 py-2 text-muted lg:hidden"
          >
            Questions
            <ChevronDown
              size={14}
              strokeWidth={1.5}
              className={cn("transition-transform", showList && "rotate-180")}
            />
          </button>
        </div>
        <ol
          className={cn(
            "divide-y divide-[var(--rule)] border-y border-rule",
            showList ? "block" : "hidden lg:block",
          )}
        >
          {scene.questions.map((item, itemIndex) => {
            const itemResult = results[item.id];
            const active = itemIndex === index;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setIndex(itemIndex)}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition-colors",
                    active
                      ? "border-l-4 border-l-accent bg-surface-2"
                      : "border-l-4 border-l-transparent hover:bg-surface-2",
                  )}
                >
                  <span className="type-body-sm text-ink">
                    <span className="type-num mr-2 text-muted">
                      {String(itemIndex + 1).padStart(2, "0")}
                    </span>
                    {item.prompt.slice(0, 60)}
                    {item.prompt.length > 60 ? "…" : ""}
                  </span>
                  <span className="type-label shrink-0 text-muted">
                    {itemResult
                      ? `${Math.round(itemResult.score * 100)}%`
                      : item.type === "single"
                        ? "Single choice"
                        : item.type === "multi"
                          ? "Multi select"
                          : item.type === "short"
                            ? "Short answer"
                            : "Derivation"}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-6 border-t border-rule pt-4">
          <p className="type-label text-muted">Grading criteria</p>
          <ul className="mt-3 space-y-3">
            {(question.rubric?.criteria ?? defaultCriteria()).map((criterion) => (
              <li key={criterion.id} className="border-l border-rule pl-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="type-body-sm text-ink">{criterion.label}</span>
                  <span className="type-num text-muted">
                    {Math.round(criterion.weight * 100)}%
                  </span>
                </div>
                <p className="type-body-sm text-muted">{criterion.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="col-span-4 order-first lg:order-none lg:col-span-9 lg:pl-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3">
          <p className="type-label text-accent">
            Question {String(index + 1).padStart(2, "0")} of{" "}
            {String(scene.questions.length).padStart(2, "0")}
          </p>
          <Tag tone="outline">{question.type === "single" ? "Single choice" : question.type === "multi" ? "Multi select" : question.type === "short" ? "Short answer" : "Derivation"}</Tag>
        </div>

        <div className="mt-5">
          <RichText text={question.prompt} className="type-h3 measure max-w-[62ch] text-ink" as="p" />
          {question.context ? (
            <div className="mt-4 border border-rule bg-surface px-4 py-3">
              <p className="type-label text-muted">Reference</p>
              <p className="type-body-sm mt-1 text-muted">{question.context}</p>
            </div>
          ) : null}

          {question.choices?.length ? (
            <fieldset className="mt-6">
              <legend className="type-label text-muted">
                {question.type === "multi" ? "Select every option that applies" : "Choose one option"}
              </legend>
              <div className="mt-3 divide-y divide-[var(--rule)] border border-rule">
                {question.choices.map((choice) => {
                  const selected = answer.choice_ids.includes(choice.id);
                  const isCorrect = result && question.correct?.includes(choice.id);
                  return (
                    <label
                      key={choice.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors",
                        selected ? "bg-surface-2" : "hover:bg-surface-2",
                      )}
                    >
                      <input
                        type={question.type === "multi" ? "checkbox" : "radio"}
                        name={question.id}
                        checked={selected}
                        onChange={() => {
                          if (question.type === "multi") {
                            update({
                              choice_ids: selected
                                ? answer.choice_ids.filter((id) => id !== choice.id)
                                : [...answer.choice_ids, choice.id],
                            });
                          } else {
                            update({ choice_ids: [choice.id] });
                          }
                        }}
                        className="mt-1 h-4 w-4 accent-[var(--accent)]"
                      />
                      <span>
                        <span className="type-body block text-ink">
                          <RichText text={choice.text} as="span" />
                        </span>
                        {choice.detail ? (
                          <span className="type-body-sm block text-muted">{choice.detail}</span>
                        ) : null}
                      </span>
                      {isCorrect ? (
                        <Check size={16} strokeWidth={1.5} className="ml-auto mt-1 text-accent" />
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : (
            <div className="mt-6">
              <label htmlFor="answer" className="type-label text-muted">
                Your answer
              </label>
              <textarea
                id="answer"
                value={answer.text}
                onChange={(event) => update({ text: event.target.value })}
                rows={10}
                placeholder="Write your reasoning. Inline LaTeX works between dollar signs, for example $\\tau_D = \\tau_R (\\lambda/\\Delta x)^2$."
                className="mt-2 w-full border border-rule bg-bg px-4 py-3 text-ink placeholder:text-muted"
              />
              <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
                <span className="type-label-sm text-muted">
                  {countWords(answer.text)} words
                  {savedAt ? ` · Draft saved ${formatShortTime(new Date(savedAt))}` : ""}
                </span>
                {mathCheck.firstError ? (
                  <span className="type-label-sm text-accent">
                    Formula error: {mathCheck.firstError.slice(0, 96)}
                  </span>
                ) : mathCheck.formulas.length ? (
                  <span className="type-label-sm text-muted">
                    LaTeX valid ({mathCheck.formulas.length}{" "}
                    {mathCheck.formulas.length === 1 ? "formula" : "formulas"})
                  </span>
                ) : (
                  <span className="type-label-sm text-muted">
                    Wrap formulas in $...$ for live preview
                  </span>
                )}
              </div>
              {answer.text.trim() ? (
                <div className="mt-3 border border-rule bg-surface px-4 py-3">
                  <p className="type-label text-muted">Rendered preview</p>
                  <div className="mt-2 text-ink">
                    <RichText text={answer.text} className="type-body leading-relaxed" as="div" />
                  </div>
                  {mathCheck.formulas.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-3 border-t border-rule pt-3">
                      {mathCheck.formulas.map((f, idx) => (
                        <div key={idx} className="border border-rule bg-bg px-3 py-1.5">
                          <Latex latex={f.latex} display={f.display} />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          {feedback && !result ? (
            <div className="mt-6 border border-rule bg-surface-2 p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="type-label text-accent">Draft feedback</p>
                <span className="type-label-sm text-muted">
                  Confidence {feedback.confidence.toFixed(2)} / 1.00
                </span>
              </div>
              <p className="type-body-sm mt-2 text-ink">{feedback.text}</p>
              {feedback.hints.length ? (
                <ul className="mt-3 space-y-1">
                  {feedback.hints.map((hint) => (
                    <li key={hint} className="type-body-sm text-muted">
                      — {hint}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {result ? (
            <div className="mt-6 border border-rule bg-surface p-4">
              <div className="flex items-baseline justify-between gap-4">
                <p className="type-label text-accent">Result</p>
                <p className="type-h2 text-ink">{Math.round(result.score * 100)}%</p>
              </div>
              <p className="type-body mt-2 text-ink">{result.feedback}</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <p className="type-label text-muted">You covered</p>
                  <ul className="mt-2 space-y-2">
                    {result.matched_points.length ? (
                      result.matched_points.map((point) => (
                        <li key={point} className="type-body-sm border-l border-accent pl-3 text-ink">
                          {point}
                        </li>
                      ))
                    ) : (
                      <li className="type-body-sm text-muted">Nothing marked as covered.</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="type-label text-muted">Missing</p>
                  <ul className="mt-2 space-y-2">
                    {result.missing_points.length ? (
                      result.missing_points.map((point) => (
                        <li key={point} className="type-body-sm border-l border-rule pl-3 text-muted">
                          {point}
                        </li>
                      ))
                    ) : (
                      <li className="type-body-sm text-muted">Nothing missing.</li>
                    )}
                  </ul>
                </div>
              </div>
              {result.criteria.length ? (
                <dl className="mt-4 divide-y divide-[var(--rule)] border-t border-rule">
                  {result.criteria.map((criterion) => (
                    <div key={criterion.id} className="flex items-baseline gap-4 py-2">
                      <dt className="type-body-sm w-48 shrink-0 text-ink">
                        {criteriaLabel(question, criterion.id)}
                      </dt>
                      <dd className="type-body-sm flex-1 text-muted">{criterion.comment}</dd>
                      <dd className="type-num text-ink">{Math.round(criterion.score * 100)}%</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <div className="mt-4 border-t border-rule pt-4">
                <p className="type-label text-muted">Explanation</p>
                <RichText text={question.explanation} className="type-body-sm mt-2 text-ink" as="p" />
              </div>
              {result.confidence < 0.6 ? (
                <div className="mt-4 border border-accent px-4 py-3">
                  <p className="type-body-sm text-accent">
                    AI grading may be unreliable here (confidence {result.confidence.toFixed(2)}).
                  </p>
                  {question.rubric?.reference_answer ? (
                    <details className="mt-2">
                      <summary className="type-label cursor-pointer text-ink">
                        Show reference answer
                      </summary>
                      <RichText
                        text={question.rubric.reference_answer}
                        className="type-body-sm mt-2 text-ink"
                        as="p"
                      />
                    </details>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href={`/courses/${courseId}/lecture`}
                  className="type-label inline-flex items-center gap-2 border border-ink px-4 py-3 text-ink hover:bg-ink hover:text-bg"
                >
                  <BookOpen size={14} strokeWidth={1.5} /> Jump to the lesson section
                </Link>
                {index + 1 < scene.questions.length ? (
                  <Button variant="primary" onClick={() => setIndex(index + 1)}>
                    Next question <ArrowRight size={14} strokeWidth={1.5} />
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {error ? <p className="type-body-sm mt-4 text-accent">{error}</p> : null}

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
            <Link
              href={`/courses/${courseId}/lecture`}
              className="type-label inline-flex items-center gap-2 border-b border-rule px-0 py-2 text-ink hover:border-accent"
            >
              Revise the lecture
            </Link>
            <Button variant="ghost" onClick={() => setSavedAt(Date.now())}>
              <Save size={14} strokeWidth={1.5} /> Save draft
            </Button>
            <Button variant="primary" onClick={submit} disabled={submitBusy || (!answer.choice_ids.length && !answer.text.trim())}>
              {submitBusy ? "Grading" : "Submit for grading"}
              <ArrowRight size={14} strokeWidth={1.5} />
            </Button>
            {draftBusy ? (
              <span className="type-label-sm text-muted">Reading your draft…</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function defaultCriteria() {
  return [
    {
      id: "c1",
      label: "Correctness",
      weight: 0.5,
      description: "Is the answer right?",
    },
    {
      id: "c2",
      label: "Reasoning",
      weight: 0.3,
      description: "Is the reasoning shown?",
    },
    {
      id: "c3",
      label: "Clarity",
      weight: 0.2,
      description: "Is it easy to follow?",
    },
  ];
}

function criteriaLabel(question: Question, id: string): string {
  return question.rubric?.criteria.find((criterion) => criterion.id === id)?.label ?? id;
}
