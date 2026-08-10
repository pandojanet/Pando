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
  const rows = [
    ["caregiver discoverable without consent (inv. 1)", leak],
    ["caregiver stored under 18 (inv. 2)", minors],
    ["audit row with no actor", unattributed],
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
