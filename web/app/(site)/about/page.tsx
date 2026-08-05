import type { Metadata } from "next";
import {
  Eyebrow,
  PandoGrove,
  SiteButton,
  SiteFooter,
  SiteHeader,
  Wrap,
} from "@/components/site/Shell";

export const metadata: Metadata = {
  title: { absolute: "Why “Pando”? — Our story" },
  description:
    "Pando is named for the largest, oldest living thing on Earth — a forest of thousands of trees that is secretly one organism, sharing a single root system. That's the idea behind Pando: parents who look separate, connected underground by trust.",
};

export default function AboutPage() {
  return (
    <>
      <SiteHeader />

      <main className="py-11 sm:py-[4.5rem]">
        <Wrap size="story">
          <Eyebrow>Why we’re called Pando</Eyebrow>
          <h1 className="mt-4 font-display text-[clamp(1.7rem,7vw,3rem)] font-extrabold leading-[1.05] tracking-[-0.028em]">
            The largest living thing on Earth is a forest that’s secretly one tree.
          </h1>
          <p className="mt-3 text-[1.05rem] text-ink-soft sm:text-[1.18rem]">
            We named the company after it on purpose.
          </p>

          <PandoGrove />

          <div className="space-y-[1.125rem] text-[1rem] leading-relaxed sm:text-[1.05rem]">
            <p>
              In the mountains of Utah, a grove of aspen looks like tens of
              thousands of separate trees. It isn’t. Every trunk grows from one
              shared root system — a single organism, thousands of years old, still
              standing because the roots never stopped supporting each other.
            </p>

            <p className="mt-6! font-display text-[1.5rem] font-semibold leading-[1.32] tracking-[-0.015em] text-green-deep sm:text-[clamp(1.3rem,2.8vw,1.7rem)]">
              Thousands of trees. <span className="text-gold">One root system.</span>
            </p>

            <p>
              That’s exactly what a neighborhood of parents already is. We look like
              individuals — separate families, separate group chats. But underneath,
              we hold each other up constantly: the friend who knows which swim
              teacher is gentle with a nervous kid, the neighbor who vouches for a
              babysitter she’s trusted for years.
            </p>

            <Pull>
              That knowledge is the root system. It’s already there — it’s just
              invisible, and it dies in group chats.
            </Pull>

            <p>
              The best answers live in other parents’ heads. Google can’t reach
              them; reviews can’t either — you never know who wrote them, or whether
              their life looks anything like yours. Pando makes that root system
              usable: one parent’s hard-won answer reaching another who needs it,
              over the simplest tool everyone already has — a text. No app, no feed.
              Just the neighborhood, connected the way it always secretly was. We’re
              starting with the decisions where trust matters most — caregivers,
              classes, camps — and growing into everything parents ask each other.
            </p>

            <div className="my-7! rounded-2xl border border-bark bg-card px-5 py-6 sm:px-[1.625rem] lg:-mx-10 lg:px-10 lg:py-8">
              <h2 className="font-display text-[1rem] font-bold tracking-[0.02em] text-green-deep">
                The real Pando, for the curious
              </h2>
              <ul className="mt-3">
                <li className="border-b border-bark-soft py-[0.4375rem] text-[0.97rem] text-ink-soft">
                  <b className="text-ink">What it is:</b> a single clonal colony of
                  quaking aspen (<i>Populus tremuloides</i>) in Fishlake National
                  Forest, Utah.
                </li>
                <li className="border-b border-bark-soft py-[0.4375rem] text-[0.97rem] text-ink-soft">
                  <b className="text-ink">How big:</b> around 47,000 genetically
                  identical stems across roughly 100 acres.
                </li>
                <li className="border-b border-bark-soft py-[0.4375rem] text-[0.97rem] text-ink-soft">
                  <b className="text-ink">How old:</b> estimated in the thousands of
                  years — among the oldest known living organisms.
                </li>
                <li className="py-[0.4375rem] text-[0.97rem] text-ink-soft">
                  <b className="text-ink">The name:</b> <i>pando</i> is Latin for{" "}
                  <b className="text-ink">“I spread.”</b>
                </li>
              </ul>
            </div>

            <p>
              That last detail sealed it: a network that grows by parents telling
              other parents — spreading through trust, not advertising. The name had
              already written the plan.
            </p>

            <Pull>
              A grove this old survives because the roots protect what grows above
              them.
            </Pull>

            <p>
              That’s the standard I hold Pando to, and it lives in the details. A
              caregiver is only named if a real parent recommended them <em>and</em>{" "}
              that caregiver agreed to be listed. Every answer tells you where it
              came from and when it was last confirmed. And we don’t hold a single
              phone number before its owner chooses to give it to us. Trust is the
              root system; everything else is what grows because it’s there.
            </p>

            <p className="mt-7!">
              <em>
                Pando is built in Pasadena by a local parent who got tired of
                watching the most useful answers disappear inside group chats.
              </em>
            </p>
          </div>

          <div className="mt-10 border-t border-bark pt-6 text-[1.02rem] text-ink-soft">
            <p className="mb-1.5">
              Thanks for reading this far. If it resonates, the best thing you can do
              is join the founding network — you become one of the roots.
            </p>
            <p>
              <b className="text-ink">— Janet</b>
              <br />
              Founder, Pando
            </p>
          </div>

          <div className="my-12 rounded-[1.25rem] bg-moss px-6 py-9 text-center sm:px-[2.125rem] sm:py-10 lg:-mx-10 lg:py-14">
            <h2 className="font-display text-[1.4rem] font-bold tracking-[-0.02em] text-white sm:text-[1.8rem]">
              Become one of the roots
            </h2>
            <p className="mx-auto mt-3 max-w-[48ch] text-paper-soft">
              Pando is launching soon across the San Gabriel Valley, starting with a
              founding group of local parents. Add what you know; get answers you can
              trust.
            </p>
            <SiteButton href="/#founding" tone="gold" className="mt-6 max-sm:w-full">
              Ask for an invite
            </SiteButton>
          </div>
        </Wrap>
      </main>

      <SiteFooter home />
    </>
  );
}

function Pull({ children }: { children: React.ReactNode }) {
  return (
    // lg: the rule and quote step out into the left margin, so the page has a
    // rhythm on a wide screen instead of one unbroken 700px column.
    <p className="my-7! border-l-[3px] border-gold py-1.5 pl-5 font-display text-[1.15rem] font-semibold leading-[1.35] text-moss sm:text-[1.25rem] lg:-ml-10 lg:pl-10 lg:text-[1.35rem]">
      {children}
    </p>
  );
}
