import { CaregiverFlow } from "@/components/caregiver/CaregiverFlow";
import { CaregiverInviteRequired } from "@/components/caregiver/CaregiverInviteRequired";
import { isDbConfigured } from "@/lib/server/db";
import type { MarketId } from "@/lib/types";

const MARKET: MarketId = "pasadena";

/**
 * `pando.is/caregiver` — the bare address, **closed since 23 Sep**.
 *
 * The invite a parent sends carries a token (`/caregiver/<token>`,
 * `drizzle/0049`) naming the recommendation it came from, and that is now the
 * only way into the caregiver's flow — the developer's call: *"простий ендпоінт
 * caregiver не мав би працювати"*. The write route refuses a claim without a
 * token that resolves, so this page is not the only thing keeping it closed.
 *
 * ⚠ **With no database the flow still renders**, on the rule that the flow is
 * walkable before there is one: no token can resolve without a table to resolve
 * it in, the write answers `persisted: false`, and nothing is stored either way.
 */
export default function CaregiverPage() {
  if (!isDbConfigured()) return <CaregiverFlow market={MARKET} />;
  return <CaregiverInviteRequired reason="missing" />;
}
