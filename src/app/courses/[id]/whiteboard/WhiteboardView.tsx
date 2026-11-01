"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BookOpen } from "lucide-react";
import type { Course } from "@/lib/dsl/types";
import { api } from "@/lib/api";
import { Button, Tag, useToast } from "@/components/ui";
import { RichText } from "@/components/ui/Latex";
import {
  CaptionBar,
  TransportBar,
  WhiteboardStepDetails,
  WhiteboardSteps,
  useCurrentEntry,
} from "@/components/player";
import { Stage } from "@/components/player";
import { usePlayerStore } from "@/lib/player/store";
import { getPreparedScene } from "@/lib/player/computeSceneState";

export function WhiteboardView({ course }: { course: Course }) {
  const entry = useCurrentEntry();
  const goToScene = usePlayerStore((s) => s.goToScene);
  const flat = usePlayerStore((s) => s.flat);
  const toast = useToast();
  const [practice, setPractice] = useState<{
    prompt: string;
    context?: string;
    expected_approach?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Whiteboard scenes always open on the first whiteboard scene in the course.
  useEffect(() => {
    const first = flat.findIndex((item) => item.kind === "whiteboard");
    if (first >= 0 && entry && entry.kind !== "whiteboard") goToScene(first, 0);
  }, [flat, entry, goToScene]);

  const scene = entry?.scene;
  const timeline = scene && scene.kind === "whiteboard" ? getPreparedScene(scene).timeline : null;

  const askPractice = async () => {
    if (!scene) return;
    setBusy(true);
    try {
      const result = await api.post<{
        modelled: boolean;
        problem: { prompt: string; context?: string; expected_approach?: string };
      }>(`/api/courses/${course.id}/scenes/${scene.id}/practice`, {
        step_id: scene.kind === "whiteboard" ? scene.steps[0]?.id : undefined,
      });
      setPractice(result.problem);
      toast(
        result.modelled
          ? "Practice problem generated"
          : "Practice problem drafted from the step on the board",
      );
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="col-span-4 mt-8 lg:col-span-3">
        <WhiteboardSteps />
        <div className="mt-6">
          <WhiteboardStepDetails />
        </div>
      </div>
      <div className="col-span-4 mt-8 lg:col-span-6 lg:pl-6">
        {scene ? (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3">
              <h2 className="type-h3 text-ink">{scene.title}</h2>
              <div className="flex items-center gap-2">
                <Tag tone="outline">Whiteboard</Tag>
                {timeline ? (
                  <span className="type-label text-muted">
                    {scene.kind === "whiteboard" ? `${scene.steps.length} steps` : ""}
                  </span>
                ) : null}
              </div>
            </div>
            <div data-player-root data-whiteboard-player className="player-root mt-4 flex flex-col gap-3">
              <div className="stage-frame">
                <Stage scene={scene} />
              </div>
              <p className="type-label-sm text-muted md:hidden">Swipe sideways to inspect the entire board.</p>
              <CaptionBar />
              <TransportBar sceneMarkers={false} />
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-rule pt-4">
              <Button variant="secondary" onClick={askPractice} disabled={busy}>
                Generate a practice problem from this step
              </Button>
              <Link
                href={`/courses/${course.id}/quiz`}
                className="type-label inline-flex items-center gap-2 bg-accent px-6 py-3 text-[#fff] hover:bg-accent-hover"
              >
                Launch the quiz <ArrowRight size={14} strokeWidth={1.5} />
              </Link>
            </div>
            {practice ? (
              <div className="mt-6 border border-rule bg-surface p-4">
                <p className="type-label text-accent">Practice problem</p>
                <RichText text={practice.prompt} className="type-body mt-2 text-ink" as="p" />
                {practice.context ? (
                  <RichText
                    text={practice.context}
                    className="type-body-sm mt-2 text-muted"
                    as="div"
                  />
                ) : null}
                {practice.expected_approach ? (
                  <details className="mt-3">
                    <summary className="type-label cursor-pointer text-ink">
                      Show one way to approach it
                    </summary>
                    <RichText
                      text={practice.expected_approach}
                      className="type-body-sm mt-2 text-muted"
                      as="p"
                    />
                  </details>
                ) : null}
              </div>
            ) : null}
            <Link
              href={`/courses/${course.id}/lecture`}
              className="type-label mt-6 inline-flex items-center gap-2 border-b border-rule py-2 text-muted hover:border-accent hover:text-accent"
            >
              <BookOpen size={14} strokeWidth={1.5} /> Back to the lecture
            </Link>
          </>
        ) : null}
      </div>
    </>
  );
}
