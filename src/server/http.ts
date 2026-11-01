import { NextResponse } from "next/server";

export class HttpInputError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "HttpInputError";
    this.code = code;
    this.status = status;
  }
}

export function ok<T>(data: T, init?: ResponseInit): Response {
  return NextResponse.json(data, init);
}

export function fail(code: string, message: string, status = 400): Response {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function readJson<T>(request: Request, maxBytes = 2 * 1024 * 1024): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    throw new HttpInputError("payload_too_large", "Request body is too large", 413);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new HttpInputError("payload_too_large", "Request body is too large", 413);
  }
  if (!text.trim()) {
    throw new HttpInputError("invalid_json", "Request body cannot be empty", 400);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpInputError("invalid_json", "Expected a JSON object", 400);
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof HttpInputError) throw err;
    throw new HttpInputError("invalid_json", "The request body was not valid JSON", 400);
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpInputError) {
    return fail(error.code, error.message, error.status);
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return fail("request_failed", message, 500);
}
