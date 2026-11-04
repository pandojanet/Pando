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
  /** More pictures sent with it, read together with it (up to `PICTURES_READ` in all) — two screenshots of one schedule are one schedule (review, 4 Nov). */
  also?: Array<{ url: string; contentType: string }>;
  /** Everything else delivered with it, never read: deleted at Twilio at once. */
  unread?: string[];
  /** A picture in a format Claude cannot read (HEIC, TIFF, BMP): answered so, and deleted. */
  unsupported?: boolean;
}

/** At most this many pictures are read together; the rest are deleted unread. */
export const PICTURES_READ = 4;

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

/* Twilio and some phones name JPEG otherwise (review, 4 Nov: "image/jpg" is on
   Twilio's own list, and such a picture was ignored without a word). */
const IMAGE_ALIASES: Record<string, string> = { "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg" };

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
  const items = Array.from({ length: count }, (_, i) => {
    const type = (params[`MediaContentType${i}`] ?? "").trim().toLowerCase().split(";")[0].trim();
    return { url: (params[`MediaUrl${i}`] ?? "").trim(), contentType: IMAGE_ALIASES[type] ?? type };
  }).filter((m) => isTwilioMediaUrl(m.url));
  const rest = (read: Array<{ url: string }>) => {
    const unread = items.filter((m) => !read.some((r) => r.url === m.url)).map((m) => m.url);
    return unread.length ? { unread } : {};
  };
  const voice =
    items.find((m) => m.contentType.startsWith("audio/")) ?? items.find((m) => m.contentType.startsWith("video/"));
  if (voice) return { ...voice, kind: "voice", ...rest([voice]) };
  const images = items.filter((m) => (IMAGE_TYPES as readonly string[]).includes(m.contentType)).slice(0, PICTURES_READ);
  if (images.length) {
    const [first, ...also] = images;
    return { ...first, kind: "image", ...(also.length ? { also } : {}), ...rest(images) };
  }
  const file = items.find((m) => (FILE_TYPES as readonly string[]).includes(m.contentType));
  if (file) return { ...file, kind: "file", ...rest([file]) };
  /* A picture Claude cannot open is still a picture they sent: said so, never ignored. */
  const other = items.find((m) => m.contentType.startsWith("image/"));
  return other ? { ...other, kind: "image", unsupported: true, ...rest([other]) } : null;
}

/** Every URL a media item carries, read or not — what is deleted at Twilio when it ends. */
export function mediaUrls(media: InboundMedia): string[] {
  return [media.url, ...(media.also ?? []).map((m) => m.url), ...(media.unread ?? [])];
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
  const flat = gsmFold(
    text
      .replace(/[‘’]/g, "'")
      .replace(/[“”"]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/…/g, "...")
      .replace(/[®™©]/g, "")
      .replace(/°/g, " degrees")
      .replace(/\s+/g, " ")
      .trim(),
  );
  if (flat.length <= READBACK_MAX) return flat;
  const cut = flat.slice(0, READBACK_MAX - 3);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > READBACK_MAX / 2 ? cut.slice(0, atWord) : cut).replace(/[\s,.;:-]+$/, "")}...`;
}

/* GSM-7's letters with accents; any other accented letter is folded to its
   base, so one "á" from a product label cannot turn the read-back into UCS-2
   and triple its cost (review, 4 Nov). Cyrillic and the like stay as they are:
   there is no folding them, and the hearing follows the speaker. */
const GSM_ACCENTED = "èéùìòÇØøÅåÆæßÉÄÖÑÜäöñüà";
function gsmFold(text: string): string {
  return [...text]
    .map((ch) => {
      if (ch.charCodeAt(0) < 128 || GSM_ACCENTED.includes(ch)) return ch;
      const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return base.length === 1 && base.charCodeAt(0) < 128 ? base : ch;
    })
    .join("");
}

/* The read-back on lines of its own (4 Nov, the developer: one run-on line
   "looks raw"): what arrived, what Pando understood, set apart, then the
   question. Line breaks are GSM-7; no emoji, which would not be. */
const WHAT: Record<MediaKind, (count: number) => string> = {
  voice: () => "voice note",
  image: (n) => (n > 1 ? `${n} pictures` : "picture"),
  file: () => "file",
};

const quoted = (kind: MediaKind, text: string, count: number, corrected: boolean) => `${
  corrected ? "Thanks. Here's what I have now:" : `Got your ${WHAT[kind](count)}. Here's what I understood:`
}

"${readBack(text)}"

`;

/**
 * The confirmation as an SMS: what to reply is in it. A correction is the
 * easier path, and the one asked for (review, 4 Nov): "or NO to type it
 * instead" sent people to retype a whole note to change one word.
 */
export function mediaConfirmSms(kind: MediaKind, text: string, count = 1, corrected = false): string {
  return `${quoted(kind, text, count, corrected)}Is that right? Reply YES, or tell me what to change.`;
}

/** The same on an RCS card, where Yes and No are buttons (`yes_no`). */
export function mediaConfirmCard(kind: MediaKind, text: string, count = 1, corrected = false): string {
  return `${quoted(kind, text, count, corrected)}Is that right? Or tell me what to change.`;
}

/** Nothing usable came back — no key, a failed fetch, silence, a picture with nothing to read. */
export const MEDIA_UNREADABLE: Record<MediaKind, string> = {
  voice: "Sorry, I couldn't make out that voice note. Could you type it instead?",
  image: "Sorry, I couldn't make out that picture. Could you tell me in a text what you'd like to know?",
  file: "Sorry, I couldn't read that file. Could you tell me in a text what you'd like to know?",
};

/**
 * Why it could not be read, in words that are true (review, 4 Nov): every
 * failure said "I couldn't make out that picture", including a picture Pando
 * had read and could not keep, and one too large to open.
 */
export type MediaFailure = "unreadable" | "too_large" | "unsupported" | "unavailable";

export function mediaFailureReason(reason: string): MediaFailure {
  if (reason === "too_large") return "too_large";
  if (reason === "unsupported") return "unsupported";
  if (reason === "not_configured" || reason === "download_failed" || reason === "not_kept") return "unavailable";
  return "unreadable";
}

export function mediaFailureSms(kind: MediaKind, failure: MediaFailure): string {
  const what = kind === "voice" ? "voice note" : kind === "image" ? "picture" : "file";
  const ask = kind === "voice" ? "Could you type it instead?" : "Could you tell me in a text what you'd like to know?";
  if (failure === "too_large") {
    return kind === "voice"
      ? "That voice note is too long for me to open. Could you type it, or send a shorter one?"
      : `That ${what} is too big for me to open. A screenshot works, or tell me in a text what you'd like to know.`;
  }
  if (failure === "unsupported") return "I can't open that kind of picture. A screenshot works, or tell me in a text what you'd like to know.";
  if (failure === "unavailable") return `Sorry, I can't open ${what}s right now. ${ask}`;
  return MEDIA_UNREADABLE[kind];
}

/** They said it was read wrong. */
export const MEDIA_REJECTED = "Sorry about that. Could you type it instead?";
