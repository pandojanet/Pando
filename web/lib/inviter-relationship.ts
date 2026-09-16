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

export const RELATIONSHIP_OPTIONS = [
  { id: "family", label: "Family" },
  { id: "close_friend", label: "Close friend" },
  { id: "friend", label: "Friend" },
  { id: "neighbor", label: "Neighbor" },
  { id: "colleague", label: "Colleague" },
  { id: "parent_group", label: "Mommy-and-me or parent group" },
  { id: "school_parent", label: "Our kids are at the same school or daycare" },
  { id: "other", label: "Something else" },
] as const;

export type Relationship = (typeof RELATIONSHIP_OPTIONS)[number]["id"];

const IDS = new Set<string>(RELATIONSHIP_OPTIONS.map((o) => o.id));

export function isRelationship(value: unknown): value is Relationship {
  return typeof value === "string" && IDS.has(value);
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
