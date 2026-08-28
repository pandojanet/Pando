import type { AffinityType, QuestionId } from "./types";

/**
 * The bridge between a privacy grant and the matching graph (Privacy Guidance §A).
 *
 * A grant is stored as `type:value` — `schools:walden-school` — because the
 * client builds it from the question the parent answered. The graph stores
 * `affinity_type` — `school` — because that is the vocabulary §7.1 uses. The two
 * are not the same word, and the mapping has to be identical on both sides or a
 * permission names an edge that does not exist.
 *
 * So it lives here: one map, imported by the screen that offers the toggle and by
 * the repo that writes the row. A second copy on the server is exactly how a
 * grant ends up filed against `schools` while every reader looks for `school`.
 *
 * ## Why `classes` and `camps` both become `activity`
 *
 * They already do in the graph — §7.1's "same regular activity or class" is one
 * signal at one weight, and camps were added to it on 11 Aug rather than given
 * their own type. A grant has to follow the graph, not the questionnaire's
 * groupings, or the join finds nothing.
 *
 * **The consequence to accept:** a parent who names a class *and* a camp with the
 * same slug grants once, not twice. That cannot happen with real data (a class
 * and a camp are different records) but it is why `resolveAffiliation` returns a
 * type and a value rather than echoing the ref.
 */
const AFFILIATION_TYPES: Partial<Record<QuestionId, AffinityType>> = {
  schools: "school",
  classes: "activity",
  camps: "activity",
  clubs: "social_group",
  faith: "faith_community",
};

export interface Affiliation {
  /** Matches `social_affinities.affinity_type`. */
  type: AffinityType;
  /** Matches `social_affinities.affinity_value`. */
  value: string;
}

/**
 * `schools:walden-school` → `{ type: "school", value: "walden-school" }`, or null
 * when the ref names something that cannot be an affiliation.
 *
 * Null rather than a guess, for the same reason invariant 9 parks an unmatchable
 * answer: a permission filed against a type nothing reads is worse than no
 * permission, because it looks like the parent was asked and answered.
 */
export function resolveAffiliation(ref: string): Affiliation | null {
  const colon = ref.indexOf(":");
  if (colon <= 0) return null;

  const questionId = ref.slice(0, colon) as QuestionId;
  const value = ref.slice(colon + 1);
  if (value === "") return null;

  const type = AFFILIATION_TYPES[questionId];
  return type ? { type, value } : null;
}

/** The inverse, for building a ref from a question the parent answered. */
export function affiliationRef(questionId: QuestionId, optionId: string): string {
  return `${questionId}:${optionId}`;
}

/** Whether this question produces connections a parent can grant. */
export function producesAffiliation(questionId: QuestionId): boolean {
  return questionId in AFFILIATION_TYPES;
}

/**
 * The grants, de-duplicated by the edge they name.
 *
 * Two refs can resolve to one edge (see the note above), and a duplicate would
 * violate the table's primary key — so the collapse happens here rather than as a
 * database error the parent would see as a failed save.
 */
export function resolveAffiliations(refs: string[]): Affiliation[] {
  const seen = new Map<string, Affiliation>();
  for (const ref of refs) {
    const resolved = resolveAffiliation(ref);
    if (resolved) seen.set(`${resolved.type}/${resolved.value}`, resolved);
  }
  return [...seen.values()];
}
