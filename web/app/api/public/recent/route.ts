import { NextResponse } from "next/server";
import { activityLines } from "@/lib/recent-activity";
import { withDb } from "@/lib/server/db";
import { rateLimited } from "@/lib/server/rate-limit";
import { cacheRecent, cachedRecent, recentActivity } from "@/lib/server/repo/recent-activity";

/**
 * GET /api/public/recent?market_id=pasadena — the live line on `/join`
 * (14 Oct): `{ lines: string[] }`, newest first, already worded and
 * de-identified (`lib/recent-activity.ts`). Empty when there is nothing recent,
 * no database, or a failure — the page then shows no line at all, never a
 * made-up one.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  /* The same budget as the tap lists: a public read on the first screen. */
  const limited = rateLimited(request, "market_read");
  if (limited) return limited;

  const marketId = (new URL(request.url).searchParams.get("market_id") ?? "pasadena").toLowerCase().slice(0, 40);
  if (!/^[a-z0-9-]+$/.test(marketId)) return NextResponse.json({ lines: [] });

  let rows = cachedRecent(marketId);
  if (!rows) {
    const result = await withDb((db) => recentActivity(db, marketId));
    if (!result.persisted) return NextResponse.json({ lines: [] });
    rows = result.data;
    cacheRecent(marketId, rows);
  }
  /* Worded at response time, not cached: "today" has to stay true. */
  return NextResponse.json({ lines: activityLines(rows, new Date()) });
}
