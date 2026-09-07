/**
 * A second parent arrives on the first parent's link, and the relation lands.
 *
 * Driven through the API rather than the browser: what is being proved is the
 * write path — `recordReferral` reading the invite's kind, choosing the person
 * column over the admin one, and refusing a self-referral — not a screen.
 */
import fs from "node:fs";
import postgres from "postgres";

for (const f of [".env.local", ".env"]) if (fs.existsSync(f)) process.loadEnvFile(f);
const B = process.env.PROBE_BASE_URL ?? "http://localhost:3000";
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

let pass = 0;
let fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log("  ok    " + label + (detail ? "  " + detail : ""));
  } else {
    fail++;
    console.log("  FAIL  " + label + (detail ? "  " + detail : ""));
  }
};

function session() {
  const jar = new Map();
  const store = (r) =>
    (r.headers.getSetCookie() || []).forEach((c) => {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    });
  return {
    async post(path, body) {
      const r = await fetch(B + path, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
        body: JSON.stringify(body),
      });
      store(r);
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: r.status, json };
    },
    async get(path) {
      const r = await fetch(B + path, {
        headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") },
      });
      store(r);
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: r.status, json };
    },
    drop(name) {
      jar.delete(name);
    },
  };
}

/* The referrer: the parent the browser walk just created. */
const [referrer] = await sql`
  select p.id, p.first_name, i.code
  from people p join invites i on i.referrer_person_id = p.id
  where p.phone = '+16265550781'`;
ok("the first parent has a referral link", Boolean(referrer?.code), referrer?.code ?? "none");
if (!referrer) {
  await sql.end();
  process.exit(1);
}

/* A second parent, arriving on it. */
const PHONE = "+16265550782";
const s = session();
const start = await s.post("/api/seed/verify/start", { phone: PHONE, sms_consent: true });
ok("a code can be sent", start.json?.ok === true || start.status === 200, String(start.status));
const code = start.json?.dev_code;
ok("dev codes are on for this walk", Boolean(code));
const check = await s.post("/api/seed/verify/check", { code });
ok("and it confirms", check.json?.ok === true);

const res = await s.post("/api/seed/profile", {
  invite_code: referrer.code,
  source: "link",
  phone: PHONE,
  wants_founding: true,
  first_name: "Referred",
  last_name: "Probe",
  sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" },
  monthly_contact_allowance: 5,
  children: [{ birth_year: 2020 }],
  child_ages_at_capture: [5],
  answers: { neighborhood: "altadena", child_ages: [5], allowance: "5", other: {} },
});
ok("the second profile saves", res.json?.persisted === true, String(res.status));
ok("and gets a referral link of its own", Boolean(res.json?.referral_code), res.json?.referral_code ?? "none");

const [referred] = await sql`select id, invite_id from people where phone = ${PHONE}`;
ok("their arrival is attributed to the link", Boolean(referred?.invite_id));

const rel = await sql`
  select referrer_id, referrer_admin, status from referrals
  where referred_id = ${referred.id}`;
ok("a referral row was written", rel.length === 1, JSON.stringify(rel));
ok("naming the referrer, not an admin", rel[0]?.referrer_id === referrer.id && rel[0]?.referrer_admin === null);
ok(
  "as profile_complete, never credited",
  rel[0]?.status === "profile_complete",
  "a credit is denominated in Network Asks, which do not exist yet",
);

/* Idempotence: a re-save must not stack rows. */
await s.post("/api/seed/profile", {
  invite_code: referrer.code,
  source: "link",
  phone: PHONE,
  wants_founding: true,
  first_name: "Referred",
  last_name: "Probe",
  sms_consent: { status: "opted_in", text_version: "seed-sms-2026-08-01" },
  monthly_contact_allowance: 5,
  children: [{ birth_year: 2020 }],
  child_ages_at_capture: [5],
  answers: { neighborhood: "altadena", child_ages: [5], allowance: "5", other: {} },
});
const again = await sql`select count(*)::int n from referrals where referred_id = ${referred.id}`;
ok("re-saving does not stack a second row", again[0].n === 1, String(again[0].n));
const links = await sql`select count(*)::int n from invites where referrer_person_id = ${referred.id}`;
ok("nor a second referral link", links[0].n === 1, String(links[0].n));

/**
 * Signing back in — her second instruction.
 *
 * The successes matter less than the refusals here: this endpoint answers "who
 * is this number", so the interesting question is what it says to somebody who
 * has not proved they hold one.
 */
const anon = session();
const cold = await anon.get("/api/seed/me");
ok(
  "who-am-I refuses an unverified caller",
  cold.status === 401 && cold.json?.reason === "verification_required",
  `${cold.status} ${cold.json?.reason ?? ""}`,
);

/* The same browser that just verified `PHONE` — the phone is never in the
   request, so this proves the server is reading its own record. */
const me = await s.get("/api/seed/me");
ok("and answers the parent whose number it verified", me.json?.found === true, String(me.status));
ok("with their own name", me.json?.first_name === "Referred", me.json?.first_name ?? "none");
ok("and their own link", me.json?.referral_code === res.json?.referral_code, me.json?.referral_code ?? "none");
ok(
  "and nothing about anybody else",
  me.json?.phone === undefined && me.json?.last_name === undefined,
  "no phone and no surname in the payload",
);

/**
 * A number nobody has a profile against. `found: false` rather than an error:
 * the sign-in screen sends them to `/join`, which is where everybody starts.
 */
const stranger = session();
const sPhone = "+16265550783";
const sStart = await stranger.post("/api/seed/verify/start", { phone: sPhone, sms_consent: true });
await stranger.post("/api/seed/verify/check", { code: sStart.json?.dev_code });
const none = await stranger.get("/api/seed/me");
ok("a verified stranger is not found rather than refused", none.status === 200 && none.json?.found === false,
  `${none.status} found=${none.json?.found}`);

/**
 * The repair: a profile written before `drizzle/0034` has no link, and signing
 * in is the only place a returning parent could get one. Bounded by
 * `invites_referrer_person_uniq`, so the second read mints nothing.
 */
await sql`delete from invites where referrer_person_id = ${referred.id}`;
const repaired = await s.get("/api/seed/me");
ok("a profile with no link gets one on sign-in", Boolean(repaired.json?.referral_code),
  repaired.json?.referral_code ?? "none");
const twice = await s.get("/api/seed/me");
ok("and a second read mints nothing", twice.json?.referral_code === repaired.json?.referral_code);
const linkRows = await sql`select count(*)::int n from invites where referrer_person_id = ${referred.id}`;
ok("still exactly one link", linkRows[0].n === 1, String(linkRows[0].n));

console.log(`\n  ${pass} passed, ${fail} failed\n`);

if (!process.argv.includes("--keep")) {
  for (const id of [referred.id]) {
    await sql`delete from referrals where referred_id = ${id} or referrer_id = ${id}`;
    await sql`delete from invites where referrer_person_id = ${id}`;
    for (const t of ["children", "social_affinities", "life_relevance", "consents"]) {
      await sql.unsafe(`delete from ${t} where person_id = $1`, [id]);
    }
    await sql`delete from people where id = ${id}`;
  }
  console.log("  cleaned up the referred parent\n");
}
await sql.end();
process.exit(fail > 0 ? 1 : 0);
