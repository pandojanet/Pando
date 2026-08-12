import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, adminConfigured, readToken } from "@/lib/admin/auth";
import { adminCredentials } from "@/lib/server/admin-auth";

/**
 * Protects the admin before anything renders (spec §19: "All admin routes
 * protected by middleware before rendering").
 *
 * Next 16 renamed the `middleware` convention to `proxy`; the runtime is nodejs and
 * cannot be configured, which is what lets this verify the HMAC-signed cookie with
 * node:crypto instead of shipping a second verification path — and, since the
 * credentials moved into `admin_users`, what lets it read them at all.
 *
 * Async for that reason. It is not a query per request: `adminCredentials()`
 * caches for a minute, so this is one read per minute per process, and the
 * connection it warms is the one the page's own data will use.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const credentials = await adminCredentials();
  const token = request.cookies.get(ADMIN_COOKIE)?.value;

  if (pathname === "/admin/login") {
    // Already signed in? Don't show the form again.
    if (readToken(token, credentials)) {
      return NextResponse.redirect(new URL("/admin", request.url));
    }
    return NextResponse.next();
  }

  /**
   * Two different nothings, one behaviour: with no credentials configured the
   * admin does not exist rather than existing unprotected, and with the store
   * unreadable it is unavailable rather than open. The login screen tells the
   * difference; this does not need to.
   */
  if (!adminConfigured(credentials)) {
    return NextResponse.rewrite(new URL("/admin/login?unavailable=1", request.url));
  }

  if (readToken(token, credentials)) {
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
