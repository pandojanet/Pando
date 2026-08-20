import assert from "node:assert/strict";

/* Imported dynamically, like `test-admin-auth.mts` does: a *static* `.ts`
   specifier needs `allowImportingTsExtensions`, and turning that on for one test
   file would change how the whole app is compiled. `npm run build` type-checks
   this directory, so the static form fails the build rather than only this
   script. */
const {
  formatPhone,
  isPhoneComplete,
  maskPhone,
  maskPhoneRecognisable,
  parsePhone,
  phoneCountryOf,
  toE164,
} = (await import(`../lib/phone.ts?v=${Date.now()}`)) as typeof import("../lib/phone.ts");

/**
 * `lib/phone.ts` is the only thing standing between a typed number and a row
 * keyed on it (invariant 10: one person, one identity, keyed by phone). Two
 * countries share that one function now, and the whole design rests on the claim
 * that a formatted value identifies its own country with nothing alongside it —
 * so that claim is asserted rather than believed.
 *
 * The cases that matter are the near-collisions. `380` is a real US area code, so
 * a ten-digit `380…` is American and a twelve-digit one is Ukrainian; a leading
 * `0` cannot begin a US area code, which is the whole reason two ten-digit
 * national forms can live side by side.
 */

let pass = 0;
const ok = (label: string) => {
  pass++;
  console.log(`  ok    ${label}`);
};

// ── US, every way it arrives ───────────────────────────────────────────────
{
  for (const written of [
    "6265550143",
    "(626) 555-0143",
    "626-555-0143",
    "16265550143",
    "+1 626 555 0143",
    "+1 (626) 555-0143",
  ]) {
    assert.equal(toE164(written), "+16265550143", written);
  }
  ok("every US spelling reaches one E.164");
  assert.equal(phoneCountryOf("(626) 555-0143"), "US");               ok("US recognised from the national form");
  assert.equal(formatPhone("6265550143"), "(626) 555-0143");          ok("US formats as it is written at home");
  assert.equal(formatPhone("+16265550143"), "(626) 555-0143");        ok("a stored US number resumes into the field");
}

// ── Ukraine, every way it arrives ──────────────────────────────────────────
{
  for (const written of [
    "0671234567",
    "067 123 45 67",
    "067-123-45-67",
    "380671234567",
    "+380 67 123 45 67",
    "+38 (067) 123-45-67",
  ]) {
    assert.equal(toE164(written), "+380671234567", written);
  }
  ok("every Ukrainian spelling reaches one E.164");
  assert.equal(phoneCountryOf("067 123 45 67"), "UA");                ok("UA recognised from the trunk zero");
  assert.equal(formatPhone("0671234567"), "067 123 45 67");           ok("UA formats as it is written at home");
  assert.equal(formatPhone("+380671234567"), "067 123 45 67");        ok("a stored UA number resumes into the field");
  /* Nine digits with the trunk zero left off is the one case the value cannot
     settle on its own — the field has to say so. */
  assert.equal(toE164("671234567"), null);                            ok("nine bare digits alone are not enough");
  assert.equal(toE164("671234567", "UA"), "+380671234567");           ok("nine bare digits resolve when the field says UA");
  assert.equal(formatPhone("671234567", "UA"), "067 123 45 67");      ok("and the trunk zero is put back for display");
}

// ── The near-collisions, which are the reason any of this is written down ──
{
  /* Area code 380 is real (Ohio). Ten digits is American; twelve is Ukrainian. */
  assert.equal(toE164("3801234567"), "+13801234567");                 ok("ten digits starting 380 is a US number");
  assert.equal(toE164("380671234567"), "+380671234567");              ok("twelve digits starting 380 is Ukrainian");
  assert.equal(phoneCountryOf("3801234567"), "US");                   ok("…and they are told apart by length, not prefix");

  /* No US area code begins with 0 or 1, which is what frees the trunk zero. */
  assert.equal(phoneCountryOf("0671234567"), "UA");                   ok("a leading zero can only be Ukrainian");
  assert.equal(toE164("1234567890"), null);                           ok("a US number cannot start with 1");
  assert.equal(toE164("0234567890"), null);                           ok("a UA operator code cannot start with 0");

  /* A US number is 11 digits internationally, a Ukrainian one 12 — so neither
     can be read as the other however it is punctuated. */
  assert.equal(toE164("+16265550143"), "+16265550143");               ok("US international length holds");
  assert.equal(toE164("+380671234567"), "+380671234567");             ok("UA international length holds");
}

// ── Idempotence, because the routes re-parse what the client already parsed ──
{
  for (const e164 of ["+16265550143", "+380671234567"]) {
    assert.equal(toE164(e164), e164);
    assert.equal(toE164(toE164(e164)!), e164);
  }
  ok("toE164 is idempotent — a route may re-run it on a stored value");
}

// ── Refusals ───────────────────────────────────────────────────────────────
{
  for (const bad of ["", "   ", "abc", "626555", "62655501439999", "+44 20 7946 0958", "+7 495 123 45 67"]) {
    assert.equal(toE164(bad), null, JSON.stringify(bad));
    assert.equal(isPhoneComplete(bad), false, JSON.stringify(bad));
  }
  ok("incomplete, over-long and other countries are all refused");
  assert.equal(parsePhone("+442079460958"), null);                    ok("a UK number is not quietly read as something else");
}

// ── Partial formatting, i.e. what the field does on every keystroke ────────
{
  assert.deepEqual(
    ["6", "62", "626", "6265", "626555", "6265550", "6265550143"].map((d) => formatPhone(d, "US")),
    ["6", "62", "626", "(626) 5", "(626) 555", "(626) 555-0", "(626) 555-0143"],
  );
  ok("US groups as they type");
  assert.deepEqual(
    ["0", "06", "067", "06712", "0671234", "0671234567"].map((d) => formatPhone(d, "UA")),
    ["0", "06", "067", "067 12", "067 123 4", "067 123 45 67"],
  );
  ok("UA groups as they type");
  /* The trunk zero is stripped for storage and kept for display, so the two
     ends of that have to be checked separately: the first keystroke must stay
     on screen, and an empty field must not show a bare zero. */
  assert.equal(formatPhone("0", "UA"), "0");                          ok("the trunk zero survives its own keystroke");
  assert.equal(formatPhone("", "UA"), "");                            ok("an empty field stays empty, not '0'");
  /* Over-typing is truncated rather than accepted, in both countries. */
  assert.equal(formatPhone("62655501439999", "US"), "(626) 555-0143"); ok("US stops at ten digits");
  assert.equal(formatPhone("06712345679999", "UA"), "067 123 45 67");  ok("UA stops at nine subscriber digits");
}

// ── Switching country keeps the digits the parent already typed ────────────
{
  /* The field re-groups rather than clearing, so a mis-pick costs no retyping. */
  assert.equal(formatPhone("067 123 45 67", "US"), "(067) 123-4567");
  ok("switching to US re-groups the same digits");
  /* …and the value still identifies itself, so the picker snaps back to what
     the number actually is rather than sitting on a country it contradicts. */
  assert.equal(phoneCountryOf("(067) 123-4567"), "UA");
  ok("…and a Ukrainian number stays Ukrainian however it is grouped");
}

// ── Masks: invariant 7 is about logs, but a screen is a surface too ────────
{
  assert.equal(maskPhone("+16265550143"), "••• ••• 0143");            ok("US mask shows four digits");
  assert.equal(maskPhone("+380671234567"), "••• ••• 4567");           ok("UA mask shows four digits");
  assert.equal(maskPhoneRecognisable("+16265550143"), "(626) •••‑0143");
  ok("US recognisable mask keeps the area code");
  /* This is the bug the shared helper exists to stop: the old local copy took
     the last ten digits and wrapped them in US parentheses, so a Ukrainian
     number was displayed as `(067) •••‑4567` — a trunk zero dressed as an area
     code. */
  assert.equal(maskPhoneRecognisable("+380671234567"), "067 •••‑4567");
  ok("UA recognisable mask keeps the operator code, without US parentheses");
  for (const m of [
    maskPhone("+16265550143"),
    maskPhone("+380671234567"),
    maskPhoneRecognisable("+16265550143"),
    maskPhoneRecognisable("+380671234567"),
  ]) {
    assert.ok(!m.includes("555") && !m.includes("123"), m);
  }
  ok("no mask leaks the middle of the number");
}

console.log(`\n${pass} checks passed.`);
