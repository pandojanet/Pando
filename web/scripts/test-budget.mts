/**
 * The monthly SMS and AI budgets (26 Nov): what counts as a budget, how a
 * stored one is read, each half beside its spend, and the wiring around it —
 * the admin action, the refusal, the connector's costs_summary, the admin card.
 */
import fs from "node:fs";

let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
};
const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const b = (await import(`../lib/budget.ts?v=${Date.now()}`)) as typeof import("../lib/budget.ts");

console.log("\nbudgetAmount");
ok("a number is kept", b.budgetAmount(250) === 250);
ok("a typed string is read", b.budgetAmount(" 120.5 ") === 120.5);
ok("cents kept, beyond them rounded", b.budgetAmount(10.129) === 10.13);
ok("zero is a budget", b.budgetAmount(0) === 0);
ok("the ceiling is a budget", b.budgetAmount(b.BUDGET_MAX_USD) === b.BUDGET_MAX_USD);
ok("above the ceiling is not", b.budgetAmount(b.BUDGET_MAX_USD + 1) === null);
ok("negative is not", b.budgetAmount(-5) === null);
ok("empty, null, words, NaN, Infinity are not", [" ", "", null, undefined, "ten", NaN, Infinity, {}].every((v) => b.budgetAmount(v) === null));

console.log("\nreadBudget");
ok("a stored pair", JSON.stringify(b.readBudget({ sms_usd: 50, ai_usd: 200 })) === JSON.stringify({ sms_usd: 50, ai_usd: 200 }));
ok("nothing stored is no budget", JSON.stringify(b.readBudget(null)) === JSON.stringify({ sms_usd: null, ai_usd: null }));
ok("a broken half is not set, the other kept", JSON.stringify(b.readBudget({ sms_usd: "x", ai_usd: 30 })) === JSON.stringify({ sms_usd: null, ai_usd: 30 }));
ok("not an object is no budget", b.readBudget("50").sms_usd === null && b.readBudget(7).ai_usd === null);

console.log("\nbudgetStatus");
const both = { sms_usd: 100, ai_usd: 300 };
const s = b.budgetStatus({ budget: both, spent: { sms: 40, ai: 75 }, from: "2026-11-01", to: "2026-11-10" });
ok("the month named", s?.month === "2026-11");
ok("SMS left and used", s?.sms?.left === 60 && s?.sms?.used === 0.4 && s?.sms?.over === false);
ok("AI left and used", s?.ai?.left === 225 && s?.ai?.used === 0.25);
ok("the pace: 10 days of 30 → ×3", s?.sms?.on_pace_for === 120 && s?.ai?.on_pace_for === 225);
const over = b.budgetStatus({ budget: both, spent: { sms: 130.456, ai: 10 }, from: "2026-11-01", to: "2026-11-25" });
ok("over, and left goes negative", over?.sms?.over === true && over?.sms?.left === -30.46 && over?.sms?.spent === 130.46);
ok("a whole month has no pace", b.budgetStatus({ budget: both, spent: { sms: 1, ai: 1 }, from: "2026-11-01", to: "2026-11-30" })?.sms?.on_pace_for === null);
ok("a period not from the 1st has no pace", b.budgetStatus({ budget: both, spent: { sms: 1, ai: 1 }, from: "2026-11-05", to: "2026-11-10" })?.ai?.on_pace_for === null);
ok("February counts its own days", b.budgetStatus({ budget: both, spent: { sms: 14, ai: 0 }, from: "2026-02-01", to: "2026-02-14" })?.sms?.on_pace_for === 28);
ok("across two months: none", b.budgetStatus({ budget: both, spent: { sms: 1, ai: 1 }, from: "2026-10-20", to: "2026-11-10" }) === null);
ok("no budget at all: none", b.budgetStatus({ budget: { sms_usd: null, ai_usd: null }, spent: { sms: 1, ai: 1 }, from: "2026-11-01", to: "2026-11-02" }) === null);
const one = b.budgetStatus({ budget: { sms_usd: null, ai_usd: 50 }, spent: { sms: 9, ai: 5 }, from: "2026-11-01", to: "2026-11-02" });
ok("one half set: the other is null", one?.sms === null && one?.ai?.left === 45);
ok("unknown spend (not USD): that half null", b.budgetStatus({ budget: both, spent: { sms: null, ai: 5 }, from: "2026-11-01", to: "2026-11-02" })?.sms === null);
ok("a zero budget: used is null, any spend is over", (() => {
  const z = b.budgetStatus({ budget: { sms_usd: 0, ai_usd: null }, spent: { sms: 1, ai: 0 }, from: "2026-11-01", to: "2026-11-02" });
  return z?.sms?.used === null && z?.sms?.over === true;
})());

console.log("\nwiring");
const names = read("lib/admin/action-names.ts");
const types = read("lib/admin/types.ts");
const write = read("lib/server/repo/admin-write.ts");
const route = read("app/api/admin/action/route.ts");
const server = read("lib/server/mcp/server.ts");
const adminRead = read("lib/server/repo/admin-read.ts");
const page = read("app/(admin)/admin/page.tsx");
ok("budget.set is an admin action", names.includes('"budget.set"') && /action: "budget\.set"; sms_usd: number \| null; ai_usd: number \| null/.test(types));
ok("the action validates with budgetAmount and refuses a bad amount", /case "budget\.set"[\s\S]{0,600}budgetAmount\(b\.sms_usd\)[\s\S]{0,400}invalid_budget/.test(write));
ok("it writes app_settings under BUDGET_KEY, audited as app_setting", /case "budget\.set"[\s\S]{0,1200}insert into app_settings[\s\S]{0,400}resource: "app_setting", resource_id: BUDGET_KEY/.test(write));
ok("the refusal has words", /invalid_budget: "/.test(route));
ok("costs_summary returns the budget status", /budget: budgetStatus\(/.test(server) && /readBudget\(/.test(server));
ok("an SMS spend not in dollars is not compared", /const usd = \(costs\.sms\.currency \?\? "USD"\) === "USD"/.test(server));
ok("the overview reads the budget", /budget: readBudget\(/.test(adminRead) && /budget: \{ sms_usd: number \| null; ai_usd: number \| null \}/.test(types));
ok("the admin card saves both halves", /<BudgetCard budget=\{o\.budget\}/.test(page) && /action: "budget\.set"/.test(page));
ok("a cleared field saves as no budget, not zero", /smsNow\.trim\(\) === "" \? null/.test(page) && /aiNow\.trim\(\) === "" \? null/.test(page));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
