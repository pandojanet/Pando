import type { ReactNode } from "react";
import { Eyebrow, SiteFooter, SiteHeader, Wrap } from "@/components/site/Shell";

/**
 * Where Stripe sends a parent back to — `/ask/paid` and `/ask/cancelled`.
 *
 * `lib/server/stripe.ts` has named both URLs since 13.5 was written and neither
 * page existed, so a parent who had just paid $15 landed on a 404 (13 Oct).
 *
 * ## What these pages may and may not say
 *
 * **Nothing here reads the database, and nothing here is evidence.** The `blast`
 * id in the URL is ignored: the webhook is the only thing that marks an Ask paid
 * (13.6), and a page that looked the row up would either show "not paid yet" to
 * somebody who has paid — the webhook can land seconds after the redirect — or
 * tell anybody holding a blast id something about another parent's question.
 * So the copy states only what is true for everyone who can reach the page:
 * Stripe redirects to the success URL after a completed payment, and to the
 * cancel URL when the parent leaves without paying.
 *
 * **No tier, no window, no "within 24 hours".** The hours differ by tier and a
 * person may read the question before it goes out, so a promise of when is one
 * this page cannot keep.
 *
 * On the public site's shell rather than the Seed Tool's `Screen`: that one
 * carries the Founding step rail on a laptop, and the person here is a parent
 * paying for an answer, not a contributor midway through a questionnaire.
 *
 * ⚠ New user-facing copy, on the list for the client.
 */
export function AskReturn({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader variant="back" />

      <main id="main" tabIndex={-1} className="py-11 sm:py-[4.5rem]">
        <Wrap size="text">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h1 className="mt-4 font-display text-[clamp(1.7rem,7vw,2.4rem)] font-extrabold leading-[1.08] tracking-[-0.028em]">
            {title}
          </h1>
          <div className="mt-5 space-y-[1.125rem] text-[1rem] leading-relaxed text-ink-soft sm:text-[1.05rem]">
            {children}
          </div>
        </Wrap>
      </main>

      <SiteFooter />
    </>
  );
}
