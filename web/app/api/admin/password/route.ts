import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  ADMIN_COOKIE,
  issueToken,
  loginLocked,
  passwordRecord,
  readToken,
  recordFailure,
  verifyCredentials,
} from "@/lib/admin/auth";
import {
  adminCredentials,
  invalidateAdminCredentials,
} from "@/lib/server/admin-auth";
import { withDb } from "@/lib/server/db";
import { changeOwnPassword } from "@/lib/server/repo/admin-users";

/**
 * POST /api/admin/password — a signed-in admin changes their own password.
 *
 * **Why this is its own route and not an `/api/admin/action`.** That endpoint
 * writes an audit row built from the request body, so a password sent through it
 * would land in `audit_log.after` in plain text — the one place it must never be.
 * Everything else about it also differs: it is the only write in the app whose
 * subject is the person making it.
 *
 * The rules, in the order they are applied:
 *
 *  1. **A session is not enough.** The current password is required, because a
 *     borrowed laptop with a live tab must not be able to lock the owner out of
 *     their own account. This is also why the check is throttled — the same
 *     counter the sign-in screen uses, keyed to the person rather than to the IP,
 *     so it cannot be brute-forced from a session either.
 *  2. **Only their own.** The name comes from the verified token; nothing in the
 *     body can change whose row is written.
 *  3. **Only in database mode.** With credentials in the environment there is
 *     nothing here to rewrite, and pretending otherwise would report a change
 *     that did not happen. The screen says so instead.
 *  4. **They stay signed in.** Rotating a hash changes the session key material,
 *     so the cookie they arrived with is already dead by the time this responds.
 *     A fresh one is issued against the new set — otherwise a successful password
 *     change would look exactly like being logged out at random.
 */

const MIN_LENGTH = 12;

export async function POST(request: Request) {
  const set = await adminCredentials();
  const session = readToken((await cookies()).get(ADMIN_COOKIE)?.value, set);
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (set.mode !== "database") {
    return NextResponse.json(
      {
        error:
          "This deployment's admin passwords come from configuration, not the database — an operator changes them with `npm run admin:user`.",
        reason: "not_database",
      },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    current?: unknown;
    next?: unknown;
  } | null;

  const next = typeof body?.next === "string" ? body.next : "";

  /* Keyed to the person: this route already knows who they are, so throttling by
     IP would let one attacker share a budget across accounts and would punish two
     admins behind one office address. */
  const key = `password:${session.user}`;
  if (loginLocked(key)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in 15 minutes." },
      { status: 429 },
    );
  }

  /* Checked against the live store, not the cached set: a password rotated in
     another tab a minute ago is the current one. */
  const live = await adminCredentials(true);
  const ok = await verifyCredentials(session.user, body?.current, live);
  if (!ok) {
    recordFailure(key);
    console.warn("[admin:password] wrong current password");
    return NextResponse.json(
      { error: "That's not your current password." },
      { status: 401 },
    );
  }

  if (next.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: `Use at least ${MIN_LENGTH} characters.` },
      { status: 422 },
    );
  }
  if (next === (typeof body?.current === "string" ? body.current : null)) {
    return NextResponse.json(
      { error: "That's the password you already have." },
      { status: 422 },
    );
  }

  const record = await passwordRecord(next);
  const result = await withDb((db) => changeOwnPassword(db, session.user, record));

  if (!result.persisted) {
    return NextResponse.json({ error: "That didn't go through" }, { status: 502 });
  }
  if (!result.data) {
    /* The row went away, or the account was disabled while this tab was open. */
    return NextResponse.json(
      { error: "That account can no longer sign in." },
      { status: 403 },
    );
  }

  /* The cache still holds the old hash, and the session key with it. */
  invalidateAdminCredentials();
  console.info("[admin:password] changed", { user: session.user });

  const token = issueToken(session.user, await adminCredentials(true));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, token.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: token.maxAge,
  });
  return response;
}
