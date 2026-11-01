"use client";

import { SseFrameDecoder, parseTutorFrame } from "@/lib/sse";

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const payload = data as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(
      payload?.error?.code ?? "request_failed",
      payload?.error?.message ?? `Request failed (${response.status})`,
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: async <T>(path: string, form: FormData): Promise<T> => {
    const response = await fetch(path, { method: "POST", body: form });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
      const payload = data as { error?: { code?: string; message?: string } } | null;
      throw new ApiError(
        payload?.error?.code ?? "request_failed",
        payload?.error?.message ?? "Upload failed",
      );
    }
    return data as T;
  },
};

/** Subscribe to generation progress over Server-Sent Events. */
export function subscribeToCourse(
  courseId: string,
  onEvent: (event: { type: string; [key: string]: unknown }) => void,
): () => void {
  const source = new EventSource(`/api/courses/${courseId}/events`);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as { type: string });
    } catch {
      /* ignore malformed frames */
    }
  };
  source.onerror = () => {
    /* the browser retries automatically; the UI also polls course state */
  };
  return () => source.close();
}

/** Streamed tutor answer, chunk by chunk. */
export async function streamTutor(
  body: { course_id: string; scene_id: string; segment_id?: string; question: string },
  onChunk: (text: string) => void,
): Promise<void> {
  const response = await fetch("/api/tutor/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(payload?.error?.message ?? "The tutor could not be reached");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frames = new SseFrameDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const payload of frames.push(decoder.decode(value, { stream: true }))) {
        const parsed = parseTutorFrame(payload);
        if (parsed.text) onChunk(parsed.text);
      }
    }
    for (const payload of frames.push(decoder.decode())) {
      const parsed = parseTutorFrame(payload);
      if (parsed.text) onChunk(parsed.text);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
