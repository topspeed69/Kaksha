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
    <div className="grid12">
      <div className="col-span-4 lg:col-span-12">
        <nav className="type-label text-muted">
          <Link href="/library" className="hover:text-ink">Courses</Link> / <span className="text-ink">{course.title}</span>
        </nav>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <h1 className="type-h1 max-w-[24ch] text-ink">{course.title}</h1>
          <p className="type-body-sm text-muted">Source: {course.source.label}</p>
        </div>
        {course.source.kind === "topic" && !course.source.material_ids.length ? (
          <p className="type-body-sm mt-2 text-muted">
            Content comes from general knowledge without attached reference material and should be checked.
          </p>
        ) : null}
        <div className="mt-4"><CourseTabs courseId={courseId} active={view} /></div>
      </div>

      {!course.modules.length ? (
        <div className="col-span-4 mt-8 lg:col-span-8">
          <p className="type-body border border-rule bg-surface p-6 text-muted">
            This course has not been generated yet. Review the plan first, then generate the lecture.
          </p>
          <Link href={`/courses/${courseId}/plan`} className="type-label mt-6 inline-flex items-center bg-accent px-6 py-3 text-[#fff] hover:bg-accent-hover">Review the plan</Link>
        </div>
      ) : view === "whiteboard" && !hasWhiteboard ? (
        <div className="col-span-4 mt-8 lg:col-span-8">
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
