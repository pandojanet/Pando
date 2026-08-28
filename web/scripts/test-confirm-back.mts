import assert from "node:assert/strict";

/**
 * Estimate 1.8's confirm-back trigger.
 *
 * Its own test because the failure modes are asymmetric and both are bad in
 * different ways: asking too often makes a two-minute flow feel like an
 * interrogation, and never asking loses the data quality the whole extraction row
 * exists for. So the cases below are mostly about **not** asking.
 */

const { confirmBackFor } = (await import(
  `../lib/seed-chat/confirm-back.ts?v=${Date.now()}`
)) as typeof import("../lib/seed-chat/confirm-back.ts");

let pass = 0;
const ok = (label: string) => {
  pass++;
  console.log(`  ok    ${label}`);
};

const card = (kind: string, fields: Record<string, unknown>) =>
  ({ id: "x", kind, fields, created_at: "" }) as never;

// ── asks, where it should ──────────────────────────────────────────────────
for (const thin of ["good", "great!", "we loved it", "nice", "it's fine", "amazing"]) {
  const got = confirmBackFor(card("activity", { what_makes_it_great: thin }));
  assert.ok(got, `should have asked about "${thin}"`);
  assert.equal(got.field, "what_makes_it_great");
}
ok("a thin answer gets one follow-up");

/* The field is the chat step id `tip`, not the column `tip_text` — getting that
   wrong is what made the first version of this feature never fire, while this
   test passed against the same wrong name. */
assert.ok(confirmBackFor(card("tip", { tip: "book early" })));
assert.equal(confirmBackFor(card("tip", { tip_text: "book early" })), null);
ok("and so does a thin tip, under its real step id");

// ── does not ask, where it must not ────────────────────────────────────────
const real =
  "The teacher remembers every child's name and they cap the class at eight.";
assert.equal(confirmBackFor(card("activity", { what_makes_it_great: real })), null);
ok("a real answer is left alone");

/* The sentence that broke the first version of the pattern: it starts with
   "we loved it" and then says something. Length alone would have passed it;
   the phrase test alone would have caught it wrongly. */
assert.equal(
  confirmBackFor(
    card("activity", {
      what_makes_it_great: "we loved it because the room is calm and small",
    }),
  ),
  null,
);
ok("praise followed by a reason is a real answer");

/* Invariant 12 — a caregiver's free text *is* the restricted note, and prompting
   for more about a named person is the opposite of what that rule is for. */
assert.equal(confirmBackFor(card("caregiver", { what_makes_it_great: "good" })), null);
ok("never on a caregiver card, however thin");

/* Skipping is an answer. Re-asking a declined question is what makes a flow feel
   like it is arguing. */
assert.equal(confirmBackFor(card("activity", {})), null);
ok("a skipped field is not re-asked");
assert.equal(confirmBackFor(card("activity", { what_makes_it_great: "   " })), null);
ok("nor is an empty one");

/* Once per card. A parent who answered and is still under the bar has said what
   they have to say. */
assert.equal(
  confirmBackFor(
    card("activity", { what_makes_it_great: "good", __confirm_back_asked: true }),
  ),
  null,
);
ok("never twice for one card");

// ── one question, not three ───────────────────────────────────────────────
const many = confirmBackFor(
  card("activity", { what_makes_it_great: "good", caveat: "no", who_for: "kids" }),
);
assert.ok(many);
assert.equal(many.field, "what_makes_it_great");
ok("three thin fields still produce one question, the most useful one");

console.log(`\n${pass} checks passed.`);
