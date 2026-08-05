import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, adminConfigured, readToken } from "@/lib/admin/auth";

/**
 * Protects the admin before anything renders (spec §19: "All admin routes
 * protected by middleware before rendering").
 *
 * Next 16 renamed the `middleware` convention to `proxy`; the runtime is nodejs and
 * cannot be configured, which is what lets this verify the HMAC-signed cookie with
 * node:crypto instead of shipping a second verification path.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/admin/login") {
    // Already signed in? Don't show the form again.
    if (readToken(request.cookies.get(ADMIN_COOKIE)?.value)) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  // With no ADMIN_PASSWORD / ADMIN_USERS the admin does not exist at all, rather
  // than existing unprotected.
  if (!adminConfigured()) {
    return NextResponse.rewrite(new URL("/admin/login?unavailable=1", request.url));
  }

  if (readToken(request.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const login = new URL("/admin/login", request.url);
  if (pathname !== "/admin") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // API routes do their own check so they can answer 401 instead of redirecting.
  matcher: ["/admin", "/admin/:path*"],
};
