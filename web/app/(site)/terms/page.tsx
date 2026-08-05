import type { Metadata } from "next";
import { DocShell } from "@/components/site/DocShell";

export const metadata: Metadata = {
  title: "Text messaging terms",
  description:
    "How Pando's opt-in text messaging works: consent, frequency, rates, STOP and HELP.",
};

const TERMS = [
  {
    lead: "Consent.",
    body: "You receive texts from Pando only if you opt in — either by texting Pando first, or by providing your phone number and agreeing to receive messages during signup. Consent is not a condition of any purchase.",
  },
  {
    lead: "What you’ll receive.",
    body: "Replies to your questions, and — if you’ve joined as a contributor — occasional requests to share a recommendation with a nearby family. Message frequency varies.",
  },
  {
    lead: "Rates.",
    body: "Message and data rates may apply. Carriers are not liable for delayed or undelivered messages.",
  },
  {
    lead: "Opting out.",
    body: "Reply STOP at any time to stop all messages. You’ll receive one final confirmation text.",
  },
];

/** Ported verbatim from terms.html. See the note in privacy/page.tsx about `.legal`. */
export default function TermsPage() {
  return (
    <DocShell title="Text messaging terms">
      <p className="text-ink-soft!">
        Pando is an opt-in service. Here’s exactly how messaging works.
      </p>

      <div className="mt-5 overflow-hidden rounded-2xl border border-bark bg-card">
        <ul className="m-0! list-none!">
          {TERMS.map((term) => (
            <li
              key={term.lead}
              className="mb-0! border-b border-bark-soft px-5 py-4 sm:px-7"
            >
              <strong>{term.lead}</strong> {term.body}
            </li>
          ))}
          <li className="mb-0! px-5 py-4 sm:px-7">
            <strong>Help.</strong> Reply <strong>HELP</strong> for help, or email{" "}
            <a href="mailto:hello@pando.is">hello@pando.is</a>.
          </li>
        </ul>
      </div>
    </DocShell>
  );
}
