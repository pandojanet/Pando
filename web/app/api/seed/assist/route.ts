import { NextResponse } from "next/server";
import { NOT_CONFIGURED, readTurnInput } from "@/lib/seed-chat/assist";
import { assistTurn } from "@/lib/server/assist";
import { rateLimited } from "@/lib/server/rate-limit";

/**
 * POST /api/seed/assist — one turn of the adaptive interview (9 Oct): on the
 * last context question, which sub-category the card is; after every answer,
 * whether to follow it up, which closed answers the parent's words already gave,
 * and the next question in words for this parent. The rules are in
 * `lib/seed-chat/assist.ts`; the model calls in `lib/server/assist.ts`.
 *
 * **Nothing is stored and nothing is returned that the chat could not do
 * without.** Every outcome other than a clean answer — no key, the switch off,
 * the limit hit, a body that is not one, a model that timed out — is the
 * not-configured answer, and the chat carries on in the script's order with the
 * rule-based follow-ups. So this route has no verification gate, the way the
 * removed `/api/seed/age-relevance` had none: it reads only what the parent
 * just typed into the card in front of them, and returns only wording and ids
 * from the script.
 *
 * ⚠ It spends money per call on a public route, so it has its own bucket
 * (`seed_assist`), and a caregiver card never reaches it (invariant 12):
 * `readTurnInput` accepts only the four kinds that have sub-categories.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = rateLimited(request, "seed_assist");
  if (limited) return NextResponse.json(NOT_CONFIGURED);

  const input = readTurnInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json(NOT_CONFIGURED);

  return NextResponse.json(await assistTurn(input));
}
