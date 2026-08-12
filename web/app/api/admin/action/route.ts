import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/admin/auth";
import { readAdminSession } from "@/lib/server/admin-auth";
import { cleanText } from "@/lib/sanitize";
import { withDb } from "@/lib/server/db";
import { invalidateOptions } from "@/lib/server/market-cache";
import { invalidateInvites } from "@/lib/server/invite-cache";
import { applyAction } from "@/lib/server/repo/admin-write";

/**
 * POST /api/admin/action — one write endpoint for every sensitive admin action
 * (estimates 2.4–2.8). One place that checks the session, stamps *who* acted, and
 * therefore one place that cannot forget to write an audit_log row.
 *
 * Two rules are enforced here rather than left to the workflow:
 *
 *  - **Consent needs evidence.** Moving a caregiver to `consented` requires a
 *    recorded method, and the two methods that leave no artefact of their own
 *    (a phone call, an in-person yes) additionally require a note. Referral of
 *    caregivers needs an auditable trail, not an admin checkbox.
 *  - **A merge is explicit.** Duplicate candidates are suggestions; merging names
 *    the surviving record and the ones folded into it, and never happens implicitly.
 *  - **Releasing a review hold needs a reason.** A hold exists because a parent
 *    hesitated about a named person. Clearing it is a decision, so it carries a note
 *    and an actor into the audit log — never a bare button press.
 *  - **Visibility only ever increases here, and never past consent.** `active` and
 *    `discoverable` are refused unless the caregiver has consented; the database
 *    would refuse them too, but a readable error beats a constraint violation.
 *  - **Promoting an "other" answer supplies its slug.** Matching keys on the option
 *    value, so it is chosen deliberately at promotion rather than derived twice.
 */

const ACTIONS = new Set([
  "contribution.approve",
  "contribution.needs_detail",
  "contribution.reject",
  "contribution.edit",
  "place.answer_ready",
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
  "founding.approve",
  "founding.request_invite",
  "contributor.note",
  "claim.link",
  "claim.decline",
  "claim.delete",
  "referral.link",
  "referral.void",
]);

/** The ladder, as the only transitions this endpoint will forward. */
const CONSENT_TARGETS = new Set([
  "mentioned",
  "invited",
  "consented",
  "declined",
  "revoked",
]);

const DEMAND_STATES = new Set(["open", "matched", "answered", "closed"]);

const CONSENT_METHODS = new Set([
  "sms_reply",
  "signed_link",
  "call_logged",
  "in_person",
]);
/** These leave no artefact by themselves, so the note *is* the evidence. */
const METHODS_NEEDING_NOTE = new Set(["call_logged", "in_person"]);

export async function POST(request: Request) {
  const session = await readAdminSession(
    (await cookies()).get(ADMIN_COOKIE)?.value,
  );
  if (!session) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (action === "caregiver.consent") {
    const to = body?.to;
    const method = typeof body?.method === "string" ? body.method : "";
    const note = cleanText(body?.note, 500);

    if (to === "consented") {
      if (!CONSENT_METHODS.has(method)) {
        return NextResponse.json(
          { error: "Recording consent requires how it was given" },
          { status: 422 },
        );
      }
      if (METHODS_NEEDING_NOTE.has(method) && !note) {
        return NextResponse.json(
          { error: "A call or in-person yes needs a note — that note is the evidence" },
          { status: 422 },
        );
      }
    }
  }

  if (action === "caregiver.consent" && !CONSENT_TARGETS.has(String(body?.to))) {
    return NextResponse.json({ error: "Unknown consent state" }, { status: 422 });
  }

  /**
   * Visibility is meaningless without consent, and the app should say so in words
   * rather than let the CHECK constraint answer with a Postgres error.
   */
  if (action === "caregiver.visibility") {
    const wantsOn =
      body?.active === true || body?.discoverable === true || body?.introducible === true;
    // The caller states the consent it believes it saw, and we refuse anything else.
    // A missing value is refused too — the check has to be able to fail, or it isn't
    // one. (The database would refuse it as well; this is the readable half.)
    if (wantsOn && body?.consent_status !== "consented") {
      return NextResponse.json(
        { error: "A caregiver can only be shown after they have consented" },
        { status: 422 },
      );
    }
    if (body?.introducible === true && body?.discoverable === false) {
      return NextResponse.json(
        { error: "Introducible implies discoverable — raise that first" },
        { status: 422 },
      );
    }
  }

  /** A hold exists because a parent hesitated. Clearing it needs a reason. */
  if (action === "nomination.release_hold") {
    const note = cleanText(body?.note, 500);
    if (!note || note.length < 3) {
      return NextResponse.json(
        { error: "Releasing a hold needs a note — your name goes on it" },
        { status: 422 },
      );
    }
  }

  /** "Needs more detail" is a question, so there has to be a question. */
  if (action === "contribution.needs_detail") {
    const question = cleanText(body?.question, 300);
    if (!question) {
      return NextResponse.json(
        { error: "Ask something — this goes to the parent as a question" },
        { status: 422 },
      );
    }
  }

  /**
   * An invite code goes in a URL and gets typed by hand off a QR card, so it is
   * held to the same shape as every other id a person can type. The label is what
   * the parent reads back ("You joined through …"), so an empty one would produce
   * a sentence with a hole in it.
   */
  if (action === "invite.create") {
    const code = typeof body?.code === "string" ? body.code : "";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(code)) {
      return NextResponse.json(
        { error: "A code needs to be lowercase and hyphenated — it goes in a link" },
        { status: 422 },
      );
    }
    if (!cleanText(body?.label, 80)) {
      return NextResponse.json(
        { error: "Name the group — the parent sees this, not the code" },
        { status: 422 },
      );
    }
  }

  if (action === "option.promote") {
    const value = typeof body?.option_value === "string" ? body.option_value : "";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
      return NextResponse.json(
        { error: "A promoted option needs a lowercase, hyphenated value" },
        { status: 422 },
      );
    }
  }

  /**
   * A referral needs two different people. Self-referral is the one shape that
   * would quietly corrupt the count Janet reads, so it is refused in words here
   * rather than left to look like a successful link.
   */
  if (action === "referral.link") {
    const referrer = typeof body?.referrer === "string" ? body.referrer : "";
    const referred = typeof body?.referred === "string" ? body.referred : "";
    if (!referrer || !referred) {
      return NextResponse.json(
        { error: "A referral needs both the parent who invited and the one who came" },
        { status: 422 },
      );
    }
    if (referrer === referred) {
      return NextResponse.json(
        { error: "A parent cannot have invited themselves" },
        { status: 422 },
      );
    }
  }

  /** Declining somebody's registration is a decision, so it carries a reason. */
  if (action === "claim.decline") {
    const reason = cleanText(body?.reason, 300);
    if (!reason) {
      return NextResponse.json(
        { error: "Say why — this is a person who asked to be listed" },
        { status: 422 },
      );
    }
  }

  /**
   * A deletion is the one action here that cannot be undone by another action, so
   * it records *how the person asked* — the flow promises "text DELETE", and once
   * the SMS channel is live that string is the only evidence the request was real.
   * No reason is asked for: the same promise says "without asking why".
   */
  if (action === "claim.delete") {
    const via = cleanText(body?.requested_via, 120);
    if (!via) {
      return NextResponse.json(
        { error: "Record how they asked — a text, an email, a call" },
        { status: 422 },
      );
    }
  }

  if (action === "demand.status" && !DEMAND_STATES.has(String(body?.to))) {
    return NextResponse.json({ error: "Unknown demand state" }, { status: 422 });
  }

  if (action === "caregiver.merge") {
    const keep = typeof body?.keep === "string" ? body.keep : "";
    const merge = Array.isArray(body?.merge) ? (body.merge as unknown[]) : [];
    if (!keep || merge.length === 0 || merge.includes(keep)) {
      return NextResponse.json(
        { error: "A merge needs one record to keep and at least one other to fold in" },
        { status: 422 },
      );
    }
  }

  // Enums and ids only — never the free text an admin typed about a person.
  console.info("[admin:action]", {
    action,
    actor: session.user,
    resource_id: typeof body?.id === "string" ? body.id : null,
  });

  const result = await withDb((db) =>
    applyAction(db, {
      /** Who acted. The audit row is written from this, never from the client. */
      actor: session.user,
      action,
      body: body ?? {},
    }),
  );

  if (!result.persisted) {
    if (result.reason === "unconfigured") {
      return NextResponse.json({ ok: true, persisted: false, actor: session.user });
    }
    return NextResponse.json({ error: "That didn't go through" }, { status: 502 });
  }

  /**
   * An action the endpoint accepts but cannot yet carry out answers 501 rather
   * than a cheerful `persisted: true`. An admin who clicked something must never
   * be told it worked when nothing happened.
   */
  if (!result.data.applied) {
    return NextResponse.json(
      { error: "That action isn't implemented yet", reason: "not_implemented" },
      { status: 501 },
    );
  }

  /**
   * The tap lists are read at request time and cached for a minute, so a write
   * that changes them clears that cache — otherwise an admin promotes an option,
   * reloads the questionnaire, sees nothing and concludes the button is broken.
   *
   * **After the commit, never before.** Clearing first leaves a window where a
   * read repopulates the cache with pre-write rows and then serves them for the
   * full minute — the exact staleness this is here to prevent.
   */
  if (action.startsWith("option.")) invalidateOptions();
  /* Same rule for the codes: an admin's next move after creating an invite is to
     open the link and check it works. */
  if (action.startsWith("invite.")) invalidateInvites();

  return NextResponse.json({ ok: true, persisted: true, actor: session.user });
}
