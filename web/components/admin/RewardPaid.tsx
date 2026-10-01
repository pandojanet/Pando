"use client";

import { useState } from "react";
import { when } from "@/components/admin/ui";
import { adminAction } from "@/lib/admin/client";
import type { ContributorRow } from "@/lib/admin/types";

/**
 * "Reward paid" — one box, on the list and on the person's page (30 Sep).
 *
 * `reward_status` says where somebody is on the way to the launch reward, and
 * `approved` read the same the day they earned it and the day it reached them, so
 * nothing on screen said whom was still owed. This is the fact the status could
 * not carry: a person ticked it, and when.
 *
 * It is offered only on an **approved** row. The reward is paid on an admin's yes,
 * so a box on a parent who has not earned anything would invite recording a
 * payment nobody owes; the server refuses it as well, and this is the readable
 * half. Everywhere else it renders nothing rather than a disabled control — a
 * greyed box reads as something that ought to work.
 *
 * The box disables itself while the write runs and nothing else on the page, on
 * the 7 Sep rule: a queue disables the row it is working, never the page.
 */
export function RewardPaid({
  id,
  name,
  status,
  paidAt,
  labelled = false,
  onChanged,
}: {
  id: string;
  name: string | null;
  status: ContributorRow["reward_status"];
  paidAt: string | null;
  /** Name the field beside the box — on the person's page, where no column heading does. */
  labelled?: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status !== "approved") return null;

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await adminAction({ action: "contributor.reward_paid", id, paid: next });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  const paid = paidAt !== null;

  return (
    <div>
      {/* The box, the date once it is ticked, and — only where no column heading
          names the field — its label (30 Sep). No status sentence. */}
      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[13.5px]">
        <input
          type="checkbox"
          checked={paid}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
          aria-label={`Reward paid to ${name ?? "this contributor"}${paid ? `, on ${when(paidAt)}` : ""}`}
          className="size-4 accent-[var(--color-green-deep)]"
        />
        {labelled && <span className="font-medium">Reward paid</span>}
        {paid && <span className="text-muted">{when(paidAt)}</span>}
      </label>
      {error && (
        <p role="alert" className="mt-0.5 text-[12.5px] text-alert">
          {error}
        </p>
      )}
    </div>
  );
}
