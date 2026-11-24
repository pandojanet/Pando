import { fetchMe, joinAgainHref, type MeResult } from "./api-client";
import { newSession, normaliseAnswers } from "./storage";
import { pruneAnswers } from "./questions";
import type { SeedSession } from "./types";

/**
 * The phone's copy of a parent, kept in step with the database (24 Nov).
 *
 * The developer, after a client "deleted" her profile and walked straight back in: *"просимо код при
 * вході … якщо в нас є localStorage, то він завжди має бути up to date з даними з бази, потрібно це
 * чітко бачити та обробляти"*. Until now every screen trusted `pando.seed.v3`: the profile, the chat
 * and the thank-you screens opened from it whether or not the server still knew the number — so a
 * parent could see "their" profile and be refused by the first thing that needed the server (her
 * delete answered "confirm your number first", with no way to). Now a screen that shows a saved
 * profile asks the server first, and acts on one of five answers, never on a guess:
 *
 * - **draft** — the phone holds no account to check (a questionnaire not yet saved, or one held on the
 *   phone until its number is confirmed): nothing is asked, as before.
 * - **in_step** — the server knows the number and the profile; the phone's copy takes what the server
 *   owns (the answers, the referral code, Founding, the number) and keeps what only the phone has (the
 *   chat, cards waiting to go, consents being given, the name in full). `changed` says whether the
 *   database's copy differed, so the screen can say so.
 * - **signed_out** — the server no longer knows the number (the week ran out, another browser, signed
 *   out by a delete): sign in with a code, then come back to the same screen.
 * - **erased** — the number is confirmed and nobody is on it (their own delete, an admin's reset): the
 *   phone's copy goes.
 * - **offline** — Pando could not be reached: the phone's copy is shown, and the screen says so.
 *
 * And a copy made under **another number** (two parents, one phone) is rebuilt from the server rather
 * than merged, so nobody's chat, consents or cards end up under someone else.
 */
export type AccountCheck =
  | { state: "draft" }
  /** `replaced`: the copy was another number's and `session` is a new one — use it whole, merge nothing. */
  | { state: "in_step"; session: SeedSession; changed: boolean; replaced: boolean }
  | { state: "signed_out" }
  | { state: "erased" }
  | { state: "offline" };

/**
 * Does this phone hold a profile that lives on the server? A saved profile under a number, and any one
 * of: the phone says the number is confirmed, the database was seen holding it (`server_saved_at`), or
 * it has a referral link — which only the server mints, so a phone from before `server_saved_at` is
 * recognised too.
 *
 * ⚠ Not `phone_verified` alone (24 Nov, the developer: *"мало її спочатку не пустити без коду в
 * систему"*): a write refused for a lapsed confirmation turns that flag off on seven paths, and the
 * first version of this check then took a profile that lives in the database for a draft and let the
 * phone's copy open without a code. A profile held on the phone until its number is confirmed has none
 * of the three, and keeps its code at the end of the flow, as before.
 */
export function claimsAccount(session: SeedSession | null): boolean {
  return Boolean(
    session?.profile_saved_at && session.phone && (session.phone_verified || session.server_saved_at || session.referral_code),
  );
}

/** What the server owns, compared — the parts `in_step` replaces. */
const owned = (s: SeedSession) =>
  JSON.stringify([s.answers, s.referral_code ?? null, s.wants_founding !== false, s.phone ?? null]);

/**
 * The decision, pure: the screen's current copy and what `/api/seed/me` said. Applied by the screen to
 * its **latest** state (a functional update), so an answer the parent changed while the check was in
 * flight is not lost to the copy the check started from.
 */
export function reconcile(local: SeedSession, me: MeResult, now: Date = new Date()): AccountCheck {
  if (me.reason === "unavailable" || me.reason === "failed") return { state: "offline" };
  if (!me.ok) return { state: "signed_out" };
  if (!me.found) return { state: "erased" };
  const stamp = now.toISOString();
  const otherNumber = Boolean(me.phone && local.phone && me.phone !== local.phone);
  const base: SeedSession = otherNumber
    ? { ...newSession({ invite_code: null, market_id: local.market_id, source: "signin" }), referral_shown_at: stamp }
    : local;
  const session: SeedSession = {
    ...base,
    phone: me.phone ?? base.phone,
    phone_verified: true,
    /* A name on the phone may be the fuller one ("Alice Probe" against the server's "Alice"): kept. */
    first_name: base.first_name ?? me.first_name ?? null,
    name: base.name ?? me.first_name ?? null,
    wants_founding: me.wants_founding !== false,
    referral_code: me.referral_code ?? base.referral_code,
    profile_saved_at: me.profile_saved ? (base.profile_saved_at ?? stamp) : base.profile_saved_at,
    server_saved_at: me.profile_saved ? stamp : (base.server_saved_at ?? null),
    /* The answers are the database's once it has them; a profile written before `raw_answers` carried
       anything leaves the phone's copy alone rather than showing an empty review. */
    answers: me.answers ? pruneAnswers(normaliseAnswers(me.answers)) : base.answers,
  };
  return { state: "in_step", session, changed: otherNumber || owned(session) !== owned(local), replaced: otherNumber };
}

/** Ask the server about this copy — or don't, when it is not an account. */
export async function checkAccount(local: SeedSession | null): Promise<{ check: AccountCheck; me: MeResult | null }> {
  if (!local || !claimsAccount(local)) return { check: { state: "draft" }, me: null };
  const me = await fetchMe();
  return { check: reconcile(local, me), me };
}

/** The screens a sign-in may return to; anything else goes to the thank-you screen. */
const RETURNABLE = ["/profile", "/share", "/done", "/done/ask", "/done/next"] as const;

export function signInHref(returnTo: string): string {
  return (RETURNABLE as readonly string[]).includes(returnTo) ? `/signin?next=${encodeURIComponent(returnTo)}` : "/signin";
}

/** The `next` a sign-in was given, if it is one of ours — never an address from elsewhere. */
export function safeNext(next: string | null | undefined): string {
  return next && (RETURNABLE as readonly string[]).includes(next) ? next : "/done";
}

export { joinAgainHref };
