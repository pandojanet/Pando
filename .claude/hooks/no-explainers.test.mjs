// Part of npm --prefix web run test:hooks.
//
// Runs no-explainers.mjs the way Claude Code does — JSON on stdin, exit code read
// back — against a throwaway project, then scans Pando's own admin (it must stay at
// zero) and checks the wiring.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(here, "no-explainers.mjs");
const pando = join(here, "..", "..");
const project = mkdtempSync(join(tmpdir(), "no explainers-"));
const put = (path, content) => {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), content);
};

const PAGE = "web/app/(admin)/admin/digests/page.tsx";
const KIT = "web/components/admin/kit.tsx";
const SITE = "web/app/(site)/about/page.tsx";

const run = (tool, tool_input, cwd = project) =>
  spawnSync("node", [hook], {
    input: typeof tool_input === "string" ? tool_input : JSON.stringify({ tool_name: tool, tool_input }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
const status = (...a) => run(...a).status;
const edit = (path, old_string, new_string) => status("Edit", { file_path: join(project, path), old_string, new_string });
const write = (path, content) => status("Write", { file_path: join(project, path), content });

let failed = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `  (got ${actual}, expected ${expected})`}`);
};

const LEGEND = `<p className="mt-2">Marked days have a digest; the number is families texted.</p>`;

/* Refused: what an edit adds. */
check("a sentence added to an admin page", edit(PAGE, "<div>", `<div>\n  ${LEGEND}`), 2);
check("a sentence over several lines", edit(PAGE, "<p>", `<p>\n  Marked days have a digest; the\n  number is families texted.\n</p>`), 2);
check("a new <Hint", edit(PAGE, "<X />", `<Hint label="Why">x</Hint>`), 2);
check("a native tooltip on a DOM element", edit(PAGE, "<td>", `<td title="Families texted">3</td>`), 2);
check("a sentence in an admin component", edit("web/components/admin/conversations/Thread.tsx", "<a/>", LEGEND), 2);
check("MultiEdit: the second edit adds one", status("MultiEdit", {
  file_path: join(project, PAGE),
  edits: [{ old_string: "a", new_string: "b" }, { old_string: "<div>", new_string: `<div>${LEGEND}` }],
}), 2);
check("Write: a new admin page with a sentence", write("web/app/(admin)/admin/new/page.tsx", `export default () => (\n  ${LEGEND}\n);\n`), 2);

const rejected = run("Edit", { file_path: join(project, PAGE), old_string: "<div>", new_string: LEGEND });
check("the refusal says why, on stderr", /explains nothing on the page/.test(rejected.stderr.toString()), true);

check("a page intro as a prop", edit(PAGE, "<X />", `<PageHead title="Weekly digests" intro="What went out each Saturday, what families picked, and what needs a look." />`), 2);
check("an empty state's body", edit(PAGE, "<X />", `<Empty title="No digest yet" body="The first digest appears here after a Saturday send." />`), 2);
check("a sentence in an expression", edit(PAGE, "a", `setNote(saved ? \`Saved \${n} changes. The next ranking uses them now.\` : "");`), 2);
check("a hint prop in braces", edit(PAGE, "<X />", `<Stat hint={\`\${a} sent in the last day and not counted either way\`} />`), 2);
check("a string inside a Badge's hint", edit(PAGE, "<X />", `<Badge tone="red" hint="Opening it is recorded against your name and kept.">Note</Badge>`), 2);
check("the old intro mark no longer passes", edit(PAGE, "<X />", `<p>{/* copy: intro */}Questions parents left in the Seed Tool, and where the rest are.</p>`), 2);

/* Allowed. */
check("a state in a string, marked", edit(PAGE, "a", `setNote(/* copy: state */ "Deleted. Their profile and their consent records are gone.");`), 0);
check("a kept warning in a prop, marked", edit(PAGE, "<X />", `<Field label="Note" hint={/* copy: kept — who sees it */ "Saved with your name. Never reaches the parent."} />`), 0);
check("a label prop", edit(PAGE, "<X />", `<SegmentedFilter label="Which question to answer about these contributors" />`), 0);
check("a label given as data", edit(PAGE, "a", `const todo = [{ label: "answers to read or send — a parent is waiting", n }];`), 0);
check("a label inside braces", edit(PAGE, "<X />", `<Field label={tip ? "Why it helped" : "What they like, or what didn't work for them"} />`), 0);
check("a placeholder", edit(PAGE, "<X />", `<input placeholder="Any good toddler swim classes near South Pasadena?" />`), 0);
check("a component's title", edit(PAGE, "<X />", `<RecordDrawer title={\`Who Pando would ask (\${a} of \${b} wanted)\`} />`), 0);
check("class names are not words", edit(PAGE, "<X />", `<p className="mt-2 rounded-xl border border-bark bg-paper px-3 py-2 text-muted" />`), 0);
check("a string in a label's children", edit(PAGE, "<X />", `<label htmlFor={id}>{done ? "What they said (optional)" : "Note (needed to not take it forward)"}</label>`), 0);
check("a short label", edit(PAGE, "<div>", `<p>Families texted</p>`), 0);
check("a sentence already there, kept by the edit", edit(PAGE, `<div>${LEGEND}</div>`, `<section>\n${LEGEND}\n</section>`), 0);
check("a state, marked", edit(PAGE, "<div>", `<p>{/* copy: state */}Nothing found for this group, so nobody got a text from it.</p>`), 0);
check("a state, marked on the line above", edit(PAGE, "<div>", `{/* copy: state */}\n<p>\n  Nothing found for this group, so nobody got a text from it.\n</p>`), 0);
check("a kept exception, marked with its reason", edit(PAGE, "<div>", `<p>{/* copy: kept — what the delete removes */}This deletes their profile, their sign-up and their consent records.</p>`), 0);
check("a control's own label", edit(PAGE, "<div>", `<Checkbox checked={a} onChange={b}>Only show the families who have not tapped anything yet</Checkbox>`), 0);
check("a heading", edit(PAGE, "<div>", `<h2>Which of the groups got the most replies this week so far</h2>`), 0);
check("prose in a comment", edit(PAGE, "<div>", `{/* Marked days have a digest; the number is families texted. */}`), 0);
check("code, not markup", edit(PAGE, "a", `const n = rows.filter((r) => r.a > 1 && r.b < 2 && r.c > 3 && r.d < 4).length;`), 0);
check("a Hint where it is defined", edit(KIT, "<X />", `<Hint label="Why">x</Hint>`), 0);
check("title= on a component (a prop, not a tooltip)", edit(PAGE, "<X />", `<Card title="Groups">x</Card>`), 0);
check("outside the admin", edit(SITE, "<div>", LEGEND), 0);
check("the admin sign-in screen", edit("web/components/admin/LoginForm.tsx", "<div>", LEGEND), 0);
check("not a .tsx file", edit("web/app/(admin)/admin/digests/notes.md", "a", "Marked days have a digest; the number is families texted."), 0);
check("a tool that does not write", status("Read", { file_path: join(project, PAGE) }), 0);
check("a path outside the project", status("Edit", { file_path: "/elsewhere/web/app/(admin)/admin/x/page.tsx", old_string: "a", new_string: LEGEND }), 0);
check("a payload it cannot read (fail-open)", status(null, "not json"), 0);

put(PAGE, `export default () => (\n  ${LEGEND}\n);\n`);
check("Write: rewriting a file that already had the sentence", write(PAGE, `export default () => (\n  <main>\n    ${LEGEND}\n  </main>\n);\n`), 0);

/* Pando's own admin stays at zero. */
const scan = spawnSync("node", [hook, "--scan", "web/app/(admin)", "web/components/admin"], {
  env: { ...process.env, CLAUDE_PROJECT_DIR: pando },
});
const out = scan.stdout.toString();
check("Pando's admin carries no unmarked explanation", /\n0 finding\(s\)\./.test(out), true);
if (!/\n0 finding\(s\)\./.test(out)) console.log(out);

/* Wiring: registered for every tool that writes a file, anchored to the project. */
const settings = JSON.parse(readFileSync(join(here, "..", "settings.json"), "utf8"));
const entry = (settings.hooks?.PreToolUse ?? []).find((e) => e.hooks?.some((h) => h.command?.includes("no-explainers.mjs")));
check("wired as a PreToolUse hook", Boolean(entry), true);
for (const tool of ["Edit", "Write", "MultiEdit"]) {
  check(`matcher covers ${tool}`, entry?.matcher?.split("|").includes(tool) ?? false, true);
}
check("command is anchored to $CLAUDE_PROJECT_DIR", entry?.hooks?.some((h) => h.command.includes("$CLAUDE_PROJECT_DIR")) ?? false, true);

rmSync(project, { recursive: true, force: true });
console.log(`\n${failed ? `${failed} failed` : "all passed"}`);
process.exit(failed ? 1 : 0);
