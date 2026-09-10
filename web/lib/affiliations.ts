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

/**
 * ## Which affiliations may ever be named to another parent — the client, 10 Sep
 *
 * *"Use these affiliations only for private matching. Never name them to another
 * parent or use them in shared-connection attribution, regardless of the general
 * setting."*
 *
 * ⚠⚠ **"Regardless of the general setting" is the load-bearing clause**, and it
 * is why this is a set here rather than a default on the question. A parent who
 * answered *"yes, mention shared connections"* on the old attribution screen
 * still gets nothing named: this beats the answer, rather than seeding it.
 *
 * ⚠⚠ **It is empty, and that is the current state rather than a placeholder.**
 * Every affiliation Pando collects is one of the five below, and her instruction
 * plus her note about the golf club covers all of them — a school and a class by
 * name, and a club or a faith community because *"a golf club membership is
 * exactly the kind of private affiliation a parent might not consider themselves
 * to have given permission to reveal by tapping a default during onboarding."*
 *
 * **So the mechanism is kept and the list is empty.** Deleting
 * `affiliation_visibility`, the grant path and the 24 Aug Privacy Guidance §A
 * work would be a bigger decision than she asked for, and the day she names one
 * type as shareable it is one entry here — with the screen, the derivation and
 * the table all still in place and all still tested.
 */
const NAMEABLE: ReadonlySet<AffinityType> = new Set<AffinityType>([]);

/**
 * May this connection ever be named to another parent?
 *
 * Read at three layers on purpose, because one is not enough for a rule this
 * absolute: the option list (so there is nothing to toggle), the derivation (so
 * no grant row is written even if a client posts one), and the screen gate (so
 * a question with no answers left does not render).
 */
export function mayBeNamed(type: AffinityType): boolean {
  return NAMEABLE.has(type);
}

/**
 * Whether this question produces connections a parent can grant.
 *
 * ⚠ Two conditions since 10 Sep: the question has to map to an edge **and** that
 * edge has to be one a parent may name. A question that maps but may not be
 * named still writes its affinity row — private matching is exactly what it is
 * for — it simply never becomes something another parent reads.
 */
export function producesAffiliation(questionId: QuestionId): boolean {
  const type = AFFILIATION_TYPES[questionId];
  return type !== undefined && mayBeNamed(type);
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
    /* ⚠ The second layer of the 10 Sep rule. A grant can only reach here from a
       request body, and a body is not a decision the parent made on a screen —
       so a ref naming a type that may never be shown is dropped rather than
       stored, exactly as an unresolvable one is. */
    if (resolved && mayBeNamed(resolved.type)) {
      seen.set(`${resolved.type}/${resolved.value}`, resolved);
    }
  }
  return [...seen.values()];
}
