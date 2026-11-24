// npm --prefix web run test:profile-delete — a parent's own "Delete my profile" (24 Nov), against a real
// Postgres: an in-memory PGlite on 127.0.0.1 (scripts/lib/pglite-server.mjs), every migration applied,
// then the real route handler called as the browser calls it.
//
// Why it exists: the developer deleted a profile and the same device walked straight back in. The profile
// was gone, but the number's confirmed session (90 days) and its cookie were not, so the app still knew
// the number and asked for no code. This proves the session ends on the server — on every device — the
// cookies are cleared, the sends a number already spent stay counted, and the device's storage is emptied.
//
// Never reaches a real database: DATABASE_URL is set here to the in-memory one, and the test stops if
// anything else is in it.
import { spawn } from "node:child_process";
import { startDb } from "./lib/pglite-server.mjs";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${cond ? "" : detail ? `  (${detail})` : ""}`);
};

const { url, stop } = await startDb();
if (!/^postgres:\/\/postgres@127\.0\.0\.1:\d+\/postgres/.test(url)) throw new Error("refusing: not the in-memory database");
const migrated = await new Promise<{ status: number | null; stdout: string }>((done) => {
  const child = spawn(process.execPath, ["scripts/migrate.mjs"], { env: { ...process.env, DATABASE_URL: url, MIGRATE_DATABASE_URL: url } });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.on("close", (status) => done({ status, stdout }));
});
ok("every migration applies to a fresh database", migrated.status === 0, migrated.stdout.slice(-200));
process.env.DATABASE_URL = url;
delete process.env.MIGRATE_DATABASE_URL;

const load = <T,>(file: string) => import(file) as Promise<T>;
const { sql } = await import("drizzle-orm");
const { getDb } = await load<typeof import("../lib/server/db.ts")>("../lib/server/db.ts");
const db = getDb()!;
const q = async (s: ReturnType<typeof sql>) => (await db.execute(s)) as unknown as Array<Record<string, unknown>>;
const verify = await load<typeof import("../lib/server/verify.ts")>("../lib/server/verify.ts");
const route = await load<typeof import("../app/api/seed/delete/route.ts")>("../app/api/seed/delete/route.ts");

/** A confirmed session for a number, as /api/seed/verify/check leaves it: the row and the cookie's id. */
const session = async (phone: string) => {
  const [r] = await q(sql`
    insert into phone_verifications (phone, code_hash, expires_at, sent_at, verified_at)
    values (${phone}, 'x', now() + interval '5 minutes', array[now()]::timestamptz[], now())
    returning id`);
  return String(r.id);
};
const post = (cookieId: string | null) =>
  route.POST(new Request("http://localhost/api/seed/delete", { method: "POST", headers: cookieId ? { cookie: `${verify.VERIFY_COOKIE}=${cookieId}; pando_invited=1` } : {} }));

console.log("\n=== a parent with a profile deletes it ===");
const PHONE = "+16265550111";
await q(sql`insert into people (phone, market_id, first_name, profile_captured_at, phone_verified_at) values (${PHONE}, 'pasadena', 'Test', now(), now())`);
const thisDevice = await session(PHONE);
const otherDevice = await session(PHONE);
const SOMEONE_ELSE = "+16265550199";
const theirs = await session(SOMEONE_ELSE);
ok("before: the device is signed in as the number", (await verify.verifiedPhone(thisDevice))?.phone === PHONE);

const res = await post(thisDevice);
const body = (await res.json()) as { deleted?: boolean };
ok("the delete answers 200 and says a profile was deleted", res.status === 200 && body.deleted === true, `${res.status} ${JSON.stringify(body)}`);
ok("the person is gone", (await q(sql`select 1 from people where phone = ${PHONE}`)).length === 0);
ok("this device's session ends on the server", (await verify.verifiedPhone(thisDevice)) === null);
ok("and so does the number's session on another device", (await verify.verifiedPhone(otherDevice)) === null);
ok("someone else's session is untouched", (await verify.verifiedPhone(theirs))?.phone === SOMEONE_ELSE);
const rows = await q(sql`select verified_at, cardinality(sent_at) as sends from phone_verifications where phone = ${PHONE}`);
ok("the verification rows stay, so the codes the number already spent still count against it",
  rows.length === 2 && rows.every((r) => r.verified_at !== null && Number(r.sends) === 1));
const cookies = res.headers.getSetCookie?.() ?? [];
const cleared = (name: string) => cookies.some((c) => c.startsWith(`${name}=;`) && /Max-Age=0/i.test(c) && /Path=\//i.test(c) && /HttpOnly/i.test(c));
ok("the response clears the number's cookie and the invite marker", cleared(verify.VERIFY_COOKIE) && cleared("pando_invited"), cookies.join(" | "));
ok("the same cookie again is a stranger's: confirm your number first", (await post(thisDevice)).status === 401);

console.log("\n=== a number with only a session, no saved profile ===");
const ONLY_SESSION = "+16265550122";
const bare = await session(ONLY_SESSION);
const res2 = await post(bare);
ok("answers 200, nothing deleted, and the session still ends", res2.status === 200 && ((await res2.json()) as { deleted?: boolean }).deleted === false && (await verify.verifiedPhone(bare)) === null);
ok("no cookie at all: confirm your number first, nothing touched", (await post(null)).status === 401 && (await verify.verifiedPhone(theirs))?.phone === SOMEONE_ELSE);

console.log("\n=== a confirmed number lasts a week (24 Nov) ===");
/** A confirmation made `days` ago: the row as /verify/check leaves it, its code window five minutes after the send. */
const confirmedDaysAgo = async (phone: string, days: number) => {
  const [r] = await q(sql`
    insert into phone_verifications (phone, code_hash, expires_at, sent_at, verified_at)
    values (${phone}, 'x', now() - make_interval(days => ${days}) + interval '5 minutes',
            array[now() - make_interval(days => ${days})]::timestamptz[], now() - make_interval(days => ${days}))
    returning id`);
  return String(r.id);
};
ok("confirmed six days ago: still signed in", (await verify.verifiedPhone(await confirmedDaysAgo("+16265550133", 6)))?.phone === "+16265550133");
ok("confirmed eight days ago: a code again", (await verify.verifiedPhone(await confirmedDaysAgo("+16265550144", 8))) === null);

console.log("\n=== the device ===");
/* A browser's storage, as far as forgetThisDevice uses it: keys as own properties, removeItem. */
const fakeStorage = (entries: Record<string, string>) => {
  const s = { ...entries } as Record<string, unknown>;
  Object.defineProperty(s, "removeItem", { value: (k: string) => delete s[k], enumerable: false });
  return s;
};
const local = fakeStorage({ "pando.seed.v3": "{}", "pando.seed.v2": "{}", "ph_phc_posthog": "{}", "other.app": "1" });
const sessionArea = fakeStorage({ "pando.ph_session_start": "1", "keep.me": "1" });
(globalThis as unknown as { window: unknown }).window = { localStorage: local, sessionStorage: sessionArea };
const storage = await load<typeof import("../lib/storage.ts")>("../lib/storage.ts");
storage.forgetThisDevice();
ok("every pando. key leaves local and session storage", Object.keys(local).every((k) => !k.startsWith("pando.")) && Object.keys(sessionArea).every((k) => !k.startsWith("pando.")), JSON.stringify([Object.keys(local), Object.keys(sessionArea)]));
ok("and nothing that is not Pando's is touched", "other.app" in local && "keep.me" in sessionArea && "ph_phc_posthog" in local);
let resets = 0;
(globalThis as unknown as { window: Record<string, unknown> }).window.posthog = { capture: () => {}, reset: () => void resets++ };
const analytics = await load<typeof import("../lib/analytics.ts")>("../lib/analytics.ts");
analytics.forgetAnalyticsIdentity();
ok("analytics gets a fresh anonymous id (posthog reset)", resets === 1);

await stop();
console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);
