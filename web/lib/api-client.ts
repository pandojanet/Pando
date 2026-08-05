"use client";

import type { InviteResult, ProfilePayload } from "./types";

/**
 * The browser only ever talks to our own route handlers. Those forward to n8n
 * server-side, so webhook URLs and tokens never reach the client bundle.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Network unavailable", 0);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(detail || `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

export function validateInvite(code: string | null): Promise<InviteResult> {
  return postJson<InviteResult>("/api/seed/invite", { code });
}

/* ── Phone verification (the gate everything else waits behind) ────────── */

export interface VerifyStatus {
  /** False when SEED_REQUIRE_VERIFICATION=0 — the pilot runs before Twilio. */
  required: boolean;
  /** False when no code could actually arrive: no credentials and no dev codes. */
  sendable: boolean;
  provisioned: boolean;
  dev_codes: boolean;
}

/**
 * Whether this deployment gates submission behind a code. Asked before the completion
 * screen offers a code box, so it never shows one that cannot be satisfied.
 */
export async function verifyStatus(): Promise<VerifyStatus> {
  const res = await fetch("/api/seed/verify/status").catch(() => null);
  if (!res) throw new ApiError("Network unavailable", 0);
  const data = (await res.json().catch(() => null)) as VerifyStatus | null;
  if (!data) throw new ApiError(`Request failed (${res.status})`, res.status);
  return data;
}

export interface VerifyStartResult {
  sent: boolean;
  /**
   * Why it wasn't sent, as an enum:
   * `not_provisioned` (no Twilio credentials yet) · `resend_limit` (three for this
   * verification) · `phone_send_limit` (the number's hourly ceiling) · `opted_out`
   * (they texted STOP) · `provider_error`.
   */
  reason?: string;
  sends: number;
  max_sends: number;
  expires_at: string;
  /** Only when SEED_VERIFY_DEV_CODES=1, so QA can walk the flow pre-approval. */
  dev_code?: string;
}

export async function startVerification(input: {
  phone: string;
  sms_consent: boolean;
}): Promise<VerifyStartResult> {
  // A 429 here is a real answer (the resend cap), not a failure to report.
  const res = await fetch("/api/seed/verify/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).catch(() => null);

  if (!res) throw new ApiError("Network unavailable", 0);
  const data = (await res.json().catch(() => null)) as VerifyStartResult | null;
  if (!data) throw new ApiError(`Request failed (${res.status})`, res.status);
  return data;
}

export interface VerifyCheckResult {
  ok: boolean;
  reason?: "unknown" | "expired" | "wrong_code" | "too_many_attempts";
  attempts_left?: number;
  verified_at?: string;
}

export async function checkVerification(code: string): Promise<VerifyCheckResult> {
  const res = await fetch("/api/seed/verify/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  }).catch(() => null);

  if (!res) throw new ApiError("Network unavailable", 0);
  const data = (await res.json().catch(() => null)) as VerifyCheckResult | null;
  if (!data) throw new ApiError(`Request failed (${res.status})`, res.status);
  return data;
}

export interface SaveProfileResult {
  ok: true;
  contributor_id: string | null;
  /** False when n8n isn't configured yet — the UI stays honest about it. */
  persisted: boolean;
}

export function saveProfile(
  payload: ProfilePayload,
): Promise<SaveProfileResult> {
  return postJson<SaveProfileResult>("/api/seed/profile", payload);
}

export interface SaveSubmissionResult {
  ok: true;
  record_id: string | null;
  persisted: boolean;
}

export interface CompleteSeedResult {
  ok: true;
  contributor_id: string | null;
  /** Always "pending_founding" — the badge is granted by an admin, not here. */
  contributor_status: string;
  persisted: boolean;
}

/** The parent finished, with their follow-up answer (estimate 1.7). */
export function completeSeed(payload: {
  invite_code: string | null;
  source: string;
  is_test: boolean;
  name: string | null;
  phone: string | null;
  follow_up_opt_in: boolean;
  monthly_contact_allowance: number;
  demand: {
    question_text: string;
    category: string | null;
    sensitivity?: string;
    may_save?: boolean;
  } | null;
  shared: Record<string, number>;
  profile_saved_at: string | null;
  started_at: string;
}): Promise<CompleteSeedResult> {
  return postJson<CompleteSeedResult>("/api/seed/complete", payload);
}

/** One finished capture card from the chat (estimate 1.4). */
export function saveSubmission(payload: {
  invite_code: string | null;
  market_id: string;
  source: string;
  is_test: boolean;
  contributor_name: string | null;
  contributor_phone: string | null;
  submission: { id: string; kind: string; fields: Record<string, unknown>; created_at: string };
}): Promise<SaveSubmissionResult> {
  return postJson<SaveSubmissionResult>("/api/seed/save", payload);
}
