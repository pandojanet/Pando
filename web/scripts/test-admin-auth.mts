import assert from "node:assert/strict";

const load = async () => {
  // Fresh module each time so it re-reads process.env.
  const m = await import(`../lib/admin/auth.ts?v=${Math.random()}`);
  return m as typeof import("../lib/admin/auth.ts");
};

let pass = 0;
const ok = (label: string) => { pass++; console.log(`  ok    ${label}`); };

// ── per-user mode ─────────────────────────────────────────────────────────
{
  const a = await load();
  const janet = await a.credentialRecord("janet", "amber-cedar-heron-slate-4417");
  const andrii = await a.credentialRecord("andrii", "quartz-willow-mesa-teal-9008");
  process.env.ADMIN_CREDENTIALS = `${janet},${andrii}`;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_USERS;

  const b = await load();
  assert.equal(b.adminAuthMode(), "per_user");                        ok("mode is per_user");
  assert.deepEqual(b.adminUsers(), ["janet", "andrii"]);              ok("users come from the records");
  assert.equal(await b.verifyCredentials("janet", "amber-cedar-heron-slate-4417"), true);
  ok("right person, right password");
  assert.equal(await b.verifyCredentials("janet", "quartz-willow-mesa-teal-9008"), false);
  ok("janet cannot use andrii's password  <- the whole point");
  assert.equal(await b.verifyCredentials("andrii", "amber-cedar-heron-slate-4417"), false);
  ok("andrii cannot use janet's password");
  assert.equal(await b.verifyCredentials("nobody", "amber-cedar-heron-slate-4417"), false);
  ok("unknown name refused");
  assert.equal(await b.verifyCredentials("janet", ""), false);        ok("empty password refused");
  assert.equal(await b.verifyCredentials("janet", "amber-cedar-heron-slate-441"), false);
  ok("one character off refused");

  // The plaintext must not be recoverable from what we store.
  assert.ok(!process.env.ADMIN_CREDENTIALS!.includes("amber-cedar-heron-slate-4417"));
  ok("no plaintext password in the stored records");

  // Session round-trip.
  const t = b.issueToken("janet");
  const s = b.readToken(t.value);
  assert.equal(s?.user, "janet");                                     ok("token round-trips");
  assert.equal(b.readToken(t.value + "x"), null);                     ok("tampered signature refused");
  assert.equal(b.readToken("garbage"), null);                         ok("garbage refused");
  const forged = Buffer.from(JSON.stringify({ user: "janet", exp: 2 ** 40, fp: "x" })).toString("base64url");
  assert.equal(b.readToken(`${forged}.nope`), null);                  ok("unsigned forgery refused");

  // Rotating janet's password must end janet's session and nobody else's.
  const andriiToken = b.issueToken("andrii");
  const rotated = await b.credentialRecord("janet", "brand-new-passphrase-771");
  process.env.ADMIN_CREDENTIALS = `${rotated},${andrii}`;
  const c = await load();
  assert.equal(c.readToken(t.value), null);                           ok("rotation invalidates that person's session");
  assert.equal(await c.verifyCredentials("janet", "brand-new-passphrase-771"), true);
  ok("rotated password works");
  assert.equal(await c.verifyCredentials("janet", "amber-cedar-heron-slate-4417"), false);
  ok("old password no longer works");
  // With a DERIVED secret, changing any record changes the signing key, so every
  // session ends. Blunter than it looks, so it is asserted rather than assumed.
  assert.equal(c.readToken(andriiToken.value), null);
  ok("derived secret: rotation signs everyone out (documented tradeoff)");

  // With an EXPLICIT ADMIN_SESSION_SECRET, fp does the per-person work.
  process.env.ADMIN_SESSION_SECRET = "an-explicit-session-secret-for-the-test";
  process.env.ADMIN_CREDENTIALS = [janet, andrii].join(",");
  const d = await load();
  const jTok = d.issueToken("janet");
  const aTok = d.issueToken("andrii");
  const jRotated = await d.credentialRecord("janet", "yet-another-passphrase-99");
  process.env.ADMIN_CREDENTIALS = [jRotated, andrii].join(",");
  const e = await load();
  assert.equal(e.readToken(jTok.value), null);
  ok("explicit secret: only the rotated person is signed out");
  assert.equal(e.readToken(aTok.value)?.user, "andrii");
  ok("explicit secret: everyone else stays signed in");
  delete process.env.ADMIN_SESSION_SECRET;
}

// ── timing: an unknown name must cost the same as a wrong password ─────────
{
  const a = await load();
  const t = async (u: string, p: string) => {
    const runs: number[] = [];
    for (let i = 0; i < 6; i++) { const s = performance.now(); await a.verifyCredentials(u, p); runs.push(performance.now() - s); }
    runs.sort((x, y) => x - y);
    return runs[3];
  };
  const unknown = await t("does-not-exist", "brand-new-passphrase-771");
  const wrong = await t("janet", "definitely-the-wrong-one-1");
  const ratio = Math.max(unknown, wrong) / Math.min(unknown, wrong);
  console.log(`  ok    unknown name ${unknown.toFixed(0)}ms vs wrong password ${wrong.toFixed(0)}ms (ratio ${ratio.toFixed(2)})`);
  assert.ok(ratio < 1.6, `timing gap too wide: ${ratio}`);
  pass++;
}

// ── deprecated shared mode still works ────────────────────────────────────
{
  delete process.env.ADMIN_CREDENTIALS;
  process.env.ADMIN_PASSWORD = "the-old-shared-one";
  process.env.ADMIN_USERS = "janet, andrii";
  const a = await load();
  assert.equal(a.adminAuthMode(), "shared");                          ok("falls back to shared mode");
  assert.deepEqual(a.adminUsers(), ["janet", "andrii"]);              ok("shared mode lists ADMIN_USERS");
  assert.equal(await a.verifyCredentials("janet", "the-old-shared-one"), true);
  ok("shared password still signs in");
  assert.equal(await a.verifyCredentials("mallory", "the-old-shared-one"), false);
  ok("shared mode still checks the name is on the list");
  assert.equal(a.readToken(a.issueToken("janet").value)?.user, "janet");
  ok("shared mode tokens round-trip");
}

// ── off ───────────────────────────────────────────────────────────────────
{
  delete process.env.ADMIN_CREDENTIALS;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_USERS;
  const a = await load();
  assert.equal(a.adminAuthMode(), "off");                             ok("no config = off");
  assert.equal(a.adminConfigured(), false);                           ok("adminConfigured false");
  assert.equal(await a.verifyCredentials("janet", "anything"), false); ok("nothing signs in when off");
}

// ── malformed records don't take the admin down ───────────────────────────
{
  const a = await load();
  const good = await a.credentialRecord("janet", "amber-cedar-heron-slate-4417");
  process.env.ADMIN_CREDENTIALS = `garbage,,broken:scrypt:x,${good},also:bad:1:2`;
  const b = await load();
  assert.deepEqual(b.adminUsers(), ["janet"]);                        ok("bad records skipped, good one kept");
  assert.equal(await b.verifyCredentials("janet", "amber-cedar-heron-slate-4417"), true);
  ok("still signs in past a bad paste");
}

console.log(`\n  ${pass} checks passed`);
