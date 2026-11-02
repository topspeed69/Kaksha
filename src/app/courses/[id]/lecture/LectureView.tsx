"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Course } from "@/lib/dsl/types";
import { usePlayerStore } from "@/lib/player/store";
import {
  CaptionBar,
  MobileTransport,
  ModuleTrack,
  PlayerKeyboardHint,
  PrevNextScene,
  SceneIntro,
  Stage,
  StageGestures,
  ToolsPanel,
  TranscriptPanel,
  TransportBar,
  useCurrentEntry,
} from "@/components/player";
import { Button, cn } from "@/components/ui";
import { VisualReviewPanel } from "@/components/player/VisualReviewPanel";

type PanelKey = "next" | "transcript" | "ask" | "review";

const PANELS: { key: PanelKey; label: string }[] = [
  { key: "next", label: "Up next" },
  { key: "transcript", label: "Transcript" },
  { key: "ask", label: "Ask" },
  { key: "review", label: "Review" },
];

/**
 * Desktop: stage on the left, panels in a sidebar.
 * Phone: a video-app layout. The stage and its controls stay pinned to the top
 * while the scene title and one panel at a time scroll underneath, chosen with
 * chips (Up next, Transcript, Ask, Review).
 */
export function LectureView({ course }: { course: Course }) {
  const entry = useCurrentEntry();
  const status = usePlayerStore((s) => s.status);
  const nudged = usePlayerStore((s) => s.nudged);
  const markNudged = usePlayerStore((s) => s.markNudged);
  const narration = usePlayerStore((s) => s.narration);
  const setNarration = usePlayerStore((s) => s.setNarration);
  const lastScene = entry?.sceneIndex === course.modules.flatMap((m) => m.scenes).length - 1;
  const [panel, setPanel] = useState<PanelKey>("next");

  useEffect(() => {
    if (status === "ended" && !nudged) markNudged();
  }, [status, nudged, markNudged]);

  // Below the two-column breakpoint only the chosen panel shows.
  const show = (key: PanelKey) => (panel === key ? "block" : "hidden");

  return (
    <>
      <div className="watch-primary -mx-4 md:mx-0 md:pt-4">
        <div data-player-root className="player-root">
          <div className="player-sticky">
            <div className="stage-frame relative" data-visual-review-target>
              <Stage scene={entry?.scene ?? course.modules[0].scenes[0]} />
              <StageGestures />
            </div>
            <MobileTransport />
          </div>
          <div className="hidden md:block md:pt-2">
            <TransportBar />
          </div>
          <div className="px-4 pt-3 md:px-0">
            <CaptionBar />
          </div>
        </div>

        <div className="px-4 pt-4 md:px-0">
          <SceneIntro />
        </div>

        <div className="hidden items-center justify-between gap-4 pt-3 md:flex">
          <PlayerKeyboardHint />
          <PrevNextScene />
        </div>

        <div
          role="tablist"
          aria-label="Lecture panels"
          className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-3 lg:hidden"
        >
          {PANELS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={panel === item.key}
              onClick={() => setPanel(item.key)}
              className={cn(
                "type-label min-h-11 shrink-0 border px-4 transition-colors",
                panel === item.key
                  ? "border-ink bg-ink text-bg"
                  : "border-rule text-muted active:bg-surface-2",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {lastScene && status === "ended" ? (
          <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-4 border border-accent p-4 md:mx-0">
            <p className="type-body text-ink">
              You reached the end of the lecture. Next: work through the whiteboard steps, then take
              the quiz.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link
                href={`/courses/${course.id}/whiteboard`}
                className="type-label inline-flex min-h-11 items-center justify-center gap-2 bg-accent px-5 py-3 text-accent-ink hover:bg-accent-hover"
              >
                Next: Whiteboard
              </Link>
              <Link
                href={`/courses/${course.id}/quiz`}
                className="type-label inline-flex min-h-11 items-center justify-center gap-2 border border-ink px-5 py-3 text-ink hover:bg-ink hover:text-bg"
              >
                Go to the quiz
              </Link>
            </div>
          </div>
        ) : null}

        {/* Below 1024px the "secondary" panels live here, one at a time. */}
        <div className="px-4 pb-6 md:px-0 lg:hidden">
          <div className={show("next")}><ModuleTrack /></div>
          <div className={show("transcript")}><TranscriptPanel /></div>
          <div className={show("review")}><VisualReviewPanel /></div>
          <div className={cn("flex flex-col gap-4", show("ask"))}>
            <ToolsPanel />
            <VoiceToggle />
          </div>
        </div>
      </div>

      {/* Wide screens: everything in the right column, up next first. */}
      <aside className="watch-secondary hidden flex-col gap-6 pt-4 lg:flex">
        <ModuleTrack />
        <TranscriptPanel />
        <VisualReviewPanel />
        <ToolsPanel />
        <VoiceToggle />
      </aside>
    </>
  );

  function VoiceToggle() {
    return (
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
    );
  }
}
