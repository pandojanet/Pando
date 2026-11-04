/**
 * The weekly digest goes to groups, not to each person (4 Nov).
 *
 * The developer: *"not a personalised digest for each person — combine them
 * for people with similar interests, by the graph"*, and then *"the number of
 * groups must be decided dynamically, not a fixed number"*. So the recipients
 * of a Saturday are grouped by what the graph knows about them, each group
 * gets one agent search and one digest, and how many groups there are is what
 * the people make it: two families alike enough share one, and a market of
 * strangers to each other gets several.
 *
 * ## What a family is, for this
 *
 * A set of weighted features (`familyFeatures`): the children's stages (the
 * most telling for an event — a toddler morning and a teen workshop share
 * nothing), the town and the neighborhood, the social graph's own edges
 * (school, activity, faith, club — every `social_affinities` row but the age
 * range and the neighborhood, which are already here), and the logistics and
 * budget answers (`life_relevance`). Two families' likeness is the weighted
 * Jaccard of their sets: what they share over what either has.
 *
 * ## How the number of groups comes out
 *
 * Agglomerative, average linkage (`groupFamilies`): every family starts alone,
 * and the two most alike groups merge while they are at least
 * `COHORT_SIMILARITY` alike. Then two guards, neither a count of groups:
 *
 *  - **a group smaller than `COHORT_MIN`** joins the group most like it — one
 *    agent search for one family is a personal digest by another name;
 *  - **past `COHORT_MAX` groups** the most alike keep merging: each group is
 *    one agent run, and this is the week's ceiling on that cost.
 *
 * A family the graph knows nothing about shares nothing with anyone; those go
 * together into one market-wide group rather than each into a stranger's.
 *
 * Pure and deterministic — the same people give the same groups, on every
 * hourly run of a Saturday — so `npm run test:cohorts` runs it as it is.
 */

/** A family as the graph knows it. */
export interface FamilyFacts {
  id: string;
  /** The children's ages today; a negative age is a baby on the way. */
  ages: number[];
  /** The neighborhood's id, and the town it sits in (`market_options.area`). */
  neighborhood: string | null;
  area: string | null;
  /** `social_affinities` rows, as `type:value`. */
  affinities: string[];
  /** `life_relevance` rows, as `dimension:value`. */
  relevance: string[];
}

/** Two families alike at least this much share a digest. */
export const COHORT_SIMILARITY = 0.4;
/** A group smaller than this joins the one most like it. */
export const COHORT_MIN = 3;
/** How alike a family must be to join a group it did not merge into: three quarters of a merge. A shared town alone is not. */
export const NEAR_ENOUGH = 0.75;
/** At most this many agent searches a Saturday, per market. */
export const COHORT_MAX = 12;

const STAGES = [
  { stage: "expecting", from: -9, to: -1 },
  { stage: "baby", from: 0, to: 1 },
  { stage: "toddler", from: 2, to: 3 },
  { stage: "preschool", from: 4, to: 5 },
  { stage: "early grades", from: 6, to: 8 },
  { stage: "older grades", from: 9, to: 11 },
  { stage: "teens", from: 12, to: 99 },
] as const;

export function stageOf(age: number): string {
  return (STAGES.find((s) => age >= s.from && age <= s.to) ?? STAGES[STAGES.length - 1]).stage;
}

/* What each kind of fact weighs. */
const WEIGHT = { stage: 4, area: 2, neighborhood: 1, affinity: 1, relevance: 0.5 } as const;

export function familyFeatures(f: FamilyFacts): Map<string, number> {
  const out = new Map<string, number>();
  for (const age of f.ages) out.set(`stage:${stageOf(age)}`, WEIGHT.stage);
  if (f.area) out.set(`area:${f.area.toLowerCase()}`, WEIGHT.area);
  if (f.neighborhood) out.set(`hood:${f.neighborhood}`, WEIGHT.neighborhood);
  for (const a of f.affinities) {
    if (a.startsWith("age_range:") || a.startsWith("neighborhood:")) continue;
    out.set(`aff:${a}`, WEIGHT.affinity);
  }
  for (const r of f.relevance) out.set(`rel:${r}`, WEIGHT.relevance);
  return out;
}

/** Weighted Jaccard: what both have, over what either has. 0 when neither has anything. */
export function likeness(a: Map<string, number>, b: Map<string, number>): number {
  let shared = 0;
  let either = 0;
  for (const [k, w] of a) {
    either += w;
    if (b.has(k)) shared += w;
  }
  for (const [k, w] of b) if (!a.has(k)) either += w;
  return either === 0 ? 0 : shared / either;
}

/**
 * The families, in groups. Each group is the indexes of its members into
 * `families`, sorted, and whether it is the market-wide group (`general`):
 * the families the graph knows nothing about and those too few and too unlike
 * anyone for a group of their own. The groups are sorted by their first
 * member, so the result is the same for the same input.
 */
export function groupFamilies(
  families: readonly FamilyFacts[],
  limits: { similarity: number; min: number; max: number } = { similarity: COHORT_SIMILARITY, min: COHORT_MIN, max: COHORT_MAX },
): Array<{ members: number[]; general: boolean }> {
  const order = families.map((f, i) => ({ f, i })).sort((x, y) => (x.f.id < y.f.id ? -1 : x.f.id > y.f.id ? 1 : 0));
  const features = order.map(({ f }) => familyFeatures(f));
  const known = order.map((_, k) => k).filter((k) => features[k].size > 0);
  const unknown = order.map((_, k) => k).filter((k) => features[k].size === 0);

  /* Average linkage over the known families, with the pairwise table kept up
     to date as groups merge (Lance–Williams). */
  let groups: number[][] = known.map((k) => [k]);
  const sim: number[][] = known.map((a) => known.map((b) => likeness(features[a], features[b])));
  const best = () => {
    let at: [number, number] | null = null;
    let top = -1;
    for (let x = 0; x < groups.length; x++) {
      for (let y = x + 1; y < groups.length; y++) {
        if (sim[x][y] > top) {
          top = sim[x][y];
          at = [x, y];
        }
      }
    }
    return { at, top };
  };
  const merge = (x: number, y: number) => {
    const nx = groups[x].length;
    const ny = groups[y].length;
    for (let z = 0; z < groups.length; z++) {
      if (z === x || z === y) continue;
      const v = (nx * sim[x][z] + ny * sim[y][z]) / (nx + ny);
      sim[x][z] = v;
      sim[z][x] = v;
    }
    groups[x] = [...groups[x], ...groups[y]];
    groups.splice(y, 1);
    sim.splice(y, 1);
    for (const row of sim) row.splice(y, 1);
  };

  for (let { at, top } = best(); at && top >= limits.similarity; { at, top } = best()) merge(at[0], at[1]);

  /**
   * Too small to be a group: into the group most like it — if it is at least
   * three quarters as alike as a merge needs (review, 4 Nov: "likeness above
   * 0" put a family that shared only a town, 0.27, into a group of another
   * stage). Every small group is tried, not just the first: one that matched
   * nobody stopped the rest from merging, so where a pair landed depended on a
   * stranger's id.
   */
  const unmatched = new Set<number[]>();
  for (;;) {
    const small = groups.findIndex((g) => g.length < limits.min && !unmatched.has(g));
    if (small < 0 || groups.length < 2) break;
    let into = -1;
    let top = limits.similarity * NEAR_ENOUGH;
    for (let z = 0; z < groups.length; z++) {
      if (z !== small && sim[small][z] >= top) {
        top = sim[small][z];
        into = z;
      }
    }
    if (into < 0) {
      unmatched.add(groups[small]);
      continue;
    }
    merge(Math.min(small, into), Math.max(small, into));
  }
  /* What is still too small and like nobody joins the market-wide group. */
  const alone = groups.length > 1 ? groups.filter((g) => g.length < limits.min) : [];
  /* Out of the table as well as the list, so the ceiling below merges the right rows. */
  for (let z = groups.length - 1; z >= 0; z--) {
    if (!alone.includes(groups[z])) continue;
    groups.splice(z, 1);
    sim.splice(z, 1);
    for (const row of sim) row.splice(z, 1);
  }
  const general = [...unknown, ...alone.flat()];
  /* The cost ceiling: the most alike keep merging. */
  while (groups.length + (general.length > 0 ? 1 : 0) > limits.max && groups.length > 1) {
    const { at } = best();
    if (!at) break;
    merge(at[0], at[1]);
  }

  const out = (g: number[], isGeneral: boolean) => ({ members: g.map((k) => order[k].i).sort((a, b) => a - b), general: isGeneral });
  return [...groups.map((g) => out(g, false)), ...(general.length > 0 ? [out(general, true)] : [])].sort(
    (a, b) => a.members[0] - b.members[0],
  );
}

/** A stage with its own ages, as the agent is told it: "toddler (2-3)". */
export function stageWithAges(stage: string): string {
  const s = STAGES.find((x) => x.stage === stage);
  if (!s) return stage;
  if (s.stage === "expecting") return "a baby on the way";
  return s.to >= 99 ? `${s.stage} (${s.from}+)` : `${s.stage} (${s.from}-${s.to})`;
}

/** What a group's agent search and digest are told about it. */
export interface CohortProfile {
  /** A stable name for the group's edition: the same profile is the same edition all Saturday. */
  key: string;
  /** For the admin: "Toddler, preschool · Altadena · weekend friendly". */
  label: string;
  /** The children's ages the group spans, or null when nobody listed any. */
  ages: { min: number; max: number } | null;
  stages: string[];
  areas: string[];
  interests: string[];
  members: number;
  /** The features most of it shares (`familyFeatures` keys), so a family who signs up later that Saturday joins the group it is most like rather than redrawing them. */
  features: Array<[string, number]>;
}

const readable = (slug: string) => slug.replace(/[-_]+/g, " ").trim();

/* What a share of the group has in common: a feature at least this share of
   members carry — and never one family's alone (review, 4 Nov: in a group of
   three, one family's school or faith community was "shared"). */
const COMMON = 1 / 3;
const COMMON_MIN = 2;

/**
 * What a group is told about itself. The market-wide group (`general`) is told
 * nothing narrowing: what a third of a handful of strangers share is not what
 * the rest of them want — a 4 year old in one family made a "preschool" search
 * for two families who listed no child (the lab, 4 Nov).
 */
export function cohortProfile(members: readonly FamilyFacts[], general = false): CohortProfile {
  const n = members.length;
  if (general) {
    return GENERAL(n);
  }
  const common = (pick: (f: FamilyFacts) => string[]) => {
    const counts = new Map<string, number>();
    for (const f of members) for (const v of new Set(pick(f))) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()]
      .filter(([, c]) => c / n >= COMMON && c >= Math.min(COMMON_MIN, n))
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([v]) => v);
  };
  const stages = common((f) => f.ages.map(stageOf)).sort(
    (a, b) => STAGES.findIndex((s) => s.stage === a) - STAGES.findIndex((s) => s.stage === b),
  );
  /* No stage a third of it shares: no ages at all, rather than every age in it (review, 4 Nov). */
  const ages = stages.length ? members.flatMap((f) => f.ages).filter((a) => a >= 0 && stages.includes(stageOf(a))) : [];
  const areas = common((f) => (f.area ? [f.area] : [])).slice(0, 3);
  const interests = common((f) => [
    ...f.affinities.filter((a) => !a.startsWith("age_range:") && !a.startsWith("neighborhood:")),
    ...f.relevance.filter((r) => r.startsWith("logistics:")),
  ])
    .slice(0, 5)
    .map((v) => readable(v.slice(v.indexOf(":") + 1)));
  /* Nothing shared at all is the market-wide group, and shares its edition. */
  if (stages.length === 0 && areas.length === 0 && interests.length === 0) return GENERAL(n);
  const label = [stages.join(", "), areas.join(", "), interests.join(", ")].filter(Boolean).join(" · ");
  const featureCounts = new Map<string, { w: number; c: number }>();
  for (const f of members) {
    for (const [k, w] of familyFeatures(f)) featureCounts.set(k, { w, c: (featureCounts.get(k)?.c ?? 0) + 1 });
  }
  const features = [...featureCounts.entries()]
    .filter(([, v]) => v.c / n >= COMMON && v.c >= Math.min(COMMON_MIN, n))
    .map(([k, v]): [string, number] => [k, v.w])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return {
    features,
    key: `c-${hash([stages.join(","), areas.join(",").toLowerCase(), interests.join(",")].join("|"))}`,
    label,
    ages: ages.length ? { min: Math.min(...ages), max: Math.max(...ages) } : null,
    stages,
    areas,
    interests,
    members: n,
  };
}

const GENERAL = (members: number): CohortProfile => ({
  key: "c-general",
  label: "Everyone in the market",
  ages: null,
  stages: [],
  areas: [],
  interests: [],
  members,
  features: [],
});

/**
 * The groups already drawn this Saturday, kept (review, 4 Nov). A family not
 * yet sent theirs joins the drawn group it is most like — at least
 * `NEAR_ENOUGH` as alike as a merge needs — or the market-wide one; only those
 * that fit none are grouped anew. Redrawing on every hourly run let one sign-up shift a
 * group's profile, and with it its key: a new edition, a new deep search, and
 * the three-attempt limit reset.
 */
export function joinDrawn(
  families: readonly FamilyFacts[],
  drawn: readonly CohortProfile[],
  similarity = COHORT_SIMILARITY,
): { joined: Map<string, number[]>; rest: number[] } {
  const joined = new Map<string, number[]>();
  const rest: number[] = [];
  const general = drawn.find((d) => d.key === "c-general");
  families.forEach((f, i) => {
    const mine = familyFeatures(f);
    let best: CohortProfile | null = null;
    let top = similarity * NEAR_ENOUGH;
    for (const d of drawn) {
      if (d.key === "c-general" || !d.features?.length) continue;
      const like = likeness(mine, new Map(d.features));
      if (like >= top) {
        top = like;
        best = d;
      }
    }
    const to = best ?? (mine.size === 0 ? general : undefined);
    if (!to) {
      rest.push(i);
      return;
    }
    joined.set(to.key, [...(joined.get(to.key) ?? []), i]);
  });
  return { joined, rest };
}

/* FNV-1a, 32 bits: a short stable name, not a secret. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
