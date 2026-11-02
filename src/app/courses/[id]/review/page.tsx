import { notFound } from "next/navigation";
import { bootstrap } from "@/server/bootstrap";
import { getCourseDetail } from "@/server/courses";
import { ReviewBoard } from "@/components/review/ReviewBoard";
import { CourseTabs } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  await bootstrap();
  const { id } = await params;
  const detail = await getCourseDetail(id);
  if (!detail) notFound();

  const scenes = detail.scenes.map((scene) => ({
    id: scene.id,
    index: scene.index,
    kind: scene.kind,
    title: scene.title,
    status: scene.status,
    visual: scene.visual ?? null,
    error: scene.error ?? null,
  }));

  return (
    <div className="grid12">
      <div className="col-span-4 lg:col-span-12">
        <CourseTabs courseId={id} active="review" />
      </div>
      <div className="col-span-4 lg:col-span-12">
    <ReviewBoard
      courseId={id}
      title={detail.title}
      scenes={scenes}
      lectureHref={`/courses/${id}/lecture`}
    />
      </div>
    </div>
  );
}
