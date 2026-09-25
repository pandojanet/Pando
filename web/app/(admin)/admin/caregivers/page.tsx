"use client";

import { PageHead, Toolbar } from "@/components/admin/ui";
import { SegmentedTabs } from "@/components/admin/kit";
import { CaregiversPanel } from "@/components/admin/caregivers/CaregiversPanel";
import { SignupsPanel } from "@/components/admin/caregivers/SignupsPanel";
import { useAdminRows } from "@/lib/admin/client";
import { useUrlFilter } from "@/lib/admin/url-state";
import type { Overview } from "@/lib/admin/types";

/**
 * Caregivers and their own sign-ups, on one page (25 Sep).
 *
 * The developer's instruction: *"об'єднаємо сторінки caregiver та caregiver
 * signups, де зробимо дві таби … функціонал при цьому залишається незмінним"*.
 * They are the same people from two ends — the family's nomination and her own
 * sign-up — and "Confirm — this is her" on one tab moves a card on the other.
 * The panels are the two old pages, moved whole; only their headings went,
 * because this page carries one.
 *
 * ⚠ **A tab strip, never filter pills** — the two swap whole panels with their
 * own fetch, which is the `/admin/contributors` precedent. `?view=signups` is
 * what the Overview's worklist row links to. The old `/admin/claims` address
 * is gone rather than redirected (25 Sep).
 *
 * The counts are the sidebar's own two numbers from the same `overview` read,
 * so a tab and the badge cannot disagree.
 */
const VIEWS = [
  { id: "caregivers", label: "Caregivers" },
  { id: "signups", label: "Sign-ups" },
] as const;

export default function CaregiversPage() {
  const [view, setView] = useUrlFilter(
    VIEWS.map((v) => v.id),
    "caregivers",
    "view",
  );
  const overview = useAdminRows<Overview | null>("overview");
  const counts = overview.rows
    ? {
        caregivers: overview.rows.quality.review_holds,
        signups: overview.rows.quality.pending_claims,
      }
    : null;

  return (
    <>
      <PageHead title="Caregivers" />
      <Toolbar>
        <SegmentedTabs
          panelId="caregiver-view"
          label="Nominated caregivers, or their own sign-ups"
          value={view}
          onChange={setView}
          options={VIEWS.map((v) => ({
            ...v,
            ...(counts && counts[v.id] > 0 ? { count: counts[v.id] } : {}),
          }))}
        />
      </Toolbar>
      <div
        role="tabpanel"
        id="caregiver-view"
        aria-label={VIEWS.find((v) => v.id === view)?.label}
      >
        {view === "caregivers" ? <CaregiversPanel /> : <SignupsPanel />}
      </div>
    </>
  );
}
