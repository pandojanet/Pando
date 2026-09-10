import { sql } from "drizzle-orm";
import { withDb, type Db } from "@/lib/server/db";
import { areaGroup } from "@/lib/server/repo/areas";
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
  /**
   * The `market_options.focus` topic the question is about — **a rank, never a
   * filter**, and that is the whole mitigation for how these get assigned.
   *
   * The topic on a record is written by the extraction model (4 Sep, the
   * developer's call with the cost stated: *"дешево, і помиляється так, що ніхто
   * не помітить"*). Ranking is what turns that from a silent failure into a
   * recoverable one. A wrong topic re-orders an answer; a wrong topic that
   * *excluded* would drop the right record and leave nothing on screen saying
   * so — and nobody would ever know, which is precisely the accepted risk.
   *
   * The same argument the chip list already makes about the asker's area: it
   * ranks and never filters.
   */
  focus?: string | null;
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
  /**
   * What it costs, **only when every parent who said so said the same thing.**
   *
   * R8 captures a band and a unit as taps, and it is the single most actionable
   * fact a parent asked to choose between two classes has — the answer named
   * things without ever saying what they cost. Aggregating it needs a rule, and
   * the honest one is agreement: two parents reporting `50_100` and one
   * reporting `100_200` is not a range Pando may state, and the modal value
   * would silently drop a real disagreement about money. Null when they differ,
   * and the line simply omits it.
   */
  price_band: string | null;
  price_unit: string | null;
  /**
   * R9's worth-it judgement, under the same agreement rule as the price.
   *
   * ⚠ **Measured before it was added, because the coverage is the point:**
   * across the live market the parents agree on this for **8 of 13** records and
   * on the price for 11 of 13 — and of the five records with more than one
   * contribution, only two agree on worth. So this shows mostly on records one
   * parent contributed, which are precisely the ones whose *trust* labels are
   * weakest. It is worth having and it is not a substitute for volume.
   *
   * The disagreements are shades rather than contradictions ("fair" against
   * "great value"), which is an argument for a modal value and a better argument
   * against one: enthusiasm is exactly what a reader would take from the word,
   * and reporting the majority's would quietly discard a parent who paid the
   * same money and thought less of it.
   */
  worth_it: string | null;
  /**
   * The lead contributor's first name, and only where they turned it on for
   * this recommendation (10 Sep). Null everywhere else, including the far
   * commoner case of a parent who simply never touched the switch.
   *
   * ⚠ It belongs to whoever wrote `note_great`, when there is one — see the
   * SQL. A name from any other contribution would attribute one parent's
   * sentence to another, which is the one failure this field can produce.
   */
  named_by: string | null;
  /** A firsthand parent's own words, approved and unedited. See the SQL. */
  note_great: string | null;
  note_caveat: string | null;
  /** R5 -- who it suits, the closest thing the graph has to fit. */
  note_who_for: string | null;
  /** The practical thing a parent would not know to ask. */
  note_tip: string | null;
  /** So the evidence can be said in prose rather than as a label. */
  last_confirmed_at: string | null;
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
 * The topics this market offers, as ids.
 *
 * Lives here rather than in a constant because `market_options` is
 * authoritative and an admin edits it (12 Aug) — a list in code would go stale
 * the day a market is added, and it is what both the extraction pass and the
 * question reader check their answers against. Empty on an unreachable database,
 * which reads as "match no topic" and costs an ordering nudge rather than an
 * answer.
 */
export async function focusOptions(marketId = "pasadena"): Promise<string[]> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select option_value from market_options
       where market_id = ${marketId} and category = 'focus' and active
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => String(r.option_value));
  });
  return result.persisted ? (result.data ?? []) : [];
}

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
  /**
   * The area **and every neighborhood that means the same place** (8 Sep).
   *
   * `shares.neighborhoods` and a parent's stored neighborhood are drawn from the
   * same 79-value list, which mixes seventeen towns with fourteen Pasadena
   * districts — so an exact comparison made a district an island. Measured: 13
   * of 39 contributors matched no approved record's area at all. See
   * `repo/areas.ts`; the group always contains the area itself, so this can only
   * ever widen a match.
   */
  const areaIds = await areaGroup(marketId, area);
  /* A Postgres array **literal**, never a JS array: drizzle expands one into a
     record and the `&&` then fails. The same trap `kindList` above documents,
     and `repo/caregiver.ts` and `option.promote` have each paid for it. Slugs
     only, so nothing here needs escaping beyond the quotes. */
  const areas = `{${areaIds.map((a) => `"${a}"`).join(",")}}`;
  const wantShares = question.shares !== false;
  const focus = question.focus ?? "";
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
        /**
         * What a parent actually wrote, and the two guards on it.
         *
         * ⚠ The client's strategy is built on this material — *"two said the
         * 9am class is calmer than the 10:30"* — and it had never left the
         * database. Invariant 8 permits it: the sentence is about a class, and
         * sc.status = approved (already in the WHERE) is the human review, and no
         * backtick appears in this comment: one inside a sql template closes it,
         * which is now the fifth time that has cost a debugging round.
         *
         * **Ordered by the extraction score**, which is exactly the question that
         * pass answers: how much could another parent act on this text (12 Aug).
         * Recency alone picked "Lovely for the little ones" over "Small groups and
         * the teacher is unbelievably patient with the ones who won't join in" --
         * measured on the live graph, and the score already knew which was which.
         *
         * **From a firsthand contribution only.** "We heard it's good" is not a
         * sentence to put in another parent's hands as experience.
         *
         * **Null for a record anybody flagged as naming a person**, open or
         * escalated. 11.4's detector reads a record's *name*; a note naming
         * somebody is the case the invariant is actually written for, and this
         * is the one place a reviewer's doubt has to win over their approval.
         */
        (case when exists (
               select 1 from flags f
                where f.subject_id = s.id
                  and f.reason = 'possible_named_person'
                  and f.status in ('open', 'escalated')
             ) then null
             else (array_remove(array_agg(
                     case when sc.firsthand then nullif(btrim(sc.what_makes_it_great), '') end
                     order by sc.confidence desc nulls last, sc.created_at desc), null))[1]
        end)                                                            as note_great,
        (case when exists (
               select 1 from flags f
                where f.subject_id = s.id
                  and f.reason = 'possible_named_person'
                  and f.status in ('open', 'escalated')
             ) then null
             else (array_remove(array_agg(
                     case when sc.firsthand then nullif(btrim(sc.caveat), '') end
                     order by sc.confidence desc nulls last, sc.created_at desc), null))[1]
        end)                                                            as note_caveat,
        (case when exists (
               select 1 from flags f
                where f.subject_id = s.id
                  and f.reason = 'possible_named_person'
                  and f.status in ('open', 'escalated')
             ) then null
             else (array_remove(array_agg(
                     case when sc.firsthand then nullif(btrim(sc.who_for), '') end
                     order by sc.confidence desc nulls last, sc.created_at desc), null))[1]
        end)                                                            as note_who_for,
        (case when exists (
               select 1 from flags f
                where f.subject_id = s.id
                  and f.reason = 'possible_named_person'
                  and f.status in ('open', 'escalated')
             ) then null
             else (array_remove(array_agg(
                     case when sc.firsthand then nullif(btrim(sc.tip_text), '') end
                     order by sc.confidence desc nulls last, sc.created_at desc), null))[1]
        end)                                                            as note_tip,
        /**
         * The contributor's first name, when they turned it on for this one
         * recommendation (10 Sep, drizzle/0038).
         *
         * ## It is the *lead* contributor's name, and that is the correctness rule
         *
         * The obvious version — "the top firsthand contributor who opted in" —
         * misattributes. If A wrote the sentence above and never agreed to be
         * named, and B agreed and wrote nothing, that query hands the composer
         * B's name to put in front of A's words. So this orders by exactly what
         * note_great orders by, with contributions that have a note first, and
         * takes whoever that lands on. The name and the quote therefore always
         * belong to the same person or there is no name.
         *
         * The empty string is a real value here and means *this contributor
         * declined*, which is not the same as *there is no contributor* — the
         * mapping below reads it back as null, and the distinction is what stops
         * a declining lead being skipped over in favour of somebody else.
         *
         * Same named-person guard as the notes. A record a reviewer has flagged
         * is one where nothing new gets attributed to anybody until they have
         * looked.
         *
         * And no backtick appears anywhere in this comment: one inside a sql
         * template closes it. That is now the seventh debugging round this file
         * has cost, and the first paragraph above was written with two.
         */
        (case when exists (
               select 1 from flags f
                where f.subject_id = s.id
                  and f.reason = 'possible_named_person'
                  and f.status in ('open', 'escalated')
             ) then null
             else (array_agg(
                     coalesce(case when sc.show_first_name
                                   then nullif(btrim(p.first_name), '') end, '')
                     order by (nullif(btrim(sc.what_makes_it_great), '') is null),
                              sc.confidence desc nulls last, sc.created_at desc)
                     filter (where sc.firsthand))[1]
        end)                                                            as named_by,
        count(sc.id) filter (where sc.firsthand)                        as firsthand,
        count(sc.id) filter (where not sc.firsthand)                    as secondhand,
        count(sc.id) filter (where sc.firsthand
                               and sc.recommendation in ('yes','yes_with_caveats'))
                                                                        as recommending,
        -- Agreement, not an average: the count of distinct answers is what the
        -- mapping below checks before it is willing to state a price at all.
        count(distinct sc.price_band) filter (where sc.price_band is not null) as price_bands,
        count(distinct sc.price_unit) filter (where sc.price_unit is not null) as price_units,
        count(distinct sc.worth_it) filter (where sc.worth_it is not null)     as worths,
        min(sc.price_band) filter (where sc.price_band is not null)     as price_band,
        min(sc.price_unit) filter (where sc.price_unit is not null)     as price_unit,
        min(sc.worth_it) filter (where sc.worth_it is not null)         as worth_it
      from shares s
      join share_contributions sc on sc.share_id = s.id
      -- LEFT, because a contribution has no person on the anonymous path and an
      -- inner join would drop the record from every answer rather than drop the
      -- name from one line.
      left join people p on p.id = sc.person_id
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
        -- The topic the question is about, then the asker's own area, then a
        -- golden answer (17.1), then how many parents stand behind it. All four
        -- rank and none of them filters, which for the topic is a deliberate
        -- guard rather than symmetry: see QuestionContext.focus, and note the
        -- backtick this comment deliberately does not contain: one inside a sql
        -- template closes it. That is documented in CLAUDE.md and has now cost a
        -- fourth debugging round.
        --
        -- The golden flag used to be FIRST, and that was the wrong reading of
        -- 17.1 (8 Sep). It means "complete enough to answer a question with" --
        -- a statement about the record, not about THIS question -- and six of
        -- fifteen live records carry it, so any golden record beat the only
        -- record about the subject. Measured: for three of the seven populated
        -- topics the first on-topic record sat at rank 7, and the budget fits
        -- about three. It is a tiebreak among equally relevant records now.
        case when ${focus} <> '' and s.focus = ${focus} then 0 else 1 end,
        case when ${area} <> '' and s.neighborhoods && ${areas}::text[] then 0 else 1 end,
        s.answer_ready desc,
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
      /* Agreement, checked here rather than in SQL so the rule is readable: one
         distinct answer means the parents agree and Pando may say it. */
      price_band: Number(r.price_bands) === 1 ? String(r.price_band) : null,
      price_unit: Number(r.price_units) === 1 ? String(r.price_unit) : null,
      worth_it: Number(r.worths) === 1 ? String(r.worth_it) : null,
      /* Already approved and already guarded in the SQL above. Verbatim: a
         parent's sentence is never edited before another parent reads it. */
      /* The empty string is the SQL saying "the lead contributor declined",
         which reads back as null here — the two are the same to every caller,
         and only the query needed to tell them apart. */
      named_by: r.named_by ? String(r.named_by) : null,
      note_great: r.note_great ? String(r.note_great) : null,
      note_caveat: r.note_caveat ? String(r.note_caveat) : null,
      note_who_for: r.note_who_for ? String(r.note_who_for) : null,
      note_tip: r.note_tip ? String(r.note_tip) : null,
      last_confirmed_at: r.last_confirmed_at ? String(r.last_confirmed_at) : null,
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
