"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getCachedPlayer, prefetchCourse, type PlayerPayload } from "@/lib/course-cache";
import { Button, CourseTabs, Skeleton } from "@/components/ui";
import { PlayerShell } from "@/components/player";
import { LectureView } from "@/app/courses/[id]/lecture/LectureView";
import { WhiteboardView } from "@/app/courses/[id]/whiteboard/WhiteboardView";

export function CoursePlayerPage({
  courseId,
  view,
}: {
  courseId: string;
  view: "lecture" | "whiteboard";
}) {
  const [payload, setPayload] = useState<PlayerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const cached = await getCachedPlayer(courseId);
    if (cached) {
      setPayload(cached);
      setLoading(false);
    }
    const fresh = await prefetchCourse(courseId);
    if (fresh) {
      setPayload(fresh);
    } else if (!cached) {
      setError("This course could not be loaded. Check the address and try again.");
    }
    setLoading(false);
  }, [courseId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await getCachedPlayer(courseId);
      if (cancelled) return;
      if (cached) {
        setPayload(cached);
        setLoading(false);
      }
      const fresh = await prefetchCourse(courseId);
      if (cancelled) return;
      if (fresh) setPayload(fresh);
      else if (!cached) setError("This course could not be loaded. Check the address and try again.");
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  if (loading && !payload) {
    return (
      <div className="grid12">
        <div className="col-span-4 lg:col-span-8">
          <Skeleton rows={3} />
          <div className="mt-8 border border-rule bg-surface" style={{ aspectRatio: "16 / 9" }} />
        </div>
        <div className="col-span-4 lg:col-span-4 lg:pl-8">
          <Skeleton rows={6} />
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="grid12">
        <div className="col-span-4 lg:col-span-8">
          <h1 className="type-h1 text-ink">Course unavailable</h1>
          <p className="type-body mt-4 text-muted">{error ?? "This course could not be loaded."}</p>
          <div className="mt-6 flex gap-3">
            <Button variant="secondary" onClick={() => void load()}>Try again</Button>
            <Link href="/library" className="type-label inline-flex items-center border border-ink px-6 py-3 text-ink hover:bg-ink hover:text-bg">Back to library</Link>
          </div>
        </div>
      </div>
    );
  }

  const course = payload.course;
  const hasWhiteboard = course.modules.some((module) =>
    module.scenes.some((scene) => scene.kind === "whiteboard"),
  );

  return (
    <div className="watch">
      <div className="watch-head">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/library" className="type-label hidden shrink-0 text-muted hover:text-ink md:inline">
            Courses /
          </Link>
          <h1 className="course-title min-w-0 truncate text-ink" title={course.title}>{course.title}</h1>
        </div>
        <div className="mt-1 flex items-center justify-between gap-4 md:mt-0">
          <CourseTabs courseId={courseId} active={view} />
          <p className="type-label hidden shrink-0 text-muted xl:block">
            {course.source.kind === "topic" && !course.source.material_ids.length
              ? "General knowledge · check claims"
              : `Source: ${course.source.label}`}
          </p>
        </div>
      </div>

      {!course.modules.length ? (
        <div className="watch-primary mt-6">
          <p className="type-body border border-rule bg-surface p-6 text-muted">
            This course has not been generated yet. Review the plan first, then generate the lecture.
          </p>
          <Link href={`/courses/${courseId}/plan`} className="type-label mt-6 inline-flex items-center bg-accent px-6 py-3 text-accent-ink hover:bg-accent-hover">Review the plan</Link>
        </div>
      ) : view === "whiteboard" && !hasWhiteboard ? (
        <div className="watch-primary mt-6">
          <p className="type-body border border-rule bg-surface p-6 text-muted">
            This course has no whiteboard scene. Derivations appear on the board only when the plan includes them.
          </p>
          <Link href={`/courses/${courseId}/lecture`} className="type-label mt-6 inline-flex items-center border border-ink px-6 py-3 text-ink hover:bg-ink hover:text-bg">Back to the lecture</Link>
        </div>
      ) : (
        <PlayerShell
          course={course}
          resume={{
            scene_index: payload.progress.scene_index,
            t_ms: payload.progress.t_ms,
            scenes_done: payload.progress.scenes_done,
          }}
        >
          {view === "lecture" ? <LectureView course={course} /> : <WhiteboardView course={course} />}
        </PlayerShell>
      )}
    </div>
  );
}
