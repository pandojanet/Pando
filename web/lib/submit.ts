"use client";

import {
  completeSeed,
  saveProfile,
  saveSubmission,
  type CompleteSeedResult,
} from "./api-client";
import { buildProfilePayload } from "./derive";
import type { SeedSession } from "./types";

/**
 * Deferred submit (client's v3.2 round).
 *
 * "Nothing is stored server-side until the code is confirmed — profile and
 * contributions are held in the session. If they abandon at OTP, nothing
 * persists."
 *
 * So on the founding path the profile screen and every capture card stop posting
 * as they go: everything waits on the phone until the parent confirms a code on the
 * completion screen, and then goes up in one pass, in dependency order — the
 * contributor first, their cards second, the completion record last.
 *
 * The anonymous path has no number to confirm, so it keeps posting as it goes and
 * carries no founding status. The write routes enforce the same split server-side
 * (lib/server/gate.ts) — this file is only the half that decides *when* to ask.
 */

/** True when this session must wait for a confirmed code before anything is sent. */
export function holdsUntilVerified(session: SeedSession | null): boolean {
  return Boolean(session?.wants_founding && session?.phone);
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
