/**
 * A voice note or a picture over SMS/MMS/RCS (3 Nov) — the pure half: which
 * media it is, and what Pando says back.
 *
 * The 30 Oct brief, item 2: *"a member can send a voice note or screenshot by
 * SMS/MMS; it's transcribed and structured, and they confirm it"*. The
 * developer: read it, and confirm with the person that it was read right
 * **before** the main flow — a voice note first, then a picture ("a photo of a
 * medicine, to ask which similar ones parents recommended" was their example,
 * not the rule). So neither reaches the classifier as Pando made it out; it
 * reaches it as the person confirmed it, and a "no" sends nothing on.
 *
 * A voice note is heard by Deepgram (Claude takes no audio — text, images and
 * PDFs only, checked in the models overview on 3 Nov); a picture is read by
 * Claude (`lib/server/media-note.ts`). Neither is copied to Pando: it is
 * fetched from Twilio to be read and deleted there once the person has
 * answered "is that right?"; the words are held only until then too
 * (`media_notes`).
 *
 * Pure and import-free, so `npm run test:media` loads it in plain node.
 */

/**
 * `voice` is anything with speech in it — a voice note, or a video, whose
 * sound track is what is read (Claude takes no video); `image` a picture;
 * `file` a PDF (a flyer, a schedule), which Claude reads like a picture.
 */
export type MediaKind = "voice" | "image" | "file";

/** A media item Twilio delivered with an inbound message. */
export interface InboundMedia {
  url: string;
  contentType: string;
  kind: MediaKind;
}

/**
 * Twilio's own media URL and nothing else: the server fetches it with the
 * account's credentials, so a URL anywhere else is never followed — the request
 * is signed, and this is the second lock, not the first.
 */
export function isTwilioMediaUrl(url: string): boolean {
  return /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC[0-9a-f]{32}\/Messages\/(MM|SM)[0-9a-f]{32}\/Media\/ME[0-9a-f]{32}$/i.test(
    url,
  );
}

/** The picture formats Claude reads. A HEIC or a TIFF is not one of them. */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

/** The documents Claude reads. */
export const FILE_TYPES = ["application/pdf"] as const;

/**
 * The media to read from an inbound message, from Twilio's webhook fields
 * (`NumMedia`, `MediaUrl{N}`, `MediaContentType{N}`) — or null. Spoken words
 * win (a voice note, then a video: the words are the message), then a picture,
 * then a PDF; of several of one kind, the first is read.
 */
export function inboundMediaFrom(params: Record<string, string | undefined>): InboundMedia | null {
  const count = Math.min(Number(params.NumMedia ?? 0) || 0, 10);
  const items = Array.from({ length: count }, (_, i) => ({
    url: (params[`MediaUrl${i}`] ?? "").trim(),
    contentType: (params[`MediaContentType${i}`] ?? "").trim().toLowerCase(),
  })).filter((m) => isTwilioMediaUrl(m.url));
  const voice =
    items.find((m) => m.contentType.startsWith("audio/")) ?? items.find((m) => m.contentType.startsWith("video/"));
  if (voice) return { ...voice, kind: "voice" };
  const image = items.find((m) => (IMAGE_TYPES as readonly string[]).includes(m.contentType));
  if (image) return { ...image, kind: "image" };
  const file = items.find((m) => (FILE_TYPES as readonly string[]).includes(m.contentType));
  return file ? { ...file, kind: "file" } : null;
}

/** MMS carries at most 5 MB, and so does a picture Claude reads; anything larger is not from a phone. */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Whether a tidied transcript may be read back instead of the words as heard
 * (review, 4 Nov): it may lose fillers and stutters but keeps at least a third
 * of itself, gains a fixed word or two but not a sentence, and keeps every
 * number heard — an age, a time, a price is never changed or dropped.
 */
export function tidyKept(heard: string, tidied: string): boolean {
  if (!tidied) return false;
  if (tidied.length > Math.max(heard.length * 1.15, heard.length + 15)) return false;
  /* A third is the floor: a polite opening and fillers can be most of a short note ("Hi, Pandu. I I wanted to kindly ask you, ..."). */
  if (heard.length >= 40 && tidied.length < heard.length * 0.3) return false;
  const numbers = (t: string) => t.match(/\d+/g) ?? [];
  const after = new Set(numbers(tidied));
  return numbers(heard).every((n) => after.has(n));
}

/** A pending read-back is answered within this, or it is dropped. */
export const MEDIA_PENDING_HOURS = 24;

/**
 * How much is read back. Two minutes of speech is ~1,600 characters — eleven
 * segments — so a long note is read back as its opening and "...": enough to
 * tell whether it was heard right, which is the question.
 */
export const READBACK_MAX = 480;

/**
 * The words, made safe to quote in a text: one line, straight quotes (GSM-7 —
 * a curly quote turns the message into UCS-2 and triples its cost), cut at a
 * word with "..." when long.
 */
export function readBack(text: string): string {
  const flat = text
    .replace(/[‘’]/g, "'")
    .replace(/[“”"]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= READBACK_MAX) return flat;
  const cut = flat.slice(0, READBACK_MAX - 3);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > READBACK_MAX / 2 ? cut.slice(0, atWord) : cut).replace(/[\s,.;:-]+$/, "")}...`;
}

/* The read-back on lines of its own (4 Nov, the developer: one run-on line
   "looks raw"): what arrived, what Pando understood, set apart, then the
   question. Line breaks are GSM-7; no emoji, which would not be. */
const LEAD: Record<MediaKind, string> = {
  voice: "Got your voice note. Here's what I understood:",
  image: "Got your picture. Here's what I understood:",
  file: "Got your file. Here's what I understood:",
};

const quoted = (kind: MediaKind, text: string) => `${LEAD[kind]}

"${readBack(text)}"

`;

/** The confirmation as an SMS: what to reply is in it. */
export function mediaConfirmSms(kind: MediaKind, text: string): string {
  return `${quoted(kind, text)}Is that right? Reply YES to go ahead, or NO to type it instead.`;
}

/** The same on an RCS card, where Yes and No are buttons (`yes_no`). */
export function mediaConfirmCard(kind: MediaKind, text: string): string {
  return `${quoted(kind, text)}Is that right?`;
}

/** Nothing usable came back — no key, a failed fetch, silence, a picture with nothing to read. */
export const MEDIA_UNREADABLE: Record<MediaKind, string> = {
  voice: "Sorry, I couldn't make out that voice note. Could you type it instead?",
  image: "Sorry, I couldn't make out that picture. Could you tell me in a text what you'd like to know?",
  file: "Sorry, I couldn't read that file. Could you tell me in a text what you'd like to know?",
};

/** They said it was read wrong. */
export const MEDIA_REJECTED = "Sorry about that. Could you type it instead?";
