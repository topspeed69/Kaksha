"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import type { Background, CoursePlan, Depth } from "@/lib/dsl/types";
import { api } from "@/lib/api";
import {
  Button,
  LinkButton,
  NumberedSection,
  SegmentedControl,
  Select,
  Tag,
  cn,
  useToast,
} from "@/components/ui";

type SceneRow = {
  id: string;
  index: number;
  module_id: string;
  kind: string;
  title: string;
  status: string;
  error: string | null;
};

export function PlanEditor(props: {
  courseId: string;
  title: string;
  status: string;
  plan: CoursePlan | null;
  depth: Depth;
  background: Background;
  minutes: number;
  sourceLabel: string;
  generatorLabel: string;
  scenes: SceneRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [plan, setPlan] = useState<CoursePlan | null>(props.plan);
  const [expanded, setExpanded] = useState<number | null>(0);
  const [depth, setDepth] = useState<Depth>(props.depth);
  const [background, setBackground] = useState<Background>(props.background);
  const [minutes, setMinutes] = useState(props.minutes);
  const [busy, setBusy] = useState(false);
  const [confirmReplan, setConfirmReplan] = useState(false);
  const [dragScene, setDragScene] = useState<{ modIdx: number; scIdx: number } | null>(null);
  const [liveStatus, setLiveStatus] = useState(props.status);
  const [planningElapsed, setPlanningElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // The plan is written by a background job. Poll until it lands so the page
  // fills in by itself instead of needing a manual reload.
  useEffect(() => {
    if (liveStatus !== "planning" && liveStatus !== "plan_ready") return;
    if (plan) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/courses/${props.courseId}?view=plan`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const payload = (await res.json()) as {
          status?: string;
          plan?: CoursePlan | null;
          title?: string;
        };
        if (cancelled) return;
        if (payload.plan) {
          setPlan(payload.plan);
          setLiveStatus("plan_ready");
          router.refresh();
        } else if (payload.status) {
          setLiveStatus(payload.status);
        }
      } catch {
        /* keep polling */
      }
    };
    void check();
    pollRef.current = setInterval(check, 2000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [liveStatus, plan, props.courseId, router]);

  // A ticking timer so a slow plan does not look frozen.
  useEffect(() => {
    if (liveStatus !== "planning") return;
    const timer = setInterval(() => setPlanningElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [liveStatus]);

  const recomputeTotals = (draft: CoursePlan): CoursePlan => {
    draft.modules = draft.modules.map((m, mi) => {
      const scenes = m.scenes.map((s, si) => ({ ...s, index: si }));
      const est = scenes.reduce((acc, s) => acc + s.est_seconds, 0);
      return {
        ...m,
        index: mi,
        scenes,
        est_seconds: est,
        duration_min: Math.max(1, Math.round(est / 60)),
      };
    });
    return draft;
  };

  const mutatePlan = (fn: (draft: CoursePlan) => void) => {
    if (!plan) return;
    const next = JSON.parse(JSON.stringify(plan)) as CoursePlan;
    fn(next);
    setPlan(recomputeTotals(next));
  };

  const totalScenes = plan?.modules.reduce((acc, m) => acc + m.scenes.length, 0) ?? 0;
  const totalMinutes =
    Math.round((plan?.modules.reduce((acc, m) => acc + m.est_seconds, 0) ?? 0) / 60) ||
    props.minutes;
  const quizCount = plan?.modules.reduce(
    (acc, m) => acc + m.scenes.filter((s) => s.kind === "quiz").length,
    0,
  );

  const save = async (next: CoursePlan) => {
    setBusy(true);
    try {
      const res = await api.put<{ plan: CoursePlan }>(`/api/courses/${props.courseId}/plan`, {
        plan: next,
      });
      if (res.plan) setPlan(res.plan);
      toast("Plan saved");
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    try {
      if (plan) await api.put(`/api/courses/${props.courseId}/plan`, { plan });
      await api.post(`/api/courses/${props.courseId}/generate`);
      router.push(`/courses/${props.courseId}/generating`);
    } catch (error) {
      toast((error as Error).message, "error");
      setBusy(false);
    }
  };

  const replan = async () => {
    setBusy(true);
    try {
      const res = await api.put<{ plan: CoursePlan | null }>(`/api/courses/${props.courseId}/plan`, {
        replan: true,
        plan: { ...plan, depth, background, minutes_target: minutes },
      });
      if (res.plan) setPlan(res.plan);
      toast("Re-planned with the new settings");
      router.refresh();
      setConfirmReplan(false);
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid12">
      <div className="col-span-4 lg:col-span-8">
        <nav className="type-label hidden text-muted md:block">
          <a href="/library" className="hover:text-ink">
            Courses
          </a>{" "}
          / <span className="text-ink">Course plan</span>
        </nav>
        <h1 className="type-h1 mt-3 text-ink">{props.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Tag tone="outline">Source: {props.sourceLabel}</Tag>
          <Tag tone="outline">Depth: {depth}</Tag>
          <Tag tone="outline">{totalMinutes} min planned</Tag>
          <span className="type-label text-muted">{props.generatorLabel}</span>
        </div>
      </div>

      <div className="order-last col-span-4 lg:order-none lg:col-span-4 lg:pl-8 lg:pt-12">
        <div className="border border-rule p-4 md:p-6 lg:sticky lg:top-6">
          <h2 className="type-label text-muted">Curriculum summary</h2>
          <dl className="mt-4 divide-y divide-[var(--rule)] border-y border-rule">
            {[
              { label: "Modules", value: String(plan?.modules.length ?? 0).padStart(2, "0") },
              { label: "Scenes", value: `${totalScenes} total` },
              { label: "Quizzes", value: `${quizCount ?? 0} scene${quizCount === 1 ? "" : "s"}` },
              { label: "Planned time", value: `${totalMinutes} minutes` },
              { label: "Depth", value: depth },
            ].map((item) => (
              <div key={item.label} className="flex items-baseline justify-between gap-4 py-3">
                <dt className="type-body-sm text-muted">{item.label}</dt>
                <dd className="type-body-sm text-ink">{item.value}</dd>
              </div>
            ))}
          </dl>
          <div className="hidden md:block">
            <Button
              variant="primary"
              full
              className="mt-6"
              onClick={generate}
              disabled={busy || !plan}
            >
              Generate lecture <ArrowRight size={14} strokeWidth={1.5} />
            </Button>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setConfirmReplan((value) => !value)}
              className="type-label text-left text-muted underline decoration-[var(--rule)] hover:text-accent max-md:min-h-11"
            >
              Change depth, time or background
            </button>
            <LinkButton
              href={`/courses/${props.courseId}/lecture`}
              variant="ghost"
              className="w-full justify-start"
            >
              Open the lecture
            </LinkButton>
            <LinkButton
              href={`/courses/${props.courseId}/review`}
              variant="ghost"
              className="w-full justify-start"
            >
              Visual review of every slide
            </LinkButton>
          </div>
          {confirmReplan ? (
            <div className="mt-4 border border-rule p-4">
              <p className="type-body-sm text-muted">
                Changing these re-writes the outline. Scenes already generated are discarded.
              </p>
              <div className="mt-4 space-y-4">
                <SegmentedControl
                  name="Depth"
                  value={depth}
                  onChange={setDepth}
                  options={[
                    { value: "introductory", label: "Introductory" },
                    { value: "undergraduate", label: "Undergraduate" },
                    { value: "graduate", label: "Graduate" },
                  ]}
                />
                <SegmentedControl
                  name="Background"
                  value={background}
                  onChange={setBackground}
                  options={[
                    { value: "beginner", label: "Beginner" },
                    { value: "familiar", label: "Familiar" },
                    { value: "advanced", label: "Advanced" },
                  ]}
                />
                <Select
                  label="Time available"
                  value={String(minutes)}
                  onChange={(value) => setMinutes(Number(value))}
                  options={[15, 30, 45, 60, 90].map((value) => ({
                    value: String(value),
                    label: `${value} minutes`,
                  }))}
                />
                <Button variant="secondary" full onClick={replan} disabled={busy}>
                  Re-plan now
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="col-span-4 mt-10 lg:col-span-8">
        <NumberedSection
          index="01"
          title="Modules and scenes"
          aside={
            plan ? (
              <Button
                variant="ghost"
                onClick={() =>
                  mutatePlan((draft) => {
                    const nextNum = draft.modules.length + 1;
                    draft.modules.push({
                      id: `mod${Date.now().toString(36)}`,
                      index: draft.modules.length,
                      title: `Module ${String(nextNum).padStart(2, "0")}`,
                      objective: "Define what the learner should master in this module.",
                      objectives: [
                        {
                          id: "obj1",
                          text: "Explain the core concept of this module",
                          bloom: "understand",
                        },
                      ],
                      prerequisites: [],
                      duration_min: 3,
                      est_seconds: 180,
                      scenes: [
                        {
                          id: `sc-${Date.now().toString(36)}-1`,
                          index: 0,
                          title: "Core idea",
                          kind: "slide",
                          intent: "Introduce the key idea clearly.",
                          est_seconds: 90,
                        },
                        {
                          id: `sc-${Date.now().toString(36)}-2`,
                          index: 1,
                          title: "Check yourself",
                          kind: "quiz",
                          intent: "Short check on this module's objective.",
                          est_seconds: 90,
                        },
                      ],
                    });
                    setExpanded(draft.modules.length - 1);
                  })
                }
              >
                <Plus size={14} strokeWidth={1.5} /> Add module
              </Button>
            ) : null
          }
        />
        {!plan ? (
          <div className="type-body mt-4 border border-rule bg-surface p-6">
            <p className="text-ink">
              {liveStatus === "planning" ? "Planning your course…" : "The plan is not ready yet."}
            </p>
            <p className="mt-2 text-muted">
              {liveStatus === "planning"
                ? "Reading the topic, choosing the modules and writing the scene list. This page updates by itself."
                : "If the planner stopped, re-plan the course from the panel on the right."}
            </p>
            {liveStatus === "planning" ? (
              <div className="mt-4 flex items-center gap-3">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
                <span className="type-label-sm text-muted">
                  {Math.floor(planningElapsed / 60)}m {String(planningElapsed % 60).padStart(2, "0")}s
                  elapsed
                </span>
              </div>
            ) : null}
          </div>
        ) : (
          <ol className="mt-4 divide-y divide-[var(--rule)] border-y border-rule">
            {plan.modules.map((moduleBlock, moduleIndex) => (
              <li key={moduleBlock.id} className="py-5">
                <div className="flex items-start gap-4">
                  <span className="type-num mt-1 text-accent">
                    {String(moduleIndex + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <textarea
                        rows={1}
                        onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
                        value={moduleBlock.title}
                        aria-label="Module title"
                        onChange={(event) =>
                          mutatePlan((draft) => {
                            draft.modules[moduleIndex].title = event.target.value;
                          })
                        }
                        className="type-h3 w-full resize-none bg-transparent text-ink outline-none [field-sizing:content] focus:border-b focus:border-accent"
                      />
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          title="Move module up"
                          aria-label="Move module up"
                          disabled={moduleIndex === 0}
                          onClick={() =>
                            mutatePlan((draft) => {
                              const [moved] = draft.modules.splice(moduleIndex, 1);
                              draft.modules.splice(moduleIndex - 1, 0, moved);
                            })
                          }
                          className="border border-rule p-2.5 text-muted md:p-1 hover:text-ink disabled:opacity-30"
                        >
                          <ArrowUp size={13} strokeWidth={1.5} />
                        </button>
                        <button
                          type="button"
                          title="Move module down"
                          aria-label="Move module down"
                          disabled={moduleIndex === plan.modules.length - 1}
                          onClick={() =>
                            mutatePlan((draft) => {
                              const [moved] = draft.modules.splice(moduleIndex, 1);
                              draft.modules.splice(moduleIndex + 1, 0, moved);
                            })
                          }
                          className="border border-rule p-2.5 text-muted md:p-1 hover:text-ink disabled:opacity-30"
                        >
                          <ArrowDown size={13} strokeWidth={1.5} />
                        </button>
                        {plan.modules.length > 1 ? (
                          <button
                            type="button"
                            title="Remove module"
                            aria-label="Remove module"
                            onClick={() =>
                              mutatePlan((draft) => {
                                draft.modules.splice(moduleIndex, 1);
                              })
                            }
                            className="border border-rule p-2.5 text-muted md:p-1 hover:border-accent hover:text-accent"
                          >
                            <Trash2 size={13} strokeWidth={1.5} />
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <textarea
                      rows={1}
                      onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
                      value={moduleBlock.objective}
                      aria-label="Module objective"
                      onChange={(event) =>
                        mutatePlan((draft) => {
                          draft.modules[moduleIndex].objective = event.target.value;
                        })
                      }
                      className="type-body-sm mt-1 w-full resize-none bg-transparent text-muted outline-none [field-sizing:content] focus:border-b focus:border-accent"
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <span className="type-label text-muted">{moduleBlock.duration_min} min</span>
                      <Tag>
                        {moduleBlock.scenes.filter((s) => s.kind === "slide").length} slides
                      </Tag>
                      <Tag>
                        {moduleBlock.scenes.filter((s) => s.kind === "whiteboard").length}{" "}
                        whiteboard
                      </Tag>
                      <Tag>{moduleBlock.scenes.filter((s) => s.kind === "quiz").length} quiz</Tag>
                    </div>
                    {moduleBlock.prerequisite_note ? (
                      <p className="type-body-sm mt-3 border-l border-rule pl-3 text-muted">
                        {moduleBlock.prerequisite_note}
                        {moduleBlock.prerequisites.length
                          ? ` Assumes: ${moduleBlock.prerequisites.join(", ")}.`
                          : ""}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === moduleIndex ? null : moduleIndex)}
                      className="type-label mt-3 flex items-center gap-2 text-muted hover:text-ink max-md:min-h-11"
                    >
                      <ChevronDown
                        size={14}
                        strokeWidth={1.5}
                        className={cn(
                          "transition-transform",
                          expanded === moduleIndex && "rotate-180",
                        )}
                      />
                      {expanded === moduleIndex ? "Hide scenes" : "Show scenes"}
                    </button>
                    {expanded === moduleIndex ? (
                      <div className="mt-3">
                        <ul className="divide-y divide-[var(--rule)] border border-rule">
                          {moduleBlock.scenes.map((scene, sceneIndex) => (
                            <li
                              key={scene.id}
                              draggable
                              onDragStart={() =>
                                setDragScene({ modIdx: moduleIndex, scIdx: sceneIndex })
                              }
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => {
                                if (!dragScene || dragScene.modIdx !== moduleIndex) return;
                                if (dragScene.scIdx === sceneIndex) return;
                                mutatePlan((draft) => {
                                  const list = draft.modules[moduleIndex].scenes;
                                  const [moved] = list.splice(dragScene.scIdx, 1);
                                  list.splice(sceneIndex, 0, moved);
                                });
                                setDragScene(null);
                              }}
                              className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-3 md:flex-nowrap md:px-4"
                            >
                              <GripVertical
                                size={14}
                                strokeWidth={1.5}
                                className="mt-1.5 hidden shrink-0 cursor-grab text-muted md:block"
                              />
                              <span className="type-num mt-1 shrink-0 text-muted">
                                {moduleIndex + 1}.{sceneIndex + 1}
                              </span>
                              <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] md:basis-0">
                                <textarea
                                  rows={1}
                                  onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
                                  value={scene.title}
                                  aria-label="Scene title"
                                  onChange={(event) =>
                                    mutatePlan((draft) => {
                                      draft.modules[moduleIndex].scenes[sceneIndex].title =
                                        event.target.value;
                                    })
                                  }
                                  className="type-body w-full resize-none bg-transparent text-ink outline-none [field-sizing:content] focus:border-b focus:border-accent"
                                />
                                <textarea
                                  rows={1}
                                  onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }}
                                  value={scene.intent}
                                  aria-label="Scene intent"
                                  onChange={(event) =>
                                    mutatePlan((draft) => {
                                      draft.modules[moduleIndex].scenes[sceneIndex].intent =
                                        event.target.value;
                                    })
                                  }
                                  className="type-body-sm mt-0.5 w-full resize-none bg-transparent text-muted outline-none [field-sizing:content] focus:border-b focus:border-accent"
                                />
                              </div>
                              <div className="flex w-full flex-wrap items-center gap-1.5 md:w-auto md:shrink-0 md:flex-nowrap">
                                <select
                                  aria-label="Scene type"
                                  value={scene.kind}
                                  onChange={(event) =>
                                    mutatePlan((draft) => {
                                      const nextKind = event.target.value as
                                        | "slide"
                                        | "whiteboard"
                                        | "quiz";
                                      draft.modules[moduleIndex].scenes[sceneIndex].kind = nextKind;
                                      draft.modules[moduleIndex].scenes[sceneIndex].est_seconds =
                                        nextKind === "whiteboard" ? 120 : 90;
                                    })
                                  }
                                  className="type-label border border-rule bg-bg px-2 py-2 text-ink md:py-1"
                                >
                                  <option value="slide">Slide</option>
                                  <option value="whiteboard">Whiteboard</option>
                                  <option value="quiz">Quiz</option>
                                </select>
                                <span className="type-label px-1 text-muted">
                                  {Math.round(scene.est_seconds / 60) || 1}m
                                </span>
                                <button
                                  type="button"
                                  title="Move scene up"
                                  aria-label="Move scene up"
                                  disabled={sceneIndex === 0}
                                  onClick={() =>
                                    mutatePlan((draft) => {
                                      const list = draft.modules[moduleIndex].scenes;
                                      const [moved] = list.splice(sceneIndex, 1);
                                      list.splice(sceneIndex - 1, 0, moved);
                                    })
                                  }
                                  className="border border-rule p-2.5 text-muted md:p-1 hover:text-ink disabled:opacity-30"
                                >
                                  <ArrowUp size={12} strokeWidth={1.5} />
                                </button>
                                <button
                                  type="button"
                                  title="Move scene down"
                                  aria-label="Move scene down"
                                  disabled={sceneIndex === moduleBlock.scenes.length - 1}
                                  onClick={() =>
                                    mutatePlan((draft) => {
                                      const list = draft.modules[moduleIndex].scenes;
                                      const [moved] = list.splice(sceneIndex, 1);
                                      list.splice(sceneIndex + 1, 0, moved);
                                    })
                                  }
                                  className="border border-rule p-2.5 text-muted md:p-1 hover:text-ink disabled:opacity-30"
                                >
                                  <ArrowDown size={12} strokeWidth={1.5} />
                                </button>
                                {moduleBlock.scenes.length > 1 ? (
                                  <button
                                    type="button"
                                    title="Remove scene"
                                    aria-label="Remove scene"
                                    onClick={() =>
                                      mutatePlan((draft) => {
                                        draft.modules[moduleIndex].scenes.splice(sceneIndex, 1);
                                      })
                                    }
                                    className="border border-rule p-2.5 text-muted md:p-1 hover:border-accent hover:text-accent"
                                  >
                                    <Trash2 size={12} strokeWidth={1.5} />
                                  </button>
                                ) : null}
                              </div>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          onClick={() =>
                            mutatePlan((draft) => {
                              const list = draft.modules[moduleIndex].scenes;
                              list.push({
                                id: `sc-${Date.now().toString(36)}`,
                                index: list.length,
                                title: `New scene ${list.length + 1}`,
                                kind: "slide",
                                intent: "Explain one clear idea for this module.",
                                est_seconds: 90,
                              });
                            })
                          }
                          className="type-label mt-2 inline-flex items-center gap-1.5 border border-rule px-3 py-1.5 text-muted hover:border-ink hover:text-ink"
                        >
                          <Plus size={12} strokeWidth={1.5} /> Add scene
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => plan && save(plan)} disabled={busy || !plan}>
            Save changes
          </Button>
          <p className="type-label text-muted">
            Drag or use arrows to reorder, switch scene types, or remove scenes before generating.
          </p>
        </div>
        {props.scenes.some((scene) => scene.error) ? (
          <div className="mt-6 border border-accent p-4">
            <p className="type-label text-accent">Some scenes failed to generate</p>
            <ul className="mt-2 space-y-2">
              {props.scenes
                .filter((scene) => scene.error)
                .map((scene) => (
                  <li key={scene.id} className="type-body-sm text-ink">
                    {scene.title}: {scene.error}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </div>
      {plan ? (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-bg px-4 pt-3 md:hidden"
          style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="type-label text-muted">
                {totalScenes} scenes · {totalMinutes} min
              </p>
              <p className="type-body-sm truncate text-ink">{props.title}</p>
            </div>
            <Button variant="primary" onClick={generate} disabled={busy}>
              {busy ? "Working" : "Generate"} <ArrowRight size={14} strokeWidth={1.5} />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
