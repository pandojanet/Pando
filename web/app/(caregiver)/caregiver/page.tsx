import { CaregiverFlow } from "@/components/caregiver/CaregiverFlow";
import type { MarketId } from "@/lib/types";

/** One market in the pilot; the type is the guard against inventing a second. */
const MARKET: MarketId = "pasadena";

/**
 * `pando.is/caregiver` — the address in the invite a parent sends (C11).
 *
 * No token in the URL, and there cannot be one: Pando holds no contact detail for a
 * nominated caregiver (invariant 13), so there is nothing to key a per-person link
 * against. Which nomination this person is gets decided by an admin afterwards —
 * see `drizzle/0004_caregiver_claims.sql`.
 */
export default function CaregiverPage() {
  return <CaregiverFlow market={MARKET} />;
}
