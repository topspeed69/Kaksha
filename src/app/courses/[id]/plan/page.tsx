import { notFound } from "next/navigation";
import { bootstrap } from "@/server/bootstrap";
import { getCourseDetail } from "@/server/courses";
import { PlanEditor } from "./PlanEditor";

export const dynamic = "force-dynamic";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  await bootstrap();
  const { id } = await params;
  const detail = await getCourseDetail(id);
  if (!detail) notFound();
  return (
    <PlanEditor
      courseId={id}
      title={detail.title}
      status={detail.status}
      plan={detail.plan}
      depth={detail.depth}
      background={detail.background}
      minutes={detail.minutes_target}
      sourceLabel={
        detail.materials.length
          ? detail.materials.map((m) => m.label).join(", ")
          : "your topic (no reference material)"
      }
      generatorLabel={detail.course?.generator.label ?? "Not generated yet"}
      scenes={detail.scenes}
    />
  );
}
