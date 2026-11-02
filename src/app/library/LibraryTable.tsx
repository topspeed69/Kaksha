"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import type { CourseSummary } from "@/server/courses";
import { DataTable, EmptyState, ProgressRule, StatusLabel, Tag, cn, useToast } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import { prefetchCourse } from "@/lib/course-cache";

const DEPTH_LABEL: Record<string, string> = {
  introductory: "Introductory",
  undergraduate: "Undergraduate",
  graduate: "Graduate",
};

type StatusFilter = "all" | "ready" | "generating" | "failed" | "planning";
type DepthFilter = "all" | "introductory" | "undergraduate" | "graduate";
type ProgressFilter = "all" | "new" | "in_progress" | "completed";
type SortKey = "recent" | "title" | "progress" | "oldest";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready" },
  { value: "generating", label: "Generating" },
  { value: "planning", label: "Planning" },
  { value: "failed", label: "Needs attention" },
];

const DEPTH_FILTERS: { value: DepthFilter; label: string }[] = [
  { value: "all", label: "Any depth" },
  { value: "introductory", label: "Introductory" },
  { value: "undergraduate", label: "Undergraduate" },
  { value: "graduate", label: "Graduate" },
];

const PROGRESS_FILTERS: { value: ProgressFilter; label: string }[] = [
  { value: "all", label: "Any progress" },
  { value: "new", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

const SORTS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Recently updated" },
  { value: "oldest", label: "Oldest first" },
  { value: "title", label: "Title A–Z" },
  { value: "progress", label: "Most progress" },
];

/**
 * A fixed, bounded facet set — no chips derived from course titles.
 * The old version made a filter chip per title's first word, so a library with
 * a few hundred lectures produced an unusable row of meaningless filters.
 */
export function LibraryTable({ courses: initialCourses }: { courses: CourseSummary[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [depth, setDepth] = useState<DepthFilter>("all");
  const [progress, setProgress] = useState<ProgressFilter>("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [showFilters, setShowFilters] = useState(false);
  const [courses, setCourses] = useState(initialCourses);
  const toast = useToast();

  const deleteCourse = useCallback(async (id: string) => {
    if (!window.confirm("Delete this course? This cannot be undone.")) return;
    try {
      const response = await fetch(`/api/courses/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete course");
      setCourses((current) => current.filter((c) => c.id !== id));
      toast("Course deleted");
    } catch {
      toast("Could not delete course", "error");
    }
  }, [toast]);

  const activeFilterCount =
    (status !== "all" ? 1 : 0) + (depth !== "all" ? 1 : 0) + (progress !== "all" ? 1 : 0);

  const clearFilters = () => {
    setStatus("all");
    setDepth("all");
    setProgress("all");
    setQuery("");
  };

  const counts = useMemo(() => {
    const result = { all: courses.length, ready: 0, generating: 0, planning: 0, failed: 0 };
    for (const course of courses) {
      const key = course.status as keyof typeof result;
      if (key in result && key !== "all") result[key] += 1;
      else if (course.status === "archived") result.failed += 0;
    }
    return result;
  }, [courses]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = courses.filter((course) => {
      if (needle && !`${course.title} ${course.source.label} ${course.topic ?? ""}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (status === "failed" && !["failed", "archived"].includes(course.status)) return false;
      if (status !== "all" && status !== "failed" && course.status !== status) return false;
      if (depth !== "all" && course.depth !== depth) return false;
      if (progress !== "all") {
        const done = course.progress.scenes_done;
        const total = course.progress.scenes_total;
        if (progress === "new" && done > 0) return false;
        if (progress === "completed" && (total === 0 || done < total)) return false;
        if (progress === "in_progress" && !(done > 0 && done < total)) return false;
      }
      return true;
    });

    const time = (value: string | null) => (value ? new Date(value).getTime() : 0);
    return [...list].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "oldest") return time(a.created_at) - time(b.created_at);
      if (sort === "progress") {
        const pa = a.progress.scenes_total ? a.progress.scenes_done / a.progress.scenes_total : 0;
        const pb = b.progress.scenes_total ? b.progress.scenes_done / b.progress.scenes_total : 0;
        return pb - pa || time(b.last_opened_at ?? b.updated_at) - time(a.last_opened_at ?? a.updated_at);
      }
      return time(b.last_opened_at ?? b.updated_at) - time(a.last_opened_at ?? a.updated_at);
    });
  }, [courses, query, status, depth, progress, sort]);

  if (!courses.length) {
    return (
      <EmptyState
        title="No courses yet"
        body="Start from a topic, a paper, a link or your own notes. Lumen plans the outline first, so you can edit it before anything is generated."
        action={
          <Link
            href="/create"
            className="type-label inline-flex items-center gap-2 bg-accent px-6 py-3 text-accent-ink hover:bg-accent-hover"
          >
            Plan your first course
          </Link>
        }
      />
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 border-b border-rule pb-4 md:flex md:flex-wrap md:items-center md:justify-between" suppressHydrationWarning>
        <div className="contents md:flex md:flex-wrap md:items-center md:gap-3">
          <label className="col-span-2 flex min-h-11 items-center gap-2 border border-rule px-3 md:col-auto md:min-h-0 md:py-2" suppressHydrationWarning>
            <Search size={16} strokeWidth={1.5} className="text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, topic, source"
              aria-label="Search your courses"
              className="type-body-sm w-full min-w-0 bg-transparent outline-none placeholder:text-muted md:w-56"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted hover:text-ink">
                <X size={14} />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            onClick={() => setShowFilters((value) => !value)}
            aria-expanded={showFilters}
            className={cn(
              "type-label inline-flex min-h-11 items-center justify-center gap-2 border px-3 transition-colors md:min-h-0 md:py-2",
              activeFilterCount ? "border-ink text-ink" : "border-rule text-muted hover:text-ink",
            )}
          >
            <SlidersHorizontal size={14} strokeWidth={1.5} />
            Filters {activeFilterCount ? `(${activeFilterCount})` : ""}
            <ChevronDown size={14} className={cn("transition-transform", showFilters && "rotate-180")} />
          </button>
        </div>
        <div className="contents md:flex md:items-center md:gap-3">
          {activeFilterCount || query ? (
            <button type="button" onClick={clearFilters} className="type-label order-last col-span-2 min-h-11 text-right text-accent hover:underline md:order-none md:col-auto md:min-h-0">
              Clear all
            </button>
          ) : null}
          <label className="type-label flex min-h-11 items-center gap-2 text-muted md:min-h-0">
            <span className="sr-only md:not-sr-only">Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="type-body-sm min-w-0 flex-1 border border-rule bg-bg px-2 py-2 text-ink outline-none md:flex-none md:py-1.5"
              aria-label="Sort courses"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {showFilters ? (
        <div className="grid gap-5 border-b border-rule py-4 md:grid-cols-3">
          <FacetGroup
            label="Status"
            options={STATUS_FILTERS.map((option) => ({
              ...option,
              label: `${option.label} (${counts[option.value] ?? 0})`,
            }))}
            value={status}
            onChange={(value) => setStatus(value as StatusFilter)}
          />
          <FacetGroup label="Depth" options={DEPTH_FILTERS} value={depth} onChange={(value) => setDepth(value as DepthFilter)} />
          <FacetGroup label="Progress" options={PROGRESS_FILTERS} value={progress} onChange={(value) => setProgress(value as ProgressFilter)} />
        </div>
      ) : null}

      {/* Phones get a card list: a six-column table cannot be read on a
          narrow screen without sideways scrolling. */}
      <ul className="mt-4 flex flex-col gap-3 md:hidden">
        {filtered.map((course) => {
          const total = Math.max(1, course.progress.scenes_total);
          const done = course.progress.scenes_done;
          return (
            <li key={course.id} className="border border-rule bg-bg p-4">
              <Link
                href={`/courses/${course.id}/plan`}
                className="type-body text-ink hover:text-accent"
              >
                {course.title}
              </Link>
              <p className="type-body-sm mt-1 text-muted">
                {course.source.label} · {course.scene_kinds.slide} slides
                {course.scene_kinds.quiz ? ` · ${course.scene_kinds.quiz} quiz` : ""}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <StatusLabel status={course.status} />
                <Tag tone="outline">{DEPTH_LABEL[course.depth] ?? course.depth}</Tag>
              </div>
              <div className="mt-3">
                <ProgressRule value={done} max={total} />
                <p className="type-label-sm mt-1 text-muted">
                  {done} of {total} scenes · {formatRelative(course.last_opened_at)}
                </p>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {course.status === "generating" || course.status === "planning" ? (
                  <Link
                    href={`/courses/${course.id}/generating`}
                    className="type-label border border-accent px-3 py-2.5 text-accent"
                  >
                    View progress
                  </Link>
                ) : (
                  <Link
                    href={`/courses/${course.id}/lecture`}
                    onMouseEnter={() => prefetchCourse(course.id)}
                    className="type-label border border-ink px-3 py-2.5 text-ink"
                  >
                    Open
                  </Link>
                )}
                <Link
                  href={`/courses/${course.id}/review`}
                  className="type-label border border-rule px-3 py-2.5 text-muted"
                >
                  Visual review
                </Link>
                <button
                  type="button"
                  onClick={() => deleteCourse(course.id)}
                  aria-label={`Delete ${course.title}`}
                  className="border border-rule p-2.5 text-muted hover:border-accent hover:text-accent"
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hidden md:block">
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
                <span className="type-body-sm text-muted">{DEPTH_LABEL[course.depth] ?? course.depth}</span>
              </td>
              <td className="px-3 py-4"><StatusLabel status={course.status} /></td>
              <td className="px-3 py-4">
                <ProgressRule value={done} max={total} />
                <p className="type-label-sm mt-1 text-muted">{done} of {total} scenes</p>
              </td>
              <td className="px-3 py-4">
                <span className="type-body-sm text-muted">{formatRelative(course.last_opened_at)}</span>
              </td>
              <td className="px-3 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  {course.status === "generating" || course.status === "planning" ? (
                    <Link
                      href={`/courses/${course.id}/generating`}
                      className="type-label border border-accent px-3 py-2 text-accent hover:bg-accent hover:text-accent-ink"
                    >
                      View progress
                    </Link>
                  ) : (
                    <Link
                      href={`/courses/${course.id}/lecture`}
                      onMouseEnter={() => prefetchCourse(course.id)}
                      className="type-label border border-rule px-3 py-2 text-ink hover:bg-ink hover:text-bg"
                    >
                      Open
                    </Link>
                  )}
                  {course.status === "ready" ? (
                    <Link
                      href={`/courses/${course.id}/review`}
                      className="type-label border border-rule px-3 py-2 text-muted hover:border-ink hover:text-ink"
                    >
                      Review
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => deleteCourse(course.id)}
                    aria-label={`Delete ${course.title}`}
                    className="border border-rule p-2 text-muted hover:border-accent hover:text-accent"
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
      {!filtered.length ? (
        <p className="type-body-sm py-8 text-center text-muted">
          No courses match these filters.{" "}
          <button type="button" onClick={clearFilters} className="text-accent hover:underline">Clear filters</button>
        </p>
      ) : null}
    </div>
  );
}

function FacetGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="type-label mb-2 text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={cn(
              "type-label border px-2.5 py-1.5 transition-colors",
              value === option.value
                ? "border-ink bg-ink text-bg"
                : "border-rule text-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
