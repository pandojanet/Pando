/**
 * Pando's monthly budgets, SMS and AI separately (26 Nov — the founder's Operating Playbook asks the
 * daily report for "actual AI/SMS/manual cost and budget gap"; the developer: *separate SMS and AI
 * budgets*). The founder says them in the chat and Pando MCP's `set_budget` keeps them (the audited admin
 * action `budget.set`, in `app_settings` under `BUDGET_KEY`) — not a field on /admin, so the admin stays
 * small and the number lives where the reports are read. `costs_summary` reads them beside what was spent.
 *
 * Pure and import-free, so `npm run test:budget` loads it in plain node.
 */

export const BUDGET_KEY = "monthly_budget";
/** A budget above this is a typo, not a plan. */
export const BUDGET_MAX_USD = 100_000;

export interface MonthlyBudget {
  /** US dollars a calendar month for Twilio (SMS, MMS, RCS, numbers); null when not set. */
  sms_usd: number | null;
  /** US dollars a calendar month for the AI model calls; null when not set. */
  ai_usd: number | null;
}

/** A budget as typed or stored: a number from 0 to `BUDGET_MAX_USD`, cents kept — anything else is "not set". */
export function budgetAmount(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > BUDGET_MAX_USD) return null;
  return Math.round(n * 100) / 100;
}

/** What `app_settings` holds, read safely: an unreadable value is no budget. */
export function readBudget(value: unknown): MonthlyBudget {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return { sms_usd: budgetAmount(v.sms_usd), ai_usd: budgetAmount(v.ai_usd) };
}

export interface BudgetHalf {
  budget: number;
  /** Null when the spend is not known (that half of costs_summary is not configured): the budget still shows. */
  spent: number | null;
  left: number | null;
  /** Spent as a share of the budget, 0.37 for 37%; null for a budget of 0 or an unknown spend. */
  used: number | null;
  /** At this pace, the month's total — only when the period runs from the 1st to before the month's end. */
  on_pace_for: number | null;
  over: boolean;
}

const daysIn = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * Each budget beside what was spent, for a period inside one calendar month (YYYY-MM-DD, inclusive) —
 * a budget is monthly, so a period across two months has none (null). A half with no budget set is null;
 * one whose spend is unknown keeps its budget, with the spend and what follows from it null (26 Nov: the
 * lab's reports read an all-null half as "no budget set").
 */
export function budgetStatus(input: {
  budget: MonthlyBudget;
  spent: { sms: number | null; ai: number | null };
  from: string;
  to: string;
}): { month: string; sms: BudgetHalf | null; ai: BudgetHalf | null } | null {
  const month = input.from.slice(0, 7);
  if (month !== input.to.slice(0, 7) || !/^\d{4}-\d{2}$/.test(month)) return null;
  if (input.budget.sms_usd === null && input.budget.ai_usd === null) return null;
  const days = Number(input.to.slice(8, 10)) - Number(input.from.slice(8, 10)) + 1;
  const fromFirst = input.from.endsWith("-01");
  const monthDays = daysIn(month);
  const half = (budget: number | null, spent: number | null): BudgetHalf | null => {
    if (budget === null) return null;
    if (spent === null) return { budget, spent: null, left: null, used: null, on_pace_for: null, over: false };
    const round = (x: number) => Math.round(x * 100) / 100;
    return {
      budget,
      spent: round(spent),
      left: round(budget - spent),
      used: budget > 0 ? Math.round((spent / budget) * 100) / 100 : null,
      on_pace_for: fromFirst && days > 0 && days < monthDays ? round((spent / days) * monthDays) : null,
      over: spent > budget,
    };
  };
  return { month, sms: half(input.budget.sms_usd, input.spent.sms), ai: half(input.budget.ai_usd, input.spent.ai) };
}
