import Link from "next/link";
import { bootstrap } from "@/server/bootstrap";
import { listCourses } from "@/server/courses";
import { LibraryTable } from "./LibraryTable";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  await bootstrap();
  const courses = await listCourses();
  const inProgress = courses.filter(
    (course) =>
      course.progress.scenes_done > 0 &&
      course.progress.scenes_done < Math.max(1, course.progress.scenes_total),
  ).length;
  const completed = courses.filter(
    (course) =>
      course.progress.scenes_total > 0 &&
      course.progress.scenes_done >= course.progress.scenes_total,
  ).length;
  return (
    <div className="grid12">
      <div className="col-span-4 flex flex-col justify-between gap-6 lg:col-span-8">
        <div>
          <h1 className="type-display text-ink">Course library</h1>
          <p className="type-body-lg measure mt-4 max-w-[54ch] text-muted">
            Every course you have planned or generated, with your real progress in each one.
          </p>
        </div>
        <dl className="flex flex-wrap gap-10 border-y border-rule py-5">
          {[
            { label: "Courses", value: courses.length },
            { label: "In progress", value: inProgress },
            { label: "Completed", value: completed },
          ].map((item) => (
            <div key={item.label}>
              <dt className="type-label text-muted">{item.label}</dt>
              <dd className="type-h2 mt-1 text-ink">{String(item.value).padStart(2, "0")}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="col-span-4 flex items-start justify-end lg:col-span-4">
        <Link
          href="/create"
          className="type-label inline-flex items-center gap-2 bg-accent px-6 py-3 text-[#fff] transition-colors hover:bg-accent-hover"
        >
          New course
        </Link>
      </div>
      <div className="col-span-4 mt-8 lg:col-span-12">
        <LibraryTable courses={courses} />
      </div>
    </div>
  );
}
