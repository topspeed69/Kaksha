"use client";

import type { Course } from "@/lib/dsl/types";
import { api } from "@/lib/api";

export type PlayerPayload = {
  course: Course;
  progress: { scene_index: number; t_ms: number; scenes_done: number[] };
};

type CacheEntry = PlayerPayload & { savedAt: number };

const DB_NAME = "kaksha-client";
const STORE = "course-player";
const MEMORY_MAX = 12;
const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<PlayerPayload | null>>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "course.id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function remember(entry: CacheEntry): void {
  memory.delete(entry.course.id);
  memory.set(entry.course.id, entry);
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
}

export async function cachePlayerPayload(payload: PlayerPayload): Promise<void> {
  const entry = { ...payload, savedAt: Date.now() };
  remember(entry);
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getCachedPlayer(courseId: string): Promise<PlayerPayload | null> {
  const hit = memory.get(courseId);
  if (hit) {
    remember(hit);
    return hit;
  }
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(courseId);
      request.onsuccess = () => {
        const entry = request.result as CacheEntry | undefined;
        if (entry?.course) {
          remember(entry);
          resolve(entry);
        } else resolve(null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Deduplicated network fetch. Useful on hover/focus and after generation. */
export function prefetchCourse(courseId: string): Promise<PlayerPayload | null> {
  const existing = inflight.get(courseId);
  if (existing) return existing;
  const task = api
    .get<PlayerPayload>(`/api/courses/${courseId}/player`)
    .then(async (payload) => {
      await cachePlayerPayload(payload);
      return payload;
    })
    .catch(() => null)
    .finally(() => inflight.delete(courseId));
  inflight.set(courseId, task);
  return task;
}

export function prefetchCourseWhenIdle(courseId: string): void {
  if (typeof window === "undefined") return;
  const run = () => void prefetchCourse(courseId);
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1500 });
  } else {
    setTimeout(run, 250);
  }
}
