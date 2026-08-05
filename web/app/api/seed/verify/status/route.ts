import { NextResponse } from "next/server";
import { isSmsProvisioned } from "@/lib/server/sms";
import { devCodesEnabled, verificationRequired } from "@/lib/server/verify";

/**
 * GET /api/seed/verify/status — can this parent actually finish?
 *
 * The completion screen needs to know before it offers a code box. Three states, and
 * the difference between them decides whether anybody can contribute at all:
 *
 *  - **required and sendable** — the normal path. Nothing is stored until a code is
 *    confirmed.
 *  - **required but not sendable** (no Twilio credentials, no dev codes) — the founding
 *    path is a dead end: the parent would be asked for a code that cannot arrive. The
 *    screen says so plainly instead of showing an unsatisfiable box.
 *  - **not required** (`SEED_REQUIRE_VERIFICATION=0`) — the pilot runs before Twilio
 *    is provisioned. Everything is stored, `phone_verified_at` stays null, and those
 *    contributors cannot reach Founding until they confirm a number later. That is the
 *    honest trade, and it is a deliberate switch rather than a silent fallback.
 *
 * No session, no body, nothing about a person: this is configuration, and the answer
 * is the same for everyone.
 */
export function GET() {
  const required = verificationRequired();
  const provisioned = isSmsProvisioned();
  const devCodes = devCodesEnabled();

  return NextResponse.json(
    {
      required,
      /** True when a code can actually reach the parent (or QA, in dev). */
      sendable: provisioned || devCodes,
      provisioned,
      dev_codes: devCodes,
    },
    {
      // Configuration, not data. A few seconds of caching is fine and keeps the
      // completion screen snappy; it must not be cached for the length of a deploy.
      headers: { "Cache-Control": "private, max-age=15" },
    },
  );
}
