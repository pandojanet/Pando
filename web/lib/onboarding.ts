/**
 * M5.9 + M5.4 — the parent who texts Pando cold, and the one question at a time
 * that turns them into somebody it can match.
 *
 * ## Why a cold inbound is answered before anything is asked
 *
 * 5.9 is explicit: they are "answered immediately with clearly-labeled public
 * information — **never gated** — and the label itself explains why a profile is
 * worth having". The person on the other end typically arrived from a forwarded
 * answer, which means their entire impression of Pando is the next message. A
 * form would be the wrong one.
 *
 * So the order is: answer, then ask **one** thing, and only when the answer would
 * actually be better for knowing it. The full tap-through profile is not
 * requested until they try to use their free Ask — "framed as an unlock rather
 * than a restriction", which is the estimate's own wording and a real difference
 * in how the same sentence reads.
 *
 * ## Why the questions are ordered, and why there are only two
 *
 * A child's age and a neighborhood are what `matching.ts` needs before it can
 * rank anybody: the age band and the area are two of the seven weighted signals,
 * and without either the pool is everybody. Everything else the seed profile
 * collects makes matching *better*; these two make it possible.
 *
 * Age first, because it changes what an answer should even contain — a toddler
 * question and a teenager question are different questions about the same class.
 *
 * ## The profile is built over SMS, not on the web (21 Oct)
 *
 * The client: a person texts Pando, the bot asks their name, the children's
 * ages and so on, and the profile exists without a trip to the website —
 * *"no one will do that"*. So two more questions follow the two that make
 * matching possible: their **first name**, then **how many requests** they are
 * willing to receive (P14 over SMS). The order stays answer-first and one at a
 * time, in her words: *"mind if I ask one more thing so I can give you a better
 * answer?"*. The first question rides on an answer; each reply to one is
 * thanked and the next is asked in the same message, so a parent who keeps
 * answering has a profile four texts later, and one who stops has still given
 * what they gave.
 */

/* No runtime imports: this module is loaded directly by `test:onboarding` and
   `test:intent` under plain Node, which cannot resolve an extensionless
   specifier. The participation level's reader and confirmation live in
   `outreach-policy.ts` and are applied by the server (`inbound.ts`,
   `repo/onboarding.ts`); the weekly number below is pinned to it by the suite. */

export type ClarifyingQuestion = "child_age" | "neighborhood" | "first_name" | "participation";

/** What Pando knows about somebody so far. */
export interface KnownProfile {
  /** Birth years from `children`. Empty means it has never been asked. */
  child_birth_years: number[];
  neighborhood: string | null;
  /**
   * A place they gave on the web profile that no admin has approved yet
   * (`raw_answers.other.neighborhood`, 24 Sep) — "New York, NY". Not
   * matchable (invariant 9), but it *is* an answer: asking a parent where they
   * live after they told us is the question Pando must not repeat.
   */
  pending_place?: string | null;
  /**
   * `people.first_name`; null asks for it. **Absent (undefined) means "not
   * known to the caller" and is never asked** — a caller that did not read the
   * column must not make Pando ask a parent who gave their name on `/join`.
   */
  first_name?: string | null;
  /**
   * Whether they have chosen how many requests to receive (P14 or SETTINGS).
   * False asks; absent never asks, for the same reason as `first_name`.
   */
  allowance_chosen?: boolean;
}

/**
 * The one question worth asking next, or null when Pando has enough.
 *
 * **One at a time, always.** Two questions in a text message get one answer, and
 * then Pando has to guess which — so the second is asked after the first is
 * answered, or not at all if the parent stops replying. Somebody who answers one
 * and ignores the next has still made Pando better than it was.
 */
export function nextQuestion(profile: KnownProfile): ClarifyingQuestion | null {
  if (profile.child_birth_years.length === 0) return "child_age";
  if (!profile.neighborhood && !profile.pending_place) return "neighborhood";
  if (profile.first_name === null) return "first_name";
  if (profile.allowance_chosen === false) return "participation";
  return null;
}

/** The profile as it stands once `question` has been answered — for asking the next one. */
export function withAnswer(profile: KnownProfile, question: ClarifyingQuestion, text: string): KnownProfile {
  switch (question) {
    case "child_age": {
      const year = new Date().getFullYear();
      return { ...profile, child_birth_years: parseAges(text).map((a) => year - Math.max(0, a)) };
    }
    case "neighborhood":
      /* The parsed id is the repo's to compute; any non-empty value closes it. */
      return { ...profile, neighborhood: profile.neighborhood ?? "answered" };
    case "first_name":
      return { ...profile, first_name: parseFirstName(text) };
    case "participation":
      return { ...profile, allowance_chosen: true };
  }
}

/**
 * The wording.
 *
 * Kept here rather than in `sms-templates.ts` because these are **not registered
 * copy** — they are conversational, they will be rewritten as the pilot learns
 * what parents actually answer, and a change to one does not need a carrier
 * sample re-registered. `sms-templates.ts` is for the messages where a reword is
 * a compliance event; this is not one of those.
 *
 * Each explains why it is being asked. A bare "how old is your child?" from a
 * phone number reads as a form; the reason is what makes it read as a person.
 *
 * ## And it is written in GSM-7, which cost a punctuation mark
 *
 * The age question carried an em dash, which is the house voice and is **not in
 * GSM-7** — so the message it rides in fell to UCS-2 and the budget from 160
 * characters to 70. Measured with `planSegments`: the acknowledgement plus this
 * question is 194 characters and **three** segments with the dash, and 193
 * characters and **two** with a comma. That is a third of the cost of the most
 * frequently sent message in the onboarding path, for one character nobody will
 * miss. Safe to change precisely because this copy is *not* registered — the
 * paragraph above says so — where `sms-templates.ts` would have needed the
 * carrier sample re-registered instead.
 */
export const CLARIFYING_COPY: Record<ClarifyingQuestion, string> = {
  /* The client's own opening, on the two questions that do change an answer.
     Every child at once since 21 Oct — "3 and 7" is two children. */
  child_age:
    "Mind if I ask one more thing so I can give you a better answer? How old are your kids? (Just the ages is fine, like 3 and 7.)",
  neighborhood:
    "Mind if I ask one more thing so I can give you a better answer? Roughly where do you live? I'll look for parents nearby rather than across town.",
  first_name: "Mind if I ask one more thing? What's your first name, so I know who I'm talking to?",
  /* P14 over SMS: the same three levels and the same digits as the SETTINGS
     menu, so one reader (`parseAllowanceChoice`) serves both. */
  /* "3 a week" is `OPEN_WEEKLY_LIMIT`, pinned by `test:onboarding`. Kept to the
     length of the others: riding on a full 765-character answer, the longer
     first draft was a seventh segment. The 48-hour promise is in the
     confirmation that answers it. */
  participation:
    "Last thing: how many questions from nearby parents could Pando send you? Reply 1 for up to 5 a month, 2 for up to 10, or 3 for up to 3 a week.",
};

/**
 * What Pando says when a clarifying answer lands, and the next question with it.
 *
 * The reply to an answer is a thank-you and, while the profile still misses
 * something, the next question — one outbound for one inbound, and still one
 * question at a time: the outbound's template names the question it carries,
 * so the next reply is read against it exactly as before. The last answer gets
 * `CLARIFY_THANKS`, which asks nothing — or, for the participation level,
 * `confirmed`: the SETTINGS menu's own confirmation, which the caller computes,
 * followed by a closing (22 Oct). The confirmation alone ended the SMS
 * onboarding on *"Done: up to 5 a month…"*, which is the last thing the parent
 * hears and told them neither how to change it nor that they can now just ask.
 */
export function clarifyReply(input: {
  question: ClarifyingQuestion;
  text: string;
  next: ClarifyingQuestion | null;
  confirmed?: string;
}): string {
  if (input.question === "participation") {
    return input.confirmed ? `${input.confirmed} ${SETTINGS_CLOSING}` : CLARIFY_THANKS;
  }
  const name = input.question === "first_name" ? parseFirstName(input.text) : null;
  if (!input.next) return name ? `Nice to meet you, ${name}! ${ANYTIME}` : CLARIFY_THANKS;
  const thanks = name ? `Nice to meet you, ${name}!` : "Got it, thanks!";
  return `${thanks} ${CLARIFYING_COPY[input.next]}`;
}

const ANYTIME = "Text me any question, anytime.";

/** After the last onboarding answer: how to change it, and that they can ask now. */
const SETTINGS_CLOSING = `Text SETTINGS to change it. ${ANYTIME}`;

/**
 * What Pando says when that answer lands.
 *
 * ⚠⚠ **Answering it used to be met with silence**, and the developer hit it on
 * the live relay: the question went out with a real answer, they replied *"4"*,
 * and the pipeline stored the age and `return`ed. From the phone it is
 * indistinguishable from a dead number — which is the one thing 5.9 exists to
 * prevent, and it lands on the parent who did exactly what was asked. The
 * 14 Sep decision named this and left it, because an acknowledgement is new
 * user-facing copy; it has now been reported, so it exists.
 *
 * ⚠ **It asks nothing**, for `SMALL_TALK`'s reason: 5.4 owns what gets asked
 * and when, and a question here would make the *next* message ambiguous all
 * over again — which is the fault above, one turn later.
 *
 * ⚠ **It promises nothing about this answer either.** The age sharpens what
 * `retrieveFor` filters on *next* time; re-running the question they just
 * asked with the new age would be a second answer nobody asked for and a
 * second bill, and it is the client's call rather than a side effect of a
 * thank-you. So the sentence says what is true: it is kept, and it is for what
 * comes next.
 *
 * One GSM-7 segment, pinned by `test:onboarding` — this is the reply to the
 * most-answered question in the onboarding path, so a curly apostrophe here
 * would double the cost of every one of them.
 */
export const CLARIFY_THANKS =
  /* "find parents closer to you" until 22 Oct, which was true of an area and
     not of an age — and an age is the answer this most often thanks. */
  "Got it, thanks. I'll use that to give you better answers next time you ask.";

/**
 * Is this message a reply to what Pando asked, or a fresh question?
 *
 * ⚠ **The parsers cannot answer this on their own, and assuming they could cost
 * a parent their question** (14 Sep). `parseAge` matches a one or two digit
 * number **anywhere** in the text — deliberately, because "he's 3" and "about 4
 * I think" are ordinary answers — so after *"how old is your child?"* the
 * message *"any camps for a 6 year old in Altadena?"* parsed as the age 6,
 * stored it, set `clarified`, and the pipeline returned **without answering the
 * question they had just asked**. Their age was recorded and they got silence.
 *
 * The discriminator is the shape of the message rather than its content, and it
 * has to be, because the content is legitimately ambiguous: a clarifying answer
 * is short and is not a question. A question mark is the clearest signal a
 * parent gives, and the length floor catches the ones who leave it out. Twelve
 * words, because "we moved to south pas last year from the valley" is still an
 * answer and anything longer is a sentence with its own agenda.
 *
 * ⚠ Deliberately **not** a check for question words: "how old" appears in a
 * parent's own answer often enough ("how old — she's 4") that a word list would
 * refuse real answers, and refusing one costs the profile a field it will never
 * be asked for again (one refusal is a parent who did not want to answer).
 */
export function isClarifyingAnswer(text: string): boolean {
  const body = text.trim();
  if (body.length === 0) return false;
  if (body.includes("?")) return false;
  return body.split(/\s+/).length <= 12;
}

/**
 * Read an age out of a reply.
 *
 * Deliberately narrow. A parent answering "3" means three years old; a parent
 * answering "18 months" means one. Anything that is not clearly an age comes back
 * null, and null means Pando asks nothing further and does not guess — a wrong
 * age is worse than no age, because it silently ranks the wrong parents for
 * every question they ever ask.
 */
export function parseAge(text: string): number | null {
  const body = text.trim().toLowerCase();

  /* Months, because "18 months" is how a parent of a toddler answers. Under
     twelve months is a baby, which is age 0 — not a rounding error. */
  const months = body.match(/\b(\d{1,2})\s*(?:months?|mos?|mo)\b/);
  if (months) {
    const n = Number(months[1]);
    if (n >= 0 && n <= 36) return Math.floor(n / 12);
  }

  /* Expecting is a real answer and the questionnaire already has a value for it. */
  if (/\b(expecting|pregnant|due in|on the way|not born yet)\b/.test(body)) return -1;

  /**
   * A bare number, or one with "years".
   *
   * The boundary is at the **start only**, with a negative lookahead for another
   * digit — not a trailing `\b`. Both halves were caught by the tests: "11yo" has
   * no word boundary between the digits and the letters, so a trailing `\b`
   * rejects a perfectly ordinary answer; and "2021" must not yield 20, which the
   * lookahead prevents by refusing a number that continues.
   *
   * With the 0–25 range that also keeps a phone number out: "6265550143" offers
   * only "62", which is out of range, and there is no later word boundary for it
   * to try again from.
   */
  const years = body.match(/\b(\d{1,2})(?!\d)(?:\s*(?:years?|yrs?|yo|y\/o))?/);
  if (years) {
    const n = Number(years[1]);
    if (n >= 0 && n <= 25) return n;
  }

  return null;
}

/**
 * Every child's age in one reply (21 Oct) — "3 and 7", "4, 9 and 18 months",
 * "a 6 year old and one on the way".
 *
 * The same narrow reading as `parseAge`, applied to each number in order: months
 * first and removed from the text (so "18 months" is one child aged 1, not two),
 * then whole numbers 0–25 that do not continue into more digits (a year or a
 * phone number offers nothing), then "expecting" as -1. Two equal ages are two
 * children — twins are a supported answer (10 Sep). Nothing readable is `[]`,
 * which stores nothing.
 */
export function parseAges(text: string): number[] {
  let body = text.trim().toLowerCase();
  const ages: Array<{ at: number; age: number }> = [];

  for (const m of body.matchAll(/\b(\d{1,2})\s*(?:months?|mos?|mo)\b/g)) {
    const n = Number(m[1]);
    if (n >= 0 && n <= 36) ages.push({ at: m.index ?? 0, age: Math.floor(n / 12) });
  }
  body = body.replace(/\b(\d{1,2})\s*(?:months?|mos?|mo)\b/g, (s) => " ".repeat(s.length));

  for (const m of body.matchAll(/\b(\d{1,2})(?!\d)(?:\s*(?:years?|yrs?|yo|y\/o))?/g)) {
    const n = Number(m[1]);
    if (n >= 0 && n <= 25) ages.push({ at: m.index ?? 0, age: n });
  }

  const expecting = body.match(/\b(expecting|pregnant|due in|on the way|not born yet)\b/);
  if (expecting) ages.push({ at: expecting.index ?? 0, age: -1 });

  return ages.sort((a, b) => a.at - b.at).slice(0, 8).map((a) => a.age);
}

/**
 * A first name out of a reply (21 Oct) — "Anna", "I'm Anna", "sure, it's anna".
 *
 * Narrow like the other readers: one name-shaped word after the usual openers,
 * letters with an inner hyphen or apostrophe, at most 30 characters, and the
 * reply no longer than four words once the opener is gone — anything longer is
 * a sentence, not a name. A refusal ("rather not", "skip") or a bare "sure"
 * comes back null, which stores nothing and is not asked again. Lowercase input
 * is capitalised; anything else is kept as typed.
 */
export function parseFirstName(text: string): string | null {
  let body = text.trim().replace(/[’]/g, "'").replace(/[.!?]+$/, "").trim();
  if (/^(no|nope|nah|pass|skip|rather not|prefer not|why|n\/a|none|stop|later)\b/i.test(body)) {
    return null;
  }
  body = body
    .replace(/^(sure|yes|yeah|yep|ok|okay|of course|no problem)\b[,!.\s-]*/i, "")
    .replace(/^(hi|hey|hello)\b[,!.\s-]*/i, "")
    .replace(/^(i'm|im|i am|it's|its|this is|my name is|my name's|name is|name's|call me)\s+/i, "")
    .trim();
  const words = body.split(/\s+/).filter(Boolean);
  /* A first name, or a first and last: two words at most once the opener is
     gone (review, 21 Oct — "ballet for my 5yo" became *Ballet*). */
  if (words.length === 0 || words.length > 2) return null;
  const first = words[0].replace(/[,.;:]+$/, "");
  if (!/^\p{L}(?:[\p{L}'-]{0,28}\p{L})?$/u.test(first)) return null;
  /* Two words where the second is what a question is about ("swim lessons",
     "camps near") are a question, not a first and last name. */
  if (
    words.length === 2 &&
    /^(lessons?|classes|class|camps?|near|for|in|please|stuff|ideas?|options?|places?|spots?|programs?|activities|tutors?|doctors?|dentists?|sitters?|nannies|daycare|preschools?|schools?)$/i.test(
      words[1].replace(/[,.;:?!]+$/, ""),
    )
  ) {
    return null;
  }
  /* An acknowledgement or a reaction is not a name: "cool" became *Cool*. */
  if (
    /^(cool|awesome|great|nice|good|fine|perfect|sounds|got|lol|haha|hmm|wow|yay|thx|ty|k|kk|alright|right|any|more|other|others|else|also|and|but|so|well|maybe|idk|dunno|nothing|nevermind|nvm|done|deal)$/i.test(
      first,
    )
  ) {
    return null;
  }
  /* Words that open a sentence rather than name a person — "what's this for",
     "why do you ask" — so a reply that is really a question stores nothing. */
  if (
    /^(thanks|thank|sure|yes|ok|okay|hi|hey|hello|me|my|the|a|an|what|what's|whats|who|who's|why|how|when|where|which|can|could|do|does|is|are|will|would|please|just|not|i|we|our|it|that|this)$/i.test(
      first,
    )
  ) {
    return null;
  }
  return first === first.toLowerCase() ? first[0].toUpperCase() + first.slice(1) : first;
}

/**
 * Read a neighborhood out of a reply.
 *
 * Matched against the market's own option ids, because that is the only
 * vocabulary the graph can use — the lesson from `area_slug`: comparing against a
 * display name bridges single-word areas and nothing else. The caller supplies
 * the list, so this stays free of a database and of any runtime import.
 *
 * Loose on the input, exact on the output: "we're in south pas" should find
 * `south-pasadena`, and anything it cannot place comes back null rather than
 * being stored as words no taxonomy contains (the 27 Aug rule).
 */
export function parseNeighborhood(
  text: string,
  options: Array<{ id: string; label: string }>,
): string | null {
  const body = text.trim().toLowerCase();
  if (body.length === 0) return null;

  /* Exact label or id first — the common case, and unambiguous. */
  for (const option of options) {
    if (body === option.label.toLowerCase() || body === option.id) return option.id;
  }

  /**
   * Then containment, longest label first.
   *
   * Longest first matters: "Pasadena" is a substring of "South Pasadena", so
   * checking the shorter one first would file every South Pasadena parent in
   * Pasadena — a wrong area that looks entirely reasonable in the data.
   */
  const byLength = [...options].sort((a, b) => b.label.length - a.label.length);
  for (const option of byLength) {
    if (body.includes(option.label.toLowerCase())) return option.id;
  }

  /**
   * Finally the slug's own words, for "south pas" and "la canada".
   *
   * **The first two parts, as three-letter prefixes** — not every part, and not
   * the whole word. Both of the obvious rules were wrong and the tests said so:
   *
   *  - *every* part fails "la canada", because a parent writing that has dropped
   *    "flintridge" and is still unambiguous;
   *  - a *four*-letter prefix fails "south pas", which is how somebody actually
   *    types it.
   *
   * Two parts is enough to stay unambiguous where it matters: "pasadena" alone
   * offers no "sou", so it cannot be swallowed by "south-pasadena" — which is
   * the collision that would otherwise file every South Pasadena parent in the
   * wrong area, invisibly.
   */
  for (const option of byLength) {
    const parts = option.id.split("-");
    if (parts.length < 2) continue;
    const needed = parts.slice(0, 2).map((p) => p.slice(0, 3));
    /* Matched at the start of a *word*, never anywhere inside one, and a
       two-letter part ("la" in la-canada) only as a whole word. `includes`
       made "I can't say, later" a La Cañada Flintridge parent, and a wrong
       area is filed permanently and looks fine afterwards. */
    const words = body
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const at = (p: string) =>
      words.some((w) => (p.length < 3 ? w === p : w.startsWith(p)));
    if (needed.every(at) || words.some((w) => w.startsWith(needed.join("")))) {
      return option.id;
    }
  }

  return null;
}

/**
 * The template name recorded on the outbound message.
 *
 * This is how Pando remembers what it asked without a second table: the last
 * outbound `clarify_*` template in `message_log` **is** the pending question, and
 * the inbound reply that names it is the answer. One fact, in the place that
 * already records outbound messages.
 */
export function clarifyTemplate(question: ClarifyingQuestion): string {
  return `clarify_${question}`;
}

export function questionFromTemplate(template: string | null): ClarifyingQuestion | null {
  if (template === "clarify_child_age") return "child_age";
  if (template === "clarify_neighborhood") return "neighborhood";
  if (template === "clarify_first_name") return "first_name";
  if (template === "clarify_participation") return "participation";
  return null;
}
