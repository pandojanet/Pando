"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "./kit";
import { Highlight } from "./PersonPicker";
import { Loading, slugLabel } from "./ui";
import { useAdminRows } from "@/lib/admin/client";
import { rankPeople } from "@/lib/admin/person-search";
import type { ContributorRow } from "@/lib/admin/types";

/**
 * Find one parent from anywhere in the admin.
 *
 * ## Why
 *
 * Twenty nav items, and not one of them answers "where is Sarah". Every route to
 * a person went through a page that happens to list them — the contributors
 * table, or a queue they appear in — so looking somebody up meant first knowing
 * which screen would have them, then filtering it. That is the navigation cost a
 * better-organised sidebar cannot fix, because it is not a grouping problem.
 *
 * ## Four rules
 *
 * **It searches people, and says so.** The tempting next step is to cover
 * records, caregivers and questions too, and each of those is its own read; a box
 * that silently covers one of five things is worse than one that names its
 * subject. The dialog's own description says where it looks.
 *
 * **The ranking is `lib/admin/person-search.ts`** — the same pure module the
 * matching harness's picker uses and `npm run test:person-search` pins, so a slug
 * is searched as words ("south pas" finds South Pasadena) and every term has to
 * match something. A second ranking rule here would be a second thing to get
 * wrong, and the failure mode of a search rule is silence.
 *
 * **The rows are fetched on the first open and then kept** (`useAdminRows`'s
 * `enabled`). A query is ~200ms whatever it returns, and most page loads never
 * touch this.
 *
 * **It navigates and never acts.** Every destination is a contributor's own page,
 * nothing here writes anything, so a mis-tap costs a page load.
 */
export function QuickFind() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  const { rows, loading, configured } = useAdminRows<ContributorRow[]>(
    "contributors",
    undefined,
    open,
  );

  /* One shape for the ranker, carrying the row it came from — rather than
     ranking ids and looking each one up again. */
  const people = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.name)
        .map((r) => ({
          person_id: r.id,
          name: r.name,
          neighborhood: r.neighborhood,
          row: r,
        })),
    [rows],
  );

  const list = useMemo(
    () =>
      (query.trim() === "" ? people : rankPeople(people, query)).slice(0, 8),
    [people, query],
  );

  /*
   * "/" from anywhere, the way every list-shaped tool has done it for twenty
   * years — guarded on the event target, because this admin is full of text
   * fields and a shortcut that eats a slash typed into a rewrite of an answer is
   * worse than no shortcut at all. Ctrl/Cmd+K is the other habit and costs
   * nothing to accept.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        el?.isContentEditable === true;
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setActive(0);
  }, [query]);

  /* `Dialog` calls `showModal` in its own effect, so focusing the field has to
     wait a tick — before that the element is not yet in the top layer. */
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  function go(id: string) {
    setOpen(false);
    setQuery("");
    router.push(`/admin/contributors/${id}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-9 w-full items-center gap-2 rounded-lg border border-bark bg-paper px-3 text-left text-[13px] text-muted transition-colors hover:border-green hover:text-ink-soft"
      >
        <span aria-hidden="true">&#8981;</span>
        <span className="flex-1 truncate">Find a parent</span>
        {/* Shown rather than only documented: a keyboard path nobody knows about
            is a keyboard path nobody uses. */}
        <kbd className="hidden rounded border border-bark px-1 text-[11px] font-semibold md:inline">
          /
        </kbd>
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Find a parent"
        description="Searches the name and neighbourhood of everyone who came through, and opens their page."
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, list.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && list[active]) {
              e.preventDefault();
              go(list[active].person_id);
            }
          }}
          placeholder="A name, or an area"
          aria-label="Search for a parent"
          className="w-full rounded-xl border border-bark bg-paper px-3 py-2.5 text-[15px] outline-none focus:border-green"
        />

        {loading && !rows ? (
          <Loading inline />
        ) : list.length === 0 ? (
          <p className="px-1 py-4 text-[13.5px] text-muted">
            {/* Three different silences, and only one of them means "not
                found" — the `persisted: false` honesty rule, in a search box. */}
            {!configured
              ? "No database is connected, so there is nobody to look for."
              : query.trim() === ""
                ? "Nobody has come through yet."
                : "Nothing matching that."}
          </p>
        ) : (
          <ul className="mt-2 max-h-[50vh] overflow-y-auto">
            {list.map((entry, i) => (
              <li key={entry.person_id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(entry.person_id)}
                  className={
                    "flex w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left text-[13.5px] " +
                    (i === active
                      ? "bg-green-wash text-green-deep"
                      : "hover:bg-paper")
                  }
                >
                  <span className="font-semibold">
                    <Highlight text={entry.name ?? "—"} query={query} />
                  </span>
                  <span className="text-[12.5px] text-muted">
                    {entry.neighborhood ? (
                      <Highlight
                        text={slugLabel(entry.neighborhood)}
                        query={query}
                      />
                    ) : (
                      "no area recorded"
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </>
  );
}
