import { Thanks } from "@/components/seed/done/Thanks";

/**
 * Estimate 1.7 — the immediate thank-you and the founding badge, after the chat.
 * Since 7 Oct the order is /profile → /done/ask → /share → here → /done/next.
 *
 * The completion screen used to be one page carrying the badge, the shared list,
 * the demand question, the follow-up consent, the OTP gate, five next-steps, the
 * referral card and a come-back note. It is now three: this one tells, /done/ask
 * asks, /done/next explains. See CLAUDE.md for the trade that buys.
 */
export default function DonePage() {
  return <Thanks />;
}
