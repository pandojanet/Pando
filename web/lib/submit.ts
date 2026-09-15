"use client";

import {
  ApiError,
  completeSeed,
  saveProfile,
  saveSubmission,
  type CompleteSeedResult,
} from "./api-client";
import { buildProfilePayload } from "./derive";
import { loadSession, saveSession } from "./storage";
import { track } from "./analytics";
import type { SeedSession } from "./types";

/**
 * When a session's data may leave the phone.
 *
 * The client's rule is unchanged and non-negotiable: *"nothing is stored
 * server-side until the code is confirmed. If they abandon at OTP, nothing
 * persists."* What changed (12 Aug) is **when the code is asked for** — right
 * after the parent's own details, before the questionnaire, rather than at the
 * very end. The rule then produces a different, better shape:
 *
 *  - **Before verification** nothing is sent, exactly as before. A parent who
 *    walks away at the code has left nothing behind anywhere.
 *  - **After it** the profile and each card post as they are finished, which is
 *    what the screens have always claimed. Previously "saved" meant *on this
 *    phone* for the whole flow, and a parent could not tell — nor could we
 *    answer "did that card land?" without asking them to reach the last screen.
 *
 * This one predicate is the whole switch: `ProfileFlow`, `ChatSeeding` and
 * `FinishAsks` each ask it, so the two worlds cannot drift apart.
 *
 * **A session that predates the change still works.** It has no confirmed code,
 * so this stays true, everything stays held, and the gate on the completion screen
 * flushes it exactly as it used to. The same fallback catches an expired
 * verification mid-flow: the write answers 401, the session drops back to holding,
 * and the parent finishes through the old path rather than losing anything.
 *
 * The anonymous path has no number to confirm, so it keeps posting as it goes and
 * carries no founding status. The write routes enforce the same split server-side
 * (lib/server/gate.ts) — this file is only the half that decides *when* to ask.
 */

/** True when this session must wait for a confirmed code before anything is sent. */
export function holdsUntilVerified(session: SeedSession | null): boolean {
  return Boolean(
    session?.wants_founding && session?.phone && !session?.phone_verified,
  );
}

/**
 * A write came back 401: the confirmed number this session was writing under is no
 * longer confirmed — the window ran out, or the container restarted and took the
 * in-memory record with it.
 *
 * The recovery is to stop trusting it and go back to holding. Everything the
 * parent has done is still on this phone, the screens carry on saying "kept on
 * this phone", and the gate at the end asks for a fresh code and sends it all.
 * Nothing is lost and nothing needs a new screen — the deferred path is still
 * there, and this is what it now exists for.
 *
 * Returns true when it handled the error, so a caller can tell "the number needs
 * confirming again" from "that genuinely failed".
 */
export function handleExpiredVerification(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 401) return false;

  const current = loadSession();
  if (current?.phone_verified) {
    saveSession({ ...current, phone_verified: false });
  }
  track("seed_verification_expired");
  return true;
}

/**
 * A write came back **422 with a required answer missing** — the one refusal
 * this flow can actually recover from without the parent doing anything twice.
 *
 * ## Why it exists (15 Sep)
 *
 * The developer's report was *"I confirmed my number and it still asks me to
 * confirm it"*, and the cause is two screens deep. `/api/seed/profile` refuses
 * a profile whose neighborhood or children are missing — correctly, they are
 * the two §8.5 makes required — and the flow's answer to *any* failed write was
 * one sentence saying "try again" on the screen the parent was already on,
 * which at that moment is the **code box**. So a parent whose answer had gone
 * missing confirmed a code, watched it fail, and was shown a code box again: the
 * number was confirmed the whole time and nothing on screen said so.
 *
 * ⚠ The route already names the fields (`fields: ["child_ages"]`) — it has since
 * 27 Aug, when one message for two failures made exactly this undiagnosable —
 * and **nothing read them**. This is the reader.
 *
 * ⚠ `ApiError.message` carries the response body verbatim (see `api-client.ts`),
 * so the parse is defensive at every step: a body that is not JSON, or is JSON
 * of another shape, returns null and the caller falls back to the ordinary
 * failure. Returning `[]` — refused, but the server named no field — is
 * deliberately distinct from null, because the first still means *an answer is
 * missing* and the second means *something else went wrong*.
 */
/**
 * ⚠ **Re-exported so a caller — including a test — reads the same class this
 * module compares against.** `unansweredRequired` and
 * `handleExpiredVerification` both use `instanceof`, and a module loaded
 * twice (a cache-busting query on one import and not the other) gives two
 * `ApiError` classes whose instances fail each other's check — silently, and
 * in the direction that makes a correct recovery look broken.
 */
export { ApiError };

export function unansweredRequired(err: unknown): string[] | null {
  if (!(err instanceof ApiError) || err.status !== 422) return null;
  let body: unknown;
  try {
    body = JSON.parse(err.message);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const { reason, fields } = body as { reason?: unknown; fields?: unknown };
  if (reason !== "invalid_required_answers") return null;
  return Array.isArray(fields)
    ? fields.filter((f): f is string => typeof f === "string")
    : [];
}

export interface FlushResult {
  profile: boolean;
  /** Cards the server confirmed, out of how many were held. */
  cards_persisted: number;
  cards_total: number;
  completion: CompleteSeedResult;
}

/**
 * Sends everything the session has been holding. Throws on the first failure — a
 * half-submitted contributor is worth retrying, and every write is keyed by a
 * client id so a retry upserts rather than duplicates.
 */
export async function flushSession(
  session: SeedSession,
  completion: { follow_up_opt_in: boolean },
): Promise<FlushResult> {
  const profileResult = await saveProfile(buildProfilePayload(session));

  const cards = session.chat?.submissions ?? [];
  let cardsPersisted = 0;
  for (const card of cards) {
    const saved = await saveSubmission({
      invite_code: session.invite_code,
      market_id: session.market_id,
      source: session.source,
      is_test: session.is_test === true,
      contributor_name: session.name,
      contributor_phone: session.phone,
      submission: {
        id: card.id,
        kind: card.kind,
        /* Carried here too, or a card held until the code is confirmed would
           lose the toggle at exactly the moment it finally reaches the
           database — which is every card on the founding path. */
        show_name: card.show_name === true,
        fields: card.fields as Record<string, unknown>,
        created_at: card.created_at,
      },
    });
    if (saved.persisted) cardsPersisted += 1;
  }

  const counts = cards.reduce<Record<string, number>>((acc, card) => {
    acc[card.kind] = (acc[card.kind] ?? 0) + 1;
    return acc;
  }, {});

  const completionResult = await completeSeed({
    invite_code: session.invite_code,
    source: session.source,
    is_test: session.is_test === true,
    name: session.name,
    phone: session.phone,
    follow_up_opt_in: completion.follow_up_opt_in,
    /* The allowance is not sent: `saveProfile` above wrote it, from the tap,
       with the mode it has to agree with. This line used to be
       `Number(session.answers.allowance)`, which is **NaN** for the
       open-ended level — see `repo/completion.ts`. */
    demand: session.demand,
    shared: counts,
    profile_saved_at: session.profile_saved_at,
    started_at: session.started_at,
  });

  return {
    profile: profileResult.persisted,
    cards_persisted: cardsPersisted,
    cards_total: cards.length,
    completion: completionResult,
  };
}
