#!/usr/bin/env node
// PreToolUse hook (Edit|Write|MultiEdit) — the admin explains nothing on the page.
//
// The client's call, 7 Sep, and the developer's again on 12 Nov ("a hook that
// won't add explanations to the page's components"; then, of the digests page's
// one-line intro, "it should have fired right here"): an admin page carries its
// facts, never prose about how to read them — no intro under the title either
// (.claude/skills/pando-design-system/SKILL.md, "The admin surface").
//
// So an edit to a .tsx under web/app/(admin)/ or web/components/admin/ is
// refused (exit 2, the reason on stderr) when what it ADDS has:
//   - a sentence written into the markup — a run of JSX text of SENTENCE_WORDS
//     words or more ("Marked days have a digest; the number is families texted.");
//   - a sentence in a string — a prop (`intro="…"`, `body="…"`, `hint={…}`) or an
//     expression (`{saved ? "Saved. The next ranking uses it." : …}`); a label,
//     a component's title, a placeholder and aria-* are not read;
//   - a new `<Hint`;
//   - a native tooltip: `title=` on a lowercase (DOM) element.
//
// A sentence that is the data's own state — "Nothing found for this group, so
// nobody got a text from it." — is not an explanation, and neither is an action's
// result ("Saved."). Mark it, right before the text or on one of the two lines
// above: `{/* copy: state */}` (in a string: `/* copy: state */ "…"`). The one
// other mark is `copy: kept — <reason>`, for a warning before an action (who sees
// a note, that opening one is audited, what a delete removes).
//
// Only what the edit adds counts: a finding whose words were already in the old
// string (or, for a Write, the file) passes, so moving or re-wrapping an old
// sentence does not trip on it — only a new one does.
//
//   node .claude/hooks/no-explainers.mjs --scan web/app/(admin) web/components/admin
// lists what the existing files carry, the same rules over whole files.
//
// Fail-open on a payload it cannot read: this is a style rule, not a safety one,
// and a hook that blocks every edit on a parse error stops all work.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SENTENCE_WORDS = 7;
const SCOPE = [/^web\/app\/\(admin\)\/.+\.tsx$/, /^web\/components\/admin\/.+\.tsx$/];
/* The sign-in screen is the gate, not an admin page: on a deployment with no credentials its words are
   the only way an operator learns how to get in. */
const OUT_OF_SCOPE = [/^web\/components\/admin\/LoginForm\.tsx$/];
/* state: the data's own state or an action's result · kept: a warning before an action, with its reason. */
const MARK = /copy:\s*(state|kept)\b/i;
/* Text inside these is a control's own label or a heading, never an explanation. */
const LABEL_TAGS = new Set(["Checkbox", "Radio", "Button", "TextLink", "InlineAction", "Badge", "Th", "label", "button", "a", "option", "summary", "th", "dt", "h1", "h2", "h3", "h4", "legend"]);
/* The files that define the primitives — a `Hint` there is the definition, not a use. */
const PRIMITIVES = /(^|\/)components\/admin\/(ui|kit)\.tsx$/;

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function toProjectPath(candidate) {
  const rel = relative(projectDir, resolve(projectDir, candidate));
  if (rel === "" || rel.startsWith("..")) return null;
  return rel.split(sep).join("/");
}

export const inScope = (path) => SCOPE.some((r) => r.test(path)) && !OUT_OF_SCOPE.some((r) => r.test(path));

/** Strip comments, keeping line count, so commented prose is never read as markup. */
function uncomment(text) {
  return text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/.*$/gm, (m, p) => p + " ".repeat(m.length - p.length));
}

const words = (s) => s.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w));

/**
 * The findings in a piece of TSX: { line, kind, text }. `lines` (a Set of 0-based
 * line numbers) limits them to those lines; null reads everything.
 */
export function findExplainers(source, lines = null, path = "") {
  const raw = source.split("\n");
  const code = uncomment(source).split("\n");
  const marked = (i) => [i, i - 1, i - 2].some((k) => k >= 0 && MARK.test(raw[k] ?? ""));
  const want = (i) => (lines === null || lines.has(i)) && !marked(i);
  const out = [];
  code.forEach((line, i) => {
    if (!want(i)) return;
    if (/<Hint[\s>]/.test(line) && !PRIMITIVES.test(path)) out.push({ line: i + 1, kind: "a Hint", text: raw[i].trim() });
    if (/<[a-z][\w-]*\b[^>]*\stitle=/.test(line)) out.push({ line: i + 1, kind: "a native tooltip (title=)", text: raw[i].trim() });
  });
  /* JSX text: what sits between a tag's ">" and the next "<" or "{", over lines. */
  const flat = code.join("\n");
  const re = />([^<>{}]+)(?=[<{])/g;
  let m;
  while ((m = re.exec(flat))) {
    const text = m[1];
    if (words(text).length < SENTENCE_WORDS) continue;
    /* Not markup at all: an arrow, a comparison or a statement inside code ("a => b < c"). */
    if (/=>|[!=]==?|&&|\|\||\breturn\b|\bconst\b|\blet\b|\btypeof\b|\bfunction\b|\basync\b|\.\.\./.test(text)) continue;
    /* A control's own label or a heading: the element whose opening tag this text follows. */
    const lt = flat.lastIndexOf("<", m.index);
    const open = lt >= 0 ? /^<([A-Za-z][\w.-]*)/.exec(flat.slice(lt)) : null;
    if (open && LABEL_TAGS.has(open[1])) continue;
    /* The lines the words themselves sit on — not the opening tag's line before them. */
    const lead = text.length - text.trimStart().length;
    const first = flat.slice(0, m.index + 1 + lead).split("\n").length - 1;
    const span = Array.from({ length: text.trim().split("\n").length }, (_, k) => first + k);
    if (span.some(marked)) continue;
    const hit = span.find((i) => lines === null || lines.has(i));
    if (hit === undefined) continue;
    out.push({ line: hit + 1, kind: "a sentence in the markup", text: text.trim().replace(/\s+/g, " ") });
  }
  /* A sentence in a string: a prop (`intro="…"`, `body="…"`, `hint={`…`}`) or an expression
     (`{saved ? "Saved. The next ranking uses it." : null}`) renders as prose just the same.
     Quoted strings stay on one line, so a stray apostrophe cannot pair across the file. */
  const str = /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g;
  while ((m = str.exec(flat))) {
    const body = m[0].slice(1, -1).replace(/\$\{[^}]*\}/g, "N");
    if (!isProse(body)) continue;
    const before = flat.slice(Math.max(0, m.index - 400), m.index);
    /* A placeholder is an example value, a title= on a component is its heading, a label is a label,
       aria-* and alt are never on the page. */
    const attr = valueOf(flat, m.index);
    if (attr && NOT_PROSE_ATTRS.test(attr)) continue;
    if (/(?:\bnew\s+\w*Error|\bconsole\.\w+|\bthrow)\s*\(?\s*$/.test(before)) continue;
    /* A label or a heading given as data: `{ label: "answers to read or send — a parent is waiting" }`. */
    if (/\b(label|title|heading|placeholder)\s*:\s*$/.test(before)) continue;
    /* A string among a label or a heading's children — `<label>{a ? "…" : "…"}</label>` — is its label. */
    const lt = flat.lastIndexOf("<", m.index);
    const open = lt >= 0 ? /^<([A-Za-z][\w.-]*)/.exec(flat.slice(lt)) : null;
    const tagEnd = lt >= 0 ? flat.slice(lt, m.index).search(/(?<!=)>/) : -1;
    if (open && LABEL_TAGS.has(open[1]) && tagEnd >= 0 && !attr) continue;
    const first = flat.slice(0, m.index).split("\n").length - 1;
    const span = Array.from({ length: m[0].split("\n").length }, (_, k) => first + k);
    if (span.some(marked)) continue;
    const hit = span.find((i) => lines === null || lines.has(i));
    if (hit === undefined) continue;
    const text = body.replace(/\s+/g, " ").trim();
    if (out.some((f) => f.line === hit + 1 && f.text.includes(text))) continue;
    out.push({ line: hit + 1, kind: "a sentence in a string", text });
  }
  return out;
}

/**
 * The prop whose value the string at `at` is part of — `hint` for `hint="…"` or `hint={x ? "…" : ""}` —
 * or null when it is not inside a prop's value (children, code).
 */
function valueOf(flat, at) {
  const from = Math.max(0, at - 600);
  const re = /([A-Za-z][\w-]*)=(?=["'{`])/g;
  re.lastIndex = from;
  let m;
  let found = null;
  while ((m = re.exec(flat)) && m.index < at) {
    const start = m.index + m[0].length;
    if (start === at) { found = m[1]; continue; }
    if (flat[start] !== "{") continue;
    let depth = 0;
    let inside = false;
    for (let i = start; i < at; i++) {
      if (flat[i] === "{") depth++;
      else if (flat[i] === "}") depth--;
      if (depth === 0) break;
      if (i === at - 1) inside = true;
    }
    if (inside) found = m[1];
  }
  return found;
}

const NOT_PROSE_ATTRS = /^(placeholder|title|label|alt|aria-[\w-]+|className|href|id|key|type|role|name|value|htmlFor|data-[\w-]+)$/;

/** Words of a sentence, not code or class names: seven at least, most of the string. */
function isProse(s) {
  const toks = s.trim().split(/\s+/).filter(Boolean);
  const natural = toks.filter((w) => /^[("“‘'«]?[A-Za-z][A-Za-z'’-]*[)"”’»,.;:!?]*$/.test(w) && !/^[a-z]+-[a-z0-9[]/.test(w));
  return natural.length >= SENTENCE_WORDS && natural.length / toks.length >= 0.7;
}

const flatten = (s) => s.replace(/\s+/g, " ").trim();

/** The findings in `next` whose words were not already in `prev`. */
function added(prev, next, path) {
  const had = flatten(prev);
  return findExplainers(next, null, path).filter((f) => !had.includes(flatten(f.text)));
}

function report(path, findings) {
  return [
    `no-explainers: ${path} — the admin explains nothing on the page (client, 7 Sep).`,
    ...findings.map((f) => `  line ${f.line}: ${f.kind} — ${f.text.slice(0, 140)}`),
    "Remove it: let the layout, the labels and the numbers say it — no intro under the title, no body on an",
    "empty state. If it is the data's own state or an action's result rather than an explanation (\"Nothing",
    "found for this group…\", \"Saved.\"), mark it {/* copy: state */} right before it (in a string:",
    "/* copy: state */ \"…\"); a warning before an action is {/* copy: kept — <reason> */}.",
  ].join("\n");
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

/* ── CLI: --scan ─────────────────────────────────────────────────────────── */
if (process.argv[2] === "--scan") {
  let total = 0;
  for (const root of process.argv.slice(3)) {
    for (const file of walk(resolve(projectDir, root))) {
      if (!inScope(toProjectPath(file) ?? "")) continue;
      const findings = findExplainers(readFileSync(file, "utf8"), null, toProjectPath(file) ?? "");
      if (!findings.length) continue;
      total += findings.length;
      console.log(`\n${toProjectPath(file)}`);
      for (const f of findings) console.log(`  ${f.line}: ${f.kind} — ${f.text.slice(0, 160)}`);
    }
  }
  console.log(`\n${total} finding(s).`);
  process.exit(0);
}

/* ── Hook ─────────────────────────────────────────────────────────────────── */
/* `fileURLToPath`, not `new URL(…).pathname` (16 Nov): on Windows the pathname is "/D:/…", which
   resolves to "D:\D:\…", never matched the script path, and the hook silently allowed every edit. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const tool = input?.tool_name;
  const ti = input?.tool_input ?? {};
  const path = typeof ti.file_path === "string" ? toProjectPath(ti.file_path) : null;
  if (!path || !inScope(path) || !["Edit", "Write", "MultiEdit"].includes(tool)) process.exit(0);

  let findings = [];
  if (tool === "Write") {
    let before = "";
    try {
      before = readFileSync(resolve(projectDir, path), "utf8");
    } catch {
      /* a new file: everything is added */
    }
    const content = String(ti.content ?? "");
    findings = added(before, content, path);
  } else {
    const edits = tool === "MultiEdit" ? (ti.edits ?? []) : [ti];
    for (const e of edits) {
      const next = String(e.new_string ?? "");
      findings.push(...added(String(e.old_string ?? ""), next, path));
    }
  }
  if (findings.length) {
    console.error(report(path, findings));
    process.exit(2);
  }
  process.exit(0);
}
