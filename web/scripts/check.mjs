/**
 * Read-only snapshot of what a test run actually wrote.
 *
 *   npm run check
 *
 * The parent-facing screens deliberately say very little about storage, and the
 * admin shows a curated view — so after a QA walkthrough there is no easy way to
 * answer "did that land, and did it land correctly?". This prints the counts plus
 * the few cross-checks the database cannot enforce on its own.
 *
 * Writes nothing. Safe to run against production.
 */

import { existsSync } from "node:fs";
import postgres from "postgres";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(file);
  }
}

const url = process.env.DATABASE_URL;
if (!url || url.trim() === "") {
  console.error("DATABASE_URL is not set — nothing to check.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const one = async (q, fallback = "—") => {
  try {
    const [row] = await q;
    return row ? Object.values(row)[0] : fallback;
  } catch {
    return fallback;
  }
};

try {
  console.log("── what's in the database ─────────────────────────────");
  for (const [label, table] of [
    ["people", "people"],
    ["children", "children"],
    ["submissions", "submissions"],
    ["places", "places"],
    ["place_contributions", "place_contributions"],
    ["caregivers", "caregivers"],
    ["caregiver_nominations", "caregiver_nominations"],
    ["restricted_notes", "restricted_notes"],
    ["consents", "consents"],
    ["demand_signals", "demand_signals"],
    ["flags", "flags"],
    ["pending_options", "pending_options"],
    ["audit_log", "audit_log"],
  ]) {
    const n = await one(sql`select count(*)::int from ${sql(table)}`);
    console.log(`  ${label.padEnd(24)} ${n}`);
  }

  /**
   * Who can sign in — the one count that is about people rather than parents.
   * Zero is not an error: with an empty table the app falls back to
   * `ADMIN_CREDENTIALS` (bootstrap), and says so on the sign-in screen.
   */
  const adminsActive = await one(
    sql`select count(*)::int from admin_users where active`,
  );
  const adminsTotal = await one(sql`select count(*)::int from admin_users`);
  console.log(
    `  ${"admin_users".padEnd(24)} ${adminsActive} active` +
      (adminsTotal > adminsActive ? `, ${adminsTotal - adminsActive} revoked` : "") +
      (adminsTotal === 0 ? "  (falling back to ADMIN_CREDENTIALS)" : ""),
  );

  console.log("\n── extraction (1.8) ───────────────────────────────────");
  const scored = await one(
    sql`select count(*)::int from place_contributions where confidence is not null`,
  );
  const unscored = await one(
    sql`select count(*)::int from place_contributions where confidence is null`,
  );
  console.log(`  scored: ${scored}   unscored: ${unscored}`);
  if (unscored > 0) {
    console.log(
      "  unscored is fine for pure-tap cards (no free text to judge) and for\n" +
        "  caregiver cards (excluded by design). Otherwise: ANTHROPIC_API_KEY unset,\n" +
        "  or run the catch-up sweep — POST /api/admin/extract.",
    );
  }

  console.log("\n── invariants the schema can't enforce ────────────────");
  const leak = await one(sql`
    select count(*)::int from caregivers
    where (consent_status <> 'consented' or not active) and discoverable
  `);
  const minors = await one(sql`select count(*)::int from caregivers where not is_adult`);
  const unattributed = await one(sql`
    select count(*)::int from audit_log where actor is null or actor = ''
  `);
  /**
   * §17.1 — "ready to answer with" has to be a subset of "a human approved it".
   * The CHECK enforces it on write; this catches a row that predates the
   * constraint, or one changed by hand.
   */
  const goldenUnapproved = await one(sql`
    select count(*)::int from places where answer_ready and status <> 'approved'
  `);
  /** The Product Strategy's rule for a claim about a named person. */
  const allegationUsable = await one(sql`
    select count(*)::int from demand_signals
    where sensitivity = 'named_allegation' and not requires_human_review
  `);
  /**
   * A2P §3.8, the acceptance check that is provable without a live channel:
   * "a consent record exists for every user who has ever received a proactive
   * message". Outreach only — a transactional reply to something they just did is
   * exempt, and so is a row whose person was deleted at their own request.
   */
  const outreachWithoutConsent = await one(sql`
    select count(*)::int from message_log m
    where m.category = 'outreach'
      and m.direction = 'out'
      and m.person_id is not null
      and not exists (
        select 1 from consents c
        where c.person_id = m.person_id and c.status = 'opted_in'
      )
  `);
  /** The suppression list is the first check in the send layer, so it must hold. */
  const sentAfterOptOut = await one(sql`
    select count(*)::int from message_log m
    join people p on p.id = m.person_id
    join sms_opt_outs o on o.phone = p.phone
    where m.category = 'outreach' and m.direction = 'out'
      and m.sent_at > o.opted_out_at
  `);
  /**
   * Belt to the CHECK in 0008: an admin credential that is not a scrypt record
   * is either a row that predates the constraint or one written by hand, and
   * either way it is the shape a plaintext password would arrive in.
   */
  const adminPlaintext = await one(sql`
    select count(*)::int from admin_users
    where password_hash !~ '^scrypt:[0-9]+:[0-9]+:[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
  `);
  const rows = [
    ["caregiver discoverable without consent (inv. 1)", leak],
    ["caregiver stored under 18 (inv. 2)", minors],
    ["audit row with no actor", unattributed],
    ["admin credential that isn't a scrypt record", adminPlaintext],
    ["answer-ready on an unapproved record (§17.1)", goldenUnapproved],
    ["named allegation not held for review", allegationUsable],
    ["outreach with no consent record (A2P §3.8)", outreachWithoutConsent],
    ["outreach sent after a STOP (A2P §3.8)", sentAfterOptOut],
  ];
  for (const [label, n] of rows) {
    console.log(`  ${n === 0 ? "ok  " : "FAIL"} ${label}: ${n}`);
  }

  const bad = rows.filter(([, n]) => typeof n === "number" && n > 0).length;
  console.log(
    bad === 0
      ? "\n✓ no invariant violations found"
      : `\n✗ ${bad} check(s) failed — these are product-level bugs, not data noise`,
  );
  if (bad > 0) process.exitCode = 1;
} catch (err) {
  console.error("check failed:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await sql.end();
}
