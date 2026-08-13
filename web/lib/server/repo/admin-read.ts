import "server-only";

import { sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import type { AdminResource } from "@/lib/admin/types";

/**
 * Estimates 2.2–2.8 — every admin read, in one place.
 *
 * Replaced the 16-node `admin_read` workflow. Two rules carried over from it:
 *
 *  - **the list views never carry restricted text.** `admin_caregiver_rows`
 *    reports *whether* a private note exists; the body is its own resource,
 *    fetched one at a time, so a list render cannot leak it (invariant 12).
 *  - **a phone is masked before it leaves this file.** The admin needs to
 *    recognise a contributor, not to be able to read out their number
 *    (invariant 7).
 */

/** Enough to recognise a returning parent, not enough to call them. */
function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  return phone.length <= 4 ? "•••" : `•••${phone.slice(-4)}`;
}

type Row = Record<string, unknown>;

async function rows(db: Db, query: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await db.execute(query);
  return result as unknown as Row[];
}

export async function readResource(
  db: Db,
  resource: AdminResource,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (resource) {
    case "overview":
      return overview(db);
    case "contributors":
      return contributors(db);
    case "contributor":
      return contributorDetail(db, String(params.id ?? ""));
    case "contributions":
      return contributions(db);
    case "caregivers":
      return caregivers(db);
    case "caregiver_claims":
      return caregiverClaims(db);
    case "restricted_note":
      return restrictedNote(db, String(params.nomination_id ?? params.id ?? ""));
    case "duplicates":
      return duplicates(db);
    case "options":
      return pendingOptions(db);
    case "flags":
      return flagRows(db);
    case "demand":
      return demandRows(db);
    case "founding":
      return foundingQueue(db);
    case "invites":
      return inviteRows(db);
    case "consents":
      return consentRows(db);
    case "audit":
      return auditRows(db);
  }
}

/* ── 2.1 Overview ────────────────────────────────────────────────────────── */

async function overview(db: Db) {
  const [r] = await rows(
    db,
    sql`
      /**
       * One pass over founding_checklist, not four.
       *
       * The view runs two correlated counts per person, so every extra scan of
       * it costs that again — and this page had grown to four (two-plus, plus
       * the three reward states). A CTE referenced more than once is
       * materialised by Postgres, so the counts below share a single scan and
       * separate with FILTER.
       */
      with checklist as (
        select fc.qualifying_approved,
               fc.caregiver_approved,
               s.person_id is not null as gave_something
        from founding_checklist fc
        left join (select distinct person_id from submissions where not is_test) s
          on s.person_id = fc.person_id
      ),
      reward as (
        select
          count(*) filter (where qualifying_approved >= 2)                 as with_two_plus,
          count(*) filter (where qualifying_approved >= 1
                              or caregiver_approved >= 1)                  as reward_eligible,
          count(*) filter (where qualifying_approved = 0
                             and caregiver_approved = 0
                             and gave_something)                           as reward_started,
          count(*) filter (where not gave_something)                       as reward_none
        from checklist
      )
      select
        (select count(*) from people where not is_test)                            as contributors_total,
        (select count(*) from people where not is_test and profile_completeness > 0) as contributors_completed,
        r.with_two_plus,
        (select count(*) from submissions where kind = 'activity' and not is_test) as activities,
        (select count(*) from submissions where kind = 'caregiver' and not is_test) as caregivers,
        (select count(*) from submissions where kind = 'place' and not is_test)    as places,
        (select count(*) from submissions where kind = 'tip' and not is_test)      as tips,
        (select count(distinct person_id) from consents
           where scope = 'follow_up' and status = 'opted_in')                      as follow_up_opt_in,
        (select count(*) from caregiver_nominations
           where reference_willing = 'yes' and not is_test)                        as reference_willing,
        (select count(*) from caregivers where consent_status = 'mentioned' and not is_test) as cg_mentioned,
        (select count(*) from caregivers where consent_status = 'invited'   and not is_test) as cg_invited,
        (select count(*) from caregivers where consent_status = 'consented' and not is_test) as cg_consented,
        (select count(*) from caregivers where consent_status = 'declined'  and not is_test) as cg_declined,
        (select count(*) from share_contributions
           where confidence is not null and confidence < 0.6 and not is_test)      as low_confidence,
        (select count(*) from flags where status = 'open')                         as open_flags,
        (select count(*) from flags
           where status = 'open' and severity = 'escalation')                      as escalations,
        (select count(*) from pending_options where status = 'pending')            as pending_options,
        (select count(*) from caregiver_nominations where review_hold and not is_test) as review_holds,
        (select count(*) from caregiver_claims
           where status = 'pending' and not is_test)                            as pending_claims,
        (select count(*) from share_contributions
           where status = 'pending_review' and not is_test)                        as pending_contributions,
        (select count(*) from people where founding = 'pending_founding' and not is_test) as founding_pending,
        (select count(*) from people where founding = 'founding' and not is_test)  as founding_approved,
        -- The reward gate. founding_checklist already excludes test rows, and it
        -- is the only place the qualifying rule is written down: counting it
        -- again by hand here would be a second definition waiting to drift.
        r.reward_eligible,
        r.reward_started,
        r.reward_none,
        (select count(*) from demand_signals
           where status = 'open' and sensitivity = 'ordinary' and not is_test)     as demand_ordinary,
        (select count(*) from demand_signals
           where status = 'open' and sensitivity = 'peer_support' and not is_test) as demand_peer,
        (select count(*) from demand_signals
           where status = 'open' and sensitivity = 'high_stakes' and not is_test)  as demand_high,
        (select count(*) from demand_signals
           where status = 'open' and sensitivity = 'named_allegation'
             and not is_test)                                                     as demand_allegation,
        -- §17.1. Not a queue: this one counts *up* as the golden-answer pass
        -- progresses, which is why it is not one of the quality numbers.
        (select count(*) from shares where answer_ready and not is_test)           as answer_ready
      from reward r
    `,
  );

  const n = (key: string) => Number(r?.[key] ?? 0);

  return {
    contributors: {
      total: n("contributors_total"),
      completed: n("contributors_completed"),
      with_two_plus: n("with_two_plus"),
    },
    submissions: {
      activities: n("activities"),
      caregivers: n("caregivers"),
      places: n("places"),
      tips: n("tips"),
    },
    consent: {
      follow_up_opt_in: n("follow_up_opt_in"),
      reference_willing: n("reference_willing"),
    },
    caregivers: {
      mentioned: n("cg_mentioned"),
      invited: n("cg_invited"),
      consented: n("cg_consented"),
      declined: n("cg_declined"),
    },
    quality: {
      low_confidence: n("low_confidence"),
      open_flags: n("open_flags"),
      pending_options: n("pending_options"),
      review_holds: n("review_holds"),
      pending_contributions: n("pending_contributions"),
      escalations: n("escalations"),
      pending_claims: n("pending_claims"),
    },
    founding: { pending: n("founding_pending"), approved: n("founding_approved") },
    reward: {
      eligible: n("reward_eligible"),
      started: n("reward_started"),
      none: n("reward_none"),
    },
    demand: {
      ordinary: n("demand_ordinary"),
      peer_support: n("demand_peer"),
      high_stakes: n("demand_high"),
      named_allegation: n("demand_allegation"),
    },
    answer_ready: n("answer_ready"),
    /** Funnels live in PostHog; this page does not invent its own. */
    drop_off: [],
    posthog_url: process.env.POSTHOG_DASHBOARD_URL ?? null,
  };
}

/* ── 2.3 Contributors ────────────────────────────────────────────────────── */

async function contributors(db: Db) {
  const list = await rows(
    db,
    sql`
      select p.id, p.first_name, p.last_name, p.phone, p.neighborhood,
             p.founding, p.wants_founding, p.is_test, p.created_at,
             coalesce(array_agg(c.birth_year) filter (where c.birth_year is not null), '{}') as birth_years,
             (select count(*) from submissions s where s.person_id = p.id)        as submissions,
             -- Joined, not sub-selected twice: founding_checklist runs two
             -- correlated counts per person, so asking it for one column and
             -- then the other ran the whole view twice for every row.
             coalesce(fc.qualifying_approved, 0)                                  as qualifying_approved,
             coalesce(fc.caregiver_approved, 0)                                   as caregiver_approved,
             (select cs.status from consents cs
                where cs.person_id = p.id and cs.scope = 'follow_up'
                order by cs.captured_at desc limit 1)                             as follow_up
      from people p
      left join children c on c.person_id = p.id
      left join founding_checklist fc on fc.person_id = p.id
      group by p.id, fc.qualifying_approved, fc.caregiver_approved
      order by p.created_at desc
      limit 500
    `,
  );

  return list.map((r) => {
    const qualifying = Number(r.qualifying_approved ?? 0);
    const caregivers = Number(r.caregiver_approved ?? 0);
    const submissions = Number(r.submissions ?? 0);

    return {
      id: r.id,
      name: fullName(r.first_name, r.last_name),
      phone_masked: maskPhone(r.phone as string | null),
      neighborhood: r.neighborhood,
      child_birth_years: (r.birth_years as number[]) ?? [],
      submissions,
      qualifying_approved: qualifying,
      caregiver_approved: caregivers,
      /**
       * "One activity or one caregiver" — the client's minimum, not Founding's
       * two. `started` is the honest middle: they gave something, but nothing has
       * been approved yet, so the answer to "do I pay this person" is *not yet*
       * rather than no.
       */
      reward_status:
        qualifying >= 1 || caregivers >= 1
          ? "eligible"
          : submissions > 0
            ? "started"
            : "none",
      founding_status: r.founding,
      follow_up_opt_in: r.follow_up === null ? null : r.follow_up === "opted_in",
      wants_founding: r.wants_founding,
      is_test: r.is_test,
      created_at: r.created_at,
    };
  });
}

async function contributorDetail(db: Db, id: string) {
  if (!id) return null;
  /**
   * One statement, ten result sets.
   *
   * This used to be a `Promise.all` of ten queries, which reads like the fast
   * version and is not. Measured against the Supabase pooler: a query is ~195ms
   * of round trip and ~5ms of work, but a *new connection* is ~1300ms of TLS and
   * auth — so fanning ten queries out opened ten sockets and paid the handshake
   * on nine of them. Collapsing them into one scalar-subquery statement is one
   * round trip on one connection.
   *
   * Each sub-select is independent and keyed on the same person, so this is the
   * same work the planner was doing anyway, minus the network.
   *
   * **One shape did change.** Timestamps inside these json_build_object calls are
   * serialised by Postgres (`2026-08-10T11:30:27.680876+00:00`) rather than by the
   * driver, which used to hand back a JS `Date` that `NextResponse.json` rendered
   * as `2026-08-10T11:30:27.680Z`. Both are ISO 8601 and `new Date()` parses them
   * to the same instant, which is all `when()` in `components/admin/ui.tsx` needs —
   * but anything that ever string-compares or slices one of these must not assume
   * the `Z` form.
   */
  const [p] = await rows(
    db,
    sql`
      select
        p.*,
        (select coalesce(json_agg(k.birth_year), '[]'::json)
           from children k where k.person_id = p.id)                    as kids,
        (select coalesce(json_agg(json_build_object(
                  'affinity_type', a.affinity_type,
                  'affinity_value', a.affinity_value,
                  'weight', a.weight_at_capture)), '[]'::json)
           from social_affinities a where a.person_id = p.id)           as affinities,
        (select coalesce(json_agg(json_build_object(
                  'dimension', l.dimension, 'value', l.value)), '[]'::json)
           from life_relevance l where l.person_id = p.id)              as relevance,
        (select coalesce(json_agg(json_build_object(
                  'option_value', sc.option_value, 'status', sc.status)), '[]'::json)
           from person_schools sc where sc.person_id = p.id)            as schools,
        (select coalesce(json_agg(json_build_object(
                  'id', x.id, 'kind', x.kind, 'title', x.title,
                  'status', x.status, 'firsthand', x.firsthand,
                  'received_at', x.received_at)
                  order by x.received_at desc), '[]'::json)
           from (
             select s.id, s.kind, s.received_at,
                    coalesce(pl.name, cg.first_name, 'Untitled') as title,
                    coalesce(pc.status, cn.status, 'pending_review') as status,
                    coalesce(pc.firsthand, cn.worked_for_family, false) as firsthand
             from submissions s
             left join share_contributions pc on pc.submission_id = s.id
             left join shares pl on pl.id = pc.share_id
             left join caregiver_nominations cn on cn.submission_id = s.id
             left join caregivers cg on cg.id = cn.caregiver_id
             where s.person_id = p.id
           ) x)                                                         as cards,
        (select coalesce(json_agg(json_build_object(
                  'scope', cs.scope, 'status', cs.status,
                  'text_version', cs.text_version, 'captured_at', cs.captured_at)
                  order by cs.captured_at desc), '[]'::json)
           from consents cs where cs.person_id = p.id)                  as consent_rows,
        (select coalesce(json_agg(json_build_object(
                  'id', al.id, 'actor', al.actor, 'after', al.after, 'at', al.at)
                  order by al.at desc), '[]'::json)
           from audit_log al
           where al.resource = 'contributor_note'
             and al.resource_id = p.id::text)                           as notes,
        (select to_json(fc) from founding_checklist fc
           where fc.person_id = p.id)                                   as checklist,
        -- A voided link is excluded rather than deleted: "we thought Sarah
        -- brought her, we were wrong" is still something the trail should hold.
        (select json_build_object('id', r.referrer_id,
                  'first_name', p2.first_name, 'last_name', p2.last_name)
           from referrals r join people p2 on p2.id = r.referrer_id
           where r.referred_id = p.id and r.status <> 'void'
           limit 1)                                                     as referred_by,
        (select coalesce(json_agg(json_build_object(
                  'referral_id', r.id, 'id', r.referred_id, 'status', r.status,
                  'first_name', p2.first_name, 'last_name', p2.last_name)
                  order by r.created_at desc), '[]'::json)
           from referrals r join people p2 on p2.id = r.referred_id
           where r.referrer_id = p.id)                                  as referred
      from people p
      where p.id = ${id}::uuid
      limit 1
    `,
  );
  if (!p) return null;

  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const kids = list<number>(p.kids);
  const affinities = list<Row>(p.affinities);
  const relevance = list<Row>(p.relevance);
  const schools = list<Row>(p.schools);
  const cards = list<Row>(p.cards);
  const consentRows = list<Row>(p.consent_rows);
  const notes = list<Row>(p.notes);
  const checklist = p.checklist ? [p.checklist as Row] : [];
  const referredBy = p.referred_by ? [p.referred_by as Row] : [];
  const referred = list<Row>(p.referred);

  return {
    id: p.id,
    name: fullName(p.first_name, p.last_name),
    phone_masked: maskPhone(p.phone as string | null),
    neighborhood: p.neighborhood,
    child_birth_years: kids.filter((y): y is number => typeof y === "number"),
    submissions: cards.length,
    qualifying_approved: Number(checklist[0]?.qualifying_approved ?? 0),
    caregiver_approved: Number(checklist[0]?.caregiver_approved ?? 0),
    reward_status:
      Number(checklist[0]?.qualifying_approved ?? 0) >= 1 ||
      Number(checklist[0]?.caregiver_approved ?? 0) >= 1
        ? "eligible"
        : cards.length > 0
          ? "started"
          : "none",
    founding_status: p.founding,
    follow_up_opt_in:
      consentRows.find((c) => c.scope === "follow_up")?.status === "opted_in",
    wants_founding: p.wants_founding,
    is_test: p.is_test,
    created_at: p.created_at,
    invite_code: p.invite_code,
    source: p.source,
    profile_completeness: Number(p.profile_completeness ?? 0),
    time_in_area: p.time_in_area,
    moved_from: p.moved_from,
    attribution: p.attribution,
    aggregate_display: p.aggregate_display,
    monthly_contact_allowance: p.monthly_contact_allowance,
    allowance_mode: p.allowance_mode,
    topic_preferences: p.topic_preferences ?? [],
    topics_lived_experience: p.topics_lived_experience ?? [],
    school_status: Object.fromEntries(
      schools.map((s) => [s.option_value as string, s.status as string]),
    ),
    affinities: affinities.map((a) => ({
      affinity_type: a.affinity_type,
      affinity_value: a.affinity_value,
      /** `weight`, not `weight_at_capture`: the json_build_object above renames it. */
      weight: a.weight,
    })),
    relevance: relevance.map((r) => ({ dimension: r.dimension, value: r.value })),
    cards: cards.map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      status: c.status,
      firsthand: c.firsthand,
      created_at: c.received_at,
    })),
    consents: consentRows,
    /** The chat stays on the device; nothing is stored until that is a decision. */
    transcript: [],
    notes: notes.map((n) => ({
      id: n.id,
      author: n.actor,
      body: (n.after as { body?: string } | null)?.body ?? "",
      at: n.at,
    })),
    referral: {
      referred_by: referredBy[0]
        ? {
            id: referredBy[0].id as string,
            name: fullName(referredBy[0].first_name, referredBy[0].last_name),
          }
        : null,
      referred: referred.map((r) => ({
        referral_id: r.referral_id as string,
        id: r.referred_id as string,
        name: fullName(r.first_name, r.last_name),
        status: r.status,
      })),
    },
  };
}

/* ── 2.4 Contributions ───────────────────────────────────────────────────── */

async function contributions(db: Db) {
  const list = await rows(
    db,
    sql`
      select pc.*, pl.name, pl.venue, pl.neighborhoods, pl.age_bands,
             pl.freshness_state, pl.last_confirmed_at, pl.validated_count,
             pl.answer_ready,
             pl.id as share_id, pl.kind, pl.provenance,
             p.id as contributor_id, p.first_name, p.last_name
      from share_contributions pc
      join shares pl on pl.id = pc.share_id
      left join people p on p.id = pc.person_id
      order by pc.created_at desc
      limit 500
    `,
  );

  return list.map((r) => ({
    id: r.id,
    kind: r.kind,
    share: {
      id: r.share_id,
      name: r.name,
      venue: r.venue,
      neighborhoods: r.neighborhoods ?? [],
      age_bands: r.age_bands ?? [],
      freshness_state: r.freshness_state,
      last_confirmed_at: r.last_confirmed_at,
      validated_count: Number(r.validated_count ?? 0),
      answer_ready: r.answer_ready === true,
    },
    firsthand: r.firsthand,
    child_age_at_time: r.child_age_at_time ?? [],
    last_there: r.last_there,
    how_much: r.how_much,
    recommendation: r.recommendation,
    what_makes_it_great: r.what_makes_it_great,
    caveat: r.caveat,
    caveat_answered: r.caveat_answered,
    who_for: r.who_for,
    who_not_for: r.who_not_for,
    price_band: r.price_band,
    price_unit: r.price_unit,
    worth_it: r.worth_it,
    follow_up_ok: r.follow_up_ok,
    tip_text: r.tip_text,
    status: r.status,
    confidence: r.confidence === null ? null : Number(r.confidence),
    confidence_note: (r.confidence_note as string | null) ?? null,
    provenance: r.provenance,
    contributor: r.contributor_id
      ? { id: r.contributor_id, name: fullName(r.first_name, r.last_name) }
      : null,
    is_test: r.is_test,
    created_at: r.created_at,
  }));
}

/* ── 2.5 Caregivers ──────────────────────────────────────────────────────── */

async function caregivers(db: Db) {
  /**
   * Straight off `admin_caregiver_rows`, which is the view that decides what a
   * list is allowed to know. Note what it returns about the restricted notes: a
   * boolean, never the text.
   */
  const list = await rows(
    db,
    sql`
      select r.*, n.needs_horizon, n.needs_change_type, n.recontact_ok,
             n.pay_band, n.pay_benchmark_consent,
             n.schedule_pattern, n.hours_per_week, n.benefits
      from admin_caregiver_rows r
      left join caregiver_nominations n
        on n.caregiver_id = r.id and n.status = r.nomination_status
      order by r.created_at desc
      limit 500
    `,
  );

  return list.map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_initial: r.last_initial,
    type: r.type,
    good_with_bands: r.good_with_bands ?? [],
    strengths: [],
    good_fit_for: [],
    consent_status: r.consent_status,
    active: r.active,
    discoverable: r.discoverable,
    introducible: r.introducible,
    consent_evidence: r.consent_evidence,
    invite_sent_by_parent: r.invite_sent_by_parent,
    hire_again: null,
    review_hold: r.review_hold ?? false,
    hold_reasons: r.hold_reasons ?? [],
    has_restricted_notes: r.has_restricted_notes ?? false,
    caveat: r.caveat,
    nomination_status: r.nomination_status ?? "pending_review",
    contributor_reference_opt_in: r.contributor_reference_opt_in,
    needs_horizon: r.needs_horizon,
    needs_change_type: r.needs_change_type,
    recontact_ok: r.recontact_ok ?? false,
    pay_band: r.pay_band,
    pay_benchmark_consent: r.pay_benchmark_consent ?? false,
    schedule_pattern: r.schedule_pattern ?? [],
    hours_per_week: r.hours_per_week,
    benefits: r.benefits ?? [],
    nominations: Number(r.nominations ?? 0),
    provenance: r.provenance,
    is_test: r.is_test,
    created_at: r.created_at,
  }));
}

/**
 * Fetched one at a time, deliberately. The caller writes an audit row for every
 * read — that is the whole reason this is not a column on the list.
 */
async function restrictedNote(db: Db, nominationId: string) {
  if (!nominationId) return null;
  const list = await rows(
    db,
    sql`select id, nomination_id, kind, body, created_at
        from restricted_notes where nomination_id = ${nominationId}::uuid
        order by created_at`,
  );
  return list;
}

/**
 * Suggestions only — never merged automatically (2.5). Name and initial are not
 * an identifier, so this proposes and a human decides.
 */
async function duplicates(db: Db) {
  const list = await rows(
    db,
    sql`
      select a.id as a_id, a.first_name as a_first, a.last_initial as a_initial,
             b.id as b_id, b.first_name as b_first, b.last_initial as b_initial,
             similarity(lower(a.first_name), lower(b.first_name)) as score
      from caregivers a
      join caregivers b
        on b.id > a.id
       and b.market_id = a.market_id
       and coalesce(b.last_initial,'') = coalesce(a.last_initial,'')
       and similarity(lower(a.first_name), lower(b.first_name)) > 0.6
      where not a.is_test and not b.is_test
      limit 100
    `,
  );

  return list.map((r) => ({
    key: `${r.a_id}:${r.b_id}`,
    score: Number(r.score ?? 0),
    reason: ["similar first name", "same last initial"],
    members: [
      {
        id: r.a_id,
        first_name: r.a_first,
        last_initial: r.a_initial,
        type: null,
        neighborhood: null,
      },
      {
        id: r.b_id,
        first_name: r.b_first,
        last_initial: r.b_initial,
        type: null,
        neighborhood: null,
      },
    ],
  }));
}

/* ── 2.6 Tap lists ───────────────────────────────────────────────────────── */

async function pendingOptions(db: Db) {
  const list = await rows(
    db,
    sql`
      select po.*, p.id as person_id, p.first_name, p.last_name
      from pending_options po
      left join people p on p.id = po.submitted_by
      where po.status = 'pending'
      order by po.occurrences desc, po.created_at desc
      limit 300
    `,
  );

  return list.map((r) => ({
    id: r.id,
    market_id: r.market_id,
    category: r.category,
    submitted_value: r.submitted_value,
    submitted_by: r.person_id
      ? { id: r.person_id, name: fullName(r.first_name, r.last_name) }
      : null,
    occurrences: Number(r.occurrences ?? 1),
    status: r.status,
    created_at: r.created_at,
  }));
}

/* ── 2.7 Flags and demand ────────────────────────────────────────────────── */

async function flagRows(db: Db) {
  const list = await rows(
    db,
    sql`
      select f.*, p.id as person_id, p.first_name, p.last_name
      from flags f
      left join people p on p.id = f.person_id
      order by
        case f.severity when 'escalation' then 0 when 'review' then 1 else 2 end,
        f.created_at desc
      limit 300
    `,
  );

  return list.map((r) => ({
    id: r.id,
    severity: r.severity,
    reason: r.reason,
    excerpt: r.excerpt ?? "",
    field: r.field,
    subject: r.subject_kind
      ? { kind: r.subject_kind, id: r.subject_id, title: String(r.reason) }
      : null,
    contributor: r.person_id
      ? { id: r.person_id, name: fullName(r.first_name, r.last_name) }
      : null,
    status: r.status,
    confidence: r.confidence === null ? null : Number(r.confidence),
    created_at: r.created_at,
  }));
}

async function demandRows(db: Db) {
  const list = await rows(
    db,
    sql`
      select d.*, p.id as person_id, p.first_name, p.last_name
      from demand_signals d
      left join people p on p.id = d.person_id
      order by
        -- A claim about a named person sorts above everything, including a
        -- high-stakes question: it is the one class where nothing at all can
        -- happen until somebody has read it.
        case d.sensitivity
          when 'named_allegation' then 0
          when 'high_stakes' then 1
          when 'peer_support' then 2
          else 3 end,
        d.created_at desc
      limit 300
    `,
  );

  return list.map((r) => ({
    id: r.id,
    question_text: r.question_text,
    category: r.category,
    neighborhood: r.neighborhood,
    sensitivity: r.sensitivity,
    requires_human_review: r.requires_human_review,
    status: r.status,
    contributor: r.person_id
      ? { id: r.person_id, name: fullName(r.first_name, r.last_name) }
      : null,
    is_test: r.is_test,
    created_at: r.created_at,
  }));
}

/* ── 2C Caregiver claims ─────────────────────────────────────────────────── */

/**
 * A caregiver's own registration, plus the nominations it *might* belong to.
 *
 * The candidate list is a shortlist, not a match. It is scoped to the same market,
 * the same first name and the same initial, and to nominees whose invite a parent
 * actually sent — because the only legitimate way here is that invite. Anything
 * looser would invite an admin to link two different people who share a name, which
 * is the one mistake this table exists to make impossible to do by accident.
 *
 * Note what is absent: nothing from `caregiver_nominations` beyond a count, and
 * nothing at all from `restricted_notes`. A private note about a named person does
 * not travel to a screen about that person (invariant 12).
 */
async function caregiverClaims(db: Db) {
  const list = await rows(
    db,
    sql`
      select cc.*, p.phone,
             lc.first_name as linked_first_name,
             lc.last_initial as linked_last_initial,
             (select coalesce(json_agg(json_build_object(
                       'id', c.id,
                       'first_name', c.first_name,
                       'last_initial', c.last_initial,
                       'consent_status', c.consent_status,
                       'nominations', (select count(*) from caregiver_nominations n
                                         where n.caregiver_id = c.id),
                       'invite_sent_by_parent', exists (
                         select 1 from caregiver_nominations n
                         where n.caregiver_id = c.id and n.invite_sent_by_parent))
                     ), '[]'::json)
                from caregivers c
                where c.market_id = cc.market_id
                  and not c.is_test
                  and lower(c.first_name) = lower(cc.first_name)
                  and coalesce(upper(c.last_initial), '') = coalesce(upper(cc.last_initial), '')
                  and c.consent_status in ('mentioned', 'invited')
             ) as candidates
      from caregiver_claims cc
      join people p on p.id = cc.person_id
      left join caregivers lc on lc.id = cc.linked_caregiver_id
      where not cc.is_test
      order by cc.status = 'pending' desc, cc.created_at desc
      limit 200
    `,
  );

  return list.map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_initial: r.last_initial,
    phone_masked: maskPhone(r.phone as string | null),
    roles_wanted: r.roles_wanted ?? [],
    age_experience: r.age_experience ?? [],
    strengths: r.strengths ?? [],
    areas_served: r.areas_served ?? [],
    drives: r.drives,
    days_available: r.days_available ?? [],
    available_from: r.available_from,
    hours_note: r.hours_note,
    rate_band: r.rate_band,
    appear_in_answers: r.appear_in_answers,
    open_to_introductions: r.open_to_introductions,
    open_to_reference_intros: r.open_to_reference_intros,
    consent_text_version: r.consent_text_version,
    status: r.status,
    linked_caregiver: r.linked_caregiver_id
      ? {
          id: r.linked_caregiver_id as string,
          first_name: r.linked_first_name as string,
          last_initial: r.linked_last_initial as string | null,
        }
      : null,
    candidates: Array.isArray(r.candidates) ? r.candidates : [],
    created_at: r.created_at,
  }));
}

/* ── 2.2 Founding queue ──────────────────────────────────────────────────── */

async function foundingQueue(db: Db) {
  const list = await rows(
    db,
    sql`
      select fc.*, p.first_name, p.last_name, p.phone, p.neighborhood,
             p.invited_via_group, p.source, p.invite_code, p.created_at,
             coalesce(array_agg(c.birth_year) filter (where c.birth_year is not null), '{}') as birth_years,
             (select ps.option_value from person_schools ps
                where ps.person_id = p.id limit 1)                                as school,
             (select count(*) from submissions s
                where s.person_id = p.id and s.kind = 'activity')                 as activities,
             (select count(*) from submissions s
                where s.person_id = p.id and s.kind = 'caregiver')                as caregivers,
             (select count(*) from submissions s
                where s.person_id = p.id and s.kind = 'place')                    as places,
             (select count(*) from submissions s
                where s.person_id = p.id and s.kind = 'tip')                      as tips
      from founding_checklist fc
      join people p on p.id = fc.person_id
      left join children c on c.person_id = p.id
      where fc.founding = 'pending_founding'
      group by fc.person_id, fc.founding, fc.verified, fc.has_neighborhood,
               fc.has_children, fc.allowance_ok, fc.qualifying_approved,
               fc.caregiver_approved, p.id
      order by p.created_at desc
      limit 300
    `,
  );

  return list.map((r) => ({
    id: r.person_id,
    name: fullName(r.first_name, r.last_name),
    phone_masked: maskPhone(r.phone as string | null),
    neighborhood: r.neighborhood,
    child_birth_years: (r.birth_years as number[]) ?? [],
    school: r.school,
    invited_by: r.invited_via_group,
    arrived_via: r.invite_code ?? r.source,
    submissions: {
      activities: Number(r.activities ?? 0),
      caregivers: Number(r.caregivers ?? 0),
      places: Number(r.places ?? 0),
      tips: Number(r.tips ?? 0),
    },
    checklist: {
      verified: r.verified,
      has_neighborhood: r.has_neighborhood,
      has_children: r.has_children,
      allowance_ok: r.allowance_ok,
      qualifying_approved: Number(r.qualifying_approved ?? 0),
      caregiver_approved: Number(r.caregiver_approved ?? 0),
    },
    status: r.founding,
    created_at: r.created_at,
  }));
}

/* ── Invites (one per group) ─────────────────────────────────────────────── */

/**
 * Every invite with what it actually produced.
 *
 * `delivered` is the number worth reading: contributors who arrived on this code
 * *and* have at least one approved contribution. A group that delivers two out of
 * forty is telling you something a click count never would — and `founding_checklist`
 * is where "approved contribution" is defined, so this cannot drift from the
 * founding queue's idea of the same thing.
 *
 * One statement with scalar sub-selects rather than three round trips (CLAUDE.md:
 * against the pooler the round trip is the cost, not the query).
 */
async function inviteRows(db: Db) {
  const list = await rows(
    db,
    sql`
      select i.*,
             (select count(*) from people p
               where p.invite_id = i.id and not p.is_test)              as contributors,
             (select count(*) from people p
               join founding_checklist fc on fc.person_id = p.id
              where p.invite_id = i.id and not p.is_test
                and (fc.qualifying_approved > 0 or fc.caregiver_approved > 0)) as delivered
      from invites i
      order by i.active desc, i.created_at desc
      limit 200
    `,
  );

  return list.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    market_id: r.market_id,
    group_option_value: r.group_option_value,
    active: r.active === true,
    note: r.note,
    contributors: Number(r.contributors ?? 0),
    delivered: Number(r.delivered ?? 0),
    created_at: r.created_at,
    created_by: r.created_by,
  }));
}

/* ── Consent export (A2P §3.3) ───────────────────────────────────────────── */

/**
 * Every consent decision, newest first, with the opt-out state that may have
 * overridden it. A2P §3.3: "consent records must be exportable — if there's ever a
 * TCPA complaint, this table is the defense."
 *
 * Two deliberate choices. Test rows are included, because a complaint is about a
 * phone number and not about our idea of which rows count — and they are labelled
 * rather than hidden. And the opt-out is joined from `sms_opt_outs` by phone
 * rather than looked up per row: the defence has to show the *sequence* (agreed
 * here, withdrew there), and one join gives it.
 */
async function consentRows(db: Db) {
  const list = await rows(
    db,
    sql`
      select c.id, c.person_id, c.scope, c.status, c.source,
             c.text_version, c.captured_at,
             p.first_name, p.last_name, p.phone, p.is_test,
             o.opted_out_at
      from consents c
      left join people p on p.id = c.person_id
      left join sms_opt_outs o on o.phone = p.phone
      order by c.captured_at desc
      limit 5000
    `,
  );

  return list.map((r) => ({
    id: r.id,
    person_id: r.person_id,
    name: fullName(r.first_name, r.last_name),
    phone: r.phone,
    scope: r.scope,
    status: r.status,
    source: r.source,
    text_version: r.text_version,
    captured_at: r.captured_at,
    opted_out_at: r.opted_out_at,
    is_test: r.is_test === true,
  }));
}

/* ── 2.8 Audit ───────────────────────────────────────────────────────────── */

async function auditRows(db: Db) {
  const list = await rows(
    db,
    sql`select * from audit_log order by at desc limit 500`,
  );
  return list.map((r) => ({
    id: r.id,
    at: r.at,
    user: r.actor,
    action: r.action,
    resource: r.resource,
    resource_id: r.resource_id,
    before: r.before,
    after: r.after,
  }));
}

function fullName(first: unknown, last: unknown): string | null {
  const f = typeof first === "string" ? first : "";
  const l = typeof last === "string" ? last : "";
  const name = `${f} ${l}`.trim();
  return name === "" ? null : name;
}
