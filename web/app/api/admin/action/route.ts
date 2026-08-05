import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, readToken } from "@/lib/admin/auth";
import { cleanText } from "@/lib/sanitize";
import { forwardToN8n, isHookConfigured } from "@/lib/server/n8n";

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
  "nomination.approve",
  "nomination.reject",
  "nomination.release_hold",
  "caregiver.consent",
  "caregiver.visibility",
  "caregiver.merge",
  "option.promote",
  "option.reject",
  "option.retire",
  "flag.resolve",
  "flag.escalate",
  "demand.status",
  "founding.approve",
  "founding.request_invite",
  "contributor.note",
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
  const session = readToken((await cookies()).get(ADMIN_COOKIE)?.value);
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

  if (action === "option.promote") {
    const value = typeof body?.option_value === "string" ? body.option_value : "";
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) {
      return NextResponse.json(
        { error: "A promoted option needs a lowercase, hyphenated value" },
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

  const payload = {
    ...body,
    /** Who acted. The audit row is written from this, not from the client. */
    actor: session.user,
    requested_at: new Date().toISOString(),
  };

  // Enums and ids only — never the free text an admin typed about a person.
  console.info("[admin:action]", {
    action,
    actor: session.user,
    resource_id: typeof body?.id === "string" ? body.id : null,
  });

  if (!isHookConfigured("admin_write")) {
    return NextResponse.json({ ok: true, persisted: false, actor: session.user });
  }

  const result = await forwardToN8n<{ ok?: boolean; persisted?: boolean }>(
    "admin_write",
    payload,
  );

  if (!result.forwarded) {
    console.error("[admin:action] n8n forward failed", result.error ?? result.reason);
    return NextResponse.json({ error: "That didn't go through" }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    persisted: result.data.persisted !== false,
    actor: session.user,
  });
}
