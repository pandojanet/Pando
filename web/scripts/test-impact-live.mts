/**
 * M9.3 — the `impact_sync` sweep, against the real schema.
 *
 * `syncImpactIn` is the exact pair of statements the job runs
 * (`lib/server/repo/impact-sync.ts`). Every fixture and both sweeps happen inside
 * one transaction that is always rolled back, so nothing here can leave a row in
 * the live database — including the events the sweep would write for real rows
 * that are missing one.
 *
 * What it asks, case by case: which contributions and Ask replies earn an event,
 * which do not, when the event is dated, what it is worth, whether a test row
 * stays a test row, and whether a second run (or a run beside the live write)
 * ever counts anything twice.
 *
 * Run: `npm run test:impact-live`
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import type { SyncResult } from "../lib/server/repo/impact-sync.ts";

/* A value import with a .ts extension is refused by tsc here, so the module is
   loaded the way the other suites load theirs. */
const { syncImpactIn } = (await import("../lib/server/repo/impact-sync" + ".ts")) as {
  syncImpactIn: (tx: unknown) => Promise<SyncResult>;
};

const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error("No DATABASE_URL — this suite needs the real schema.");
  process.exit(1);
}
const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);

let failures = 0;
let checks = 0;
function ok(what: string, cond: boolean, detail = "") {
  checks++;
  if (cond) console.log(`  ok    ${what}`);
  else {
    failures++;
    console.log(`  FAIL  ${what}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = "impact-live";
const ROLLBACK = new Error("rollback");

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rows = async (tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute(q)) as unknown as Row[];
const one = async (tx: Tx, q: ReturnType<typeof sql>) => (await rows(tx, q))[0];

try {
  await db.transaction(async (tx) => {
    /* ── fixtures ─────────────────────────────────────────────────────────── */
    const person = async (n: number) =>
      (await one(tx, sql`
        insert into people (first_name, last_name, phone, phone_verified_at, is_test,
                            source, monthly_contact_allowance, allowance_mode)
        values (${"Impact" + n}, 'Live', ${"+1626555995" + n}, now(), true,
                ${TAG}, 5, 'fixed')
        returning id`))!.id as string;
    const [p1, p2, p3, p4, p5] = [
      await person(1), await person(2), await person(3), await person(4), await person(5),
    ];

    const share = async (name: string) =>
      (await one(tx, sql`
        insert into shares (market_id, kind, name, status, provenance, is_test)
        values ('pasadena', 'activity', ${name}, 'approved', 'parent_submitted', true)
        returning id`))!.id as string;
    const s1 = await share(`${TAG} one`);
    const s2 = await share(`${TAG} two`);
    const s3 = await share(`${TAG} three`);

    const contribution = async (
      shareId: string,
      personId: string | null,
      status: string,
      approvedAt: string | null,
      isTest = true,
    ) =>
      (await one(tx, sql`
        insert into share_contributions (share_id, person_id, firsthand, status,
                                         approved_at, is_test, created_at)
        values (${shareId}::uuid, ${personId}::uuid, true, ${status},
                ${approvedAt}::timestamptz, ${isTest}, '2026-07-15T12:00:00Z')
        returning id`))!.id as string;

    await contribution(s1, p1, "approved", "2026-08-01T10:00:00Z"); // → event, dated approval
    await contribution(s1, p2, "pending_review", null);              // → nothing
    await contribution(s1, p3, "rejected", null);                    // → nothing
    await contribution(s2, null, "approved", "2026-08-02T10:00:00Z"); // parent deleted → nothing
    await contribution(s2, p4, "approved", null);                    // → event, dated creation
    await contribution(s3, p5, "approved", "2026-08-03T10:00:00Z", false); // not a test row

    /* The live write already landed for p1 on s2 (admin approve) — the sweep
       must neither duplicate it nor re-date it. */
    await contribution(s2, p1, "approved", "2026-08-05T10:00:00Z");
    await tx.execute(sql`
      insert into impact_events (person_id, kind, share_id, is_test, created_at)
      values (${p1}::uuid, 'contribution_approved', ${s2}::uuid, true, '2026-08-05T10:00:01Z')`);

    /* Approved, counted, then taken back by an admin: the ledger is
       append-only, so the event stays. */
    const flipped = await contribution(s3, p2, "approved", "2026-08-06T10:00:00Z");

    const blast = async () =>
      (await one(tx, sql`
        insert into blasts (market_id, asker_id, question_text, tier, status,
                            pool_target, is_test)
        values (${TAG}, ${p5}::uuid, 'Anyone know a Saturday swim class?',
                'targeted', 'active', 5, true)
        returning id`))!.id as string;
    const b1 = await blast();

    const recipient = async (
      blastId: string,
      personId: string,
      review: string,
      quality: number | null,
      sentAt: string | null,
      respondedAt: string | null,
    ) =>
      tx.execute(sql`
        insert into blast_recipients (blast_id, person_id, sent_at, responded_at,
                                      response_text, review_status, quality)
        values (${blastId}::uuid, ${personId}::uuid, ${sentAt}::timestamptz,
                ${respondedAt}::timestamptz, 'Try Rose Bowl on Saturdays',
                ${review}, ${quality})`);

    await recipient(b1, p2, "approved", 4, "2026-09-01T09:00:00Z", "2026-09-01T11:00:00Z");
    await recipient(b1, p3, "pending_review", null, "2026-09-01T09:00:00Z", "2026-09-01T12:00:00Z");
    await recipient(b1, p4, "rejected", 1, "2026-09-01T09:00:00Z", "2026-09-01T13:00:00Z");
    await recipient(b1, p5, "approved", null, "2026-09-01T09:00:00Z", null); // unrated, no reply time

    /* ── first sweep ──────────────────────────────────────────────────────── */
    console.log("=== first sweep ===");
    const first = await syncImpactIn(tx);
    console.log(
      `  (live database: ${first.contributions} contribution and ${first.blast_answers} Ask events were missing, fixtures included)`,
    );

    await tx.execute(sql`update share_contributions set status = 'rejected' where id = ${flipped}::uuid`);

    const events = await rows(tx, sql`
      select person_id, kind, share_id, blast_id, quality, is_test, created_at
        from impact_events
       where person_id = any(${`{${[p1, p2, p3, p4, p5].join(",")}}`}::uuid[])`);
    const find = (personId: string, kind: string, subject: string) =>
      events.filter(
        (e) => e.person_id === personId && e.kind === kind &&
          (e.share_id === subject || e.blast_id === subject),
      );
    const iso = (v: unknown) => new Date(v as string).toISOString();

    console.log("=== contributions ===");
    const e1 = find(p1, "contribution_approved", s1);
    ok("an approved contribution earns one event", e1.length === 1, `${e1.length}`);
    ok("it is dated when it was approved, not when it was written",
      e1[0] !== undefined && iso(e1[0].created_at) === "2026-08-01T10:00:00.000Z",
      e1[0] ? iso(e1[0].created_at) : "none");
    ok("a test contribution stays a test event", e1[0]?.is_test === true);
    ok("a contribution waiting for review earns nothing",
      find(p2, "contribution_approved", s1).length === 0);
    ok("a rejected contribution earns nothing",
      find(p3, "contribution_approved", s1).length === 0);
    const orphan = await one(tx, sql`
      select count(*)::int as n from impact_events where share_id = ${s2}::uuid`);
    ok("a contribution whose parent was deleted earns nothing (only the two real owners of s2)",
      orphan!.n === 2, `${orphan!.n}`);
    const e4 = find(p4, "contribution_approved", s2);
    ok("with no approval time it falls back to when the card was written",
      e4.length === 1 && iso(e4[0].created_at) === "2026-07-15T12:00:00.000Z",
      e4[0] ? iso(e4[0].created_at) : "none");
    const e5 = find(p5, "contribution_approved", s3);
    ok("a real contribution is not marked as a test", e5.length === 1 && e5[0].is_test === false);
    const live = find(p1, "contribution_approved", s2);
    ok("an event the live path already wrote is not written twice", live.length === 1, `${live.length}`);
    ok("…and keeps the date the live path gave it",
      live[0] !== undefined && iso(live[0].created_at) === "2026-08-05T10:00:01.000Z");

    console.log("=== Ask replies ===");
    const r2 = find(p2, "blast_answered", b1);
    ok("an approved reply earns one event", r2.length === 1, `${r2.length}`);
    ok("it carries the admin's rating", r2[0]?.quality === 4, `${r2[0]?.quality}`);
    ok("it is dated when they replied",
      r2[0] !== undefined && iso(r2[0].created_at) === "2026-09-01T11:00:00.000Z");
    ok("a reply waiting to be read earns nothing", find(p3, "blast_answered", b1).length === 0);
    ok("a rejected reply earns nothing, rating or not", find(p4, "blast_answered", b1).length === 0);
    const r5 = find(p5, "blast_answered", b1);
    ok("an approved reply nobody rated still counts, unrated", r5.length === 1 && r5[0].quality === null);
    ok("with no reply time it falls back to when the Ask was sent",
      r5[0] !== undefined && iso(r5[0].created_at) === "2026-09-01T09:00:00.000Z");
    ok("a reply to a test Ask stays a test event", r2[0]?.is_test === true,
      `is_test = ${r2[0]?.is_test}`);

    console.log("=== running it again ===");
    const second = await syncImpactIn(tx);
    ok("a second sweep writes nothing at all",
      second.contributions === 0 && second.blast_answers === 0,
      JSON.stringify(second));
    const kept = find(p2, "contribution_approved", s3);
    ok("an approval later taken back keeps its event (the ledger is append-only)", kept.length === 1);

    console.log("=== a reply with no time on it ===");
    /* Not reachable through the product (a reply is only recorded on a row a
       send created), but seed scripts insert rows directly. One bad row must
       not take the whole sweep down with it. */
    const b2 = await blast();
    await recipient(b2, p1, "approved", 3, null, null);
    let crashed: string | null = null;
    try {
      await tx.transaction(async (sp) => {
        await syncImpactIn(sp);
      });
    } catch (err) {
      crashed = String((err as { cause?: { message?: string } })?.cause?.message ?? err).slice(0, 120);
    }
    ok("a reply with neither a send nor a reply time does not break the sweep",
      crashed === null, crashed ?? "");

    throw ROLLBACK;
  });
} catch (err) {
  if (err !== ROLLBACK) {
    failures++;
    console.log(`  FAIL  the suite itself — ${String(err).slice(0, 300)}`);
  }
} finally {
  await client.end();
}

console.log(`\n${checks - failures} passed, ${failures} failed (everything rolled back)`);
process.exit(failures ? 1 : 0);
