/**
 * Every admin action's name, in one list (27 Oct).
 *
 * `/api/admin/action` refuses a name that is not here; `AdminAction` in
 * `types.ts` must name exactly these (a compile-time check there); and
 * `admin-write.ts`'s switch is exhaustive over them. A name typed in one place
 * and not the others no longer compiles — until now the three were kept in
 * step by hand (2 Sep: eight buttons answered 400 because the set lagged).
 *
 * Pure and import-free.
 */
export const ADMIN_ACTION_NAMES = [
  "contribution.approve",
  "contribution.needs_detail",
  "contribution.reject",
  "contribution.edit",
  "share.answer_ready",
  /* 4 Oct — a record's own name, for everyone who shared it. */
  "share.rename",
  /* 14.9 — the two ways out of the freshness queue. */
  "share.retire",
  "share.keep",
  /**
   * M5's answer queue and M7's blast loop (2 Sep).
   *
   * All eight were implemented in `admin-write.ts` and wired to buttons on
   * `/admin/answers` and `/admin/responses`, and **none of them was in this
   * set** — so every one of those buttons answered `400 Unknown action`, and
   * the two queues could not be worked at all. Found by diffing the switch
   * against this list; the fix is the list, since the implementations were
   * already there and already audited.
   */
  "answer.approve",
  "answer.send",
  "answer.reject",
  "answer.edit",
  /* 7.1's entry (7 Sep). `createBlast` had no caller at all before it. */
  "blast.create",
  "blast.send",
  /* M7's exit — the approved replies, back to the parent who asked (8 Sep). */
  "blast.deliver",
  /* 14.3 — the blast manager's verbs. */
  "blast.release",
  "blast.fulfil",
  "blast_response.rate",
  "blast_response.approve",
  "blast_response.reject",
  "nomination.approve",
  "nomination.reject",
  "nomination.release_hold",
  "caregiver.consent",
  "caregiver.visibility",
  "caregiver.merge",
  "invite.create",
  "invite.retire",
  "invite.restore",
  "option.promote",
  "option.reject",
  "option.retire",
  "flag.resolve",
  "flag.escalate",
  "demand.status",
  "matching.weight",
  "matching.relevance_step",
  "founding.approve",
  "founding.request_invite",
  /* 13 Oct — the way back from "Not Founding", which had none. */
  "founding.reopen",
  "contributor.note",
  "contributor.reward_paid",
  "claim.link",
  "claim.decline",
  "claim.delete",
  "referral.link",
  "referral.void",
  "person.link",
  "person.unlink",
  /* Introductions — parent to parent (21 Oct). */
  "intro.approve",
  "intro.reject",
  "intro.contacted",
  "intro.connected",
  "intro.declined",
] as const;

export type AdminActionName = (typeof ADMIN_ACTION_NAMES)[number];

const NAMES: ReadonlySet<string> = new Set(ADMIN_ACTION_NAMES);

export function isAdminActionName(value: unknown): value is AdminActionName {
  return typeof value === "string" && NAMES.has(value);
}
