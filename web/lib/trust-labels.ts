/**
 * M5.6 — the trust labels and the freshness logic an answer is built from.
 *
 * This is the file invariants 3 and 4 live or die in. The spec's wording is
 * **approved copy**, not a description of what to say: the estimate lists it
 * verbatim, and the reason is that a label is Pando's whole claim about where a
 * sentence came from. Reword one and the product is asserting something it was
 * not given permission to assert.
 *
 * ## The three rules, and none is a preference
 *
 * **A label reads the source, never who typed it** (invariant 3). "Shared by a
 * local parent" says a parent shared it; it never says which parent, and it never
 * becomes "shared by Sarah" — that is P13's decision, taken separately, and it is
 * about attribution rather than trust.
 *
 * **A parent-trust label needs a parent behind it** (invariant 4):
 * `provenance = parent_submitted` **and** a real contributor. An admin-entered
 * record is useful and is labelled honestly as general information; it is never
 * dressed as somebody's experience.
 *
 * **Public information never wears a trust label** (5.6's own words: "the guard
 * that public info is never presented as parent trust"). `labelsFor` is built so
 * the public case is a *different branch* rather than a missing flag — a boolean
 * somebody forgets to set is how this invariant would break.
 *
 * ## Why it is pure
 *
 * Same reason as `matching.ts`: it is a rule that has to be exhaustively testable,
 * including the cases where a label must **not** appear. `npm run test:trust`
 * spends most of its checks on refusals.
 */

/** The freshness ladder, as stored on `shares.freshness_state`. */
export type FreshnessState = "fresh" | "ageing" | "stale";

/**
 * Per-category thresholds, mirroring the seeded `freshness_policy` table.
 *
 * The table is the authority at query time — this is the fallback for a caller
 * with no database, and the shape the repo hands in. Camps are the reason the
 * numbers differ per category at all: registration is annual, so a camp
 * recommendation from last February is current in a way a class from last
 * February is not.
 */
export interface FreshnessPolicy {
  kind: string;
  stale_days: number;
  ageing_days: number;
}

export const FRESHNESS_FALLBACK: FreshnessPolicy[] = [
  { kind: "activity", stale_days: 120, ageing_days: 90 },
  { kind: "caregiver", stale_days: 180, ageing_days: 120 },
  { kind: "place", stale_days: 365, ageing_days: 180 },
  { kind: "tip", stale_days: 365, ageing_days: 180 },
];

/**
 * How old a record is, in the vocabulary the labels use.
 *
 * Computed rather than read from `shares.freshness_state` when a date is
 * available, for the same reason `matching.ts` recomputes an age band: the stored
 * state was written at capture and nothing walks the table nightly yet — that is
 * the freshness-ping job (10.3), which does not exist. A stored `fresh` on a
 * fourteen-month-old record would be the app asserting something untrue.
 */
export function freshnessOf(
  lastConfirmedAt: Date | string | null,
  kind: string,
  policies: FreshnessPolicy[] = FRESHNESS_FALLBACK,
  now: Date = new Date(),
): FreshnessState {
  if (!lastConfirmedAt) return "stale";
  const at = lastConfirmedAt instanceof Date ? lastConfirmedAt : new Date(lastConfirmedAt);
  if (Number.isNaN(at.getTime())) return "stale";

  const policy =
    policies.find((p) => p.kind === kind) ??
    FRESHNESS_FALLBACK.find((p) => p.kind === kind) ??
    /* An unknown kind takes the strictest policy on the list rather than a
       default of "fresh": a new category that nobody wrote a threshold for must
       not inherit the most generous answer. */
    policies.reduce((strictest, p) => (p.ageing_days < strictest.ageing_days ? p : strictest), {
      kind: "unknown",
      stale_days: 120,
      ageing_days: 90,
    });

  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000);
  if (days >= policy.stale_days) return "stale";
  if (days >= policy.ageing_days) return "ageing";
  return "fresh";
}

/**
 * The approved wording. **Verbatim** — see invariant 3.
 *
 * Listed in estimate 5.6 and in spec §11. Changing a string here changes what
 * Pando claims about a record's origin, so it is a product decision and a
 * re-approval, never a copy edit. `LAST_CONFIRMED` takes the date because the
 * spec writes it as "Last confirmed [date]".
 */
export const TRUST_LABEL = {
  PUBLIC: "Public/general information",
  SHARED: "Shared by a local parent",
  VOUCHED: "Vouched by a local parent",
  VALIDATED: "Validated by multiple parents",
  FRESH_NETWORK: "Fresh network answer",
  HUMAN_REVIEWED: "Human-reviewed",
  REFERENCE_AVAILABLE: "Reference available",
} as const;

export function lastConfirmedLabel(at: Date | string | null): string | null {
  if (!at) return null;
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  /* The spec's own bracket, filled with a date a parent can read in a text. */
  return `Last confirmed ${d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  })}`;
}

/** One record, as much of it as a label depends on. */
export interface Candidate {
  kind: string;
  provenance: "parent_submitted" | "admin_entered" | "migrated";
  /** Contributions from parents who used it themselves. */
  firsthand_count: number;
  /** Welcome, labelled, and never enough for a trust label on their own. */
  secondhand_count: number;
  /**
   * How many of the firsthand contributions say they would recommend it —
   * `recommendation` in `('yes','yes_with_caveats')`.
   *
   * This is what separates "shared" from "vouched": a parent can tell Pando
   * about a class they used and stop short of recommending it, and the labels
   * have to keep those apart or "vouched" means nothing.
   */
  recommending_count: number;
  /** A human read it — `status = 'approved'` on the record and its contribution. */
  human_reviewed: boolean;
  last_confirmed_at: Date | string | null;
  /**
   * The contribution arrived from a live Network Ask rather than from the seed
   * base. Phase 2 sets it; nothing does today, so it defaults false and the
   * label simply never appears.
   */
  from_network_ask?: boolean;
  /** Caregiver records only: a nominating parent willing to be a reference. */
  reference_available?: boolean;
}

export interface TrustLabels {
  /** In the order an answer should present them. */
  labels: string[];
  freshness: FreshnessState;
  /**
   * True when nothing here is parent-backed.
   *
   * The response generator (5.7) needs this as a *fact*, not as the absence of a
   * label: an answer built only from public information has to say so in its own
   * voice, and "no trust labels came back" is too easy to read as "labels not
   * computed yet".
   */
  public_only: boolean;
}

/**
 * What may honestly be said about one record.
 *
 * Order matters and is the spec's: the strongest parent claim first, then the
 * qualifiers. The generator renders them for SMS length and may drop from the
 * end — so nothing load-bearing is ever last.
 */
export function labelsFor(
  candidate: Candidate,
  options: { policies?: FreshnessPolicy[]; now?: Date } = {},
): TrustLabels {
  const now = options.now ?? new Date();
  const freshness = freshnessOf(candidate.last_confirmed_at, candidate.kind, options.policies, now);

  /**
   * The guard, as a branch rather than a flag.
   *
   * A record that is not parent-submitted, or that no parent has firsthand
   * experience of, gets the public label and **cannot reach the parent-trust
   * branch below at all**. Written this way on purpose: a shared code path with
   * an `if (isPublic)` sprinkled through it is how invariant 3 gets breached by
   * someone adding a label and forgetting the check.
   */
  const parentBacked =
    candidate.provenance === "parent_submitted" && candidate.firsthand_count > 0;

  if (!parentBacked) {
    /* Typed, because `as const` on TRUST_LABEL would otherwise narrow this to
       the one literal it starts with and refuse the second push. */
    const labels: string[] = [TRUST_LABEL.PUBLIC];
    /* "Human-reviewed" is about *our* process, not about a parent, so it is the
       one label that may sit beside the public one. */
    if (candidate.human_reviewed) labels.push(TRUST_LABEL.HUMAN_REVIEWED);
    return { labels, freshness, public_only: true };
  }

  const labels: string[] = [];

  if (candidate.firsthand_count >= 2) {
    labels.push(TRUST_LABEL.VALIDATED);
  } else if (candidate.recommending_count > 0) {
    labels.push(TRUST_LABEL.VOUCHED);
  } else {
    labels.push(TRUST_LABEL.SHARED);
  }

  if (candidate.from_network_ask === true) labels.push(TRUST_LABEL.FRESH_NETWORK);
  if (candidate.human_reviewed) labels.push(TRUST_LABEL.HUMAN_REVIEWED);
  if (candidate.reference_available === true) labels.push(TRUST_LABEL.REFERENCE_AVAILABLE);

  const confirmed = lastConfirmedLabel(candidate.last_confirmed_at);
  if (confirmed) labels.push(confirmed);

  return { labels, freshness, public_only: false };
}

/**
 * Whether a record may be presented at all, and why not.
 *
 * Separate from the labels because "how do I describe this" and "may I use this"
 * are different questions, and folding them together is how a stale record ends
 * up in an answer wearing an honest date.
 *
 * A stale record is **not** excluded here: the spec's answer to old knowledge is
 * to mark it old, not to hide it (§11, and the strategy's "old knowledge is
 * marked as old"). What is excluded is the thing no label can fix.
 */
export function usable(candidate: Candidate): { ok: boolean; reason?: string } {
  if (candidate.provenance !== "parent_submitted" && candidate.firsthand_count > 0) {
    /* Firsthand experience on a record nobody submitted as a parent is a data
       fault, not a presentation choice — it would let invariant 4's label attach
       to an admin-entered row. */
    return { ok: false, reason: "firsthand_on_non_parent_record" };
  }
  if (!candidate.human_reviewed) {
    /* Phase 1's rule, and the strategy is explicit that it holds for the pilot:
       "for the first months every contribution is read by a person". */
    return { ok: false, reason: "not_reviewed" };
  }
  return { ok: true };
}
