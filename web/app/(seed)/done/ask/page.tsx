import { FinishAsks } from "@/components/seed/done/FinishAsks";

/**
 * Estimate 1.7 — D1, the follow-up permission, and the OTP gate. Straight after
 * the profile and before the chat since 7 Oct (see `FinishAsks`).
 *
 * The only screen of the three that writes anything. D1 sits above the consent
 * because its answer travels in the same completion write.
 */
export default function DoneAskPage() {
  return <FinishAsks />;
}
