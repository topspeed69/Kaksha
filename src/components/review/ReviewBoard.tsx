"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, RefreshCw, ScanEye, Wand2 } from "lucide-react";
import { Button, LinkButton, Tag, cn, useToast } from "@/components/ui";

type Finding = {
  severity: "blocking" | "advisory";
  area: string;
  detail: string;
  suggestion: string;
};

type Audit = {
  score: number;
  verdict: "pass" | "revise";
  findings: Finding[];
  checks?: string[];
  reviewed_by: string;
  saw_screenshot: boolean;
};

type SceneRow = {
  id: string;
  index: number;
  kind: string;
  title: string;
  status: string;
  visual: Audit | null;
  error: string | null;
};

type AuditEntry = { sceneId: string; index: number; audit: Audit };

/**
 * Post-generation visual review board.
 *
 * Every generated scene is listed with its deterministic layout audit, and the
 * learner can send the whole deck (or one scene) to the reviewer model. Any
 * scene can be rewritten, including one that already passed: the visual
 * findings are handed to the writer as a focused correction.
 */
export function ReviewBoard({
  courseId,
  title,
  scenes,
  lectureHref,
}: {
  courseId: string;
  title: string;
  scenes: SceneRow[];
  lectureHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [audits, setAudits] = useState<Record<string, Audit>>(() =>
    Object.fromEntries(
      scenes
        .filter((scene) => scene.visual)
        .map((scene) => [scene.id, scene.visual as Audit]),
    ),
  );
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, string>>({});

  const ready = useMemo(() => scenes.filter((scene) => scene.status === "ready"), [scenes]);

  const runModelReview = useCallback(
    async (sceneIds?: string[]) => {
      setReviewing(sceneIds ? "one" : "all");
      try {
        const response = await fetch(`/api/courses/${courseId}/visual-review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sceneIds ? { sceneIds } : {}),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "The review could not run.");
        }
        const entries = (payload.audits ?? []) as AuditEntry[];
        setAudits((current) => {
          const next = { ...current };
          for (const entry of entries) next[entry.sceneId] = entry.audit;
          return next;
        });
        const blocking = Number(payload.blocking ?? 0);
        toast(
          blocking
            ? `${entries.length} scenes reviewed, ${blocking} need attention`
            : `${entries.length} scenes reviewed, no blocking defects`,
        );
        router.refresh();
      } catch (error) {
        toast((error as Error).message, "error");
      } finally {
        setReviewing(null);
      }
    },
    [courseId, router, toast],
  );

  const regenerate = useCallback(
    async (sceneId: string) => {
      setRegenerating(sceneId);
      try {
        const response = await fetch(
          `/api/courses/${courseId}/scenes/${sceneId}/regenerate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ feedback: feedback[sceneId] ?? "" }),
          },
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Could not queue a rewrite.");
        }
        toast("Rewriting that scene", );
        router.push(`/courses/${courseId}/generating`);
      } catch (error) {
        toast((error as Error).message, "error");
        setRegenerating(null);
      }
    },
    [courseId, feedback, router, toast],
  );

  const totalBlocking = ready.filter((scene) =>
    (audits[scene.id]?.findings ?? []).some((finding) => finding.severity === "blocking"),
  ).length;
  const totalAdvisory = ready.filter((scene) =>
    (audits[scene.id]?.findings ?? []).some((finding) => finding.severity === "advisory"),
  ).length;

  return (
    <div className="grid12">
      <div className="col-span-4 lg:col-span-8">
        <nav className="type-label hidden text-muted md:block">
          <a href="/library" className="hover:text-ink">Courses</a>{" "}
          / <span className="text-ink">Visual review</span>
        </nav>
        <h1 className="type-h1 mt-3 text-ink">{title}</h1>
        <p className="type-body-lg measure mt-3 hidden max-w-[58ch] text-muted md:block">
          Check every scene the way a learner sees it, then rewrite the ones that need it. The
          layout audit runs free on every scene; the reviewer model looks at the scene itself.
        </p>
      </div>

      <div className="col-span-4 flex flex-col items-stretch gap-3 md:items-start lg:col-span-4 lg:items-end lg:pt-12">
        <div className="flex flex-wrap gap-2">
          <Tag tone={totalBlocking ? "accent" : "outline"}>
            {totalBlocking} blocking
          </Tag>
          <Tag tone="outline">{totalAdvisory} advisory</Tag>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => runModelReview()}
            disabled={reviewing !== null || !ready.length}
          >
            <ScanEye size={14} strokeWidth={1.5} />
            {reviewing === "all" ? "Reviewing…" : `Review all ${ready.length} scenes`}
          </Button>
          <LinkButton href={lectureHref} variant="secondary">
            Open lecture
          </LinkButton>
        </div>
      </div>

      <div className="col-span-4 mt-4 md:mt-10 lg:col-span-12">
        {ready.length === 0 ? (
          <p className="type-body border border-rule bg-surface p-6 text-muted">
            Nothing has been generated yet. Once the scenes are ready, they appear here with a
            layout audit you can act on.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--rule)] border-y border-rule">
            {ready.map((scene, position) => {
              const audit = audits[scene.id];
              const blocking = (audit?.findings ?? []).filter((f) => f.severity === "blocking");
              const advisory = (audit?.findings ?? []).filter((f) => f.severity === "advisory");
              const clean = !blocking.length && !advisory.length;
              return (
                <li key={scene.id} className="py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="type-num text-muted">
                          {String(position + 1).padStart(2, "0")}
                        </span>
                        <Tag tone="outline">{scene.kind}</Tag>
                        <p className="type-body text-ink">{scene.title}</p>
                      </div>

                      {audit ? (
                        <div className="mt-3 space-y-2">
                          <p className="type-label-sm text-muted">
                            {audit.reviewed_by}
                            {audit.saw_screenshot ? " · inspected the render" : " · checked the scene data"}
                            {" · "}
                            {audit.score}/100
                          </p>
                          {clean ? (
                            <p className="type-body-sm flex items-center gap-2 text-ink">
                              <Check size={14} strokeWidth={1.5} className="text-accent" />
                              No visual defects found.
                            </p>
                          ) : (
                            <ul className="space-y-1.5">
                              {[...blocking, ...advisory].map((finding, i) => (
                                <li
                                  key={i}
                                  className={cn(
                                    "border-l-2 pl-3",
                                    finding.severity === "blocking" ? "border-accent" : "border-rule-strong",
                                  )}
                                >
                                  <p className="type-body-sm text-ink">
                                    {finding.severity === "blocking" ? (
                                      <AlertTriangle
                                        size={12}
                                        strokeWidth={1.5}
                                        className="mr-1.5 inline text-accent"
                                      />
                                    ) : null}
                                    {finding.detail}
                                  </p>
                                  <p className="type-body-sm text-muted">{finding.suggestion}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ) : (
                        <p className="type-body-sm mt-2 text-muted">
                          Not audited yet. The layout audit runs automatically when a scene is
                          generated; use “Review” to have the reviewer model look at it.
                        </p>
                      )}
                    </div>

                    <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => runModelReview([scene.id])}
                          disabled={reviewing !== null}
                        >
                          <ScanEye size={14} strokeWidth={1.5} />
                          Review
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => regenerate(scene.id)}
                          disabled={regenerating !== null}
                        >
                          <RefreshCw size={14} strokeWidth={1.5} />
                          {regenerating === scene.id ? "Queueing…" : "Rewrite"}
                        </Button>
                      </div>
                      <label className="block">
                        <span className="sr-only">What to change in this scene</span>
                        <input
                          value={feedback[scene.id] ?? ""}
                          onChange={(event) =>
                            setFeedback((current) => ({ ...current, [scene.id]: event.target.value }))
                          }
                          placeholder="Optional: what should change?"
                          className="type-body-sm w-full border border-rule bg-bg px-3 py-2 text-ink outline-none placeholder:text-muted focus:border-ink sm:w-64"
                        />
                      </label>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {scenes.some((scene) => scene.status === "failed") ? (
          <div className="mt-8 border border-accent p-4">
            <p className="type-label text-accent">Some scenes failed</p>
            <ul className="mt-3 space-y-2">
              {scenes
                .filter((scene) => scene.status === "failed")
                .map((scene) => (
                  <li key={scene.id} className="type-body-sm text-ink">
                    {scene.title}
                    {scene.error ? (
                      <span className="block text-muted">{scene.error.slice(0, 240)}</span>
                    ) : null}
                  </li>
                ))}
            </ul>
            <LinkButton href={`/courses/${courseId}/generating`} variant="secondary" className="mt-4">
              <Wand2 size={14} strokeWidth={1.5} />
              Retry with the smarter model
            </LinkButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
