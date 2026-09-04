/**
 * M11.4 — the named-person policy: is this record's *name* a person?
 *
 * Pure, and free of runtime imports, like every rule that decides what enters
 * the graph.
 *
 * ## The hole this closes, and how narrow it actually is
 *
 * A caregiver is protected by an apparatus: invariant 14's firsthand-employment
 * gate, invariant 2's 18+ question, invariant 13 (no contact details, ever), and
 * invariant 1's four conditions before they can appear in an answer at all.
 * **All of it keys on the record being a `caregivers` row.**
 *
 * So a tutor, a coach or a music teacher entered as an *activity* — "Diane
 * Kovalenko", "Ms. Diane" — gets none of it. Nobody asked whether she is 18.
 * Nobody asked her anything. And her name would be given to strangers, because
 * `shares.name` goes straight into a composed answer where `answer.ts` reads
 * `name` and `venue` and nothing else. The estimate's phrase for this is exactly
 * right: *"protecting the person regardless of capture path."*
 *
 * Worth being precise about what is **not** the hole, because it was the first
 * guess and it is wrong. A parent's free text naming a teacher ("Ms. Diane got
 * my son playing in three weeks") never reaches a parent at all:
 * `AnswerCandidate` has no free-text field, by construction. That protection is
 * structural and this file does not need to add to it — it needs to cover the
 * one field that *is* published.
 *
 * ## Which way it errs, and why that is the safe direction
 *
 * A **false positive** ("Kidspace Museum" read as a person) costs an admin a
 * glance and a resolve. A **false negative** puts a real person's name in front
 * of strangers with no consent and no age check. Those are not comparable, so
 * this leans toward flagging.
 *
 * But it leans only where leaning is cheap, which is why a venue word is an
 * absolute veto rather than a counterweight: **"Coach Patty's Gymnastics" is a
 * real record in this market's taxonomy** (the importer's own example — "CPG"
 * finds it), and it carries an honorific *and* a business word. A rule that let
 * the honorific win would flag a legitimate business every time a market's
 * gyms happen to be named after their founders, which in this taxonomy is
 * often.
 */

/**
 * Words that make a name a business, a venue or a programme.
 *
 * Checked first and absolutely: any of these present means this is not a person,
 * whatever else the name contains. Drawn from what the four directories actually
 * hold — schools, activity providers, faith communities and clubs — rather than
 * invented, because a list that misses the words in the data would veto nothing.
 */
const VENUE_WORDS = [
  // Schools and childcare
  "school", "schools", "academy", "preschool", "pre-school", "kindergarten",
  "daycare", "day care", "nursery", "montessori", "elementary", "middle",
  "high", "college", "institute", "learning", "education", "prep",
  // Places
  "center", "centre", "museum", "park", "library", "studio", "gym",
  "gymnastics", "pool", "rink", "field", "court", "playground", "zoo",
  "garden", "gardens", "farm", "theater", "theatre", "hall", "house",
  "lodge", "campus", "arena", "stadium", "aquarium", "observatory",
  // Programmes and activities
  "camp", "camps", "class", "classes", "lessons", "program", "programs",
  "programme", "workshop", "workshops", "clinic", "league", "team", "swim",
  "swimming", "soccer", "dance", "ballet", "music", "art", "arts", "martial",
  "karate", "taekwondo", "judo", "yoga", "tutoring", "tutors", "chess",
  "coding", "robotics", "scouts", "gymboree", "playgroup",
  // Organisations and faith
  "club", "association", "society", "foundation", "trust", "council",
  "church", "temple", "synagogue", "mosque", "parish", "chapel", "ministry",
  "congregation", "fellowship", "ymca", "ywca", "jcc", "co-op", "coop",
  /* Added from the measurement, not guessed: each of these named a real record
     the `personal_name` signal had flagged. They are institution words in the
     vocabulary the data actually uses, so they generalise — unlike the record
     names themselves, which would have been whack-a-mole. */
  "masjid", "gurdwara", "mandir", "vihara", "monastery", "convent", "abbey",
  "presbyterian", "unitarian", "universalist", "buddhist", "lutheran",
  "methodist", "episcopal", "baptist", "catholic", "orthodox", "evangelical",
  "immersion", "fundamental", "magnet", "charter", "conservatory",
  "stables", "symphony", "orchestra", "chorale", "choir", "playschool",
  "playgarden", "playlab", "montessori",
  "cooperative", "collective", "group", "network", "alliance", "guild",
  // Commercial
  "inc", "llc", "ltd", "co", "company", "services", "care", "kids",
  "children", "childrens", "family", "families", "baby", "babies", "tots",
  "toddler", "little", "young", "junior", "academy", "the",
];

/**
 * Titles that make a name a person, whatever else is in it — unless a venue
 * word vetoes it first.
 *
 * "Ms. Diane" is the archetype: it is how parents refer to a teacher, and it is
 * the exact example CLAUDE.md cites as the most useful card of four.
 */
const HONORIFICS = [
  "mr", "mrs", "ms", "miss", "mx", "dr", "doctor", "prof", "professor",
  "coach", "teacher", "tutor", "nanny", "auntie", "aunty", "uncle",
  "senora", "senorita", "senor", "madame", "mlle", "sensei", "maestro",
  "maestra", "tia", "tio",
];

/** Particles that sit inside a surname and should not count as a word of it. */
const NAME_PARTICLES = ["de", "la", "del", "van", "von", "der", "den", "di", "da", "el", "al", "bin", "ibn", "mac", "mc", "o"];

export type NamedPersonVerdict =
  | { person: false }
  | {
      person: true;
      /** Which signal fired, so a flag can say why and a test can pin it. */
      signal: "honorific" | "personal_name" | "possessive_first_name";
      /**
       * Whether this is strong enough to **refuse** on, or only to flag.
       *
       * **Measured, not assumed.** Run against all 588 curated records in the
       * Pasadena taxonomy, the `personal_name` signal alone flags 16 of them —
       * "Marshall Fundamental", "Calvary Monrovia", "Altadena Stables",
       * "Masjid Gibrael". That is 2.7%, and it is not a tuning problem: two
       * capitalised words is the dominant shape of an institution as well as of
       * a person, and no lexical rule separates "Diane Kovalenko" from "Marshall
       * Fundamental" without a first-name dictionary.
       *
       * So the two costs get two thresholds. **Strong** (an honorific, or a bare
       * possessive) is near-impossible to trigger by accident and is what the
       * SMS capture refuses on — where the cost of being wrong is a parent sent
       * to a form that can take their nomination properly. **Weak** is a prompt
       * for an admin, where the cost of being wrong is a glance.
       */
      strong: boolean;
    };

/** Strip punctuation a name carries but a comparison should not. */
function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,'’"()]/g, " ")
    .split(/[\s/&+-]+/)
    .map((w) => w.trim())
    .filter((w) => w !== "");
}

/**
 * Does this record's name look like an individual person?
 *
 * Three positive signals, in the order they are trusted:
 *
 *  1. **An honorific.** "Ms. Diane", "Coach Sarah", "Dr. Patel".
 *  2. **A personal-name shape**: two or three capitalised words, none of them a
 *     venue word, no digits, and not an acronym. "Diane Kovalenko".
 *  3. **A possessive first name on its own**: "Diane's". Weak, and it is the
 *     reason a venue word vetoes — "Diane's Dance Studio" is a business.
 *
 * Anything else is not a person as far as this rule is concerned, including a
 * single bare word: "Kidspace" is a venue and "Diane" alone is more often a
 * shorthand somebody typed for a place than a full identification. A single
 * first name with no honorific is deliberately **not** flagged — it is the
 * commonest shape of a legitimate short business name in this taxonomy, and
 * flagging it would bury the queue.
 */
export function looksLikePerson(
  name: string,
  options: {
    /**
     * Place names from the market's own taxonomy — area slugs, town names.
     *
     * **Passed in rather than hardcoded**, because it is the one veto that has
     * to generalise: the false positives measured on this market are dominated
     * by place + descriptor ("Brella Pasadena", "Calvary Monrovia", "Altadena
     * Stables"), and a list baked into this file would be a second copy of
     * `market_options` going stale the day a market is added. A caller with the
     * areas passes them; the SMS path does not need to, because it refuses only
     * on the strong signals.
     */
    placeWords?: string[];
  } = {},
): NamedPersonVerdict {
  const raw = (name ?? "").trim();
  if (raw === "") return { person: false };

  const parts = words(raw);
  if (parts.length === 0) return { person: false };

  /* The veto, first and absolute — see the header on "Coach Patty's
     Gymnastics". */
  if (parts.some((w) => VENUE_WORDS.includes(w))) return { person: false };

  /* A place name in it makes it a place. Slugs are compared as words, the rule
     `person-search.ts` and the inbound parser both already follow. */
  const places = new Set(
    (options.placeWords ?? []).flatMap((p) => words(p.replace(/-/g, " "))),
  );
  if (places.size > 0 && parts.some((w) => places.has(w))) {
    return { person: false };
  }

  /* A digit anywhere means a room, a cohort or an address, never a person. */
  if (/\d/.test(raw)) return { person: false };

  if (HONORIFICS.includes(parts[0])) {
    return { person: true, signal: "honorific", strong: true };
  }

  /**
   * "Diane's" — a possessive, alone. With a venue word it was already vetoed,
   * which is what keeps "Diane's Dance Studio" out.
   *
   * Tested on the **raw** string rather than on `parts`, because `words()`
   * strips the apostrophe to a space and turns this into two tokens — so the
   * `parts.length === 1` version of this check never fired, and a bare
   * possessive fell through to the two-word branch and came back `weak`. Still
   * flagged, so nothing leaked; but it would have been classified as the signal
   * that is *not* safe to refuse on, which is the half that matters.
   */
  if (/^[^\s]+['’]s$/.test(raw)) {
    return { person: true, signal: "possessive_first_name", strong: true };
  }

  /* Two or three capitalised words with nothing else in them. Capitalisation is
     required rather than inferred: "swim with sarah" typed in lower case is a
     description, and reading it as an identification would flag prose. */
  const significant = parts.filter((w) => !NAME_PARTICLES.includes(w));
  if (significant.length >= 2 && significant.length <= 3) {
    const capitalised = raw
      .split(/[\s/&+-]+/)
      .filter((w) => w.replace(/[.,'’"()]/g, "").length > 0)
      .every((w) => /^[A-ZÀ-ÖØ-Þ]/.test(w.replace(/[('’"]/g, "")));
    /* An acronym is an organisation ("LCHS", "YMCA"), not a person. */
    const acronym = parts.some((w) => w.length >= 2 && w === w.toUpperCase() && raw.includes(w.toUpperCase()));
    if (capitalised && !acronym) {
      return { person: true, signal: "personal_name", strong: false };
    }
  }

  return { person: false };
}

/**
 * The flag reason a person-shaped record carries.
 *
 * One string, exported so `labels.ts`, the writer and the tests cannot disagree
 * about it — the same reason `recommendation_withdrawn` is written down once.
 */
export const NAMED_PERSON_FLAG = "named_person_record" as const;
