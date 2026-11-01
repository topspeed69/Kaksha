"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { Course } from "@/lib/dsl/types";
import { usePlayerStore } from "@/lib/player/store";
import {
  CaptionBar,
  ModuleTrack,
  PlayerKeyboardHint,
  PrevNextScene,
  SceneIntro,
  Stage,
  ToolsPanel,
  TranscriptPanel,
  TransportBar,
  useCurrentEntry,
} from "@/components/player";
import { Button } from "@/components/ui";

export function LectureView({ course }: { course: Course }) {
  const entry = useCurrentEntry();
  const status = usePlayerStore((s) => s.status);
  const nudged = usePlayerStore((s) => s.nudged);
  const markNudged = usePlayerStore((s) => s.markNudged);
  const narration = usePlayerStore((s) => s.narration);
  const setNarration = usePlayerStore((s) => s.setNarration);
  const lastScene = entry?.sceneIndex === course.modules.flatMap((m) => m.scenes).length - 1;

  useEffect(() => {
    if (status === "ended" && !nudged) markNudged();
  }, [status, nudged, markNudged]);

  return (
    <>
      <div className="col-span-4 mt-8 lg:col-span-8">
        <SceneIntro />
        <div data-player-root className="player-root mt-4 flex flex-col gap-3">
          <div className="stage-frame">
            <Stage scene={entry?.scene ?? course.modules[0].scenes[0]} />
          </div>
          <CaptionBar />
          <TransportBar />
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <PlayerKeyboardHint />
          <PrevNextScene />
        </div>
        <div className="mt-8">
          <ModuleTrack />
        </div>
        {lastScene && status === "ended" ? (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border border-accent p-4">
            <p className="type-body text-ink">
              You reached the end of the lecture. Next: work through the whiteboard steps, then take
              the quiz.
            </p>
            <div className="flex gap-3">
              <Link
                href={`/courses/${course.id}/whiteboard`}
                className="type-label inline-flex items-center gap-2 bg-accent px-6 py-3 text-[#fff] hover:bg-accent-hover"
              >
                Next: Whiteboard
              </Link>
              <Link
                href={`/courses/${course.id}/quiz`}
                className="type-label inline-flex items-center gap-2 border border-ink px-6 py-3 text-ink hover:bg-ink hover:text-bg"
              >
                Go to the quiz
              </Link>
            </div>
          </div>
        ) : null}
      </div>
      <div className="col-span-4 mt-8 flex flex-col gap-8 lg:col-span-4 lg:pl-8">
        <TranscriptPanel />
        <ToolsPanel />
        <Button
          variant="ghost"
          onClick={() => {
            setNarration(
              narration === "auto" ? "browser" : narration === "browser" ? "captions" : "auto",
            );
          }}
          full
        >
          Voice: {narration === "auto" ? "auto (file, then browser)" : narration === "browser" ? "browser voice" : "captions only"}
        </Button>
      </div>
    </>
  );
}
