import "server-only";

import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db";
import type { DemandSensitivity, StoredDemand } from "@/lib/demand";
import {
  consents,
  demandSignals,
  flags,
  people,
} from "@/lib/db/schema";

/**
 * Estimate 1.7 — what the completion screen records.
 *
 * Replaced the tail of the `pando-1.7-complete` workflow. The three writes are
 * one transaction because they are one moment: a follow-up consent stored
 * without the allowance it was given under, or a high-stakes question stored
 * without the flag that routes it to a person, are both worse than nothing.
 */

export interface CompletionInput {
  /** Resolved from the verified phone. Null on the anonymous path. */
  person_id: string | null;
  follow_up_opt_in: boolean;
  consent_text_version: string;
  demand: {
    question_text: string;
    category: string | null;
    sensitivity: DemandSensitivity;
    requires_human_review: boolean;
  } | null;
  is_test: boolean;
}

export interface CompletionResult {
  person_id: string | null;
  demand_signal_id: string | null;
  flagged: boolean;
}

export async function writeCompletion(
  db: Db,
  input: CompletionInput,
): Promise<CompletionResult> {
  return db.transaction(async (tx) => {
    /**
     * Founding is never self-granted. Finishing the form moves a named parent to
     * `pending_founding` — the admin queue is what makes it real, and the screen
     * they just saw promises a text, not a badge.
     *
     * ⚠⚠ **It writes the standing and nothing else. It used to write
     * `monthly_contact_allowance` too, and that is what broke this screen for a
     * third of the cohort** (found 9 Sep, on the client's report that the
     * follow-up answer was not being saved).
     *
     * The allowance is a **pair** of columns — `monthly_contact_allowance` and
     * `allowance_mode` — held together by the `allowance_shape` CHECK: either
     * `as_relevant` with a null number, or `fixed` with 5 or 10. `derive.ts`
     * sets both from the parent's tap and the profile write stores them
     * together. This update set the number **without the mode**, from a value
     * the browser restated out of `localStorage`, so for anybody who chose the
     * open-ended level the row became `as_relevant` + 5, the CHECK fired, and
     * the whole transaction rolled back — taking the follow-up consent, the
     * founding standing and the D1 question with it, behind a 502 the screen
     * reported as "that didn't save".
     *
     * ⚠ **Do not restore it "with the mode this time".** The profile write
     * already stored both, server-side, from sanitised answers — this was a
     * *second writer* of one fact, and the second writer is the one that got it
     * wrong. That is the 11 Aug rule (the graph is derived here and never taken
     * from the request body) applied to the one field that had escaped it.
     */
    if (input.person_id) {
      /* ⚠ **Only ever `none` → `pending_founding`** (29 Sep). This was an
         unconditional set, so a returning parent who re-opened the completion
         screen — `/signin` leads there — was demoted from an admin-approved
         `founding`, and a person an admin had moved to `request_invite` was put
         back in the queue. Founding is a person's decision (`founding.approve`)
         and finishing a form must never unmake it. */
      await tx
        .update(people)
        .set({
          founding: sql`case when ${people.founding} = 'none'
                             then 'pending_founding'::founding_status
                             else ${people.founding} end`,
        })
        .where(eq(people.id, input.person_id));

      /**
       * Recorded either way. A decline is as much a consent decision as an
       * opt-in, and only an explicit record can prove which one the parent made
       * and under what wording.
       */
      await tx.insert(consents).values({
        personId: input.person_id,
        scope: "follow_up",
        status: input.follow_up_opt_in ? "opted_in" : "declined",
        source: "seed_completion_screen",
        textVersion: input.consent_text_version,
      });
    }

    let demandSignalId: string | null = null;
    let flagged = false;

    if (input.demand) {
      const [signal] = await tx
        .insert(demandSignals)
        .values({
          personId: input.person_id,
          questionText: input.demand.question_text,
          category: input.demand.category,
          /**
           * Read from the parent's own profile in the same statement rather than
           * taken from the body (spec v3.2 §9, QC Answers Q7). It is the number
           * that decides which market Pando opens next, so the browser does not
           * get a vote — the same reason the affinity graph is derived here.
           */
          neighborhood: input.person_id
            ? sql`(select neighborhood from people where id = ${input.person_id}::uuid)`
            : null,
          sensitivity: input.demand.sensitivity,
          requiresHumanReview: input.demand.requires_human_review,
          isTest: input.is_test,
        })
        .returning({ id: demandSignals.id });
      demandSignalId = signal.id;

      /**
       * Two classes are owed a person, for opposite reasons.
       *
       * A health, legal or safety question is owed one *today*: the parent already
       * saw professional resources in the flow, and this is the other half of that
       * promise — a queue entry no automated path can answer.
       *
       * A claim about a named person is owed one *first*. The Product Strategy is
       * explicit that it must never be circulated or written into the knowledge
       * base automatically, and `demand_signals_allegation_review_check` holds the
       * storage side of that. This flag is the human side: its own reason, so the
       * admin can see what kind of thing it is before opening it.
       */
      const escalation = escalationFor(input.demand.sensitivity);

      if (escalation && !input.is_test) {
        await tx.insert(flags).values({
          severity: "escalation",
          reason: escalation,
          subjectKind: "demand_signal",
          subjectId: signal.id,
          personId: input.person_id,
        });
        flagged = true;
      }
    }

    return { person_id: input.person_id, demand_signal_id: demandSignalId, flagged };
  });
}

/** The flag reason a D1 is owed, or null — the two classes `writeCompletion` names. */
function escalationFor(sensitivity: DemandSensitivity): string | null {
  return sensitivity === "high_stakes"
    ? "high_stakes_demand"
    : sensitivity === "named_allegation"
      ? "named_allegation"
      : null;
}

export type DemandEditOutcome = "updated" | "inserted" | "deleted" | "unchanged";

/**
 * A parent's D1 changed **after** the completion was written (7 Oct).
 *
 * ## Why it exists
 *
 * D1 only ever travelled inside the completion write, so a question changed
 * afterwards stayed on the phone while the screen said "Noted — that's yours".
 * Harmless while `/done/ask` ended the flow; since 7 Oct the chat's Back returns
 * there, and the developer's instruction is that an edit is saved — **the same
 * question edited, not a second one added**.
 *
 * ## Which row is "the same question"
 *
 * The parent's newest `demand_signals` row. Nothing else writes that table — this
 * function and `writeCompletion` are its only two writers — so a person's rows are
 * all their own D1s. ⚠ Only while it is still `open`: once an admin has matched,
 * answered or closed it, that question was dealt with, and rewriting its text would
 * make the record say something other than what was dealt with. A change then is a
 * new question, so it is inserted.
 *
 * ## Withdrawn (`demand: null`) — Skip, or "Don't keep it"
 *
 * The open row is deleted, with the flags raised about it that nobody has touched.
 * That is the same outcome as giving that answer before the completion (nothing
 * stored, nothing flagged), and it is what the screen promises in so many words:
 * *"'Don't keep it' deletes what you typed, here and on our side."* ⚠ A question
 * somebody is already dealing with — its status moved, or an admin escalated or
 * annotated one of its flags (`flag.escalate` leaves the flag `open`) — is left
 * alone, and an edit to it is inserted as a new question rather than rewriting
 * the one they are working on.
 *
 * ## The escalation
 *
 * Re-derived from the edited text exactly as `writeCompletion` does it. An open
 * flag already raised for this question stays — a person still has to read it —
 * and a new class that is owed one gets one, never two of the same reason.
 */
export async function writeDemandEdit(
  db: Db,
  input: {
    person_id: string;
    demand: StoredDemand | null;
    is_test: boolean;
  },
): Promise<{ outcome: DemandEditOutcome; flagged: boolean }> {
  return db.transaction(async (tx) => {
    /**
     * `for update`: an admin's `demand.status` landing between this read and the
     * write below would otherwise be overwritten — the parent's edit rewriting,
     * or deleting, a question that had just been answered.
     *
     * "Handled" is wider than the row's own status: ⚠ `flag.escalate` leaves its
     * flag `open` and writes an admin's note into it, so an open flag can carry a
     * person's work. Any flag an admin has touched means somebody is dealing with
     * this question, and it is left exactly as they found it.
     */
    const [current] = (await tx.execute(sql`
      select d.id::text as id, d.status, d.is_test,
             exists (select 1 from flags f
                      where f.subject_kind = 'demand_signal'
                        and f.subject_id = d.id
                        and (f.status <> 'open'
                             or f.resolution_note is not null
                             or f.resolved_by is not null)) as handled_flag
        from demand_signals d
       where d.person_id = ${input.person_id}::uuid
       order by d.created_at desc
       limit 1
       for update
    `)) as unknown as Array<{
      id: string;
      status: string;
      is_test: boolean;
      handled_flag: boolean;
    }>;
    const open =
      current && current.status === "open" && !current.handled_flag
        ? current.id
        : null;

    if (input.demand === null) {
      if (!open) return { outcome: "unchanged" as const, flagged: false };
      /* Only flags nobody has touched — the `handled_flag` test above already
         sent anything an admin worked on down the "unchanged" branch. */
      await tx.execute(sql`
        delete from flags
         where subject_kind = 'demand_signal'
           and subject_id = ${open}::uuid
           and status = 'open'
           and resolution_note is null
           and resolved_by is null
      `);
      await tx.execute(sql`
        delete from demand_signals where id = ${open}::uuid and status = 'open'
      `);
      return { outcome: "deleted" as const, flagged: false };
    }

    const d = input.demand;
    let signalId: string;
    let outcome: DemandEditOutcome;
    /**
     * Whether this question is a test one is the **row's** fact when it exists,
     * never the body's: a body saying `is_test: true` must not turn a real
     * question into an allegation that skips its escalation flag and sits in the
     * live queue with nothing putting it in front of a person.
     */
    let isTest = input.is_test;
    if (open) {
      isTest = current.is_test;
      await tx.execute(sql`
        update demand_signals
           set question_text = ${d.question_text},
               category = ${d.category},
               sensitivity = ${d.sensitivity},
               requires_human_review = ${d.requires_human_review},
               neighborhood = (select neighborhood from people
                                where id = ${input.person_id}::uuid)
         where id = ${open}::uuid and status = 'open'
      `);
      signalId = open;
      outcome = "updated";
    } else {
      const [signal] = await tx
        .insert(demandSignals)
        .values({
          personId: input.person_id,
          questionText: d.question_text,
          category: d.category,
          neighborhood: sql`(select neighborhood from people where id = ${input.person_id}::uuid)`,
          sensitivity: d.sensitivity,
          requiresHumanReview: d.requires_human_review,
          isTest: input.is_test,
        })
        .returning({ id: demandSignals.id });
      signalId = signal.id;
      outcome = "inserted";
    }

    const escalation = escalationFor(d.sensitivity);
    let flagged = false;
    if (escalation && !isTest) {
      const [already] = (await tx.execute(sql`
        select 1 from flags
         where subject_kind = 'demand_signal'
           and subject_id = ${signalId}::uuid
           and reason = ${escalation}
           and status = 'open'
         limit 1
      `)) as unknown as Array<unknown>;
      if (!already) {
        await tx.insert(flags).values({
          severity: "escalation",
          reason: escalation,
          subjectKind: "demand_signal",
          subjectId: signalId,
          personId: input.person_id,
        });
        flagged = true;
      }
    }

    return { outcome, flagged };
  });
}
