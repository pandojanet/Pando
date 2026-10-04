# Documentation standards

> Document type: **rules**. Read this when writing or moving a durable doc, a skill, an
> agent instruction or a substantive code comment. Chat replies may stay short; these may
> not.

## Where a thing is written

| It is… | It goes in |
| ------ | ---------- |
| needed on every task | [CLAUDE.md](../CLAUDE.md) — a map, kept short because every session loads it |
| a rule whose breach is a product bug | [.claude/rules/invariants.md](../.claude/rules/invariants.md) |
| a procedure for one kind of task | a skill under `.claude/skills/` |
| a choice a later session could undo | a row in [decisions.md](decisions.md) |
| what is built | [status.md](status.md) |
| a shortcut taken on purpose | [technical-debt.md](technical-debt.md) |
| how a change is proven | [reference/validation.md](reference/validation.md) |
| where code lives | [reference/code-map.md](reference/code-map.md) |

A rule lives in exactly one of these. If the same rule is needed in two places, one links
to the other. A new rule for agents is added after a real mistake it would have
prevented, and says which one — not in advance.

## Banner

Every doc under `docs/` opens with a one-line banner: its **type** (rules, inventory,
runbook, test plan, scope reconciliation, decision log, open question) and, when it
moved or stopped being current, the date and where it went.

## Link to other documents

Refer to another document with an **inline markdown link**, never a bare path in
backticks. Link to a heading when you mean a section. The link text says what the reader
will find. Code paths, package names and env vars may stay in backticks.

## Plain language

Assume the reader is not a native English speaker. Prefer ordinary words that translate
cleanly. Do not use unexplained metaphors for code or process ("sunset", "seam",
"ledger", "tribal knowledge"); if a short industry term is unavoidable, define it in the
same sentence.

## Cold-reader pass

Reread as someone who has not lived in this domain:

- introduce each important identifier with its kind of thing on first use (table, route,
  function in `path`, env var, enum value);
- name what pronouns and shorthand refer to;
- replace a packed clause only the author can unpack with one clear sentence.

## Comments in code

A comment says *why* — the constraint, the measurement, the incident — never what the
next line does. A comment that restates the code, or a doc that restates what a schema or
type already says, is maintained forever for nothing.
