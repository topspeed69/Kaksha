import { fail } from "@/server/http";
import { getCourseDetail, isUuid } from "@/server/courses";
import { resumePendingWork, subscribe, type GenerationEvent } from "@/server/pipeline/runner";
import { bootstrap } from "@/server/bootstrap";

export const dynamic = "force-dynamic";

/** Server-Sent Events stream of real generation progress. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) {
    return fail("not_found", "That course does not exist", 404);
  }
  await bootstrap();
  const detail = await getCourseDetail(id).catch(() => null);
  if (!detail) {
    return fail("not_found", "That course does not exist", 404);
  }
  const encoder = new TextEncoder();
  const total = detail.scenes.length;
  const done = detail.scenes.filter((s) => s.status === "ready").length;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send({ type: "step", course_id: id, step: detail.status, current: done, total });
      const unsubscribe = subscribe(id, (event: GenerationEvent) =>
        send(event as unknown as Record<string, unknown>),
      );
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        clearTimeout(hardStop);
        unsubscribe();
        onFinish();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const onFinish = subscribe(id, (event) => {
        if (event.type === "done" || event.type === "error") {
          setTimeout(cleanup, 300);
        }
      });
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          cleanup();
        }
      }, 15000);
      void resumePendingWork();
      const hardStop = setTimeout(cleanup, 3_600_000);
      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
