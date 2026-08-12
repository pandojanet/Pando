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
    monthly_contact_allowance: session.answers.allowance
      ? Number(session.answers.allowance)
      : 3,
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
