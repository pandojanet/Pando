import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { MODELS } from "@/lib/models";
import { classifyDemand } from "@/lib/demand";
import { baseQuestion } from "@/lib/more-options";
import {
  MEMORY_FOLD_BATCH,
  MEMORY_IDLE_DAYS,
  MEMORY_SCHEMA,
  familyInterests,
  mayFold,
  memoryExpired,
  memoryPrompt,
  mergeMemory,
  readMemoryAsks,
  validMemory,
  type MemoryAsk,
  type MemoryExchange,
  type MemoryTopic,
} from "@/lib/conversation-memory";
import { withDb, type Db } from "@/lib/server/db";
import { tracedFetch } from "@/lib/server/trace";
import { EARLIER_DAYS, EARLIER_EXCHANGES } from "@/lib/server/repo/deep-dives";

/**
 * A parent's older exchanges as a structured memory (12 Nov, drizzle/0066; the
 * rules are in `lib/conversation-memory.ts`). One row per person: the asks that
 * left the verbatim window, and how far they reach (`covers_through`).
 *
 * The model call that files them is traced like every model call: under the
 * 5 Nov exception (invariant 7) a trace carries the call's words, masked by
 * `cleanContent`, and `POSTHOG_TRACE_CONTENT=off` takes them out. What it is
 * sent has passed `mayFold`; what it returns is only the allowed values.
 */

const MEMORY_TIMEOUT_MS = 15_000;
const sensitive = (text: string) => classifyDemand(text, null) !== "ordinary";

/** One fold per person at a time (review, 12 Nov): two quick texts read the same state and paid twice. */
const folding = new Set<string>();

/** The market's areas — the only places a remembered ask may name. */
async function areasFor(db: Db, personId: string): Promise<string[]> {
  const rows = (await db.execute(sql`
    select distinct o.area from market_options o
      join people p on p.market_id = o.market_id
     where p.id = ${personId}::uuid and o.category = 'neighborhoods' and o.area is not null
  `)) as unknown as Array<{ area: string }>;
  return rows.map((r) => r.area);
}

/** The memory for this person, re-checked against today's rules — and deleted as it is read when it is past its keeping. */
export async function memoryFor(personId: string | null | undefined): Promise<MemoryAsk[]> {
  if (!personId) return [];
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      select asks, updated_at from conversation_summaries where person_id = ${personId}::uuid
    `)) as unknown as Array<{ asks: unknown; updated_at: string | Date }>;
    const row = rows[0];
    if (!row) return [];
    if (memoryExpired(new Date(row.updated_at), new Date())) {
      await db.execute(sql`delete from conversation_summaries where person_id = ${personId}::uuid`);
      return [];
    }
    return validMemory(row.asks, await areasFor(db, personId));
  });
  return result.persisted ? (result.data ?? []) : [];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Each person's interests (25 Nov, `familyInterests`): the topics of their
 * questions still in the verbatim window — sent unheld, within `EARLIER_DAYS` —
 * and of their remembered asks. Two queries for any number of people, so the
 * weekly digest reads everyone's at once. A person with none is absent from
 * the map. Nothing is written, and nothing is logged but a count by the caller.
 */
export async function familyInterestsFor(personIds: readonly string[]): Promise<Map<string, MemoryTopic[]>> {
  const ids = [...new Set(personIds.filter((id) => UUID.test(id)))];
  if (ids.length === 0) return new Map();
  /* An array literal, not `sql.array` — see `admin-read.ts`. Only UUIDs reach it. */
  const literal = `{${ids.map((id) => `"${id}"`).join(",")}}`;
  const result = await withDb(async (db: Db) => {
    const memories = (await db.execute(sql`
      select person_id::text as person_id, asks, updated_at from conversation_summaries
       where person_id = any(${literal}::uuid[])
    `)) as unknown as Array<{ person_id: string; asks: unknown; updated_at: string | Date }>;
    const asked = (await db.execute(sql`
      select person_id::text as person_id, question_text from answers
       where person_id = any(${literal}::uuid[])
         and created_at > now() - make_interval(days => ${EARLIER_DAYS}::int)
         and status = 'sent' and hold_reason = 'not_held'
         and question_text is not null
       order by created_at desc
    `)) as unknown as Array<{ person_id: string; question_text: string }>;
    return { memories, asked };
  });
  if (!result.persisted || !result.data) return new Map();
  const now = new Date();
  const memoryOf = new Map<string, MemoryAsk[]>();
  for (const m of result.data.memories) {
    if (memoryExpired(new Date(m.updated_at), now)) continue;
    /* Topics only: the area is not used here, so no market's areas are needed to read it. */
    memoryOf.set(m.person_id, validMemory(m.asks, [], now));
  }
  const questionsOf = new Map<string, string[]>();
  for (const a of result.data.asked) {
    const q = baseQuestion(String(a.question_text)).trim();
    if (q) questionsOf.set(a.person_id, [...(questionsOf.get(a.person_id) ?? []), q]);
  }
  const out = new Map<string, MemoryTopic[]>();
  for (const id of ids) {
    const interests = familyInterests({ memory: memoryOf.get(id) ?? [], recentQuestions: questionsOf.get(id) ?? [], isSensitive: sensitive });
    if (interests.length > 0) out.set(id, interests);
  }
  return out;
}

type AnswerRow = { question_text: string | null; answer_text: string | null; status: string; hold_reason: string; created_at: string | Date; at: string };

/**
 * Files the exchanges that have left the verbatim window into the memory.
 *
 * Runs during a message, before its own answer exists, so the window is what
 * the **next** reading will show word for word: this message's answer plus the
 * 12 newest exchanges already there (review, 12 Nov: measuring 13 left one
 * exchange in neither). Within the last `EARLIER_DAYS` only; older ones have
 * left it too. Never folded again: anything at or before `covers_through`, the
 * person's last STOP, or `MEMORY_IDLE_DAYS` ago — so a STOP, or 90 quiet days,
 * is not undone by the next text rebuilding the memory from old answers. An
 * exchange `mayFold` refuses is passed over and still counted as covered.
 * Never throws; returns an enum for the log.
 */
export async function foldMemory(personId: string | null | undefined, phone: string): Promise<"none" | "busy" | "skipped" | "folded" | "not_written" | "failed"> {
  if (!personId) return "none";
  if (folding.has(personId)) return "busy";
  folding.add(personId);
  try {
    const state = await withDb(async (db: Db) => {
      const floorRows = (await db.execute(sql`
        select greatest(
                 (select covers_through from conversation_summaries where person_id = ${personId}::uuid),
                 /* A real STOP: a START from a number that never sent one writes both at once (review, 12 Nov). */
                 (select max(opted_out_at) from sms_opt_outs
                   where phone = ${phone} and (opted_in_at is null or opted_in_at > opted_out_at)),
                 now() - make_interval(days => ${MEMORY_IDLE_DAYS}::int)
               )::text as floor,
               (now() - make_interval(days => ${EARLIER_DAYS}::int))::text as week_ago,
               now()::text as started,
               (select created_at from answers
                 where phone = ${phone} and question_text is not null and status = 'sent' and hold_reason = 'not_held'
                   and answer_text is not null and created_at > now() - make_interval(days => ${EARLIER_DAYS}::int)
                 order by created_at desc offset ${EARLIER_EXCHANGES - 1} limit 1)::text as twelfth
      `)) as unknown as Array<{ floor: string; week_ago: string; started: string; twelfth: string | null }>;
      const { floor, week_ago, started, twelfth } = floorRows[0];
      /* With twelve in the week, everything older than the twelfth has left; with fewer, everything older than the week. */
      const cutoff = twelfth ?? week_ago;
      const leaving = (await db.execute(sql`
        select question_text, answer_text, status, hold_reason, created_at, created_at::text as at from answers
         where phone = ${phone} and question_text is not null
           and created_at > ${floor}::timestamptz
           and created_at < ${cutoff}::timestamptz
         order by created_at asc
         limit ${MEMORY_FOLD_BATCH}
      `)) as unknown as AnswerRow[];
      if (leaving.length === 0) return null;
      const current = (await db.execute(sql`
        select asks from conversation_summaries where person_id = ${personId}::uuid
      `)) as unknown as Array<{ asks: unknown }>;
      const previous = current[0]?.asks ?? [];
      return { leaving, started, previous, areas: await areasFor(db, personId) };
    });
    if (!state.persisted) {
      console.info("[memory] fold", { outcome: "failed", step: "read" });
      return "failed";
    }
    if (!state.data) return "none";
    const { leaving, started, previous, areas } = state.data;

    /* The newest folded, exactly as stored (to the microsecond, as text), so the next fold starts after it. */
    const reach = leaving[leaving.length - 1].at;
    const exchanges: MemoryExchange[] = leaving.map((r) => ({
      question: baseQuestion(String(r.question_text ?? "")).trim(),
      answer: String(r.answer_text ?? ""),
      status: r.status,
      hold_reason: r.hold_reason,
      on: new Date(r.created_at).toISOString().slice(0, 10),
    }));
    const foldable = exchanges.filter((x) => mayFold(x, sensitive));

    /* A call that fails is not tried again: the exchanges count as covered, so a
       batch that always fails (a cut-off reply, a timeout) cannot cost a model
       call on every text (review, 12 Nov). They are simply not remembered. */
    let added: MemoryAsk[] = [];
    let callFailed = false;
    if (foldable.length > 0 && process.env.ANTHROPIC_API_KEY?.trim()) {
      try {
        const prompt = memoryPrompt(foldable, areas);
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, fetch: tracedFetch("conversation_memory") });
        const response = await anthropic.messages.create(
          {
            model: MODELS.fast,
            max_tokens: 1500,
            system: prompt.system,
            output_config: { format: { type: "json_schema", schema: MEMORY_SCHEMA } },
            messages: [{ role: "user", content: prompt.user }],
          },
          { timeout: MEMORY_TIMEOUT_MS },
        );
        const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        if (response.stop_reason !== "end_turn") callFailed = true;
        else added = readMemoryAsks(JSON.parse(text), foldable, areas);
      } catch {
        callFailed = true;
      }
    } else if (foldable.length > 0) {
      callFailed = true;
    }
    const asks = mergeMemory(validMemory(previous, areas), added);

    /* Written only while they are not opted out (review, 12 Nov: a fold already
       running when STOP arrived wrote the memory back after STOP cleared it). */
    const stored = await withDb(async (db: Db) => {
      const rows = (await db.execute(sql`
        insert into conversation_summaries (person_id, asks, covers_through, model, updated_at)
        select ${personId}::uuid, ${JSON.stringify(asks)}::jsonb, ${reach}::timestamptz, ${MODELS.fast}, now()
         where not exists (
           select 1 from sms_opt_outs o
            where o.phone = ${phone} and o.opted_out_at is not null
              and (o.opted_in_at is null or o.opted_in_at < o.opted_out_at
                   /* nor when a STOP came while this fold ran, START or not */
                   or o.opted_out_at > ${started}::timestamptz))
        on conflict (person_id) do update
           set asks = excluded.asks, covers_through = excluded.covers_through, model = excluded.model, updated_at = now()
         where conversation_summaries.covers_through < excluded.covers_through
        returning person_id
      `)) as unknown as unknown[];
      return rows.length;
    });
    if (!stored.persisted) return "failed";
    const outcome = stored.data === 0 ? "not_written" : callFailed ? "failed" : added.length > 0 ? "folded" : "skipped";
    console.info("[memory] fold", { outcome, leaving: leaving.length, foldable: foldable.length, added: added.length, kept: asks.length });
    return outcome;
  } catch {
    console.info("[memory] fold", { outcome: "failed" });
    return "failed";
  } finally {
    folding.delete(personId);
  }
}

/** STOP (12 Nov): the memory goes with the conversation; `foldMemory` never rebuilds what came before it. DELETE removes it with the person (cascade). */
export async function forgetMemory(phone: string): Promise<void> {
  const result = await withDb(async (db: Db) => {
    await db.execute(sql`
      delete from conversation_summaries where person_id in (select id from people where phone = ${phone})
    `);
    return true;
  });
  /* It cannot be lost quietly: an enum, so a failed clear is seen. */
  if (!result.persisted) console.error("[memory] clear failed", { reason: "db" });
}

/** The `expire_memory` job: every memory nobody has added to for `MEMORY_IDLE_DAYS`. */
export async function expireMemory(): Promise<number | null> {
  const result = await withDb(async (db: Db) => {
    const rows = (await db.execute(sql`
      delete from conversation_summaries where updated_at < now() - make_interval(days => ${MEMORY_IDLE_DAYS}::int) returning person_id
    `)) as unknown as unknown[];
    return rows.length;
  });
  return result.persisted ? (result.data ?? 0) : null;
}
