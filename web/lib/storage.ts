"use client";

import { EMPTY_ANSWERS } from "./questions";
import type { MarketId, ProfileAnswers, SeedSession } from "./types";

/**
 * Autosave + resume (estimate 1.10: "autosaves progress, and lets them
 * resume"). localStorage is enough for Phase 1: the profile is not sensitive on
 * its own, there is no auth yet, and a parent interrupted by a toddler must be
 * able to come back to the same tab and continue.
 *
 * Everything is wrapped in try/catch — Safari private mode throws on write.
 */

const KEY = "pando.seed.v1";

export function newSession(init: {
  invite_code: string | null;
  market_id: MarketId;
  source: string;
  /**
   * Part of the data model, not something the app can switch on: the schema, the
   * payloads and every admin count filter on it, so a row can still be marked as
   * test data from the admin side or by a seeding script. There is deliberately no
   * URL that turns it on — a query parameter that quietly changes what gets stored is
   * a footgun for whoever forwards the link.
   */
  is_test?: boolean;
}): SeedSession {
  const now = new Date().toISOString();
  return {
    version: 1,
    invite_code: init.invite_code,
    market_id: init.market_id,
    source: init.source,
    is_test: init.is_test === true,
    name: null,
    first_name: null,
    last_name: null,
    wants_founding: true,
    phone_verified: false,
    sms_consent: null,
    phone: null,
    answers: { ...EMPTY_ANSWERS, other: {}, skipped: [] },
    chat: null,
    screen_index: 0,
    profile_saved_at: null,
    follow_up_opt_in: null,
    consent: null,
    demand: null,
    completed_at: null,
    started_at: now,
    updated_at: now,
  };
}

/**
 * Rebuild the answers from stored data, keeping a value only when its *shape* still
 * matches what the current question set expects.
 *
 * This is the whole reason the profile crashed on a session written before the July
 * question set: `{ ...EMPTY_ANSWERS, ...stored }` looks safe, but a stored `null` — from
 * a build where `budget` was a single choice rather than a multi-select — overwrites the
 * default `[]` with `null`, and the next `.length` throws.
 *
 * A parent's stored session is data we do not control: it was written by whatever
 * version of the app they last opened, and mid-pilot they will meet several. So each key
 * is taken on its own terms and anything unrecognisable falls back to the default rather
 * than being trusted.
 */
function normaliseAnswers(stored: unknown): ProfileAnswers {
  const out: ProfileAnswers = {
    ...EMPTY_ANSWERS,
    other: {},
    skipped: [],
    school_status: {},
  };
  if (!stored || typeof stored !== "object") return out;
  const raw = stored as Record<string, unknown>;

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

  for (const key of Object.keys(EMPTY_ANSWERS) as Array<keyof ProfileAnswers>) {
    const value = raw[key];
    if (value === undefined || value === null) continue; // keep the default

    if (key === "child_ages") {
      out.child_ages = Array.isArray(value)
        ? value.filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        : [];
      continue;
    }
    if (key === "other") {
      // Free-text "other" entries, keyed by question id.
      out.other =
        typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>)
                .map(([k, v]) => [k, strings(v)])
                .filter(([, v]) => (v as string[]).length > 0),
            )
          : {};
      continue;
    }
    if (key === "child_of") {
      /**
       * Question id → option id → the ages it belongs to. Two levels deep, so it
       * needs its own branch: the generic one below would see an object where it
       * expects a list and drop the whole thing — which is exactly how a parent
       * who reloads mid-profile would silently lose every "whose is it" tap.
       */
      out.child_of = {};
      if (typeof value === "object" && !Array.isArray(value)) {
        for (const [questionId, perOption] of Object.entries(
          value as Record<string, unknown>,
        )) {
          if (typeof perOption !== "object" || perOption === null) continue;
          const cleaned: Record<string, number[]> = {};
          for (const [optionId, ages] of Object.entries(
            perOption as Record<string, unknown>,
          )) {
            if (!Array.isArray(ages)) continue;
            const kept = ages.filter(
              (a): a is number => typeof a === "number" && Number.isFinite(a),
            );
            if (kept.length > 0) cleaned[optionId] = kept;
          }
          if (Object.keys(cleaned).length > 0) {
            out.child_of[questionId as keyof typeof out.child_of] = cleaned;
          }
        }
      }
      continue;
    }
    if (key === "school_status") {
      out.school_status =
        typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value as Record<string, unknown>).filter(
                ([, v]) => typeof v === "string",
              ) as Array<[string, string]>,
            )
          : {};
      continue;
    }

    const fallback = EMPTY_ANSWERS[key];
    if (Array.isArray(fallback)) {
      // A single-select answer that later became a multi-select still counts.
      out[key] = (typeof value === "string" ? [value] : strings(value)) as never;
    } else if (typeof value === "string") {
      out[key] = value as never;
    }
  }

  return out;
}

export function loadSession(): SeedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SeedSession;
    if (parsed?.version !== 1) return null;
    // Tolerate answer-shape changes between deploys mid-pilot.
    return {
      ...parsed,
      answers: normaliseAnswers(parsed.answers),
      chat: parsed.chat ?? null,
      is_test: parsed.is_test === true,
      first_name: parsed.first_name ?? null,
      last_name: parsed.last_name ?? null,
      wants_founding: parsed.wants_founding !== false,
      phone_verified: parsed.phone_verified === true,
      sms_consent: parsed.sms_consent ?? null,
      follow_up_opt_in: parsed.follow_up_opt_in ?? null,
      consent: parsed.consent ?? null,
      demand: parsed.demand ?? null,
      completed_at: parsed.completed_at ?? null,
    };
  } catch {
    return null;
  }
}

export function saveSession(session: SeedSession): SeedSession {
  const next = { ...session, updated_at: new Date().toISOString() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the flow still works, it just can't be resumed.
  }
  return next;
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* no-op */
  }
}

/** Has this parent made enough progress that we should offer to resume? */
export function hasResumableProgress(session: SeedSession | null): boolean {
  if (!session || session.profile_saved_at) return false;
  return (
    session.screen_index > 0 ||
    session.answers.neighborhood !== null ||
    session.answers.child_ages.length > 0
  );
}
