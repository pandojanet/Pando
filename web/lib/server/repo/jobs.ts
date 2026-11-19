import { sql } from "drizzle-orm";
import { JOBS, isDue, outcomeFor, type JobName, type JobResult } from "@/lib/jobs";
import { deliveryHealth } from "@/lib/delivery";
import { withDb, type Db } from "@/lib/server/db";
import { deliveryCounts } from "@/lib/server/repo/outreach";
import { syncImpact } from "@/lib/server/repo/impact";
import { recordPingSent } from "@/lib/server/repo/vouch";
import {
  answersDuePrompt,
  contributorsToThank,
  markPrompted,
} from "@/lib/server/repo/thanks";
import { thanksList } from "@/lib/thanks";
import {
  SMS_TEMPLATE_VERSION,
  thanksPromptSms,
  thanksPromptCard,
  thanksSms,
  freshnessPingSms,
  freshnessPingCard,
} from "@/lib/sms-templates";
import { sendSms } from "@/lib/server/sms";
import { MARKETS } from "@/lib/markets";
import { editionVariable } from "@/lib/sms-rich";
import { expireMemory } from "@/lib/server/repo/conversation-memory";
import { feedbackAskCard, feedbackAskSms, reminderSms } from "@/lib/digest-followup";
import { claimFollowup, dueFeedback, dueReminders, releaseFollowup } from "@/lib/server/repo/digest-followup";
import { ageOn, composeDigest, digestDue, digestPrepFor, nextDigestDate, pickForPerson, poolForFamily } from "@/lib/digest";
import { cohortProfile, groupFamilies, joinDrawn, type CohortProfile, type FamilyFacts } from "@/lib/digest-cohorts";
import {
  claimDigestSend,
  digestAudience,
  digestEdition,
  digestFamilyByPhone,
  drawnCohorts,
  readyEditionsOfDay,
  unapprovedEditionsOfDay,
  hasDigestRecipients,
  releaseDigestSend,
} from "@/lib/server/repo/digest";
import { runRetrySweep } from "@/lib/server/repo/retry";
import { withTrace } from "@/lib/server/trace";

/**
 * M9.5 — running a scheduled job, and the three jobs themselves.
 *
 * ## Claim, then work, then close
 *
 * The run is inserted **before** any work happens, and the partial unique index
 * on `job_runs` is what makes that a lock: a second attempt while one is in
 * flight fails on the constraint rather than racing it. That ordering is the
 * whole protection — a cron that fires twice, a container restarted mid-run, two
 * hosts briefly overlapping are all the same event to this table, and the
 * expensive version of getting it wrong is a parent receiving two freshness
 * pings.
 *
 * ## What a job is allowed to assume
 *
 * Nothing about the rules. `freshness_ping` decides only *who is worth asking*;
 * whether that person may actually be texted is `sendSms`'s answer, and it
 * re-runs opt-out, quiet hours, the 48-hour gap, the monthly ceiling and the
 * one-ping-a-month rule. A job that duplicated any of those would be a second
 * place for them to be wrong.
 */

export interface RunOutcome extends JobResult {
  ran: boolean;
  /** Why not, when it did not run. */
  reason?: "too_soon" | "already_running" | "unconfigured";
}

/** Run one job, if it is due. Everything about "is it due" is in the database. */
async function runJobUntraced(name: JobName): Promise<RunOutcome> {
  const spec = JOBS[name];

  const claim = await withDb(async (db: Db) => {
    const history = (await db.execute(sql`
      select
        max(started_at)                                          as last_started,
        bool_or(finished_at is null)                             as in_flight,
        bool_or(finished_at is null and started_at < now() - make_interval(mins => ${spec.take_over_after_minutes ?? 0}))
                                                                 as stale
      from job_runs where job = ${name}
    `)) as unknown as Array<Record<string, unknown>>;

    let inFlight = history[0]?.in_flight === true;
    /* A job allowed to take over (the digest sweeps): a run open past its limit
       was a crash or a deploy, not a run still working — closed, counted as an
       error, and this one goes ahead (review, 11 Nov). */
    if (inFlight && spec.take_over_after_minutes && history[0]?.stale === true) {
      await db.execute(sql`
        update job_runs set finished_at = now(), outcome = 'error', note = 'taken_over'
         where job = ${name} and finished_at is null
           and started_at < now() - make_interval(mins => ${spec.take_over_after_minutes})
      `);
      console.warn("[job] took over a run left open", { job: name });
      inFlight = false;
    }

    const verdict = isDue(spec, {
      last_started_at: (history[0]?.last_started as string | null) ?? null,
      in_flight: inFlight,
    });
    if (!verdict.due) return { claimed: false as const, verdict };

    /* Claimed before the work. The unique index refuses a second one. */
    try {
      const rows = (await db.execute(sql`
        insert into job_runs (job) values (${name}) returning id
      `)) as unknown as Array<Record<string, unknown>>;
      return { claimed: true as const, runId: String(rows[0]?.id ?? "") };
    } catch (err) {
      /* The index doing its job: another run claimed it between the read above
         and this insert. That is `already_running`, which is what the caller
         and the cron log should hear — left to escape, `withDb` reported the
         database as unconfigured, a wrong answer to a healthy race. */
      const code =
        (err as { code?: string } | null)?.code ??
        (err as { cause?: { code?: string } } | null)?.cause?.code;
      if (code === "23505") {
        return {
          claimed: false as const,
          verdict: { due: false as const, reason: "already_running" as const },
        };
      }
      throw err;
    }
  });

  if (!claim.persisted || !claim.data) {
    return { ran: false, reason: "unconfigured", outcome: "error", processed: 0, skipped: 0, failed: 0 };
  }
  if (!claim.data.claimed) {
    const v = claim.data.verdict;
    return {
      ran: false,
      reason: v.due ? undefined : v.reason,
      outcome: "skipped",
      processed: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const runId = claim.data.runId;
  let result: JobResult;
  try {
    result = await BODIES[name]();
  } catch (err) {
    /* Enums only — never what the job was carrying (invariant 7). */
    console.error("[job] failed", {
      job: name,
      error: err instanceof Error ? err.constructor.name : "unknown",
    });
    result = { outcome: "error", processed: 0, skipped: 0, failed: 1 };
  }

  /* Closed however it ended. A run left open blocks the next one, which is the
     intended behaviour for a crash and would be a bug for an ordinary failure. */
  await withDb(async (db: Db) => {
    await db.execute(sql`
      update job_runs
         set finished_at = now(), outcome = ${result.outcome},
             processed = ${result.processed}, skipped = ${result.skipped},
             failed = ${result.failed}, note = ${result.note ?? null}
       where id = ${runId}::uuid
    `);
    return true;
  });

  console.info("[job] ran", { job: name, ...result });
  return { ran: true, ...result };
}

const BODIES: Record<JobName, () => Promise<JobResult>> = {
  expire_blasts,
  delivery_check,
  freshness_ping,
  impact_sync,
  thanks_prompt,
  thanks_delivery,
  retry_failed,
  weekly_digest,
  expire_memory,
  digest_reminders: () => runDigestReminders(new Date()),
  digest_feedback: () => runDigestFeedback(new Date()),
};

/**
 * The digest's follow-ups (11 Nov, lib/digest-followup.ts), with the clock
 * passed in so the lab can walk an event's day. Claimed before each send, as
 * the digest is; a send that may pass later gives its claim back.
 */
async function runDigestFollowups(now: Date, kind: "remind" | "feedback"): Promise<JobResult> {
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  /* Each row carries its own moment (set on the market's clock when it was picked), so the sweep only asks what is due now. */
  const due = kind === "remind" ? await dueReminders(now) : await dueFeedback(now);
  /* One feedback question per family a run, so a tap answers the one they were asked (review, 11 Nov). */
  const asked = new Set<string>();
  for (const item of due) {
    if (kind === "feedback" && asked.has(item.personId)) continue;
    if (!(await claimFollowup(kind, item.interestId, now))) continue;
    asked.add(item.personId);
    const result = await sendSms({
      to: item.phone,
      body: kind === "remind" ? reminderSms(item) : feedbackAskSms(item),
      category: "digest",
      personId: item.personId,
      template: kind === "remind" ? "digest_reminder" : "digest_feedback_ask",
      templateVersion: SMS_TEMPLATE_VERSION,
      rich: kind === "feedback" ? { kind: "digest_feedback", card: feedbackAskCard(item) } : undefined,
    });
    if (result.sent) processed++;
    else if (result.reason === "opted_out") skipped++;
    else {
      failed++;
      await releaseFollowup(kind, item.interestId);
    }
  }
  console.info("[digest] followups", { kind, processed, skipped, failed });
  return { outcome: outcomeFor({ processed, skipped, failed }), processed, skipped, failed };
}

export const runDigestReminders = (now: Date) => runDigestFollowups(now, "remind");
export const runDigestFeedback = (now: Date) => runDigestFollowups(now, "feedback");

/** 12 Nov: the conversation summaries nobody has added to for 90 days (`lib/conversation-memory.ts`). */
async function expire_memory(): Promise<JobResult> {
  const deleted = await expireMemory();
  if (deleted === null) return { outcome: "error", processed: 0, skipped: 0, failed: 1 };
  return { outcome: outcomeFor({ processed: deleted, skipped: 0, failed: 0 }), processed: deleted, skipped: 0, failed: 0 };
}

/**
 * The weekly digest's body (3 Nov). Per market: not Saturday morning to
 * evening there, nothing. Otherwise the edition (found once), then each parent
 * who said yes gets what suits their household. Somebody it has nothing for, or
 * who has texted STOP, is recorded with no items so the hourly runs stop
 * weighing them; a send refused for a reason that can pass (quiet hours, the
 * provider) is left for the next run. Counts only (invariant 7).
 */
async function weekly_digest(): Promise<JobResult> {
  return runWeeklyDigest(new Date());
}

/**
 * The body, with the clock passed in — so the lab can walk a Saturday on a
 * Tuesday — and `isTest` for such a walk: its own edition, marked as a test,
 * sent to test people only.
 */
export async function runWeeklyDigest(now: Date, isTest = false): Promise<JobResult> {
  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let awaiting = 0;
  for (const market of Object.values(MARKETS)) {
    /* Prepared from Friday morning, sent on Saturday only once approved (19 Nov). */
    const editionDate = digestPrepFor(now, market.timeZone);
    if (!editionDate) continue;
    const sending = digestDue(now, market.timeZone) !== null;
    /* Nobody signed up, no agent run (review, 3 Nov). */
    if (!(await hasDigestRecipients(market.id, isTest))) continue;
    /* Ages on the Saturday itself, so Friday's groups are Saturday's (19 Nov). */
    const today = editionDate;
    /**
     * Groups, not people (4 Nov, `lib/digest-cohorts.ts`): drawn over everyone
     * this Saturday's digest is for, sent or not, so every hourly run draws the
     * same ones; how many there are is what the families make it. Each group
     * is one edition — one agent search — and one digest, the same text for
     * every member.
     */
    const audience = await digestAudience(market.id, editionDate, isTest);
    const families: FamilyFacts[] = audience.map((r) => ({
      id: r.person_id,
      ages: r.children.map((c) => ageOn(c.year, c.month, today)),
      neighborhood: r.neighborhood,
      area: r.area,
      affinities: r.affinities,
      relevance: r.relevance,
    }));
    /* Drawn once a Saturday (review, 4 Nov): the first run groups everyone;
       later runs put whoever is not yet sent into the groups already drawn, and
       group anew only those who fit none. */
    const drawn = await drawnCohorts(market.id, editionDate, isTest);
    const unsentAll = audience.map((r, i) => (r.sent ? -1 : i)).filter((i) => i >= 0);
    const draw = (idx: number[]) =>
      groupFamilies(idx.map((i) => families[i])).map((g) => ({
        members: g.members.map((k) => idx[k]),
        profile: cohortProfile(g.members.map((k) => families[idx[k]]), g.general),
      }));
    let plan: Array<{ members: number[]; profile: CohortProfile }>;
    if (drawn.length === 0) {
      plan = draw(audience.map((_, i) => i));
    } else {
      const { joined, rest } = joinDrawn(unsentAll.map((i) => families[i]), drawn);
      plan = [
        ...[...joined.entries()].map(([key, ks]) => ({ members: ks.map((k) => unsentAll[k]), profile: drawn.find((d) => d.key === key)! })),
        ...(rest.length ? draw(rest.map((k) => unsentAll[k])) : []),
      ];
    }
    /* Sizes only (invariant 7). */
    console.info("[digest] groups", { market: market.id, test: isTest, families: families.length, groups: plan.length, sizes: plan.map((g) => g.members.length), kept: drawn.length > 0 });
    /* Every group's edition first, then the sends (11 Nov): a family whose
       children span more than one group's ages is also sent what the other
       groups' editions made for those ages (`poolForFamily`). The cost, named
       by the review: the first text waits for every group's search (up to
       COHORT_MAX x 3 minutes in the worst case, early in an 11-hour window),
       and a family is sent from the editions ready at that hour — one that
       turns ready later is not sent again. Editions are stored as they are
       found, so a run cut off mid-way loses no search. */
    const editions: Array<{ unsent: number[]; profile: CohortProfile; edition: NonNullable<Awaited<ReturnType<typeof digestEdition>>> }> = [];
    for (const { members: group, profile } of plan) {
      const unsent = group.filter((i) => !audience[i].sent);
      if (unsent.length === 0) continue;
      const edition = await digestEdition(market.id, editionDate, profile, isTest);
      if (edition) editions.push({ unsent, profile, edition });
    }
    /* What still waits for a person, said in the run's note (counts only). */
    const waiting = await unapprovedEditionsOfDay(market.id, editionDate, isTest);
    awaiting += waiting;
    /* Friday: prepared, nothing sent (19 Nov). */
    if (!sending) continue;
    const ofDay = editions.length ? await readyEditionsOfDay(market.id, editionDate, isTest) : [];
    for (const { unsent, profile, edition } of editions) {
      /* A group's own edition with something in it goes only once approved; one with
         nothing of its own sends what approved editions hold for its children. */
      if (!edition.approved && edition.items.length > 0) continue;
      const others = ofDay.filter((e) => e.key !== profile.key).map((e) => e.items);
      /**
       * One search per group; what each family is sent is the group's items
       * that suit their own children (review, 4 Nov). The same text for every
       * member sent a family with no children, or only a toddler, the group's
       * teen workshops: `ageFits` keeps a family with no children to what is
       * for everyone.
       */
      for (const i of unsent) {
        const recipient = audience[i];
        const { body, card, included, items: sentItems } = composeDigest(pickForPerson(poolForFamily(edition.items, others, families[i].ages), families[i].ages));
        /* Claimed before it is sent, so a write that fails afterwards can never
           mean a second copy next hour (review, 3 Nov). Nothing that suits them is
           a claim with no items: the hourly runs stop weighing them. The claim
           keeps what was sent, in its numbers' order (11 Nov). */
        /* The ids in their numbers' order; with any missing the text is not read as picks at all, never shifted (review, 11 Nov). */
        const ids = sentItems.map((x) => x.id);
        const sentIds = ids.every((id): id is string => typeof id === "string") ? ids : [];
        /* Nothing yet, while an edition that may hold something for them still waits for approval:
           not claimed, so a later run can send it (19 Nov — a claim is final). */
        if (included === 0 && waiting > 0) continue;
        if (!(await claimDigestSend(edition.id, recipient.person_id, included, sentIds))) continue;
        if (included === 0) {
          skipped++;
          continue;
        }
        const result = await sendSms({
          to: recipient.phone,
          body,
          category: "digest",
          personId: recipient.person_id,
          template: "weekly_digest",
          templateVersion: SMS_TEMPLATE_VERSION,
          /* On RCS, buttons "1" to "4" inside the card (11 Nov, `digest_pick`); off until its template's SID is set. */
          /* `{{3}}`: the edition, in each button's id — a tap on an old card picks from its own week (11 Nov). */
          rich: { kind: "digest_pick", card, edition: editionVariable(editionDate) },
        });
        if (result.sent) {
          processed++;
        } else if (result.reason === "opted_out") {
          /* STOP is final for the edition; the claim stays. */
          skipped++;
        } else {
          /* Quiet hours, the provider: may pass — give the claim back for the next run. */
          failed++;
          await releaseDigestSend(edition.id, recipient.person_id);
        }
      }
    }
  }
  return {
    outcome: outcomeFor({ processed, skipped, failed }),
    processed,
    skipped,
    failed,
    ...(awaiting > 0 ? { note: `${awaiting} ${awaiting === 1 ? "group waits" : "groups wait"} for approval.` } : {}),
  };
}

/**
 * The admin's one-number test (19 Nov). The developer, with every scheduled job
 * paused for testing: *"підготувати виклик джоби та надсилання для певного
 * номера"*; and no digest consent asked for it.
 *
 * Two steps, the same approval between them as a real Saturday:
 *  - `prepareDigestFor` — the family's own group (`cohortProfile` of that one
 *    family, or a test group already drawn for that Saturday that fits it) and
 *    its edition, found by the agent. Stored as a **test** edition, so a real
 *    Saturday never sends from it; it is approved on /admin/digests → Test.
 *  - `sendDigestTo` — composed and sent to that number only, from that group's
 *    edition once approved (with what other approved test editions hold for its
 *    children). A second send replaces the first's claim, so the test can be
 *    run again; STOP and quiet hours are still `sendSms`'s.
 *
 * The Saturday is today's or the next (`nextDigestDate`); the hourly window
 * does not apply. Counts and enums only in the log (invariant 7).
 */
export type DigestOneOutcome =
  | { ok: true; edition_date: string; edition_id: string; status: "ready" | "empty" | "failed"; items: number; approved: boolean; sent?: number }
  | { ok: false; reason: "no_person" | "not_prepared" | "preparing" | "not_approved" | "nothing_suits" | "not_sent"; edition_date?: string; detail?: string };

async function oneFamily(phone: string, now: Date) {
  /* `sent` is not read here (a test send replaces its own claim), so any date finds the person. */
  const family = await digestFamilyByPhone(phone, nextDigestDate(now, Object.values(MARKETS)[0].timeZone));
  if (!family) return null;
  /* The Saturday on the person's own market's clock. */
  const market = MARKETS[family.market_id as keyof typeof MARKETS] ?? Object.values(MARKETS)[0];
  const editionDate = nextDigestDate(now, market.timeZone);
  const facts: FamilyFacts = {
    id: family.person_id,
    ages: family.children.map((c) => ageOn(c.year, c.month, editionDate)),
    neighborhood: family.neighborhood,
    area: family.area,
    affinities: family.affinities,
    relevance: family.relevance,
  };
  const drawn = await drawnCohorts(market.id, editionDate, true);
  const { joined } = joinDrawn([facts], drawn);
  const key = [...joined.keys()][0];
  const existing = key ? drawn.find((d) => d.key === key) ?? null : null;
  return { family, facts, market, editionDate, existing };
}

export async function prepareDigestFor(phone: string, now = new Date()): Promise<DigestOneOutcome> {
  const one = await oneFamily(phone, now);
  if (!one) return { ok: false, reason: "no_person" };
  /* Grouped exactly as the job groups a family that is alone (`groupFamilies`: its own group,
     market-wide only when nothing is known about it), so the test searches what a real
     Saturday would. The agent can still come back empty or time out — walked in the lab,
     Thanksgiving weekend's search for one San Marino family did both, and the next
     Saturday's found three; Prepare again retries, up to DIGEST_AGENT_ATTEMPTS. */
  const drawnAlone = groupFamilies([one.facts])[0];
  const profile = one.existing ?? cohortProfile([one.facts], drawnAlone?.general ?? true);
  const edition = await digestEdition(one.market.id, one.editionDate, profile, true);
  console.info("[digest] one-number prepare", { found: edition !== null, items: edition?.items.length ?? 0 });
  if (!edition) return { ok: false, reason: "preparing", edition_date: one.editionDate };
  return { ok: true, edition_date: one.editionDate, edition_id: edition.id, status: edition.status, items: edition.items.length, approved: edition.approved };
}

export async function sendDigestTo(phone: string, now = new Date()): Promise<DigestOneOutcome> {
  const one = await oneFamily(phone, now);
  if (!one) return { ok: false, reason: "no_person" };
  /* Never an agent run from Send: only a group Prepare drew. */
  if (!one.existing) return { ok: false, reason: "not_prepared", edition_date: one.editionDate };
  const edition = await digestEdition(one.market.id, one.editionDate, one.existing, true);
  if (!edition) return { ok: false, reason: "preparing", edition_date: one.editionDate };
  if (!edition.approved && edition.items.length > 0) return { ok: false, reason: "not_approved", edition_date: one.editionDate };
  const others = (await readyEditionsOfDay(one.market.id, one.editionDate, true)).filter((e) => e.key !== one.existing!.key).map((e) => e.items);
  const { body, card, included, items: sentItems } = composeDigest(pickForPerson(poolForFamily(edition.items, others, one.facts.ages), one.facts.ages));
  if (included === 0) return { ok: false, reason: "nothing_suits", edition_date: one.editionDate };
  const ids = sentItems.map((x) => x.id);
  const sentIds = ids.every((id): id is string => typeof id === "string") ? ids : [];
  /* Again and again while testing: the last send is the one its numbers mean. */
  await releaseDigestSend(edition.id, one.family.person_id);
  if (!(await claimDigestSend(edition.id, one.family.person_id, included, sentIds))) return { ok: false, reason: "not_sent", edition_date: one.editionDate };
  const result = await sendSms({
    to: one.family.phone,
    body,
    category: "digest",
    personId: one.family.person_id,
    template: "weekly_digest",
    templateVersion: SMS_TEMPLATE_VERSION,
    rich: { kind: "digest_pick", card, edition: editionVariable(one.editionDate) },
  });
  console.info("[digest] one-number send", { sent: result.sent, items: included, reason: result.sent ? null : result.reason });
  if (!result.sent) {
    await releaseDigestSend(edition.id, one.family.person_id);
    return { ok: false, reason: "not_sent", edition_date: one.editionDate, detail: result.reason };
  }
  return { ok: true, edition_date: one.editionDate, edition_id: edition.id, status: edition.status, items: edition.items.length, approved: true, sent: included };
}

/**
 * 13.4 — the retry sweep's body.
 *
 * Thin on purpose: the policy is in `lib/delivery.ts` and the rebuild in
 * `repo/retry.ts`, so this only translates one shape into the other. A refusal
 * counts as a **skip**, not a failure — a message the policy declined to retry
 * is the policy working, and the commonest skip of all is a permanent carrier
 * error, which is the answer being right rather than something going wrong.
 */
async function retry_failed(): Promise<JobResult> {
  const sweep = await runRetrySweep();
  /* A refusal by the policy is `skipped`, and only a send that was attempted
     and did not go is `failed` — the same split every other sending job here
     uses, so `outcomeFor` reports "partial" for the case that deserves a look
     rather than for the ordinary one. */
  return {
    outcome: outcomeFor({
      processed: sweep.retried,
      skipped: sweep.skipped,
      failed: sweep.failed,
    }),
    processed: sweep.retried,
    skipped: sweep.skipped,
    failed: sweep.failed,
    note:
      sweep.considered === 0
        ? "Nothing failed recently."
        : `${sweep.retried} sent again, ${sweep.skipped} left alone${
            Object.keys(sweep.reasons).length > 0
              ? ` (${Object.entries(sweep.reasons)
                  .map(([reason, n]) => `${reason}: ${n}`)
                  .join(", ")})`
              : ""
          }.`,
  };
}

/**
 * 9.1 — ask the parent who got an answer whether it helped.
 *
 * The prompt is **stamped after the send**, so a refusal leaves the answer on
 * the queue for tomorrow — which matters because the window closes: a parent
 * inside their 48-hour gap today may still be inside the window on Thursday,
 * and stamping first would spend their one chance on a message that never went.
 *
 * Nothing here checks whether they may be texted. `sendSms` does, and a refusal
 * is a skip: somebody who opted out is the system working.
 */
async function thanks_prompt(): Promise<JobResult> {
  const due = await answersDuePrompt();
  let sent = 0;
  let skipped = 0;

  for (const answer of due) {
    const result = await sendSms({
      to: answer.phone,
      body: thanksPromptSms(),
      /* Yes and No buttons on RCS (29 Oct); the SMS is the registered sample. */
      rich: { kind: "yes_no", card: thanksPromptCard() },
      category: "outreach",
      /* A question, so a request: gapped, capped and counted (24 Sep). */
      outreachKind: "prompt",
      personId: answer.person_id ?? undefined,
      template: "thanks_prompt",
      templateVersion: SMS_TEMPLATE_VERSION,
    });
    if (!result.sent) {
      skipped += 1;
      continue;
    }
    await markPrompted(answer.answer_id);
    sent += 1;
  }

  return {
    outcome: outcomeFor({ processed: sent, skipped, failed: 0 }),
    processed: sent,
    skipped,
    failed: 0,
  };
}

/**
 * 9.2 — the batched thank-you.
 *
 * One message per contributor per week, carrying everything owed since the last
 * one. Nothing is marked as thanked here: the week is measured from
 * `message_log`, which `sendSms` writes only after the provider accepted — so a
 * refused send leaves the batch owed rather than silently discharged, and the
 * next run picks it up with whatever else has accumulated.
 */
async function thanks_delivery(): Promise<JobResult> {
  const targets = await contributorsToThank();
  let sent = 0;
  let skipped = 0;

  for (const target of targets) {
    const result = await sendSms({
      to: target.phone,
      body: thanksSms(thanksList(target.items)),
      category: "outreach",
      outreachKind: "thanks",
      personId: target.person_id,
      template: "thanks",
      templateVersion: SMS_TEMPLATE_VERSION,
    });
    if (result.sent) sent += 1;
    else skipped += 1;
  }

  return {
    outcome: outcomeFor({ processed: sent, skipped, failed: 0 }),
    processed: sent,
    skipped,
    failed: 0,
  };
}

/**
 * 9.3 — the ledger's catch-up sweep.
 *
 * `processed` is what it had to add, so a healthy run reports **zero**: every
 * event the live path already wrote is a conflict this skips. A run that keeps
 * finding work is the signal worth reading — it means approvals are landing
 * without their ledger entry, which the live write is allowed to do and nothing
 * else would notice.
 */
async function impact_sync(): Promise<JobResult> {
  const result = await syncImpact();
  if (!result) {
    return { outcome: "error", processed: 0, skipped: 0, failed: 1 };
  }
  const added = result.contributions + result.blast_answers;
  return {
    outcome: outcomeFor({ processed: added, skipped: 0, failed: 0 }),
    processed: added,
    skipped: 0,
    failed: 0,
  };
}

/**
 * 7.7 — close what ran out of time.
 *
 * The test is an **approved** answer rather than a reply: a contributor writing
 * back is not the promise being kept, only the admin's approval says one
 * arrived. Nothing is credited or refunded — every Network Ask is free (22 Oct).
 */
async function expire_blasts(): Promise<JobResult> {
  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      const due = (await tx.execute(sql`
        select b.id
          from blasts b
         -- draft too (25 Sep): an Ask nobody sent is still a promise with a clock.
         where b.status in ('draft', 'active', 'pending_review')
           and b.expires_at is not null
           and b.expires_at < now()
           and not exists (
             select 1 from blast_recipients r
              where r.blast_id = b.id and r.review_status = 'approved')
         for update of b skip locked
      `)) as unknown as Array<Record<string, unknown>>;

      for (const row of due) {
        await tx.execute(sql`
          update blasts set status = 'expired' where id = ${String(row.id)}::uuid
        `);
      }
      return { expired: due.length };
    }),
  );

  if (!result.persisted || !result.data) {
    return { outcome: "error", processed: 0, skipped: 0, failed: 1 };
  }
  const { expired } = result.data;
  return {
    outcome: outcomeFor({ processed: expired, skipped: 0, failed: 0 }),
    processed: expired,
    skipped: 0,
    failed: 0,
  };
}

/** 12.5 — the daily rate, reported. Reads only. */
async function delivery_check(): Promise<JobResult> {
  /* Two days, not one (26 Sep). `unreported` counts messages OLDER than 24 hours
     that never got a final status, and a one-day window contains none of them
     by construction — so the thin-sample alarm below could not fire, and a
     total loss of status callbacks read as "nothing settled", an all-clear.
     The second day is what gives the check something to be suspicious of. */
  const counts = await deliveryCounts(2);
  if (!counts) return { outcome: "error", processed: 0, skipped: 0, failed: 1 };

  const health = deliveryHealth(counts);
  if (health.below_floor) {
    console.error("[job] delivery below floor", {
      rate: health.rate,
      settled: health.settled,
      alerts: health.alerts.map((a) => a.code),
    });
  }
  /**
   * ⚠ A thin sample is its own alarm, and until 25 Sep this job could not
   * raise it: with 13 of 64 messages reporting it returned `ok · 100%`, so
   * the one automated check 12.5 asks for was reporting an all-clear over
   * exactly the outage its page warns about — no status callback, so no
   * status. It is `partial` with a note naming the coverage, because a cron
   * reads outcomes rather than percentages.
   */
  if (health.thin_sample) {
    console.error("[job] delivery statuses are not coming back", {
      settled: health.settled,
      unreported: health.unreported,
    });
  }
  return {
    outcome: health.below_floor || health.thin_sample ? "partial" : "ok",
    processed: health.settled,
    skipped: health.in_flight,
    failed: health.settled - health.delivered,
    note:
      health.rate === null
        ? "nothing settled"
        : health.thin_sample
          ? `${Math.round(health.rate * 100)}% — only ${health.settled} of ${health.settled + health.unreported} reported back`
          : `${Math.round(health.rate * 100)}%`,
  };
}

/**
 * 10.3 — ask whether an ageing recommendation still holds.
 *
 * Picks the oldest ageing records and asks the parent who shared each one. The
 * job's only judgement is **who is worth asking**; every protection is enforced
 * below it, and a refusal is counted as a skip rather than a failure — somebody
 * inside their 48-hour gap is the system working.
 *
 * Capped hard per run. A freshness sweep that texts forty people in a minute is
 * indistinguishable from a bug, and the point of the ladder is that Pando is
 * scarce.
 */
/** A contributor is not asked about the same record again within this many days (22 Oct audit). */
const FRESHNESS_REPEAT_DAYS = 90;

async function freshness_ping(): Promise<JobResult> {
  const PER_RUN = 5;

  const candidates = await withDb(async (db: Db) => {
    /**
     * Two kinds of parent are asked, and only the second can produce a vouch.
     *
     * ⚠⚠ **Until 23 Sep this asked only the record's own contributors**, so every
     * reply was a *refresh* and 10.2's vouch — a different parent saying they
     * used it too, the one path by which a ping makes a record "Validated by
     * multiple parents" — could not happen at all. `confirmKindFor` and the
     * vouch write were correct and reachable from nothing; walked live, a vouch
     * needed a ping row inserted by hand.
     *
     * The second kind is **a parent who told Pando an answer naming this record
     * helped them** (9.1's yes on `answers.helped`, joined through
     * `share_ids`). That is the honest reading of "somebody the matcher picked
     * as connected to it": they have *used* it — they said so — and have not
     * contributed it. A parent merely nearby would be asked to confirm
     * something they may never have tried, and a vouch is a firsthand claim.
     * Their yes still enters `pending_review`, so an admin reads it first.
     */
    const rows = (await db.execute(sql`
      with stale as (
        select shares.id, shares.name, shares.kind, shares.last_confirmed_at
          from shares
          -- Each kind's own threshold (22 Oct audit): a doctor stays "fresh"
          -- to 180 days, so asking at 90 contradicted the label parents see.
          left join freshness_policy fp on fp.kind = shares.kind
         where shares.status = 'approved'
           and not shares.is_test
           -- Doctors included since 21 Oct: they are in SMS answers now, so
           -- whether one is still worth recommending is a date a parent is
           -- shown (the 8 Oct exclusion rested on their not being shown).
           and shares.last_confirmed_at is not null
           and shares.last_confirmed_at < now() - make_interval(days => coalesce(fp.ageing_days, 90))
      ),
      candidates as (
        select sc.person_id, s.id as share_id, s.name, s.kind, s.last_confirmed_at
          from share_contributions sc
          join stale s on s.id = sc.share_id
         where sc.status = 'approved'
           -- Not asked about this record again within 90 days: an unanswered
           -- ping or a PASS was re-sent every month (22 Oct audit).
           and not exists (select 1 from freshness_pings fp
                            where fp.person_id = sc.person_id and fp.share_id = s.id
                              and fp.asked_at > now() - make_interval(days => ${FRESHNESS_REPEAT_DAYS}))
        union
        select a.person_id, s.id as share_id, s.name, s.kind, s.last_confirmed_at
          from answers a
          join stale s on s.id = any(a.share_ids)
         where a.helped = true
           and a.person_id is not null
           and not exists (
             select 1 from share_contributions sc
              where sc.share_id = s.id and sc.person_id = a.person_id
           )
           and not exists (select 1 from freshness_pings fp
                            where fp.person_id = a.person_id and fp.share_id = s.id
                              and fp.asked_at > now() - make_interval(days => ${FRESHNESS_REPEAT_DAYS}))
      )
      -- Who is worth asking, chosen so the cap below cannot be spent on people
      -- sendSms is certain to refuse (26 Sep). Two exclusions, both restating a
      -- rule the send layer enforces anyway: somebody who asked Pando to stop,
      -- and somebody already pinged this calendar month (PINGS_PER_MONTH).
      -- Left in, the same handful of parents filled every run's five places,
      -- were refused every time, and nobody else was ever reached.
      select t.person_id, t.phone, t.share_id, t.name, t.kind
        from (
          select distinct on (c.person_id)
                 c.person_id, p.phone, c.share_id, c.name, c.kind,
                 c.last_confirmed_at
            from candidates c
            join people p on p.id = c.person_id
           where p.phone is not null
             and not exists (
               select 1 from sms_opt_outs o
                where o.phone = p.phone
                  and o.opted_out_at is not null
                  and (o.opted_in_at is null or o.opted_in_at < o.opted_out_at))
             and not exists (
               select 1 from message_log m
                where m.person_id = p.id
                  and m.direction = 'out'
                  and m.template = 'freshness_ping'
                  and m.retry_of is null
                  and date_trunc('month', m.sent_at) = date_trunc('month', now()))
           order by c.person_id, c.last_confirmed_at asc
        ) t
       -- The oldest first, which is what the job's own header promises. The
       -- inner ordering only serves distinct-on, so without this the five were
       -- simply the lowest ids.
       order by t.last_confirmed_at asc
       limit ${PER_RUN}
    `)) as unknown as Array<Record<string, unknown>>;
    return rows;
  });

  if (!candidates.persisted || !candidates.data) {
    return { outcome: "error", processed: 0, skipped: 0, failed: 1 };
  }

  let sent = 0;
  let skipped = 0;
  for (const row of candidates.data) {
    const result = await sendSms({
      to: String(row.phone),
      body: freshnessPingSms({ name: String(row.name) }),
      /* Yes and No buttons on RCS (29 Oct); no Pass button — see `RICH_BUTTONS.yes_no`. */
      rich: { kind: "yes_no", card: freshnessPingCard({ name: String(row.name) }) },
      category: "outreach",
      personId: String(row.person_id),
      outreachKind: "ping",
      template: "freshness_ping",
      templateVersion: SMS_TEMPLATE_VERSION,
    });
    if (result.sent) {
      /**
       * 10.2 — record **which** record was asked about, and only after it went.
       *
       * Without this row the reply has nowhere to land: `message_log` says a
       * ping was sent and never what it was about, so a "yes" could be received
       * and not attributed. Written after the send for the same reason
       * `helped_asked_at` is — a row saying we asked, for a message the carrier
       * refused, would take the record out of the queue having asked nobody.
       */
      await recordPingSent(String(row.person_id), String(row.share_id));
      sent += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    outcome: outcomeFor({ processed: sent, skipped, failed: 0 }),
    processed: sent,
    skipped,
    failed: 0,
  };
}

/** runJob, as one trace (27 Oct, lib/server/trace.ts). */
export async function runJob(input: Parameters<typeof runJobUntraced>[0]): ReturnType<typeof runJobUntraced> {
  return withTrace(`job:${input}`, () => runJobUntraced(input));
}
