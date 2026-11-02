import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ACCESS_COOKIE_NAME = "kaksha_access";

function signingSecret(accessCode: string): string {
  const envSecret = process.env.KAKSHA_SECRET_KEY?.trim();
  return envSecret && envSecret.length >= 16 ? envSecret : `kaksha-fallback-key:${accessCode}`;
}

export function signAccessCookie(accessCode: string): string {
  const codeDigest = createHash("sha256").update(accessCode, "utf8").digest("hex");
  const mac = createHmac("sha256", signingSecret(accessCode))
    .update(`kaksha-access-v1|${codeDigest}`)
    .digest("base64url");
  return `v1.${mac}`;
}

export function verifyAccessCookie(
  cookieValue: string | undefined,
  accessCode: string,
): boolean {
  if (!cookieValue || !accessCode) return false;
  const expected = Buffer.from(signAccessCookie(accessCode), "utf8");
  const actual = Buffer.from(cookieValue, "utf8");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Constant-time verification of a submitted access code, independent of input length. */
export function verifySubmittedCode(submitted: string, accessCode: string): boolean {
  if (!accessCode) return true;
  const a = createHash("sha256").update(submitted, "utf8").digest();
  const b = createHash("sha256").update(accessCode, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Prevent open-redirect attacks on post-login `next` targets. */
export function safeRedirectPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "/library";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return "/library";
  }
  return raw;
}
