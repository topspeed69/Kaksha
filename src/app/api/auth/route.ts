import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  signAccessCookie,
  verifySubmittedCode,
} from "@/server/auth";
import { errorResponse, fail, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const required = process.env.ACCESS_CODE?.trim();
    if (!required) {
      return NextResponse.json({ ok: true });
    }
    const body = await readJson<{ code?: unknown }>(request);
    const submitted = typeof body.code === "string" ? body.code : "";
    if (!submitted || !verifySubmittedCode(submitted, required)) {
      return fail("invalid_code", "That access code is not right", 401);
    }
    const token = signAccessCookie(required);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ACCESS_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ACCESS_COOKIE_NAME);
  return response;
}
