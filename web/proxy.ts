import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE, adminConfigured, readToken } from "@/lib/admin/auth";
import { adminCredentials } from "@/lib/server/admin-auth";
import {
  INVITE_COOKIE,
  INVITE_COOKIE_MAX_AGE,
  isGatedSeedPath,
} from "@/lib/seed-gate";
import { validateInviteCode } from "@/lib/server/invite";

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

  /**
   * The Seed Tool's half, and it returns **before** `adminCredentials()`.
   *
   * That ordering is the point rather than tidiness: the admin credential store
   * is a database read, and putting it in front of a parent's first request
   * would make the front door of the parent flow wait on it — and go down with
   * it. The two halves share this file and nothing else.
   */
  if (!pathname.startsWith("/admin")) return seedGate(request);

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

/**
 * Link-only access to the Seed Tool (4 Sep).
 *
 * Two jobs, and they are the same rule read from both ends. On `/join` a valid
 * `?i=` **issues** the marker; on the screens after it an absent marker sends
 * the visitor to the public site. Without the second half, closing `/join`
 * would only have moved the open door one URL along: `/profile` and `/share`
 * mint a session when they find none, so typing either address by hand walked
 * straight into the questionnaire.
 *
 * The code is resolved here as well as in `app/(seed)/join/page.tsx`, and that
 * is deliberate belt and braces rather than a duplicate decision — both go
 * through `validateInviteCode`, whose table is cached for 60s
 * (`lib/server/invite-cache.ts`), so they read one answer and cannot disagree.
 * The page keeps its own redirect because a proxy is configuration and a page is
 * code, and the door must not depend on the matcher below staying right.
 *
 * An invalid code neither issues a marker nor clears one: somebody mid-flow who
 * reopens a stale link with a since-retired code is a parent, not an intruder,
 * and their own screens keep working.
 *
 * ⚠ **And `/join` itself is one of their screens.** The first version bounced
 * *every* codeless arrival, which broke a control every parent can reach in two
 * taps: `ProfileFlow` sends Back from the first question to `/join`, with no
 * `?i=` on it, so tapping Back threw a parent who was mid-questionnaire out onto
 * the marketing site with no way back except the original link. Nothing was
 * lost — the session is autosaved — but the app appeared to eject them.
 *
 * So the marker is consulted here too, and that is the gate's own question
 * answered rather than a hole in it: a browser carrying `pando_invited` has
 * already arrived through a valid link, which is the whole thing the code is
 * asked to prove. They get the landing screen, and their session resumes from
 * it. Attribution is unaffected — a session begun without a code has
 * `invite_code: null` and always has.
 */
async function seedGate(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const marker = Boolean(request.cookies.get(INVITE_COOKIE));

  if (pathname === "/join") {
    const code = searchParams.get("i") ?? searchParams.get("invite");
    const invite = await validateInviteCode(code);
    if (!invite.valid) {
      return marker
        ? NextResponse.next()
        : NextResponse.redirect(new URL("/", request.url));
    }

    const response = NextResponse.next();
    response.cookies.set(INVITE_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: INVITE_COOKIE_MAX_AGE,
    });
    return response;
  }

  if (isGatedSeedPath(pathname) && !marker) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // API routes do their own check so they can answer 401 instead of redirecting.
  matcher: [
    "/admin",
    "/admin/:path*",
    // The Seed Tool: /join issues the marker, the rest require it.
    "/join",
    "/profile",
    "/share",
    "/done",
    "/done/:path*",
  ],
};
