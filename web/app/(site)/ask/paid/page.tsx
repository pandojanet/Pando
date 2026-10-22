import type { Metadata } from "next";
import { AskReturn } from "@/components/site/AskReturn";

export const metadata: Metadata = {
  title: { absolute: "Pando — Thank you" },
  /* Reached only from a Stripe checkout; there is nothing here to find. */
  robots: { index: false, follow: false },
};

/** Stripe's `success_url` for a paid Network Ask. See `AskReturn`. */
export default function AskPaidPage() {
  return (
    <AskReturn eyebrow="Your question" title="That’s paid — thank you.">
      <p>
        We’ll put your question to parents near you and text you if they share anything useful.
        There is nothing else to do here, so you can close this page.
      </p>
      <p>If no parent has a useful answer for you, we refund it.</p>
    </AskReturn>
  );
}
