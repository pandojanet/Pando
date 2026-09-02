import { sql } from "drizzle-orm";
import { INBOUND_CONSENT_VERSION } from "@/lib/consent";
import {
  clarifyTemplate,
  parseAge,
  parseNeighborhood,
  questionFromTemplate,
  type ClarifyingQuestion,
  type KnownProfile,
} from "@/lib/onboarding";
import { withDb, type Db } from "@/lib/server/db";

/**
 * M5.9 + M5.4 — the cold inbound, and writing one answer back.
 *
 * ## Why an inbound text may create a person, against invariant 11's letter
 *
 * Invariant 11 is that **nothing about a named parent is stored before their
 * phone is verified**, and its purpose is that a stored profile must belong to
 * somebody who actually holds that number. An inbound SMS is exactly that proof:
 * the carrier delivered it from that number, which is the same fact an OTP
 * establishes and arrives with less ceremony. So `phone_verified_at` is set from
 * the webhook, and it is still "a server fact read from the verification, never a
 * field the client can set" — the server here is the signed Twilio webhook.
 *
 * Two things keep this honest rather than a loophole:
 *
 *  - **No name is stored.** The row has a phone and nothing that identifies a
 *    person, which is why the `verified_if_named` CHECK permits it at all. A name
 *    still requires the ordinary flow.
 *  - **The consent records what actually happened.** `INBOUND_CONSENT_VERSION`,
 *    not the seed wording's version, because they were never shown that text.
 *
 * ## What a clarifying answer is allowed to write
 *
 * Only the thing that was asked, and only when it parsed. A reply Pando cannot
 * read leaves the profile alone — the 27 Aug rule, and here the cost of guessing
 * is permanent: a wrong age ranks the wrong parents for every question that
 * person ever asks, and nothing about the data looks wrong afterwards.
 */

export interface ColdPerson {
  person_id: string;
  /** True when this call created them — the first text, and their opt-in. */
  created: boolean;
  profile: KnownProfile;
}

/**
 * Find or create the person behind an inbound number.
 *
 * One transaction, because the person and their consent are one fact: a row
 * without the consent record beside it is somebody Pando is texting with no
 * defence for why.
 */
export async function ensureInboundPerson(input: {
  phone: string;
  marketId?: string;
}): Promise<ColdPerson | null> {
  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      const existing = (await tx.execute(sql`
        select id, neighborhood from people where phone = ${input.phone} limit 1
      `)) as unknown as Array<Record<string, unknown>>;

      let personId: string;
      let created = false;

      if (existing[0]) {
        personId = String(existing[0].id);
      } else {
        const rows = (await tx.execute(sql`
          insert into people (phone, market_id, source, phone_verified_at)
          values (${input.phone}, ${input.marketId ?? "pasadena"}, 'sms_inbound', now())
          returning id
        `)) as unknown as Array<Record<string, unknown>>;
        personId = String(rows[0]?.id ?? "");
        created = true;

        /* Their first text is their opt-in (5.9), recorded as what it was. */
        await tx.execute(sql`
          insert into consents (person_id, scope, status, source, text_version)
          values (${personId}::uuid, 'sms', 'opted_in', 'inbound_text',
                  ${INBOUND_CONSENT_VERSION})
        `);
      }

      const kids = (await tx.execute(sql`
        select coalesce(array_agg(birth_year), '{}') as years
          from children where person_id = ${personId}::uuid
      `)) as unknown as Array<Record<string, unknown>>;

      const hood = (await tx.execute(sql`
        select neighborhood from people where id = ${personId}::uuid
      `)) as unknown as Array<Record<string, unknown>>;

      return {
        person_id: personId,
        created,
        profile: {
          child_birth_years: (kids[0]?.years as number[] | null) ?? [],
          neighborhood: (hood[0]?.neighborhood as string | null) ?? null,
        },
      };
    }),
  );
  return result.persisted && result.data ? result.data : null;
}

/**
 * What Pando last asked this person, if anything is outstanding.
 *
 * Read from `message_log`, which already records every outbound message and its
 * template — so there is no second place for "what is pending" to be wrong. Only
 * the most recent clarify counts, and only if they have not answered since:
 * somebody who ignored the age question and later asked a new question is not
 * answering the old one.
 */
export async function pendingClarification(
  personId: string,
): Promise<ClarifyingQuestion | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select template
        from message_log
       where person_id = ${personId}::uuid
         and direction = 'out'
         and template like 'clarify_%'
         and sent_at > now() - interval '7 days'
       order by sent_at desc
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0]?.template ? String(rows[0].template) : null;
  });
  return result.persisted ? questionFromTemplate(result.data ?? null) : null;
}

/**
 * 5.4 — save the answer back, and update the graph with it.
 *
 * "Quietly saves that answer back into the parent's profile **so future matching
 * improves**" — the second half is the part that needs the affinity row, not just
 * the column. A neighborhood on `people` gives adjacency; the `social_affinities`
 * row is what gives the same-area weight.
 *
 * The age writes a `children` row and **no** `age_range` edge, deliberately:
 * `matching.ts` recomputes the band from `birth_year` at query time precisely
 * because a stored band goes stale, and adding one here would create the second
 * copy that decision exists to avoid.
 *
 * Returns false when the reply could not be read. Nothing is stored then, and the
 * caller does not ask again — one refusal is a parent who did not want to answer.
 */
export async function saveClarification(input: {
  personId: string;
  question: ClarifyingQuestion;
  text: string;
  /** The market's neighborhood options, for `parseNeighborhood`. */
  areas?: Array<{ id: string; label: string }>;
}): Promise<boolean> {
  if (input.question === "child_age") {
    const age = parseAge(input.text);
    if (age === null) return false;
    const result = await withDb(async (db: Db) => {
      /* Birth year, not age — the same conversion the seed flow makes, and for
         the same reason: an age stops being true in a year, a birth year does
         not. `expecting` (-1) becomes this year, which is what the questionnaire
         already assumes. */
      const birthYear = new Date().getFullYear() - Math.max(0, age);
      await db.execute(sql`
        insert into children (person_id, birth_year)
        values (${input.personId}::uuid, ${birthYear})
        on conflict do nothing
      `);
      return true;
    });
    return result.persisted === true;
  }

  const area = parseNeighborhood(input.text, input.areas ?? []);
  if (!area) return false;

  const result = await withDb(async (db: Db) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`
        update people set neighborhood = ${area} where id = ${input.personId}::uuid
      `);
      /* The edge matching actually reads for the same-area weight. Written by the
         server from what it parsed — never taken from a message body, which is
         the 11 Aug rule about who authors the graph. */
      await tx.execute(sql`
        insert into social_affinities (person_id, affinity_type, affinity_value)
        values (${input.personId}::uuid, 'neighborhood', ${area})
        on conflict do nothing
      `);
      return true;
    }),
  );
  return result.persisted === true;
}

/**
 * The market's neighborhood options, for `parseNeighborhood`.
 *
 * Lives here rather than in a shared market repo because this is its only
 * consumer: the questionnaire reads the same table through
 * `/api/market/options`, which serves a browser and caches for 60s, and a second
 * caller with different needs is how one cache ends up serving two purposes badly.
 *
 * `active` only — a retired area must not be a place somebody can be filed into
 * by texting its name, even though a stored answer still resolves against it.
 */
export async function marketAreas(
  marketId = "pasadena",
): Promise<Array<{ id: string; label: string }>> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select option_value, label
        from market_options
       where market_id = ${marketId}
         and category = 'neighborhoods'
         and active
       order by label
    `)) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.option_value),
      label: String(r.label ?? r.option_value),
    }));
  });
  return result.persisted && result.data ? result.data : [];
}

/**
 * M8.3 — the settings exchange, remembered the same way a clarification is.
 *
 * `message_log.template = 'settings_menu'` on the outbound question, and the next
 * inbound is the answer. One mechanism for "what did Pando last ask", not two.
 *
 * **This is what stops "5" being ambiguous.** A bare number means five a month
 * here and a five-year-old in the clarifying flow, and no amount of reading the
 * words can separate them — so whichever question was actually put to this person
 * is the one being answered. Same rule as `intent.ts`, same reason.
 */
export const SETTINGS_TEMPLATE = "settings_menu";

export async function awaitingSettingsChoice(personId: string): Promise<boolean> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select template
        from message_log
       where person_id = ${personId}::uuid
         and direction = 'out'
         and template in (${SETTINGS_TEMPLATE}, 'clarify_child_age', 'clarify_neighborhood')
         and sent_at > now() - interval '1 day'
       order by sent_at desc
       limit 1
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0]?.template === SETTINGS_TEMPLATE;
  });
  return result.persisted && result.data === true;
}

/**
 * Change what Pando may ask of them.
 *
 * The allowance is **a consent control, not a preference** (the phrase is from
 * `derive.ts`), so the write is narrow: the two columns, nothing else, and only
 * for the person whose number the message came from. The record of the exchange
 * is the inbound and outbound pair in `message_log` — what they asked for and
 * what Pando confirmed — which is a better artefact than a status column, because
 * it carries their own words.
 */
export async function setAllowance(input: {
  personId: string;
  allowance: number | null;
  mode: "fixed" | "as_relevant";
}): Promise<boolean> {
  const result = await withDb(async (db: Db) => {
    await db.execute(sql`
      update people
         set monthly_contact_allowance = ${input.allowance},
             allowance_mode = ${input.mode}
       where id = ${input.personId}::uuid
    `);
    return true;
  });
  return result.persisted === true;
}

/** Their current setting, for the menu that states it first. */
export async function currentAllowance(
  personId: string,
): Promise<{ monthly_contact_allowance: number | null; allowance_mode: "fixed" | "as_relevant" }> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select monthly_contact_allowance, allowance_mode
        from people where id = ${personId}::uuid
    `)) as unknown as Array<Record<string, unknown>>;
    return rows[0] ?? null;
  });
  const row = result.persisted ? result.data : null;
  return {
    monthly_contact_allowance:
      row && row.monthly_contact_allowance !== null
        ? Number(row.monthly_contact_allowance)
        : null,
    allowance_mode: row?.allowance_mode === "as_relevant" ? "as_relevant" : "fixed",
  };
}

/** The template to record when the question goes out, so the reply can find it. */
export { clarifyTemplate };
