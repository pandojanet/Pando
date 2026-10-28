/**
 * Parent ↔ parent connections (22 Oct) — the graph an admin adds to.
 *
 * What the developer decided: an admin records a connection on a parent's
 * profile; one general kind (`connected`) with an optional note; shown only on
 * the admin profile, read by nothing else. Pinned here as source and schema,
 * because the write is SQL against the one database and every rule that
 * matters is in its WHERE.
 */
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const labels = (await import(`../lib/admin/labels.ts?v=${Date.now()}`)) as typeof import("../lib/admin/labels");

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

console.log("\n=== the migration widens, and only widens ===");
const m = read("../drizzle/0061_person_links.sql");
const m44 = read("../drizzle/0044_person_relationships.sql");
const journal = JSON.parse(read("../drizzle/meta/_journal.json")) as { entries: Array<{ tag: string; when: number }> };
const entry = journal.entries.find((e) => e.tag === "0061_person_links");
ok("it is in the journal", Boolean(entry));
/* Later than every migration before it (a later file may follow it). */
const before = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === "0061_person_links"));
ok("with a `when` after every earlier one, or the migrator skips it", entry !== undefined && before.every((e) => e.when < entry.when));
for (const name of ["person_relationships_relationship_check", "person_relationships_source_check"]) {
  ok(`${name} is the name 0044 gave it`, m44.includes(name) && m.includes(`DROP CONSTRAINT IF EXISTS ${name}`));
}
const old: string[] = (m44.match(/relationship" IN \(([\s\S]*?)\)\)/)?.[1] ?? "").match(/'[a-z_]+'/g) ?? [];
const now: string[] = (m.match(/relationship IN \(([^)]*)\)/)?.[1] ?? "").match(/'[a-z_]+'/g) ?? [];
ok("every relationship 0044 allowed is still allowed", old.length >= 8 && old.every((v) => now.includes(v)), `${old} -> ${now}`);
ok("plus the one general kind", now.includes("'connected'"));
ok("the invite source stays, an admin source is added", /source IN \('invite', 'admin'\)/.test(m));
ok("a note is allowed on an admin's connection, still at most 120", /relationship IN \('other', 'connected'\) AND char_length\(note\) BETWEEN 1 AND 120/.test(m));
ok("no column, no index, no rewrite of a row", !/ADD COLUMN|CREATE (UNIQUE )?INDEX|UPDATE |DELETE /i.test(m));
const schema = read("../lib/db/schema.ts");
ok("schema.ts says the same", schema.includes("'other','connected')`") && schema.includes("in ('invite','admin')`"));

console.log("\n=== the write ===");
const write = read("../lib/server/repo/admin-write.ts");
const link = write.slice(write.indexOf('case "person.link": {'), write.indexOf('case "person.unlink": {'));
const unlink = write.slice(write.indexOf('case "person.unlink": {'), write.indexOf('case "referral.void": {'));
ok("one edge per pair, either way round", /pr\.person_id = \$\{a\}::uuid and pr\.related_person_id = \$\{other\}::uuid\)\s*or \(pr\.person_id = \$\{other\}::uuid and pr\.related_person_id = \$\{a\}::uuid/.test(link));
ok("written as the admin's, of the one kind", link.includes("'connected'") && link.includes("'admin'"));
ok("never a test profile with a real parent", link.includes("link_test_mixed"));
ok("both people must exist", link.includes("people.length !== 2"));
ok("before 0061 it says so rather than failing", link.includes("links_not_migrated") && link.includes("person_relationships_source_check"));
ok("a parent's own invite answer is never removed by an admin", /delete from person_relationships where id = \$\{target\}::uuid and source = 'admin'/.test(unlink));

console.log("\n=== the route and the screen ===");
const route = read("../app/api/admin/action/route.ts");
const names = read("../lib/admin/action-names.ts");
ok("both actions are allowlisted", names.includes('"person.link",') && names.includes('"person.unlink",'));
ok("a parent cannot be connected to themselves", route.includes("A parent cannot be connected to themselves"));
ok("each refusal has a sentence", /links_not_migrated:/.test(route) && /link_test_mixed:/.test(route));
const page = read("../app/(admin)/admin/contributors/[id]/page.tsx");
ok("the profile shows the connections and adds one", page.includes('action: "person.link"') && page.includes('action: "person.unlink"') && page.includes("Connections ("));
ok("only an admin's connection has a remove control", page.includes('k.source === "admin" && ('));
ok("the picker offers neither the parent, nor one already connected, nor the other world (test/real)", page.includes("p.id !== id &&") && page.includes("p.is_test === c.is_test") && page.includes("!c.connections.some((k) => k.person_id === p.id)"));
const readSrc = read("../lib/server/repo/admin-read.ts");
ok("the read finds an edge from either end", readSrc.includes("where pr.person_id = p.id or pr.related_person_id = p.id"));

console.log("\n=== read by nothing else ===");
for (const file of ["../lib/server/repo/retrieval.ts", "../lib/server/repo/blast.ts", "../lib/server/repo/introductions.ts", "../lib/matching.ts"]) {
  ok(`${file.split("/").pop()} does not read the graph`, !read(file).includes("person_relationships"));
}

console.log("\n=== the words ===");
ok("every stored kind has an admin's word", ["connected", "family", "close_friend", "friend", "neighbor", "colleague", "parent_group", "school_parent", "other"].every((k) => Boolean(labels.RELATIONSHIP[k])));

console.log(`\n  ${pass} checks passed${fail > 0 ? `, ${fail} FAILED` : ""}.\n`);
process.exit(fail > 0 ? 1 : 0);
