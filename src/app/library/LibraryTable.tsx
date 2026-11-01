"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import type { CourseSummary } from "@/server/courses";
import { DataTable, EmptyState, ProgressRule, StatusLabel, cn, useToast } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import { prefetchCourse } from "@/lib/course-cache";

const DEPTH_LABEL: Record<string, string> = {
  introductory: "Introductory",
  undergraduate: "Undergraduate",
  graduate: "Graduate",
};

export function LibraryTable({ courses: initialCourses }: { courses: CourseSummary[] }) {
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("All");
  const [courses, setCourses] = useState(initialCourses);
  const toast = useToast();

  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const course of courses) {
      const word = course.title.split(/[\s:,]/)[0];
      if (word) set.add(word);
    }
    return ["All", ...[...set].slice(0, 5)];
  }, [courses]);

  const deleteCourse = useCallback(async (id: string) => {
    if (!window.confirm("Delete this course? This cannot be undone.")) return;
    try {
      const response = await fetch(`/api/courses/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete course");
      setCourses((current) => current.filter((c) => c.id !== id));
      toast(`Course deleted`);
    } catch {
      toast("Could not delete course", "error");
    }
  }, [toast]);

  const filtered = courses.filter((course) => {
    const matchesQuery =
      !query.trim() ||
      `${course.title} ${course.source.label}`.toLowerCase().includes(query.toLowerCase());
    const matchesSubject = subject === "All" || course.title.startsWith(subject);
    return matchesQuery && matchesSubject;
  });

  if (!courses.length) {
    return (
      <EmptyState
        title="No courses yet"
        body="Start from a topic, a paper, a link or your own notes. Lumen plans the outline first, so you can edit it before anything is generated."
        action={
          <Link
            href="/create"
            className="type-label inline-flex items-center gap-2 bg-accent px-6 py-3 text-[#fff] hover:bg-accent-hover"
          >
            Plan your first course
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <div
        className="flex flex-wrap items-center justify-between gap-4 border-b border-rule pb-4"
        suppressHydrationWarning
      >
        <label
          className="flex items-center gap-2 border border-rule px-3 py-2"
          suppressHydrationWarning
        >
          <Search size={16} strokeWidth={1.5} className="text-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your courses"
            aria-label="Search your courses"
            className="type-body-sm w-56 bg-transparent outline-none placeholder:text-muted"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {subjects.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSubject(item)}
              className={cn(
                "type-label border px-3 py-2 transition-colors",
                item === subject
                  ? "border-ink bg-ink text-bg"
                  : "border-rule text-muted hover:text-ink",
              )}
            >
              {item === "All" ? `All (${courses.length})` : item}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        head={["Course", "Depth", "Status", "Your progress", "Last opened", "Action"]}
        caption={`Showing ${filtered.length} of ${courses.length} courses`}
      >
        {filtered.map((course) => {
          const total = Math.max(1, course.progress.scenes_total);
          const done = course.progress.scenes_done;
          return (
            <tr key={course.id} className="align-top">
              <td className="px-3 py-4">
                <Link href={`/courses/${course.id}/plan`} className="type-body text-ink hover:text-accent">
                  {course.title}
                </Link>
                <p className="type-body-sm mt-1 text-muted">
                  {course.source.label} · {course.scene_kinds.slide} slides ·{" "}
                  {course.scene_kinds.whiteboard} whiteboard
                  {course.scene_kinds.quiz ? ` · ${course.scene_kinds.quiz} quiz` : ""}
                </p>
              </td>
              <td className="px-3 py-4">
                <span className="type-body-sm text-muted">
                  {DEPTH_LABEL[course.depth] ?? course.depth}
                </span>
              </td>
              <td className="px-3 py-4">
                <StatusLabel status={course.status} current={course.scenes_ready} total={total} />
              </td>
              <td className="w-56 px-3 py-4">
                <p className="type-body-sm text-ink">
                  {done} of {course.progress.scenes_total} scenes
                  {course.progress.last_quiz_score !== null
                    ? ` · Quiz ${course.progress.last_quiz_score}%`
                    : " · Quiz not started"}
                </p>
                <div className="mt-2 w-40">
                  <ProgressRule value={done} max={total} />
                </div>
              </td>
              <td className="px-3 py-4">
                <span className="type-body-sm text-muted" suppressHydrationWarning>
                  {formatRelative(course.last_opened_at)}
                </span>
              </td>
              <td className="px-3 py-4">
                <div className="flex items-center gap-2">
                  <Link
                    href={
                      course.status === "generating"
                        ? `/courses/${course.id}/generating`
                        : course.status === "plan_ready"
                          ? `/courses/${course.id}/plan`
                          : `/courses/${course.id}/lecture`
                    }
                    onPointerEnter={() => {
                      if (course.status === "ready" || course.status === "archived") void prefetchCourse(course.id);
                    }}
                    onFocus={() => {
                      if (course.status === "ready" || course.status === "archived") void prefetchCourse(course.id);
                    }}
                    className="type-label inline-flex items-center gap-2 border border-ink px-4 py-2 text-ink hover:bg-ink hover:text-bg"
                  >
                    {course.status === "generating"
                      ? "View progress"
                      : course.status === "plan_ready"
                        ? "Review plan"
                        : "Open"}
                  </Link>
                  <button
                    type="button"
                    onClick={() => deleteCourse(course.id)}
                    className="border border-rule px-2 py-1.5 text-muted transition-colors hover:border-accent hover:text-accent"
                    aria-label={`Delete ${course.title}`}
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </div>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </div>
  );
}
