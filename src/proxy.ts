import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE_NAME, verifyAccessCookie } from "@/server/auth";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Restrict cross-origin mutating API requests to the application's own origin
  if (pathname.startsWith("/api/") && MUTATING_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host.toLowerCase();
      } catch {
        originHost = "__invalid__";
      }
      const forwardedHost = request.headers
        .get("x-forwarded-host")
        ?.split(",")[0]
        ?.trim()
        .toLowerCase();
      const host = request.headers.get("host")?.trim().toLowerCase();
      if (originHost !== forwardedHost && originHost !== host) {
        return NextResponse.json(
          {
            error: {
              code: "forbidden_origin",
              message: "Cross-origin requests are not allowed",
            },
          },
          { status: 403 },
        );
      }
    }
  }

  // Optional ACCESS_CODE gate (single-user local mode by default when unset)
  const accessCode = process.env.ACCESS_CODE?.trim();
  if (!accessCode) {
    return NextResponse.next();
  }

  if (
    pathname === "/api/health" ||
    pathname === "/api/auth" ||
    pathname === "/unlock" ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (verifyAccessCookie(cookie, accessCode)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Access code required" } },
      { status: 401 },
    );
  }

  const unlockUrl = request.nextUrl.clone();
  unlockUrl.pathname = "/unlock";
  unlockUrl.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(unlockUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
