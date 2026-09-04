/**
 * Give every untagged share a `focus` — what a parent would ask about to reach
 * it — using the same model and the same vocabulary the extraction pass uses.
 *
 *   npm run focus:backfill                       # dry run: prints what it would write
 *   npm run focus:backfill -- --commit           # writes the untagged ones
 *   npm run focus:backfill -- --retag --commit   # re-asks about every record
 *
 * ## Why this is a script and not the sweep
 *
 * The extraction pass tags a card the first time it scores it, so everything
 * captured from now on arrives tagged. What it cannot reach is the records that
 * were scored **before** the column existed: `sweepExtraction` selects on
 * `confidence is null or confidence_note is null`, so an already-scored card is
 * skipped and would never be tagged.
 *
 * Widening that condition to "or the share has no focus" was the obvious fix and
 * is wrong: `focus` is legitimately null for a record the model declined ("none
 * of these" is a real answer), so those rows would be re-swept and re-scored on
 * every run, for ever, at a cost nobody is watching. A backfill is a thing you
 * run once.
 *
 * It follows the same shape as `options:import`: **a diff first, and `--commit`
 * before anything is written.** This changes what Pando puts in front of a
 * parent, so it is a deliberate act rather than a side effect.
 *
 * ## What it will not do
 *
 * **It never overwrites without being asked to.** `where focus is null` in the
 * update as well as in the select, so a correction and a value written by an
 * earlier run both stand — the same rule the extraction pass follows, and for
 * the same reason: one share collects many parents' contributions and the tag
 * must not depend on who wrote last.
 *
 * `--retag` is the deliberate exception, and it exists because **there is no
 * admin control for this column yet**. The model assigns these, the developer
 * accepted its error rate knowing it (4 Sep), and a wrong tag with no way back
 * would make that bargain one-sided. Closing that gap properly means a control
 * on the contributions queue, where a reviewer is already looking at the record.
 *
 * **It asks for the vocabulary rather than assuming it.** The topics come from
 * `market_options.focus`, which an admin edits (12 Aug), and an answer outside
 * that list is dropped rather than stored.
 */

import { existsSync } from "node:fs";
import postgres from "postgres";
import Anthropic from "@anthropic-ai/sdk";

/* The convention every sibling script here uses - no dotenv dependency. */
for (const f of [".env.local", ".env"]) {
  if (existsSync(f) && typeof process.loadEnvFile === "function") {
    process.loadEnvFile(f);
  }
}

const COMMIT = process.argv.includes("--commit");
const RETAG = process.argv.includes("--retag");
const MARKET = "pasadena";
const MODEL = "claude-haiku-4-5";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Nothing to back-fill against.");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. This script is the model.");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const anthropic = new Anthropic();

const SCHEMA = {
  type: "object",
  properties: {
    focus: {
      type: "string",
      description:
        "One of the ids listed under Topics, exactly as written, or 'none' when the record does not clearly belong to any of them. 'none' is a real answer and is better than the nearest fit.",
    },
  },
  required: ["focus"],
  additionalProperties: false,
};

const SYSTEM = `You are tagging local records - classes, camps, places and tips - with the one topic a parent would ask about to reach them.

Judge from the name and the kind first, and the note second. Answer "none" whenever the record does not clearly belong to one of the topics offered: a wrong topic is worse than no topic, because it puts a record in front of a parent who asked about something else and nothing downstream can tell it apart from a right one.`;

const options = await sql`
  select option_value, label from market_options
   where market_id = ${MARKET} and category = 'focus' and active
   order by option_value`;

if (options.length === 0) {
  console.error(`No focus topics for ${MARKET}. Run the taxonomy import first.`);
  await sql.end();
  process.exit(1);
}
const ids = new Set(options.map((o) => String(o.option_value)));

/* One row per untagged share, with one contribution's note for context. The
   note is the weaker signal on purpose - a name and a kind are what a parent
   searches with. */
const rows = await sql`
  select s.id, s.name, s.kind, s.place_type, s.topic,
         (array_agg(sc.what_makes_it_great) filter (where sc.what_makes_it_great is not null))[1] as note
    from shares s
    left join share_contributions sc on sc.share_id = s.id and sc.status = 'approved'
   where s.market_id = ${MARKET} and not s.is_test
     ${RETAG ? sql`` : sql`and s.focus is null`}
   group by s.id
   order by s.name`;

console.log(
  `\n${rows.length} ${RETAG ? "record(s)" : "untagged record(s)"} in ${MARKET}; ${options.length} topics offered.` +
    (COMMIT ? "" : "  (dry run - nothing will be written)"),
);

const topics = options.map((o) => `${o.option_value} (${o.label})`).join(", ");
let tagged = 0;
let declined = 0;
let rejected = 0;

for (const row of rows) {
  let answer = null;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 128,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            `Kind: ${row.kind}${row.place_type ? ` / ${row.place_type}` : ""}`,
            `Name: ${row.name}`,
            row.topic ? `Tip topic: ${row.topic}` : null,
            `Topics (answer with one id, or "none"): ${topics}`,
            row.note ? `\nWhat a parent wrote: ${row.note}` : null,
          ]
            .filter((line) => line !== null)
            .join("\n"),
        },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    answer = block ? String(JSON.parse(block.text).focus ?? "").trim() : "";
  } catch (err) {
    /* Error class only: the prompt carries a parent's own words. */
    console.log(`  ${String(row.name).padEnd(34)} FAILED (${err?.status ?? "unknown"})`);
    continue;
  }

  if (answer === "none" || answer === "") {
    declined += 1;
    console.log(`  ${String(row.name).padEnd(34)} -> (none)`);
    continue;
  }
  if (!ids.has(answer)) {
    rejected += 1;
    console.log(`  ${String(row.name).padEnd(34)} -> ${answer}  REJECTED: not a topic this market offers`);
    continue;
  }

  console.log(`  ${String(row.name).padEnd(34)} -> ${answer}`);
  if (COMMIT) {
    /* `focus is null` in the update too, not only in the select above: a
       correction made while this was running must survive it. */
    await sql`update shares set focus = ${answer}
                where id = ${row.id} ${RETAG ? sql`` : sql`and focus is null`}`;
  }
  tagged += 1;
}

console.log(
  `\n${tagged} tagged, ${declined} declined by the model, ${rejected} rejected as off-vocabulary.`,
);
if (!COMMIT && tagged > 0) console.log("Re-run with --commit to write.\n");
else console.log("");

await sql.end();
