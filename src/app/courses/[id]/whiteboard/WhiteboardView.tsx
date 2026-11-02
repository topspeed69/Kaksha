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
  MobileTransport,
  StageGestures,
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
      <div className="watch-primary -mx-4 md:mx-0 md:pt-4">
        {scene ? (
          <>
            <div data-player-root data-whiteboard-player className="player-root">
              <div className="player-sticky">
                <div className="stage-frame relative">
                  <Stage scene={scene} />
                  <StageGestures />
                </div>
                <MobileTransport sceneMarkers={false} />
              </div>
              <div className="hidden md:block md:pt-2">
                <TransportBar sceneMarkers={false} />
              </div>
              <div className="px-4 pt-3 md:px-0">
                <CaptionBar />
              </div>
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-4 md:px-0">
              <div className="min-w-0">
                <p className="type-label text-accent">Whiteboard</p>
                <h2 className="scene-title mt-1 text-ink">{scene.title}</h2>
              </div>
              {timeline && scene.kind === "whiteboard" ? (
                <Tag tone="outline">{scene.steps.length} steps</Tag>
              ) : null}
            </div>

            <div className="mx-4 mt-4 flex flex-col gap-3 border-t border-rule pt-4 md:mx-0 md:flex-row md:flex-wrap md:items-center">
              <Button variant="secondary" onClick={askPractice} disabled={busy} className="max-md:w-full">
                Generate a practice problem from this step
              </Button>
              <Link
                href={`/courses/${course.id}/quiz`}
                className="type-label inline-flex min-h-11 items-center justify-center gap-2 bg-accent px-6 py-3 text-accent-ink hover:bg-accent-hover"
              >
                Launch the quiz <ArrowRight size={14} strokeWidth={1.5} />
              </Link>
            </div>
            {practice ? (
              <div className="mx-4 mt-6 border border-rule bg-surface p-4 md:mx-0">
                <p className="type-label text-accent">Practice problem</p>
                <RichText text={practice.prompt} className="type-body mt-2 text-ink" as="p" />
                {practice.context ? (
                  <RichText text={practice.context} className="type-body-sm mt-2 text-muted" as="div" />
                ) : null}
                {practice.expected_approach ? (
                  <details className="mt-3">
                    <summary className="type-label cursor-pointer text-ink">
                      Show one way to approach it
                    </summary>
                    <RichText text={practice.expected_approach} className="type-body-sm mt-2 text-muted" as="p" />
                  </details>
                ) : null}
              </div>
            ) : null}

            {/* Steps under the board below the two-column breakpoint. */}
            <div className="px-4 pt-6 md:px-0 lg:hidden">
              <WhiteboardSteps />
              <div className="mt-6">
                <WhiteboardStepDetails />
              </div>
            </div>

            <Link
              href={`/courses/${course.id}/lecture`}
              className="type-label mx-4 mt-6 inline-flex min-h-11 items-center gap-2 border-b border-rule py-2 text-muted hover:border-accent hover:text-accent md:mx-0"
            >
              <BookOpen size={14} strokeWidth={1.5} /> Back to the lecture
            </Link>
          </>
        ) : null}
      </div>

      <aside className="watch-secondary hidden flex-col gap-6 pt-4 lg:flex">
        <WhiteboardSteps />
        <WhiteboardStepDetails />
      </aside>
    </>
  );
}
