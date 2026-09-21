/**
 * "How do you know the person who invited you?" — the first edge of an internal
 * relationship graph (16 Sep).
 *
 * Asked only on a **personal** invite link, the one kind with a person behind it
 * (`invites.kind`, drizzle 0034). A group or school link has nobody to know.
 *
 * ## Whose privacy decides the wording
 *
 * The **inviter's**. A parent who chose *"Keep my name private"* is never named
 * to the person they invited — not on this question, and not in the
 * *"{first name} invited you"* line above the join card — so the server only
 * sends a first name to the browser when the inviter's standing attribution is
 * `first_name_safe`. A skipped attribution fails closed to private, exactly as it
 * does everywhere else (`derive.ts`).
 *
 * ## What it is not
 *
 * Internal. It is never shown to another parent and never scores a match today:
 * it is recorded so that "who brought whom, and how they know each other" exists
 * before anything is built on it. Deliberately pure and import-free, so a plain
 * node test can load it.
 */

/**
 * The way out of the question, in the app's own words for one (21 Sep, the
 * developer: *"має бути опція, що людина хоче залишити цю інформацію
 * анонімною, кнопку Skip з тієї сторінки потрібно прибрати"*). Eight other
 * screens already say **Prefer not to say**, so nothing new is invented here.
 *
 * ⚠⚠ **It is an answer on screen and never an edge in the database.** A
 * refusal is not a relationship, and the 9 Sep round is the reason this
 * matters: `deriveAffinities` filtered only one refusal id, so *"Homeschool"*
 * and *"No faith community"* were written as connections — and `school` is the
 * heaviest edge in the graph, awarded to two families for each **not** being
 * at a school. Anything reading this table later would have to remember to
 * exclude a value that is not what the column means; `storedRelationship`
 * removes it once, at the boundary, so nothing downstream has to.
 *
 * ⚠ It is also why the option list is deliberately **wider** than what
 * `person_relationships_relationship_check` allows (drizzle 0044). Widening
 * that CHECK to admit it is the change not to make: a value the route can
 * never send would be a permission with nothing behind it, and the CHECK is
 * the last line that says what an edge may claim.
 */
export const DECLINED_RELATIONSHIP = "prefer_not_to_say";

export const RELATIONSHIP_OPTIONS = [
  { id: "family", label: "Family" },
  { id: "close_friend", label: "Close friend" },
  { id: "friend", label: "Friend" },
  { id: "neighbor", label: "Neighbor" },
  { id: "colleague", label: "Colleague" },
  { id: "parent_group", label: "Mommy-and-me or parent group" },
  { id: "school_parent", label: "Our kids are at the same school or daycare" },
  { id: "other", label: "Something else" },
  /* Last, like every other refusal in this app: it is the question's own
     furniture rather than one of its answers. */
  { id: DECLINED_RELATIONSHIP, label: "Prefer not to say" },
] as const;

/** Anything the screen can produce, the refusal included. */
export type Relationship = (typeof RELATIONSHIP_OPTIONS)[number]["id"];

/** Anything that may become an edge. */
export type StoredRelationship = Exclude<
  Relationship,
  typeof DECLINED_RELATIONSHIP
>;

const IDS = new Set<string>(RELATIONSHIP_OPTIONS.map((o) => o.id));

export function isRelationship(value: unknown): value is Relationship {
  return typeof value === "string" && IDS.has(value);
}

/**
 * What the profile write may store: one of the relationships, or nothing at
 * all. A refusal and an unknown value both come back null, and both mean the
 * same thing here — no row is written, so there is no edge to say how these
 * two people know each other.
 */
export function storedRelationship(value: unknown): StoredRelationship | null {
  return isRelationship(value) && value !== DECLINED_RELATIONSHIP ? value : null;
}

/**
 * The question, named only when the inviter allowed their first name to show.
 * `firstName` is whatever the server chose to send, so a null here already
 * means "do not name them" — this function never decides privacy, it only
 * words what it was given.
 */
export function relationshipQuestion(firstName: string | null | undefined): string {
  const name = firstName?.trim();
  return name
    ? `How do you know ${name}?`
    : "What's your relationship with the person who invited you?";
}
