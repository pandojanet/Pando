import { CaregiverFlow } from "@/components/caregiver/CaregiverFlow";
import type { MarketId } from "@/lib/types";

/** One market in the pilot; the type is the guard against inventing a second. */
const MARKET: MarketId = "pasadena";

/**
 * `pando.is/caregiver` — the bare address, for somebody who arrived without a
 * token.
 *
 * Since 23 Sep the invite a parent sends carries one (`/caregiver/<token>`,
 * `drizzle/0049`) naming the recommendation it came from, so a sign-up through it
 * arrives already attached to that card. This address is what an older invite,
 * or somebody who typed it, still reaches — and an admin matches that sign-up by
 * name on `/admin/claims`, as before.
 */
export default function CaregiverPage() {
  return <CaregiverFlow market={MARKET} />;
}
