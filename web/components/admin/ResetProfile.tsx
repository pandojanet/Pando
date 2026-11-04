"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, inputClass, TextLink } from "@/components/admin/ui";
import { adminAction } from "@/lib/admin/client";

/**
 * "Reset profile" (3 Nov) — the client: *"so Janet can walk the whole flow from
 * scratch after each change instead of going back and editing step by step"*,
 * and her clarification, **admin only**. It lives here, on a person's admin
 * page, and nowhere a parent can reach.
 *
 * It erases the person and everything they shared (`person.reset`), so it asks
 * twice: the first press only opens it, and nothing is sent until RESET is
 * typed — the server refuses the action without it too. Afterwards the page has
 * nothing to show, so it goes back to the list.
 */
export function ResetProfile({ id, name }: { id: string; name: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await adminAction({ action: "person.reset", id, confirm: typed.trim() });
      router.push("/admin/contributors");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through");
      setBusy(false);
    }
  }

  return (
    <Card title="Reset profile">
      <div className="space-y-2.5 px-4 py-3 text-[13px]">
        <p className="text-muted">
          Erases {name ?? "this person"} and everything they shared, so the number can go through the whole flow again
          as a new parent. Their phone starts over on its own at the invite link. This cannot be undone.
        </p>
        {!open ? (
          <TextLink className="text-[12.5px]" onClick={() => setOpen(true)}>
            Reset this profile…
          </TextLink>
        ) : (
          <div className="space-y-2.5">
            <Field label="Type RESET to confirm">
              <input
                className={`${inputClass} mt-1.5`}
                value={typed}
                aria-label="Type RESET to confirm"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button tone="danger" disabled={busy || typed.trim() !== "RESET"} onClick={() => void reset()}>
                {busy ? "Resetting…" : "Reset profile"}
              </Button>
              <Button
                tone="ghost"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setTyped("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-[12.5px] text-alert">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
