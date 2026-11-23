/**
 * A line diff for /admin/proposals (23 Nov): a change to the Pando plugin — a skill, an agent, the
 * connectors — is shown as the lines it removes and adds, with a little unchanged context, so an admin
 * reads what changes rather than two whole files. Pure and small: the longest common subsequence of
 * the lines, which is exact for files of a plugin's size (a skill is at most 40,000 characters).
 */

export type DiffLine = { op: "same" | "add" | "del"; text: string } | { op: "skip"; count: number };

/** Past this many lines on a side the table would be large; the change is shown as all removed, all added. */
const MAX_LINES = 2000;

export function diffLines(before: string | null, after: string | null, context = 2): DiffLine[] {
  const a = before === null ? [] : before.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const b = after === null ? [] : after.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  if (before === null) return b.map((text) => ({ op: "add", text }));
  if (after === null) return a.map((text) => ({ op: "del", text }));

  let raw: Array<{ op: "same" | "add" | "del"; text: string }>;
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    raw = [...a.map((text) => ({ op: "del" as const, text })), ...b.map((text) => ({ op: "add" as const, text }))];
  } else {
    /* lcs[i][j]: the longest common subsequence of a[i..] and b[j..]. */
    const lcs: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    raw = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        raw.push({ op: "same", text: a[i] });
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) raw.push({ op: "del", text: a[i++] });
      else raw.push({ op: "add", text: b[j++] });
    }
    while (i < a.length) raw.push({ op: "del", text: a[i++] });
    while (j < b.length) raw.push({ op: "add", text: b[j++] });
  }

  /* Unchanged lines far from any change fold into one "N unchanged lines" row. */
  const near = raw.map(() => false);
  raw.forEach((l, k) => {
    if (l.op === "same") return;
    for (let d = -context; d <= context; d++) if (raw[k + d]) near[k + d] = true;
  });
  const out: DiffLine[] = [];
  for (let k = 0; k < raw.length; k++) {
    if (raw[k].op !== "same" || near[k]) {
      out.push(raw[k]);
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.op === "skip") last.count++;
    else out.push({ op: "skip", count: 1 });
  }
  return out;
}
