import { notFound } from "next/navigation";
import { bootstrap } from "@/server/bootstrap";
import { getCourseDetail } from "@/server/courses";
import { GeneratingView } from "./GeneratingView";

export const dynamic = "force-dynamic";

export default async function GeneratingPage({ params }: { params: Promise<{ id: string }> }) {
  await bootstrap();
  const { id } = await params;
  const detail = await getCourseDetail(id);
  if (!detail) notFound();
  return (
    <GeneratingView
      courseId={id}
      title={detail.title}
      status={detail.status}
      materials={detail.materials.map((m) => ({
        label: m.label,
        status: m.status,
        section_count: m.section_count,
        warnings: m.warnings,
      }))}
      scenes={detail.scenes}
      planReady={Boolean(detail.plan)}
      reviewAgent={detail.options.review_agent === true}
      generatorLabel={detail.course?.generator.label ?? "Not generated yet"}
    />
  );
}
