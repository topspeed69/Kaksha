import { mkdirSync } from "node:fs";
import path from "node:path";

const root = process.env.LUMEN_STORAGE_DIR ?? path.join(process.cwd(), "storage");

export const storageRoot = root;
export const audioDir = path.join(root, "audio");
export const uploadDir = path.join(root, "uploads");

export function ensureStorageDir(): void {
  mkdirSync(audioDir, { recursive: true });
  mkdirSync(uploadDir, { recursive: true });
}

export function secretKeyPath(): string {
  return path.join(root, "secret.key");
}

export function audioPath(hash: string): string {
  return path.join(audioDir, `${hash}.mp3`);
}

export function uploadPath(name: string): string {
  return path.join(uploadDir, name);
}
