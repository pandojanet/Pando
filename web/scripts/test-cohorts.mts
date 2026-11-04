/**
 * The weekly digest's groups (4 Nov): how alike two families are, how many
 * groups a market's families make — decided by them, not by a number — and
 * what each group's search is told.
 */
let pass = 0;
let fail = 0;
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
};

const c = (await import(`../lib/digest-cohorts.ts?v=${Date.now()}`)) as typeof import("../lib/digest-cohorts.ts");
type F = import("../lib/digest-cohorts.ts").FamilyFacts;
const groupsOf = (...args: Parameters<typeof c.groupFamilies>) => c.groupFamilies(...args).map((g) => g.members);

let n = 0;
const fam = (ages: number[], area: string | null, extra: Partial<F> = {}): F => ({
  id: `p${String(++n).padStart(3, "0")}`,
  ages,
  neighborhood: area ? area.toLowerCase().replace(/\s+/g, "-") : null,
  area,
  affinities: [],
  relevance: [],
  ...extra,
});

console.log("\n=== how alike two families are ===");
{
  const a = c.familyFeatures(fam([3], "Altadena"));
  const b = c.familyFeatures(fam([2], "Altadena"));
  const d = c.familyFeatures(fam([14], "Arcadia"));
  ok("two toddlers in one town are alike", c.likeness(a, b) > 0.9);
  ok("a toddler and a teen across the market are not", c.likeness(a, d) === 0);
  ok("the child's stage weighs more than the town",
    c.likeness(c.familyFeatures(fam([3], "Altadena")), c.familyFeatures(fam([2], "Arcadia"))) >
      c.likeness(c.familyFeatures(fam([3], "Altadena")), c.familyFeatures(fam([14], "Altadena"))));
  ok("nothing known is alike to nothing", c.likeness(c.familyFeatures(fam([], null)), c.familyFeatures(fam([], null))) === 0);
  ok("the age range and neighborhood edges are not counted twice",
    !c.familyFeatures(fam([3], "Altadena", { affinities: ["age_range:preschool", "neighborhood:altadena", "school:field-elementary"] })).has("aff:age_range:preschool") &&
      c.familyFeatures(fam([3], "Altadena", { affinities: ["school:field-elementary"] })).has("aff:school:field-elementary"));
  ok("a baby on the way is its own stage", c.stageOf(-1) === "expecting" && c.stageOf(0) === "baby" && c.stageOf(7) === "early grades");
}

console.log("\n=== how many groups: what the families make it ===");
{
  const toddlers = [fam([2], "Altadena"), fam([3], "Altadena"), fam([3], "Altadena"), fam([2, 3], "Altadena")];
  const teens = [fam([13], "Arcadia"), fam([14], "Arcadia"), fam([15], "Arcadia")];
  const groups = groupsOf([...toddlers, ...teens]);
  ok("toddlers in Altadena and teens in Arcadia: two groups", groups.length === 2, JSON.stringify(groups));
  ok("each family in exactly one", groups.flat().sort((a, b) => a - b).join() === "0,1,2,3,4,5,6");
  ok("and nobody with the other kind", groups.every((g) => g.every((i) => i < 4) || g.every((i) => i >= 4)));

  const alike = Array.from({ length: 9 }, () => fam([4], "Pasadena"));
  ok("nine alike families: one group, however many there are", groupsOf(alike).length === 1);

  const spread = [
    ...Array.from({ length: 3 }, () => fam([0], "Altadena")),
    ...Array.from({ length: 3 }, () => fam([4], "Pasadena")),
    ...Array.from({ length: 3 }, () => fam([7], "Arcadia")),
    ...Array.from({ length: 3 }, () => fam([10], "Sierra Madre")),
    ...Array.from({ length: 3 }, () => fam([14], "La Canada")),
  ];
  ok("five kinds of family: five groups — the number follows the people", groupsOf(spread).length === 5);
}
{
  const groups = groupsOf([fam([3], "Altadena"), fam([3], "Altadena"), fam([3], "Altadena"), fam([3], "Pasadena")]);
  ok("one family too few for a group of its own joins the one most like it", groups.length === 1 && groups[0].length === 4);
  const unknown = groupsOf([fam([3], "Altadena"), fam([3], "Altadena"), fam([3], "Altadena"), fam([], null), fam([], null)]);
  ok("families the graph knows nothing about go together, not into a stranger's group",
    unknown.length === 2 && unknown.some((g) => g.join() === "3,4"));
  const flagged = c.groupFamilies([fam([3], "Altadena"), fam([3], "Altadena"), fam([3], "Altadena"), fam([], null), fam([14], "Arcadia")]);
  ok("and theirs is the market-wide group, with a family too unlike anyone for a group of its own",
    flagged.filter((g) => g.general).length === 1 && flagged.find((g) => g.general)?.members.join() === "3,4" &&
      flagged.filter((g) => !g.general).every((g) => g.members.length >= 3));
}
{
  const many = Array.from({ length: 40 }, (_, i) => fam([i % 18], `Town ${i % 20}`));
  const groups = groupsOf(many, { similarity: 0.95, min: 1, max: 6 });
  ok("never more agent searches than the ceiling", groups.length <= 6, String(groups.length));
}
{
  const fams = [fam([3], "Altadena"), fam([14], "Arcadia"), fam([3], "Altadena"), fam([14], "Arcadia"), fam([3], "Altadena"), fam([14], "Arcadia")];
  const once = JSON.stringify(groupsOf(fams));
  const shuffled = [fams[5], fams[2], fams[0], fams[4], fams[1], fams[3]];
  const again = groupsOf(shuffled).map((g) => g.map((i) => shuffled[i].id).sort());
  const first = JSON.parse(once).map((g: number[]) => g.map((i) => fams[i].id).sort());
  ok("the same families make the same groups in any order — every hourly run of a Saturday",
    JSON.stringify(again.sort()) === JSON.stringify(first.sort()));
}

console.log("\n=== what a group's search is told ===");
{
  const members = [
    fam([3], "Altadena", { affinities: ["school:the-growing-place"], relevance: ["logistics:weekend_friendly", "budget:mid_range"] }),
    fam([2], "Altadena", { relevance: ["logistics:weekend_friendly"] }),
    fam([4], "Altadena", { affinities: ["school:the-growing-place"] }),
  ];
  const p = c.cohortProfile(members);
  ok("its stages — what two or more of it share; one family's preschooler is not the group's", p.stages.join() === "toddler", p.stages.join());
  ok("the ages of those stages", p.ages?.min === 2 && p.ages?.max === 3);
  ok("its town", p.areas.join() === "Altadena");
  ok("what a third of it shares, readable; the budget left out",
    p.interests.includes("weekend friendly") && p.interests.includes("the growing place") && !p.interests.some((i) => i.includes("mid")));
  ok("a label for the admin", p.label === "toddler · Altadena · weekend friendly, the growing place", p.label);
  ok("what most of it shares, kept for a family who signs up later that day",
    p.features.some(([k]) => k === "stage:toddler") && p.features.some(([k]) => k === "area:altadena"));
  ok("a stable key: the same profile is the same edition", c.cohortProfile([...members].reverse()).key === p.key && /^c-[0-9a-z]+$/.test(p.key));
  ok("a different profile, a different key", c.cohortProfile([fam([14], "Arcadia")]).key !== p.key);
  const general = c.cohortProfile([fam([], null), fam([], null)]);
  ok("a group with nothing in common says so and has no ages", general.label === "Everyone in the market" && general.ages === null);
  const wide = c.cohortProfile([fam([4], "Pasadena"), fam([], null), fam([], null)], true);
  ok("the market-wide group is never narrowed by what one of its families has (the lab: a 4 year old made it 'preschool')",
    wide.label === "Everyone in the market" && wide.ages === null && wide.stages.length === 0 && wide.key === "c-general");
}

console.log("\n=== the review's cases (4 Nov) ===");
{
  /* A lone unlike family sorted first stopped the toddler pair from joining the toddlers. */
  const lone = { ...fam([14], "La Canada", { affinities: ["faith:st-marks"] }), id: "a000" };
  const pair = [fam([2], "Altadena"), fam([3], "Altadena")];
  const three = [fam([2], "Altadena"), fam([3], "Altadena"), fam([2], "Altadena")];
  const groups = c.groupFamilies([lone, ...pair, ...three]);
  const toddlers = groups.find((g) => g.members.includes(1));
  ok("every small group is tried: one that matches nobody does not stop the others",
    toddlers?.members.length === 5 && !toddlers.general, JSON.stringify(groups));
  ok("and the unlike family goes to the market-wide group, not to a stranger's", groups.find((g) => g.members.includes(0))?.general === true);
}
{
  const groups = c.groupFamilies([fam([2], "Altadena"), fam([3], "Altadena"), fam([2], "Altadena"), fam([14], "Altadena")]);
  ok("sharing only a town is not enough to be put in another stage's group",
    groups.find((g) => g.members.includes(3))?.general === true);
}
{
  const mixed = c.cohortProfile([fam([0], "A1"), fam([2], "A2"), fam([4], "A3"), fam([7], "A4")]);
  ok("a group with no stage in common has no ages, and is the market-wide edition", mixed.ages === null && mixed.key === "c-general");
  ok("each stage is told with its own ages", c.stageWithAges("toddler") === "toddler (2-3)" && c.stageWithAges("teens") === "teens (12+)" && c.stageWithAges("expecting") === "a baby on the way");
}
{
  const drawnFams = [fam([2], "Altadena"), fam([3], "Altadena"), fam([2], "Altadena")];
  const teens = [fam([14], "Arcadia"), fam([13], "Arcadia"), fam([15], "Arcadia")];
  const drawn = [c.cohortProfile(drawnFams), c.cohortProfile(teens), c.cohortProfile([fam([], null)], true)];
  const late = [fam([3], "Altadena"), fam([], null), fam([9], "Sierra Madre")];
  const { joined, rest } = c.joinDrawn(late, drawn);
  ok("a family signing up later that Saturday joins the group already drawn that it is like",
    joined.get(drawn[0].key)?.join() === "0");
  ok("one the graph knows nothing about joins the market-wide group", joined.get("c-general")?.join() === "1");
  ok("one like none is grouped anew, and no drawn group's key moves", rest.join() === "2" && c.cohortProfile(drawnFams).key === drawn[0].key);
}

console.log(`\n  ${pass} checks passed${fail ? `, ${fail} FAILED` : ""}.`);
if (fail) process.exit(1);
