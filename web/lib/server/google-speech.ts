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
 * Without a service account, a plain console key (`GOOGLE_SPEECH_API_KEY`)
 * reaches the older v1 API instead (`transcribeV1`): an older model, and only
 * the encodings v1 names.
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
   first pass detects among. v1 is told them; Chirp 3 detects on its own ("auto"). */
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

/**
 * `GOOGLE_SPEECH_API_KEY` (4 Nov, the developer: *"use the older API for now,
 * and improve it later if needed"*): a plain key from the console, for the v1
 * API. Google's Speech docs name only OAuth for v1 too, so a key is
 * undocumented — the first request says whether it is taken (a 401/403 in the
 * log). The service account wins when both are set.
 */
function apiKey(): string | null {
  return process.env.GOOGLE_SPEECH_API_KEY?.trim() || null;
}

export function googleSpeechConfigured(): boolean {
  return serviceAccount() !== null || apiKey() !== null;
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
  error?: { status?: string; message?: string; details?: Array<{ fieldViolations?: Array<{ field?: string; description?: string }> }> };
};

/** "3.500s" → 3.5 */
const seconds = (offset: string | undefined): number | null => {
  const n = Number.parseFloat(offset ?? "");
  return Number.isFinite(n) ? n : null;
};

/**
 * v1 decodes only what it is told, and a phone's voice note is told by its
 * content type. Encoding and sample rate are required for all but FLAC and
 * WAV; AMR is 8000 Hz and AMR-WB 16000 by definition, and Opus is 48000 inside
 * its container. v1 has no MP4, M4A, AAC or 3GP encoding at all, and MP3 only
 * in v1p1beta1 — those are refused here, and Deepgram's reading stands.
 */
const V1_ENCODINGS: Record<string, { encoding?: string; sampleRateHertz?: number }> = {
  "audio/amr": { encoding: "AMR", sampleRateHertz: 8000 },
  "audio/amr-wb": { encoding: "AMR_WB", sampleRateHertz: 16000 },
  "audio/ogg": { encoding: "OGG_OPUS", sampleRateHertz: 48000 },
  "audio/opus": { encoding: "OGG_OPUS", sampleRateHertz: 48000 },
  "audio/webm": { encoding: "WEBM_OPUS", sampleRateHertz: 48000 },
  "audio/wav": {},
  "audio/x-wav": {},
  "audio/wave": {},
  "audio/flac": {},
  "audio/x-flac": {},
};

type V1Reply = {
  results?: Array<{
    alternatives?: Array<{ transcript?: string; confidence?: number }>;
    resultEndTime?: string;
    languageCode?: string;
  }>;
  error?: { status?: string; message?: string; details?: Array<{ fieldViolations?: Array<{ field?: string; description?: string }> }> };
};

async function transcribeV1(bytes: ArrayBuffer, contentType: string, key: string, places: string[]): Promise<ReadResult> {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const decoding = V1_ENCODINGS[type];
  if (!decoding) {
    console.warn("[media] google v1 cannot decode", { type });
    return { ok: false, reason: "read_failed" };
  }
  try {
    const res = await fetch("https://speech.googleapis.com/v1/speech:recognize", {
      method: "POST",
      headers: { "x-goog-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        config: {
          ...decoding,
          /* Up to three alternatives beside the main language; the result is
             in the most likely of the four. No `model`: the default one, which
             Google's docs put no restriction on for alternative languages. */
          languageCode: LANGUAGES[0],
          alternativeLanguageCodes: LANGUAGES.slice(1),
          enableAutomaticPunctuation: true,
          /* Words it should expect: the service's name ("Hi, Pandu" otherwise)
             and the market's places. Phrases bias the hearing, never force it. */
          speechContexts: [{ phrases: ["Pando", ...places].slice(0, 500) }],
        },
        audio: { content: Buffer.from(bytes).toString("base64") },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as V1Reply;
    if (!res.ok) {
      console.warn("[media] transcription refused", { provider: "google-v1", status: res.status, reason: data.error?.status ?? null });
      return { ok: false, reason: "read_failed" };
    }
    return heardFrom("google-v1", data.results ?? [], (r) => r.resultEndTime, bytes, type);
  } catch {
    console.warn("[media] transcription failed", { provider: "google-v1" });
    return { ok: false, reason: "read_failed" };
  }
}

/** The words of either version's results, and the one log line about them. */
function heardFrom<R extends { alternatives?: Array<{ transcript?: string; confidence?: number }>; languageCode?: string }>(
  provider: "google" | "google-v1",
  results: R[],
  endOf: (r: R) => string | undefined,
  bytes: ArrayBuffer,
  contentType: string,
): ReadResult {
  const text = results
    .map((r) => (r.alternatives?.[0]?.transcript ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const confidence = results[0]?.alternatives?.[0]?.confidence;
  const last = results.at(-1);
  const durationSec = seconds(last ? endOf(last) : undefined);
  /* The shape, never the words (invariant 7). */
  console.info("[media] heard", {
    provider,
    type: contentType,
    kb: Math.round(bytes.byteLength / 1024),
    seconds: durationSec,
    language: results.find((r) => r.languageCode)?.languageCode ?? null,
    model: provider === "google" ? MODEL : "default",
    chars: text.length,
  });
  if (!text) return { ok: false, reason: "empty" };
  /* 0 is Google's "not set", not a confidence. */
  return { ok: true, text, confidence: confidence ? confidence : null, durationSec };
}

export async function transcribeWithGoogle(bytes: ArrayBuffer, contentType: string, places: string[] = []): Promise<ReadResult> {
  const account = serviceAccount();
  if (!account) {
    const key = apiKey();
    return key ? transcribeV1(bytes, contentType, key, places) : { ok: false, reason: "not_configured" };
  }
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
            /* "auto": Chirp 3 detects the language itself, among all it knows (5 Nov). A list
               was refused: four by name ("Maximum number of allowed language codes is 3"),
               and any three with a bare INVALID_ARGUMENT — probed one at a time, only one or
               two codes pass. Two would drop Ukrainian or Russian; "auto" keeps all four.
               v1 still takes a main + three (`transcribeV1`). */
            languageCodes: ["auto"],
            features: { enableAutomaticPunctuation: true },
          },
          content: Buffer.from(bytes).toString("base64"),
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = (await res.json().catch(() => ({}))) as RecognizeReply;
    if (!res.ok) {
      /* Google's own message too: it names the field it refused, never anything the parent said. */
      console.warn("[media] transcription refused", { provider: "google", status: res.status, reason: data.error?.status ?? null, detail: data.error?.message?.slice(0, 300) ?? null, fields: (data.error?.details ?? []).flatMap((d) => d.fieldViolations ?? []).map((v) => `${v.field}: ${v.description}`.slice(0, 200)), details: JSON.stringify(data.error?.details ?? []).slice(0, 400) });
      return { ok: false, reason: "read_failed" };
    }
    return heardFrom("google", data.results ?? [], (r) => r.resultEndOffset, bytes, contentType);
  } catch {
    console.warn("[media] transcription failed", { provider: "google" });
    return { ok: false, reason: "read_failed" };
  }
}
