import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  adminConfigured,
  clearFailures,
  issueToken,
  loginLocked,
  recordFailure,
} from "@/lib/admin/auth";
import { adminCredentials, verifyAdminSignIn } from "@/lib/server/admin-auth";
import { clientAddress } from "@/lib/rate-limits";

/** POST /api/admin/session — sign in. DELETE — sign out. (Estimate 2.1.) */

/**
 * The address the 15-minute lock is keyed on.
 *
 * ⚠ This read the **leftmost** `X-Forwarded-For` entry, which is the one a
 * caller writes themselves — a proxy appends the address it saw to the *right*.
 * So sending a different made-up leading value with every attempt gave every
 * attempt a fresh five-guess budget, and the lock on the admin password was no
 * lock at all (audit, 29 Sep). `clientAddress` counts from the right, one hop
 * per trusted proxy, which is the rule every other limiter in the app uses
 * (`lib/rate-limits.ts`). No usable address still shares one key ("local"), so
 * that case locks conservatively rather than opening.
 */
function clientKey(request: Request): string {
  const raw = Number(process.env.TRUSTED_PROXIES ?? 1);
  const proxies = Number.isInteger(raw) && raw >= 0 ? raw : 1;
  return (
    clientAddress(
      request.headers.get("x-forwarded-for"),
      request.headers.get("x-real-ip"),
      proxies,
    ) ?? "local"
  );
}

export async function POST(request: Request) {
  /**
   * Read once, uncached, and reused below — so somebody added to `admin_users` a
   * moment ago can sign in a moment later, and so an unreadable store answers 503
   * rather than "that didn't match", which would send an admin hunting for a
   * password that was never wrong.
   */
  const configured = await adminCredentials(true);
  if (!adminConfigured(configured)) {
    return NextResponse.json(
      {
        error:
          configured.mode === "unavailable"
            ? "Admin sign-in is temporarily unavailable"
            : "Admin is not configured on this deployment",
      },
      { status: 503 },
    );
  }

  const key = clientKey(request);
  if (loginLocked(key)) {
    // Spec §19: max attempts then a lock, so a shared password can't be brute-forced.
    return NextResponse.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    user?: unknown;
    password?: unknown;
  } | null;

  const user = typeof body?.user === "string" ? body.user.trim() : "";

  /**
   * One call decides it, and it costs the same whether the name exists or not —
   * so neither the answer nor the response time says which half was wrong.
   */
  const attempt = await verifyAdminSignIn(user, body?.password);
  if (!attempt.ok) {
    recordFailure(key);
    console.warn("[admin:login] failed attempt");
    return NextResponse.json({ error: "That didn't match." }, { status: 401 });
  }

  clearFailures(key);
  /* Issued against the set that just verified them, so the session fingerprint
     matches the credential it was proved with. */
  const token = issueToken(user, attempt.set);
  console.info("[admin:login] signed in", { user });

  const response = NextResponse.json({ ok: true, user });
  response.cookies.set(ADMIN_COOKIE, token.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: token.maxAge,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
