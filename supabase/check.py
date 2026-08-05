"""Static check over the migrations, for the things a first `db reset` would catch.

Not a substitute for running Postgres — it is what you can do *without* one. It parses
the DDL, then walks every function body and view and complains when something refers to
a table, column, enum value or function that isn't defined.

    python supabase/check.py

Exit code 1 on any finding, so it can go in CI later.
"""

import io
import re
import sys
from collections import defaultdict

FILES = [
    "supabase/migrations/0001_schema.sql",
    "supabase/migrations/0002_views.sql",
    "supabase/migrations/0003_write_ops.sql",
    "supabase/migrations/0004_rls.sql",
    "supabase/migrations/0005_rpc.sql",
    "supabase/migrations/0006_remaining_ops.sql",
    "supabase/migrations/0007_flag_at_capture.sql",
    "supabase/seed.sql",
]

# Postgres built-ins the checker should not chase.
BUILTINS = {
    "coalesce", "nullif", "concat_ws", "count", "max", "min", "sum", "now", "round",
    "jsonb_build_object", "jsonb_build_array", "jsonb_agg", "jsonb_array_elements",
    "jsonb_array_elements_text", "jsonb_array_length", "jsonb_each", "jsonb_typeof",
    "jsonb_object_agg", "jsonb_exists", "jsonb_to_record", "to_jsonb", "array_agg",
    "array_length", "array_remove", "unnest", "similarity", "lower", "upper", "left",
    "right", "substring", "trim", "length", "extract", "gen_random_uuid", "randomint",
    "format", "regexp_replace", "greatest", "least", "exists", "raise", "perform",
    "to_char", "date_trunc", "generate_series", "row_number", "rank", "distinct",
    "string_agg", "cardinality", "abs", "floor", "ceil", "split_part", "replace",
    "any", "all", "bool_or", "bool_and", "array", "row", "coalesce",
    "array_to_string", "array_position", "concat",
}


def load():
    text = {}
    for path in FILES:
        text[path] = io.open(path, encoding="utf-8").read()
    return text


def strip_comments(sql):
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql


def main():
    text = load()
    all_sql = strip_comments("\n".join(text.values()))

    # ── what exists ───────────────────────────────────────────────────────
    tables = {}
    for m in re.finditer(
        r"create table (\w+)\s*\((.*?)\n\);", all_sql, re.S | re.I
    ):
        name, body = m.group(1), m.group(2)
        cols = set()
        for line in body.split("\n"):
            line = line.strip().rstrip(",")
            if not line or line.lower().startswith(
                ("constraint", "primary key", "unique", "check", "foreign key", "references")
            ):
                continue
            col = re.match(r"([a-z_][a-z0-9_]*)\s+\S", line, re.I)
            if col:
                cols.add(col.group(1).lower())
        tables[name.lower()] = cols

    views = {m.group(1).lower() for m in re.finditer(
        r"create (?:or replace )?view (\w+)", all_sql, re.I)}

    functions = {m.group(1).lower() for m in re.finditer(
        r"create or replace function (\w+)", all_sql, re.I)}

    enums = {}
    normalised = re.sub(r"[ 	]+", " ", all_sql)
    for m in re.finditer(r"create type (\w+) as enum \(([^)]*)\)", normalised, re.I):
        enums[m.group(1).lower()] = {
            v.strip().strip("'") for v in m.group(2).split(",") if v.strip()
        }

    # column → the enum type it holds, so literals can be validated
    enum_columns = {}
    for table, cols in tables.items():
        for m in re.finditer(
            r"^\s*([a-z_][a-z0-9_]*)\s+(\w+)\b", "\n".join(
                l for l in strip_comments(
                    re.search(r"create table " + table + r"\s*\((.*?)\n\);",
                              all_sql, re.S | re.I).group(1)
                ).split("\n")
            ), re.I | re.M,
        ):
            col, typ = m.group(1).lower(), m.group(2).lower()
            if typ in enums:
                enum_columns[(table, col)] = typ

    findings = []

    # ── references that must resolve ──────────────────────────────────────
    relations = set(tables) | views

    for path, sql in text.items():
        clean = strip_comments(sql)

        for m in re.finditer(r"\b(?:from|join|insert into|update)\s+([a-z_][a-z0-9_]*)", clean, re.I):
            rel = m.group(1).lower()
            if rel in relations or rel in functions:
                continue
            # subquery aliases, CTEs and set-returning calls
            if rel in {"jsonb_array_elements", "jsonb_array_elements_text", "jsonb_each",
                       "unnest", "select", "t", "x", "v", "set", "now", "anon",
                       "authenticated", "pg_proc", "pg_namespace", "public"}:
                continue
            # CTEs after the first are `), name as (` — not just `with name`.
            cte = r"(?:\bwith\s+|,\s*)" + rel + r"\s+as\s*\("
            if re.search(cte, clean, re.I | re.S):
                continue
            if re.search(r"\)\s*" + rel + r"\b", clean):   # alias after a subquery
                continue
            findings.append(f"{path}: unknown relation `{rel}`")

        for m in re.finditer(r"insert into ([a-z_][a-z0-9_]*)\s*\(([^)]*)\)", clean, re.I):
            table, collist = m.group(1).lower(), m.group(2)
            if table not in tables:
                continue
            for col in [c.strip().lower() for c in collist.split(",") if c.strip()]:
                if col and col not in tables[table]:
                    findings.append(f"{path}: {table} has no column `{col}`")

        for m in re.finditer(r"\b([a-z_][a-z0-9_]*)\s*\(", clean):
            fn = m.group(1).lower()
            if fn in BUILTINS or fn in functions or fn in relations or fn in enums:
                continue
            if fn in {"if", "case", "when", "values", "on", "and", "or", "not", "in",
                      "select", "where", "check", "returns", "table", "function",
                      "declare", "begin", "end", "language", "as", "is", "null",
                      "default", "primary", "constraint", "unique", "using", "with",
                      "order", "group", "having", "limit", "offset", "returning",
                      "for", "loop", "return", "then", "else", "elsif", "int",
                      "text", "boolean", "numeric", "uuid", "jsonb", "timestamptz",
                      "char", "interval", "real", "do", "revoke", "grant", "alter",
                      "create", "index", "gin", "btree", "exception", "raise",
                      "enum", "key", "filter", "conflict", "from", "type", "view",
                      "trigger", "before", "after", "each", "row", "execute",
                      "security", "definer", "stable", "immutable", "plpgsql",
                      "sql", "declare", "hint", "errcode", "union", "all",
                      "join", "left", "inner", "outer", "cascade", "restrict",
                      "extension", "add", "column", "to", "of", "by", "desc",
                      "asc", "nulls", "first", "last", "value", "values"}:
                continue
            findings.append(f"{path}: unknown function `{fn}()`")

    # ── enum literals ─────────────────────────────────────────────────────
    for path, sql in text.items():
        clean = strip_comments(sql)
        for m in re.finditer(r"'([a-z_]+)'::(\w+)", clean):
            value, typ = m.group(1), m.group(2).lower()
            if typ in enums and value not in enums[typ]:
                findings.append(f"{path}: '{value}' is not a value of enum {typ}")
        # An unqualified `status = 'open'` cannot be attributed to a table: `status`
        # exists on six of them, most as plain text with a CHECK. So only the form that
        # names its table is checked. Anything else would be guesswork dressed up as a
        # finding, which is worse than no check.
        for m in re.finditer(
            r"update\s+([a-z_][a-z0-9_]*)\s+set\s+(.*?)(?:\s+where\b|;)", clean, re.S | re.I
        ):
            table, assignments = m.group(1).lower(), m.group(2)
            for a in re.finditer(r"([a-z_][a-z0-9_]*)\s*=\s*'([a-z_]+)'", assignments, re.I):
                col, value = a.group(1).lower(), a.group(2)
                typ = enum_columns.get((table, col))
                if typ and value not in enums[typ]:
                    findings.append(
                        f"{path}: {table}.{col} set to '{value}', "
                        f"not in enum {typ} ({sorted(enums[typ])})"
                    )

    # ── report ────────────────────────────────────────────────────────────
    print(f"tables    {len(tables)}")
    print(f"views     {len(views)}")
    print(f"functions {len(functions)}")
    print(f"enums     {len(enums)}")
    print()

    seen = set()
    unique = [f for f in findings if not (f in seen or seen.add(f))]
    if unique:
        print(f"{len(unique)} findings:")
        for f in unique:
            print("  ·", f)
        return 1
    print("nothing unresolved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
