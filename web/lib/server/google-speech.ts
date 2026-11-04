import "server-only";
import { createSign } from "node:crypto";
import type { ReadResult } from "@/lib/server/media-note";

/**
 * A voice note heard by Google Speech-to-Text v2, `chirp_3` (4 Nov) — beside
 * Deepgram, not instead of it: the developer, after a Ukrainian note came back
 * from Deepgram with no words, *"keep Deepgram, but add Google too, to
 * compare"*. Both hear every note; `lib/server/media-note.ts` decides whose
 * words are read back.
 *
 * Same shape as `geocode.ts` and `stripe.ts`: plain `fetch`, no SDK. Speech v2
 * takes no API key — its reference names only an OAuth token with the
 * `cloud-platform` scope — so the service account's key signs a JWT here and
 * trades it for a token, which is kept until shortly before it expires.
 *
 * Limits (Google's sync-recognize page): under 60 seconds and 10 MB per
 * request. A longer note is refused by Google and Deepgram's reading stands.
 * Counts and enums in the logs only — never the words (invariant 7), never the
 * key.
 */

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

/* `us` multi-region: `chirp_3` is GA in `us` and `eu` only. */
const LOCATION = "us";
const MODEL = "chirp_3";
/* The languages a parent here is likely to speak — the same four Deepgram's
   first pass detects among. Chirp 3 picks the most prevalent one. */
const LANGUAGES = ["en-US", "es-US", "uk-UA", "ru-RU"];

/** `GOOGLE_SPEECH_CREDENTIALS`: the service account's JSON key, as JSON or base64 of it. */
function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SPEECH_CREDENTIALS?.trim();
  if (!raw) return null;
  try {
    const json = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as Partial<ServiceAccount>;
    return json.client_email && json.private_key && json.project_id
      ? { client_email: json.client_email, private_key: json.private_key, project_id: json.project_id }
      : null;
  } catch {
    return null;
  }
}

export function googleSpeechConfigured(): boolean {
  return serviceAccount() !== null;
}

let cached: { token: string; until: number } | null = null;

async function accessToken(account: ServiceAccount): Promise<string | null> {
  if (cached && cached.until > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${part({ alg: "RS256", typ: "JWT" })}.${part({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  try {
    const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn("[media] google token refused", { status: res.status });
      return null;
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    cached = { token: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return data.access_token;
  } catch {
    console.warn("[media] google token refused", { status: "error" });
    return null;
  }
}

type RecognizeReply = {
  results?: Array<{
    alternatives?: Array<{ transcript?: string; confidence?: number }>;
    resultEndOffset?: string;
    languageCode?: string;
  }>;
  error?: { status?: string };
};

/** "3.500s" → 3.5 */
const seconds = (offset: string | undefined): number | null => {
  const n = Number.parseFloat(offset ?? "");
  return Number.isFinite(n) ? n : null;
};

export async function transcribeWithGoogle(bytes: ArrayBuffer, contentType: string): Promise<ReadResult> {
  const account = serviceAccount();
  if (!account) return { ok: false, reason: "not_configured" };
  const token = await accessToken(account);
  if (!token) return { ok: false, reason: "read_failed" };
  try {
    const res = await fetch(
      `https://${LOCATION}-speech.googleapis.com/v2/projects/${account.project_id}/locations/${LOCATION}/recognizers/_:recognize`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          config: {
            autoDecodingConfig: {},
            model: MODEL,
            languageCodes: LANGUAGES,
            features: { enableAutomaticPunctuation: true },
          },
          content: Buffer.from(bytes).toString("base64"),
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as RecognizeReply;
    if (!res.ok) {
      console.warn("[media] transcription refused", { provider: "google", status: res.status, reason: data.error?.status ?? null });
      return { ok: false, reason: "read_failed" };
    }
    const results = data.results ?? [];
    const text = results
      .map((r) => (r.alternatives?.[0]?.transcript ?? "").trim())
      .filter(Boolean)
      .join(" ");
    const confidence = results[0]?.alternatives?.[0]?.confidence;
    const durationSec = seconds(results.at(-1)?.resultEndOffset);
    /* The shape, never the words (invariant 7). */
    console.info("[media] heard", {
      provider: "google",
      type: contentType,
      kb: Math.round(bytes.byteLength / 1024),
      seconds: durationSec,
      language: results.find((r) => r.languageCode)?.languageCode ?? null,
      model: MODEL,
      chars: text.length,
    });
    if (!text) return { ok: false, reason: "empty" };
    /* 0 is Google's "not set", not a confidence. */
    return { ok: true, text, confidence: confidence ? confidence : null, durationSec };
  } catch {
    console.warn("[media] transcription failed", { provider: "google" });
    return { ok: false, reason: "read_failed" };
  }
}
