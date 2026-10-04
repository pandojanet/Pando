import { NextResponse } from "next/server";
import { cleanText } from "@/lib/sanitize";
import { rateLimited } from "@/lib/server/rate-limit";
import { classifyAgeRelevance } from "@/lib/server/extract";
import { PLACE_TYPES } from "@/lib/seed-chat/scripts";

/**
 * POST /api/seed/age-relevance — should the place card ask the child's age?
 *
 * Answers `{ relevant: true | false | null }`, and `null` means ask: no model
 * configured, a timeout, or a kind of place this card does not offer. Nothing
 * is stored — the answer only decides which question comes next.
 */
export async function POST(request: Request) {
  const limited = rateLimited(request, "age_relevance");
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    place_type?: unknown;
  } | null;
  const name = cleanText(body?.name, 80);
  const placeType = PLACE_TYPES.find((o) => o.id === body?.place_type);
  if (!name || !placeType) return NextResponse.json({ relevant: null });

  const relevant = await classifyAgeRelevance({ name, place_type: placeType.label });
  return NextResponse.json({ relevant });
}
