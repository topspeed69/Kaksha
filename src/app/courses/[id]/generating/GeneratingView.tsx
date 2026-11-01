"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CloudUpload, Loader } from "lucide-react";
import { api, subscribeToCourse } from "@/lib/api";
import { prefetchCourse } from "@/lib/course-cache";
import { Button, LinkButton, ProgressRule, Tag } from "@/components/ui";

type SceneRow = {
  id: string;
  index: number;
  kind: string;
  title: string;
  status: string;
  error: string | null;
};

type StatusPayload = { status: string; scenes: SceneRow[] };

export function GeneratingView(props: {
  courseId: string;
  title: string;
  status: string;
  materials: { label: string; status: string; section_count: number; warnings: string[] }[];
  scenes: SceneRow[];
  planReady: boolean;
  reviewAgent: boolean;
  generatorLabel: string;
}) {
  const router = useRouter();
  const [scenes, setScenes] = useState(props.scenes);
  const [status, setStatus] = useState(props.status);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (status === "ready" || status === "archived") return;
    const refreshStatus = async (navigateWhenReady: boolean) => {
      try {
        const detail = await api.get<StatusPayload>(`/api/courses/${props.courseId}?view=status`);
        setScenes(detail.scenes);
        setStatus(detail.status);
        const allReady = detail.scenes.length > 0 &&
          detail.scenes.every((scene) => scene.status === "ready");
        if (detail.status === "ready" && allReady && navigateWhenReady && !finishedRef.current) {
          finishedRef.current = true;
          void prefetchCourse(props.courseId);
          router.push(`/courses/${props.courseId}/lecture`);
        }
      } catch {
        /* SSE reconnects; the lean fallback will try again. */
      }
    };
    const unsubscribe = subscribeToCourse(props.courseId, (event) => {
      if (event.type === "scene_ready") {
        const index = Number(event.scene_index);
        setScenes((current) =>
          current.map((scene) =>
            scene.index === index
              ? {
                  ...scene,
                  status: "ready",
                  title: typeof event.title === "string" ? event.title : scene.title,
                  kind: typeof event.kind === "string" ? event.kind : scene.kind,
                  error: null,
                }
              : scene,
          ),
        );
      } else if (event.type === "scene_failed") {
        const index = Number(event.scene_index);
        setScenes((current) =>
          current.map((scene) =>
            scene.index === index
              ? { ...scene, status: "failed", error: String(event.error ?? "Generation failed") }
              : scene,
          ),
        );
      } else if (event.type === "done" || event.type === "error") {
        void refreshStatus(true);
      }
    });
    // Tiny metadata-only fallback in case an SSE frame is lost.
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refreshStatus(false);
    }, 10000);
    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [props.courseId, router, status]);

  const counts = useMemo(() => {
    let ready = 0;
    let slides = 0;
    let slidesReady = 0;
    let boards = 0;
    let boardsReady = 0;
    let quizzes = 0;
    let quizzesReady = 0;
    let firstSlide: SceneRow | undefined;
    const failed: SceneRow[] = [];
    for (const scene of scenes) {
      if (scene.status === "ready") ready += 1;
      if (scene.status === "failed") failed.push(scene);
      if (scene.kind === "slide") {
        slides += 1;
        if (scene.status === "ready") {
          slidesReady += 1;
          firstSlide ??= scene;
        }
      } else if (scene.kind === "whiteboard") {
        boards += 1;
        if (scene.status === "ready") boardsReady += 1;
      } else if (scene.kind === "quiz") {
        quizzes += 1;
        if (scene.status === "ready") quizzesReady += 1;
      }
    }
    return { ready, slides, slidesReady, boards, boardsReady, quizzes, quizzesReady, firstSlide, failed };
  }, [scenes]);
  const total = scenes.length || 1;
  const pct = Math.round((counts.ready / total) * 100);

  const stages = [
    {
      title: "Reading your material",
      detail: props.materials.length
        ? props.materials.map((m) => `${m.label}: ${m.section_count} sections parsed`).join(" · ")
        : "No material attached: the course is built from the topic alone.",
      done: true,
    },
    {
      title: "Planning modules",
      detail: props.planReady
        ? `${scenes.filter((s) => s.kind !== "quiz").length} teaching scenes outlined`
        : "Waiting for the outline",
      done: props.planReady,
    },
    { title: "Writing slides", detail: `${counts.slidesReady} of ${counts.slides} slides written`, done: counts.slides > 0 && counts.slidesReady === counts.slides },
    { title: "Drawing whiteboard steps", detail: `${counts.boardsReady} of ${counts.boards} derivations drawn`, done: counts.boards > 0 && counts.boardsReady === counts.boards },
    { title: "Creating quizzes", detail: `${counts.quizzesReady} of ${counts.quizzes} quizzes written`, done: counts.quizzes > 0 && counts.quizzesReady === counts.quizzes },
    ...(props.reviewAgent ? [{
      title: "Checking the lesson",
      detail: "An independent review is requested for each scene. Scenes without a reachable review model receive format checks only.",
      done: counts.ready === scenes.length && scenes.length > 0,
    }] : []),
    { title: "Recording narration", detail: "Narration is timed from the text unless a speech service is configured.", done: status === "ready" },
  ];

  return (
    <div className="grid12">
      <div className="col-span-4 lg:col-span-8">
        <nav className="type-label text-muted">
          <Link href="/library" className="hover:text-ink">Courses</Link> / <span className="text-ink">Generating</span>
        </nav>
        <h1 className="type-h1 mt-3 text-ink">Generating your course</h1>
        <p className="type-body-lg mt-3 text-muted">You can leave this page. We keep going.</p>
      </div>
      <div className="col-span-4 flex items-start justify-end lg:col-span-4">
        <LinkButton href="/library" variant="secondary"><CloudUpload size={14} strokeWidth={1.5} /> Back to library</LinkButton>
      </div>
      <div className="col-span-4 mt-10 lg:col-span-8">
        <div className="flex items-baseline justify-between border-b border-rule pb-3">
          <span className="type-h2 text-ink">{pct}% complete</span>
          <span className="type-label text-muted">{counts.ready} of {scenes.length} scenes ready</span>
        </div>
        <div className="mt-3"><ProgressRule value={counts.ready} max={scenes.length} /></div>
        <ol className="mt-8 divide-y divide-[var(--rule)] border-y border-rule">
          {stages.map((stage, index) => (
            <li key={stage.title} className="flex items-start gap-4 py-4">
              <span className="type-num mt-1 text-muted">{String(index + 1).padStart(2, "0")}</span>
              <div className="flex-1">
                <p className="type-body text-ink">{stage.title}</p>
                <p className="type-body-sm mt-1 text-muted">{stage.detail}</p>
              </div>
              {stage.done ? <Check size={16} strokeWidth={1.5} className="mt-1 text-ink" /> : <Loader size={16} strokeWidth={1.5} className="mt-1 animate-spin text-accent" />}
            </li>
          ))}
        </ol>
        {counts.failed.length ? (
          <div className="mt-8 border border-accent p-4">
            <p className="type-label text-accent">{counts.failed.length} scene(s) failed</p>
            <ul className="mt-3 divide-y divide-[var(--rule)]">
              {counts.failed.map((scene) => (
                <li key={scene.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="flex-1">
                    <p className="type-body-sm text-ink">{scene.title}</p>
                    <p className="type-body-sm text-muted">{scene.error}</p>
                  </div>
                  <Button variant="secondary" onClick={async () => {
                    await api.post(`/api/courses/${props.courseId}/scenes/${scene.id}/retry`);
                    setScenes((current) => current.map((item) => item.id === scene.id ? { ...item, status: "generating", error: null } : item));
                    setStatus("generating");
                  }}>Retry</Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="type-body-sm mt-8 border-l border-rule pl-3 text-muted">
          Progress is stored on the server. If the app restarts, the remaining scenes are picked up where they stopped.
        </p>
      </div>
      <div className="col-span-4 mt-10 lg:col-span-4 lg:pl-8">
        <p className="type-label text-muted">Live preview</p>
        {counts.firstSlide ? (
          <div className="mt-3 border border-rule p-4">
            <Tag tone="outline">Slide</Tag>
            <p className="type-h3 mt-3 text-ink">{counts.firstSlide.title}</p>
            <p className="type-body-sm mt-2 text-muted">The first finished slide. Open the lecture to watch it narrated.</p>
            <LinkButton href={`/courses/${props.courseId}/lecture`} variant="ghost" className="mt-3">Open lecture</LinkButton>
          </div>
        ) : (
          <div className="mt-3 border border-rule p-4">
            <p className="type-body-sm text-muted">Nothing is ready yet. The first scene usually appears within a minute.</p>
          </div>
        )}
        <p className="type-label mt-6 text-muted">{props.generatorLabel}</p>
      </div>
    </div>
  );
}
