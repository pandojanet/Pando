import type { Metadata } from "next";
import { AskReturn } from "@/components/site/AskReturn";

export const metadata: Metadata = {
  title: { absolute: "Pando — Nothing was charged" },
  robots: { index: false, follow: false },
};

/** Stripe's `cancel_url` for a Network Ask left unpaid. See `AskReturn`. */
export default function AskCancelledPage() {
  return (
    <AskReturn eyebrow="Your question" title="Nothing was charged.">
      {/* Reached only from an old payment link: since 21 Oct every Network Ask
          is free, so there is nothing left to pay and no new link to send. */}
      <p>And nothing needs to be: asking parents near you is free now.</p>
      <p>
        We’ll put your question to them and text you if they share anything useful. You can
        close this page.
      </p>
    </AskReturn>
  );
}
