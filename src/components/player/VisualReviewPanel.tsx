"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toPng } from "html-to-image";
import { useCurrentEntry } from "@/components/player";
import { usePlayerStore } from "@/lib/player/store";
import { Button, Tag } from "@/components/ui";

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
  checks: string[];
  reviewed_by: string;
  saw_screenshot: boolean;
};

/**
 * The visual agent reviewer, surfaced in the lecture player.
 * It captures the real rendered stage, sends it with the scene JSON to the
 * reviewer endpoint, and lists what a learner would actually hit on screen.
 * The deterministic audit alone also runs without a screenshot.
 */
export function VisualReviewPanel() {
  const courseId = usePlayerStore((state) => state.courseId);
  const entry = useCurrentEntry();
  const scene = entry?.scene;
  const [overrideAudit, setOverrideAudit] = useState<{ sceneId: string; audit: Audit } | null>(null);
  const [busy, setBusy] = useState<"capture" | "quick" | "fix" | null>(null);
  const [overrideError, setOverrideError] = useState<{ sceneId: string; error: string } | null>(null);
  const [expanded, setExpanded] = useState(true);

  const audit = overrideAudit && scene?.id === overrideAudit.sceneId ? overrideAudit.audit : null;
  const error = overrideError && scene?.id === overrideError.sceneId ? overrideError.error : null;

  const setAudit = useCallback(
    (newAudit: Audit | null) => {
      setOverrideAudit(newAudit && scene ? { sceneId: scene.id, audit: newAudit } : null);
    },
    [scene],
  );
  const setError = useCallback(
    (newError: string | null) => {
      setOverrideError(newError && scene ? { sceneId: scene.id, error: newError } : null);
    },
    [scene],
  );

  const stored = useMemo(() => {
    const visual = scene?.visual;
    if (!visual) return null;
    return {
      score: visual.score,
      verdict: visual.verdict,
      findings: visual.findings as Finding[],
      checks: [] as string[],
      reviewed_by: visual.reviewed_by,
      saw_screenshot: visual.saw_screenshot,
    } satisfies Audit;
  }, [scene]);

  const shown = audit ?? stored;

  const run = useCallback(
    async (withScreenshot: boolean) => {
      if (!courseId || !scene) return;
      setBusy(withScreenshot ? "capture" : "quick");
      setError(null);
      try {
        let image: string | undefined;
        if (withScreenshot) {
          const stage =
            document.querySelector<HTMLElement>("[data-visual-review-target]") ??
            document.querySelector<HTMLElement>("[data-player-root]");
          if (!stage) throw new Error("The stage is not on screen yet.");
          image = await toPng(stage, {
            cacheBust: true,
            pixelRatio: 1.5,
            backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
          });
        }
        const response = await fetch(
          `/api/courses/${courseId}/scenes/${scene.id}/visual-review`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image, model: withScreenshot }),
          },
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "The review could not run.");
        }
        setAudit(payload.audit as Audit);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The review could not run.");
      } finally {
        setBusy(null);
      }
    },
    [courseId, scene, setAudit, setError],
  );

  const regenerate = useCallback(async () => {
    if (!courseId || !scene) return;
    setBusy("fix");
    setError(null);
    try {
      await fetch(`/api/courses/${courseId}/scenes/${scene.id}/retry`, { method: "POST" });
      window.location.reload();
    } catch {
      setError("Could not queue a regeneration.");
      setBusy(null);
    }
  }, [courseId, scene, setError]);

  if (!scene) return null;

  const blocking = shown?.findings.filter((finding) => finding.severity === "blocking") ?? [];
  const advisory = shown?.findings.filter((finding) => finding.severity === "advisory") ?? [];

  return (
    <section className="border border-rule bg-surface" aria-label="Visual review">
      <header className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
        <div>
          <p className="type-label text-muted">Visual review</p>
          <p className="type-body-sm mt-1 text-ink">
            {shown
              ? shown.verdict === "pass"
                ? "No blocking visual defects."
                : `${blocking.length} blocking, ${advisory.length} advisory.`
              : "Check the rendered scene for overflow, collisions and missing diagrams."}
          </p>
        </div>
        {shown ? (
          <div className="flex items-center gap-2">
            <Tag tone={shown.verdict === "pass" ? "accent" : "outline"}>
              {shown.score}/100
            </Tag>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="type-label-sm text-muted hover:text-ink"
              aria-expanded={expanded}
            >
              {expanded ? "hide" : "show"}
            </button>
          </div>
        ) : null}
      </header>

      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => run(true)}
            disabled={busy !== null}
            aria-busy={busy === "capture"}
          >
            {busy === "capture" ? "Inspecting pixels…" : "Review screenshot"}
          </Button>
          <Button variant="ghost" onClick={() => run(false)} disabled={busy !== null}>
            {busy === "quick" ? "Checking…" : "Quick check"}
          </Button>
          {shown && shown.verdict === "revise" ? (
            <Button variant="primary" onClick={regenerate} disabled={busy !== null}>
              {busy === "fix" ? "Queuing…" : "Regenerate scene"}
            </Button>
          ) : null}
        </div>

        {error ? (
          <p className="type-body-sm border border-accent px-3 py-2 text-accent" role="alert">
            {error}
          </p>
        ) : null}

        {shown && expanded ? (
          <div className="mt-1 flex flex-col gap-3">
            <p className="type-label-sm text-muted">
              {shown.saw_screenshot
                ? "A vision model inspected the rendered screenshot."
                : "Deterministic layout audit (no screenshot inspected)."}{" "}
              · {shown.reviewed_by}
            </p>
            {shown.findings.length === 0 ? (
              <p className="type-body-sm text-ink">
                Readable type, one clear focus, and every required diagram is present.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {shown.findings.map((finding, index) => (
                  <li key={`${finding.area}-${index}`} className="border-l-2 border-rule-strong pl-3">
                    <p className="type-body-sm text-ink">
                      <span
                        className={
                          finding.severity === "blocking"
                            ? "type-label mr-2 text-accent"
                            : "type-label mr-2 text-muted"
                        }
                      >
                        {finding.severity === "blocking" ? "Fix" : "Consider"}
                      </span>
                      {finding.detail}
                    </p>
                    <p className="type-body-sm mt-0.5 text-muted">{finding.suggestion}</p>
                  </li>
                ))}
              </ul>
            )}
            {shown.checks.length ? (
              <p className="type-label-sm text-muted">Checked: {shown.checks.join(" · ")}</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
