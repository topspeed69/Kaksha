import { CoursePlayerPage } from "@/components/course/CoursePlayerPage";

export default async function LecturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CoursePlayerPage courseId={id} view="lecture" />;
}
