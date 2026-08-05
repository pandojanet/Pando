"""Convert the Postgres-node workflows into HTTP/RPC ones.

Supabase's direct database host is IPv6-only unless you pay for the IPv4 add-on, so on
an IPv4 VPS the Postgres node cannot dial it at all. PostgREST is a plain HTTPS
endpoint, and every write operation already takes a single `payload jsonb` — which is
exactly PostgREST's RPC calling convention. So the conversion is mechanical:

    Postgres:  select write_person($1::jsonb)      queryReplacement = {{ … }}
    HTTP:      POST {base}/rest/v1/rpc/write_person   body = { "payload": { … } }

Run from the repo root:

    python n8n/to-http.py

Reads  n8n/workflows/*.json  →  writes  n8n/workflows/http/*.json

The graphs are copied node for node, so the two sets stay behaviourally identical and
you can switch transports by importing the other folder.
"""

import io
import json
import os
import re
import sys

SRC = "n8n/workflows"
DST = "n8n/workflows/http"

# One n8n credential, holding the service-role key as the `apikey` header.
CRED = {"httpHeaderAuth": {"id": "REPLACE_WITH_CREDENTIAL_ID", "name": "Pando Supabase RPC"}}

# Set once in n8n → Settings → Variables, so the project ref lives in one place.
BASE = "{{ $vars.SUPABASE_URL }}/rest/v1/rpc/"


def rpc_call(fn, payload_expr, node):
    """An HTTP Request node calling one PostgREST RPC function."""
    return {
        "parameters": {
            "method": "POST",
            "url": f"={BASE}{fn}",
            "authentication": "genericCredentialType",
            "genericAuthType": "httpHeaderAuth",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    # PostgREST returns a bare scalar for a scalar-returning function
                    # unless asked for JSON; asking keeps the shape predictable.
                    {"name": "Accept", "value": "application/json"},
                    # Supabase's gateway wants the role in Authorization as well as in
                    # the apikey header on some plans. Same key, and it stays in the
                    # credential rather than in the node.
                    {"name": "Content-Profile", "value": "public"},
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": payload_expr,
            "options": {
                # NOT neverError: a 4xx from PostgREST has to fail the node. Letting it
                # flow on would make the workflow answer `persisted: true` for a write
                # that never happened — the exact quiet failure this project refuses.
                "response": {"response": {"responseFormat": "json"}},
                "timeout": 15000,
            },
        },
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": node["position"],
        "id": node["id"],
        "name": node["name"],
        "credentials": CRED,
        "notes": node.get("notes", ""),
        "notesInFlow": node.get("notesInFlow", False),
        **({"alwaysOutputData": True} if node.get("alwaysOutputData") else {}),
    }


def unwrap_consumers(nodes, node_name, alias):
    """
    Rewrite `$('Node').first().json.<alias>` to `$('Node').first().json`.

    The Postgres node returned a row, so `select fn(...) as person_id` arrived as
    `{ person_id: … }`. PostgREST returns the function's value on its own, with no
    column to name it. Downstream expressions have to lose the key — and this is the
    one difference between the two transports, so it is done mechanically rather than
    left as a footnote for somebody to trip over.
    """
    if not alias:
        return
    def rewrite(text):
        if f"'{node_name}'" not in text:
            return text
        # Direct: $('Node').first().json.person_id → …json
        text = text.replace(f".json.{alias}", ".json").replace(f".json?.{alias}", ".json")
        # Two-step: `const written = $('Node').first().json;` then `written.person_id`.
        # The variable now *is* the value, so the field access has to go too.
        assignment = (
            r"(?:const|let|var)\s+(\w+)\s*=\s*\$\('"
            + re.escape(node_name)
            + r"'\)[^;\n]*\.json"
        )
        for var in re.findall(assignment, text):
            boundary = r"\b"
            text = re.sub(
                boundary + re.escape(var) + r"\??\." + re.escape(alias) + boundary,
                var,
                text,
            )
        return text

    for other in nodes:
        params = other.get("parameters") or {}
        for key, value in list(params.items()):
            if isinstance(value, str):
                params[key] = rewrite(value)
            elif isinstance(value, dict):
                for k2, v2 in list(value.items()):
                    if isinstance(v2, str):
                        value[k2] = rewrite(v2)


def convert_node(node, workflow_name):
    if not node["type"].endswith(".postgres"):
        return node, None

    query = node["parameters"]["query"]
    replacement = node["parameters"].get("options", {}).get("queryReplacement")

    # `select fn($1::jsonb)` → rpc/fn with { payload: … }
    match = re.search(r"select\s+\*?\s*(?:from\s+)?(\w+)\(\$1", query)
    if match:
        fn = match.group(1)
        alias_match = re.search(r"\)\s*(?:as\s+)(\w+)\s*$", query.strip(), re.I)
        node["_alias"] = alias_match.group(1) if alias_match else None
        inner = (replacement or "={{ {} }}").lstrip("=").strip()
        # queryReplacement is an expression producing a JSON *string*; RPC wants the
        # object, so unwrap JSON.stringify(...) where the generator used it.
        stringify = re.match(r"^\{\{\s*JSON\.stringify\((.+)\)\s*\}\}$", inner, re.S)
        if stringify:
            expr = stringify.group(1).strip()
        else:
            wrapped = re.match(r"^\{\{(.+)\}\}$", inner, re.S)
            expr = wrapped.group(1).strip() if wrapped else inner
        body = "={{ JSON.stringify({ payload: " + expr + " }) }}"
        return rpc_call(fn, body, node), None

    # Anything else is raw SQL with no RPC equivalent — report it rather than emit a
    # node that silently does nothing.
    return node, f"{workflow_name} · {node['name']}: raw SQL, no RPC wrapper"


def main():
    os.makedirs(DST, exist_ok=True)
    problems = []
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".json"):
            continue
        wf = json.load(io.open(os.path.join(SRC, name), encoding="utf-8"))
        nodes = []
        for node in wf["nodes"]:
            converted, problem = convert_node(node, wf["name"])
            nodes.append(converted)
            if problem:
                problems.append(problem)
        # Downstream expressions lose the column name the SQL alias gave them.
        for original, converted in zip(wf["nodes"], nodes):
            if converted["type"].endswith(".httpRequest"):
                unwrap_consumers(nodes, converted["name"], original.get("_alias"))
        for node in nodes:
            node.pop("_alias", None)
        wf["nodes"] = nodes
        wf["name"] = wf["name"] + " (HTTP)"
        # Distinct webhook paths, so both transports can live in one instance while you
        # decide which one works.
        for node in wf["nodes"]:
            if node["type"].endswith(".webhook"):
                node["parameters"]["path"] = node["parameters"]["path"] + "-http"
        io.open(os.path.join(DST, name), "w", encoding="utf-8", newline="\n").write(
            json.dumps(wf, indent=2, ensure_ascii=False) + "\n"
        )
        rpc = sum(1 for n in wf["nodes"] if n["type"].endswith(".httpRequest"))
        print(f"{name:34} {len(wf['nodes']):>2} nodes, {rpc:>2} RPC calls")

    if problems:
        print("\nneeds an RPC wrapper before these will work:")
        for p in problems:
            print("  ·", p)
        return 1
    print("\nevery database call converted")
    return 0


if __name__ == "__main__":
    sys.exit(main())
