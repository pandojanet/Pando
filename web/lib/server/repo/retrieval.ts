import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import {
  labelsFor,
  usable,
  type Candidate,
  type FreshnessPolicy,
  type TrustLabels,
} from "@/lib/trust-labels";

/**
 * M5.5 — candidate retrieval.
 *
 * Pulls what Pando already knows that could answer a question, labels each
 * record honestly (5.6), and hands the result to the response generator. The
 * estimate is explicit that "nothing here is user-facing on its own", and that
 * shapes the return type: no prose, no ordering decisions the generator should
 * own, and no fabricated fallback.
 *
 * ## Invariant 1 is in the WHERE clause, and that is the whole point
 *
 * "A caregiver appears in a user-facing answer **only** if
 * `consent_status = consented` **and** `active = true`, **enforced at the query
 * level**." So it is not a filter applied after the rows arrive, and not a check
 * in the generator: a caregiver who has not consented is never *fetched*. The
 * difference matters because every later mistake — a logging line, a debug dump,
 * a caller that forgets to filter — cannot leak what was never read.
 *
 * ## Why the two kinds are separate functions
 *
 * A share and a caregiver are not variants of one thing. A caregiver carries a
 * consent ladder, an 18+ gate and restricted notes that must never leave the
 * admin surface (invariant 12); a share carries none of those and can be counted
 * freely. One function with a `kind` parameter would put those two sets of rules
 * in one body, and the caregiver rules are the ones nobody may get wrong.
 */

export interface QuestionContext {
  marketId?: string;
  /** The asker's area, used to rank — never to filter. Same rule as the chip list. */
  area?: string | null;
  /** What the question is about: `activity`, `camp`, `place`, `tip`. */
  kinds?: string[];
  /** Age bands the question is about, from the asker's children or the question. */
  bands?: string[];
  limit?: number;
  /**
   * Which half may answer this question.
   *
   * Both default true, which is what every earlier caller assumed. They exist
   * because a question about a nanny was being answered with a music class and a
   * park: nothing here reads the *subject* of a question (see the header), so
   * without this the two halves are always both returned and the composer then
   * writes "local parents have shared something on this" about records that have
   * nothing to do with it.
   *
   * ⚠ This narrows by **kind of thing**, which is the one distinction that can be
   * drawn safely. It does not narrow within a kind — see the header.
   */
  caregivers?: boolean;
  shares?: boolean;
}

export interface ShareCandidate {
  share_id: string;
  kind: string;
  name: string;
  venue: string | null;
  neighborhoods: string[];
  age_bands: string[];
  /** 5.6's labels, computed from the counts below. */
  trust: TrustLabels;
  firsthand_count: number;
  secondhand_count: number;
  /** §17.1 — an admin marked this complete enough to answer with, no Ask needed. */
  answer_ready: boolean;
}

export interface CaregiverCandidate {
  caregiver_id: string;
  /**
   * First name and a last initial — the only shape `caregivers` can hold, by
   * CHECK. Not a full name, in any surface, ever.
   */
  display: string;
  kind_of_care: string[];
  areas: string[];
  trust: TrustLabels;
  /** How many families have employed them, which is what "firsthand" means here. */
  firsthand_count: number;
}

export interface Retrieved {
  shares: ShareCandidate[];
  caregivers: CaregiverCandidate[];
  /**
   * Nothing parent-backed came back.
   *
   * The estimate's own words: retrieval "falls back to clearly-labeled public
   * info when there is no parent-backed match". This flag is that fallback's
   * trigger — and it is **all** this layer does about it. Inventing the public
   * text here would put unsourced prose behind a retrieval function, where no
   * label could later tell it apart from a parent's experience.
   */
  parent_backed: boolean;
  /** Null when there is no database — never an empty result dressed as an answer. */
  configured: boolean;
}

const EMPTY: Retrieved = {
  shares: [],
  caregivers: [],
  parent_backed: false,
  configured: false,
};

/**
 * ⚠ **What this does not do: read the subject of the question.**
 *
 * There is no text matching here at all. A question is a market, an area, a set
 * of age bands and a set of kinds; records are ranked by whether an admin marked
 * them answer-ready, whether they are in the asker's area, and how many parents
 * stand behind them. So *"toddler swim classes"* and *"birthday party venues"*
 * retrieve the **same activities**, and the only thing that separates them today
 * is `caregivers`/`shares` above.
 *
 * That was invisible while nothing called this function. It became visible the
 * day the inbound path did, and it is a real gap rather than a bug to patch
 * here: matching a subject means either a topic taxonomy or embeddings, and
 * name matching specifically does **not** work — a parent asking for "toddler
 * swim classes" shares no word with "Rose Bowl Aquatics parent & me", which is
 * the right answer. Recorded so the next session does not reach for trigrams and
 * conclude they helped.
 */

/** What may answer this question, with its labels. */
export async function retrieveFor(question: QuestionContext): Promise<Retrieved> {
  const marketId = question.marketId ?? "pasadena";
  const limit = Math.min(25, Math.max(1, question.limit ?? 10));
  const kinds = question.kinds && question.kinds.length > 0
    ? question.kinds
    : ["activity", "camp", "place", "tip"];
  const area = question.area ?? "";
  const wantShares = question.shares !== false;
  const wantCaregivers = question.caregivers !== false;

  const result = await withDb(async (db: Db) => {
    const policies = (await db.execute(
      sql`select kind, stale_days, ageing_days from freshness_policy`,
    )) as unknown as FreshnessPolicy[];

    /* Array literals rather than parameter arrays: drizzle expands a JS array
       into a record and the comparison then fails — the trap already documented
       in `repo/caregiver.ts` and `option.promote`. */
    const kindList = `{${kinds.map((k) => `"${k}"`).join(",")}}`;
    const bandList =
      question.bands && question.bands.length > 0
        ? `{${question.bands.map((b) => `"${b}"`).join(",")}}`
        : null;

    const shareRows = !wantShares ? [] : (await db.execute(sql`
      select
        s.id, s.kind, s.name, s.venue, s.neighborhoods, s.age_bands,
        s.provenance, s.last_confirmed_at, s.answer_ready,
        count(sc.id) filter (where sc.firsthand)                        as firsthand,
        count(sc.id) filter (where not sc.firsthand)                    as secondhand,
        count(sc.id) filter (where sc.firsthand
                               and sc.recommendation in ('yes','yes_with_caveats'))
                                                                        as recommending
      from shares s
      join share_contributions sc on sc.share_id = s.id
      where s.market_id = ${marketId}
        and not s.is_test
        -- s.kind is the share_kind enum, so the cast is required: comparing an
        -- enum to text[] raises "operator does not exist" rather than quietly
        -- matching nothing. Double quotes here, never backticks — the whole
        -- statement is a template literal and a backtick closes it. That has now
        -- cost three separate debugging rounds in one session.
        and s.kind::text = any(${kindList}::text[])
        -- Reviewed by a human, on both halves. The strategy is explicit that this
        -- holds for the whole pilot, and shares_answerable already says it: an
        -- unreviewed record is not something Pando answers with.
        and s.status = 'approved'
        and sc.status = 'approved'
        ${bandList === null ? sql`` : sql`and s.age_bands && ${bandList}::text[]`}
      group by s.id
      order by
        -- Golden answers first (17.1), then the asker's own area, then how many
        -- parents stand behind it. Area ranks and never filters, the same rule
        -- the chip list follows.
        s.answer_ready desc,
        case when ${area} <> '' and s.neighborhoods && array[${area}]::text[] then 0 else 1 end,
        count(sc.id) filter (where sc.firsthand) desc,
        s.last_confirmed_at desc nulls last
      limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    /**
     * Invariant 1 in the WHERE clause — and **four conditions, not two**.
     *
     * Invariant 1 names `consent_status = 'consented'` and `active`. Two more
     * belong here and neither is optional:
     *
     *  - **`discoverable`** is the caregiver's own G9 permission, and it is a
     *    separate rung of the ladder (mentioned → invited → consented →
     *    discoverable → introducible, 11 Aug). Consent is not visibility: a
     *    caregiver can agree to be listed and decline to appear in answers, and
     *    the 2C flow makes that a real supported outcome. Without this clause
     *    such a caregiver would be surfaced by a query that looked correct
     *    against the invariant as written.
     *  - **`is_adult`** is invariant 2's 18+ gate. A nomination under 18 is
     *    discarded rather than stored, so this is a belt — but it is the query
     *    that a future caller will copy, so it carries the rule.
     *
     * `introducible` is deliberately **not** here: appearing in an answer and
     * being introduced are different amounts of exposure, and this function only
     * ever does the first.
     *
     * There is no `last_confirmed_at` on `caregivers`, so freshness comes from
     * the most recent nomination — the moment a parent last confirmed employing
     * them, which is what "confirmed" has to mean for a person. `updated_at`
     * would have been wrong: it moves when an admin edits a flag.
     */
    const caregiverRows = !wantCaregivers ? [] : (await db.execute(sql`
      select
        c.id, c.first_name, c.last_initial, c.provenance,
        cp.roles_wanted, cp.areas_served,
        max(n.created_at)                                               as last_confirmed_at,
        count(n.id) filter (where n.worked_for_family)                  as firsthand,
        bool_or(n.reference_willing = 'yes')                            as reference
      from caregivers c
      left join caregiver_profiles cp on cp.caregiver_id = c.id
      left join caregiver_nominations n on n.caregiver_id = c.id and not n.is_test
      where c.market_id = ${marketId}
        and not c.is_test
        and c.consent_status = 'consented'
        and c.active
        and c.discoverable
        and c.is_adult
      group by c.id, cp.roles_wanted, cp.areas_served
      order by count(n.id) filter (where n.worked_for_family) desc,
               max(n.created_at) desc nulls last
      limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    return { policies, shareRows, caregiverRows };
  });

  if (!result.persisted || !result.data) return EMPTY;
  const { policies, shareRows, caregiverRows } = result.data;

  const shares: ShareCandidate[] = [];
  for (const r of shareRows) {
    const candidate: Candidate = {
      kind: String(r.kind),
      provenance: String(r.provenance) as Candidate["provenance"],
      firsthand_count: Number(r.firsthand ?? 0),
      secondhand_count: Number(r.secondhand ?? 0),
      recommending_count: Number(r.recommending ?? 0),
      /* Both halves were required by the query, so anything here has been read. */
      human_reviewed: true,
      last_confirmed_at: (r.last_confirmed_at as string | null) ?? null,
    };
    if (!usable(candidate).ok) continue;
    shares.push({
      share_id: String(r.id),
      kind: candidate.kind,
      name: String(r.name),
      venue: r.venue ? String(r.venue) : null,
      neighborhoods: (r.neighborhoods as string[] | null) ?? [],
      age_bands: (r.age_bands as string[] | null) ?? [],
      trust: labelsFor(candidate, { policies }),
      firsthand_count: candidate.firsthand_count,
      secondhand_count: candidate.secondhand_count,
      answer_ready: r.answer_ready === true,
    });
  }

  const caregivers: CaregiverCandidate[] = [];
  for (const r of caregiverRows) {
    const candidate: Candidate = {
      kind: "caregiver",
      provenance: String(r.provenance) as Candidate["provenance"],
      firsthand_count: Number(r.firsthand ?? 0),
      secondhand_count: 0,
      /* A nomination is firsthand-only by CHECK (invariant 14), so employing a
         caregiver *is* the recommendation — there is no separate weaker signal to
         count, and treating every firsthand nomination as recommending would make
         "vouched" automatic. Only a reference-willing family raises it. */
      recommending_count: r.reference === true ? Number(r.firsthand ?? 0) : 0,
      human_reviewed: true,
      last_confirmed_at: (r.last_confirmed_at as string | null) ?? null,
      reference_available: r.reference === true,
    };
    if (!usable(candidate).ok) continue;
    caregivers.push({
      caregiver_id: String(r.id),
      /* First name and an initial — the shape the schema's CHECK enforces, and
         all Pando ever holds. Never a full surname, in any surface. */
      display:
        [r.first_name, r.last_initial ? `${r.last_initial}.` : null]
          .filter(Boolean)
          .join(" ") || "—",
      /* From her own profile (2C), so a caregiver who has not claimed one yet
         simply has no roles listed rather than roles a parent guessed at. */
      kind_of_care: (r.roles_wanted as string[] | null) ?? [],
      areas: (r.areas_served as string[] | null) ?? [],
      trust: labelsFor(candidate, { policies }),
      firsthand_count: candidate.firsthand_count,
    });
  }

  return {
    shares,
    caregivers,
    parent_backed:
      shares.some((s) => !s.trust.public_only) ||
      caregivers.some((c) => !c.trust.public_only),
    configured: true,
  };
}
