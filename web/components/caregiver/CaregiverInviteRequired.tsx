import { Wordmark } from "@/components/ui/Logo";
import {
  Eyebrow,
  Screen,
  ScreenBody,
  ScreenHeader,
} from "@/components/ui/Screen";

/**
 * What `/caregiver` shows without a working invite (23 Sep).
 *
 * The developer: *"простий ендпоінт caregiver не мав би працювати"*. Since the
 * invite a parent sends carries a token naming its recommendation, the bare
 * address was the one way in that attached to nobody — and an admin then had to
 * guess whose recommendation a sign-up belonged to by name, which is what the
 * token exists to end. So it is closed, and so is a token that names no open
 * recommendation: otherwise any made-up token would be the bare address again.
 *
 * ⚠ **Not a redirect to the marketing site.** Somebody who lands here was very
 * likely sent a link by a family and got a stale or truncated one, and the
 * useful thing is to say what to do — ask for the message again — rather than
 * drop them on a page about something else.
 *
 * ⚠ New user-facing copy, on the list for the client.
 */
export function CaregiverInviteRequired({
  reason,
}: {
  /** `missing` — the bare address; `inactive` — a token that names nothing open. */
  reason: "missing" | "inactive";
}) {
  return (
    <Screen>
      <ScreenHeader left={<Wordmark />} />
      <ScreenBody>
        <Eyebrow>For caregivers</Eyebrow>
        <h1 className="mt-2 font-display text-step-title font-bold leading-[1.12]">
          {reason === "missing"
            ? "This page needs your invite link."
            : "This invite link isn't active."}
        </h1>
        <p className="mt-3 leading-relaxed text-ink-soft text-body">
          {reason === "missing"
            ? "A caregiver profile on Pando starts from the message a family sends you — the link in it is yours."
            : "It may already have been used, or it was copied without its last part."}{" "}
          Ask the family who recommended you to send the message again.
        </p>
      </ScreenBody>
    </Screen>
  );
}
