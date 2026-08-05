import type { Metadata } from "next";
import Link from "next/link";
import { PhoneMock } from "@/components/site/PhoneMock";
import {
  Eyebrow,
  LeafIcon,
  Section,
  SectionGrid,
  SiteButton,
  SiteFooter,
  SiteHeader,
  Wrap,
} from "@/components/site/Shell";

export const metadata: Metadata = {
  title: { absolute: "Pando — AI knows things. Pando knows someone." },
  description:
    "Pando is a text line for San Gabriel Valley parents. Ask about local classes, camps, and caregivers — get answers backed by real parents in your community, labeled by who shared them and when.",
};

const STEPS = [
  {
    tone: "var(--color-gold)",
    title: "Save the number",
    body: "Add Pando to your contacts like any friend. No app, no account, no password — your phone number is all you need.",
  },
  {
    tone: "var(--color-green)",
    title: "Text your question",
    body: "Ask naturally, the way you’d text a friend. Pando may ask one quick question to understand what you actually need.",
  },
  {
    tone: "var(--color-green-deep)",
    title: "Get an answer with receipts",
    body: "Every answer is labeled by where it came from — a local parent, several parents, or public information — and how recently it was confirmed. If the network doesn’t know yet, Pando can ask it for you.",
  },
  {
    tone: "var(--color-ink)",
    title: "Sometimes, you’re the friend",
    body: "Pando works because parents help one another. Occasionally — at most three times a month, and you can always skip — Pando asks you a question your experience can answer. When another parent uses what you shared and says it helped, Pando remembers, and your access gets better.",
  },
];

const LABELS: Array<{ text: string; gold?: boolean }> = [
  { text: "From a parent at your school", gold: true },
  { text: "Shared by a local parent" },
  { text: "Recommended by 3 nearby parents" },
  { text: "Confirmed by multiple local parents", gold: true },
  { text: "Last confirmed [date]" },
  { text: "Public information" },
];

const ASKS = [
  {
    kind: "Classes",
    text: "Which swim school is actually good for a nervous 3-year-old?",
  },
  { kind: "Camps", text: "Is the science camp worth it, or is it glorified daycare?" },
  {
    kind: "Caregivers",
    text: "Any sitters other parents nearby have really used and trust?",
  },
  {
    kind: "Schedules",
    text: "Weekend toddler activities that don’t require a mortgage or a miracle parking spot?",
  },
  {
    kind: "New in town",
    text: "We just moved to Bungalow Heaven — where do the 2-year-olds hang out?",
  },
  {
    kind: "Just between us",
    text: "What are families around here actually paying their sitters and nannies?",
  },
  {
    kind: "Last minute",
    text: "Our regular sitter’s away — which backup sitter services have parents here actually used?",
  },
];

const FAQ = [
  {
    q: "Who sees my questions?",
    a: "Not your name — ever. When Pando asks other parents on your behalf, they see only the context needed to give a useful answer: “A Pasadena parent with an 18-month-old and limited backup care is wondering…” Never who you are, never your school, never anything identifying. That’s the point: Pando knows enough about you to find the right parents, without exposing you to them. It’s why you can ask the things you’d hesitate to put in a group chat under your own name.",
  },
  {
    q: "Can I ask about anything, or just classes and caregivers?",
    a: "At launch, Pando is strongest on local classes, camps, activities, and caregivers — the decisions where a real parent’s vouching matters most, and where we’re building deep coverage first. You can ask anything, and we’ll always be honest about what kind of answer we have: if the network doesn’t know yet, we’ll say so rather than dress up generic information as parent wisdom. The destination is every question you’d ask a trusted parent group chat — we’re growing there one category at a time, guided by what founding parents ask.",
  },
  {
    q: "What if I’m not in the San Gabriel Valley?",
    a: "Join the waitlist anyway. Questions from outside our launch area do two things: you’ll always get an honestly labeled answer from public information, and your question tells us exactly where to grow next. When enough parents in your area have joined, we’ll open it — and the earliest parents in every new area become its Founding Parents, with the same recognition and free network asks our first Pasadena families received.",
  },
  {
    q: "Is this just AI answering?",
    a: "No — that’s the whole point. Pando uses AI to organize knowledge, but the answers that matter come from real local parents, and every answer is labeled so you know exactly which is which. Public information is always marked as public information. A parent’s recommendation is always marked as a parent’s recommendation, with how recently it was confirmed. Every answer comes back fast — and whenever you want real parents behind it, that’s one text away.",
  },
  {
    q: "How do caregiver recommendations work?",
    a: "Carefully. A caregiver only ever appears in an answer if a local parent genuinely recommended them AND the caregiver separately consented to be listed. The vouching comes from that parent — not from Pando. Pando doesn’t employ, screen, or guarantee caregivers; it organizes real parent trust signals, and where the recommending parent has opted in, can ask whether they’re willing to provide a reference introduction. Always do your own interviews, references, and background checks.",
  },
  {
    q: "What does it cost?",
    a: "Answers from knowledge Pando already has are free — that’s the give-to-get: everyone who opts in to occasionally help another parent (at most three community questions a month, always skippable) gets access to what the network already knows. Asking Pando is always free. A Network Ask is different: Pando goes out and asks around — a small, carefully matched group of real local parents, on your behalf. That’s a paid request, your first one is on us — and if the network can’t get you a useful answer, you’re not charged. You’re paying for the right parents, the right fit, and a fresh answer — not for access to the community’s knowledge, and not for a bigger audience.",
  },
  {
    q: "Will I get spammed if I join as a contributor?",
    a: "No. You set a monthly limit on how often the network can reach you (default: five), there’s a minimum 48-hour gap between requests, and you can change your settings anytime by texting BLAST SETTINGS. No leaderboards, no streaks, no guilt.",
  },
  {
    q: "Where does Pando work?",
    a: "We’re launching across the San Gabriel Valley, one neighborhood at a time — density is what makes the answers good. Text us your neighborhood and we’ll log the demand for expansion.",
  },
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />

      <main>
        {/* Hero */}
        <Wrap className="hero-wash grid items-center gap-9 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24.5rem)] lg:gap-16 lg:py-24 xl:gap-20">
          <div>
            <Eyebrow>San Gabriel Valley · Launching this fall</Eyebrow>
            <h1 className="mt-4 font-display text-[clamp(2rem,8vw,3.6rem)] font-extrabold leading-[1.03] tracking-[-0.028em]">
              AI knows things.
              <br />
              <span className="highlight-gold text-green-deep">
                Pando knows someone.
              </span>
            </h1>
            <p className="mt-5 max-w-[46ch] text-[1.05rem] leading-relaxed text-ink-soft sm:text-[1.12rem]">
              Pando is a text line for parents. Ask about local classes, camps,
              activities, and caregivers — and get answers backed by real parents
              whose lives overlap with yours, labeled by who shared them and when.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <SiteButton href="/#founding" className="max-sm:w-full">
                Join the founding network
              </SiteButton>
              <SiteButton href="/#how" tone="gold" className="max-sm:w-full">
                See how it works
              </SiteButton>
            </div>
            <p className="mt-4 text-[0.85rem] text-muted">
              No app. No feed. No accounts. Just a number saved in your contacts.
            </p>
          </div>

          <PhoneMock />
        </Wrap>

        {/* Problem */}
        <Section>
          <Wrap className="grid items-center gap-8 lg:grid-cols-[1.05fr_1fr] lg:gap-16 xl:gap-20">
            <blockquote className="font-display text-[clamp(1.3rem,2.6vw,1.7rem)] font-semibold leading-[1.3] tracking-[-0.015em] text-green-deep lg:text-[2rem] lg:leading-[1.22]">
              The best answers in your neighborhood live in{" "}
              <span className="text-gold">other parents’ heads</span> — and die in
              group chats.
            </blockquote>
            <div className="space-y-3.5 text-ink-soft">
              <p>
                Which swim teacher is actually good with shy kids. Which camp is
                worth the waitlist. Who the trusted sitters are. Google can’t tell
                you. Reviews can’t either — you don’t know who wrote them, when, or
                whether their life looks anything like yours.
              </p>
              <p>
                Pando gathers that knowledge from a network of local parents, keeps
                it fresh, and gives it back over the lowest-friction interface that
                exists: a text message.
              </p>
              <p>
                <Link
                  href="/about"
                  className="font-semibold text-green-deep underline decoration-gold decoration-2 underline-offset-2"
                >
                  Why we’re named after the largest living thing on Earth →
                </Link>
              </p>
            </div>
          </Wrap>
        </Section>

        {/* How it works */}
        <Section id="how">
          <SectionGrid
            title="How Pando works"
            intro="Like texting a friend who knows every parent in the neighborhood — because, in a sense, that’s exactly what it is."
          >
            <div className="grid gap-3.5 sm:grid-cols-2 sm:gap-5">
              {STEPS.map((step) => (
                <div
                  key={step.title}
                  className="rounded-[1.125rem] border border-bark bg-card p-6 sm:p-7"
                >
                  <LeafIcon
                    fill={step.tone}
                    stem={
                      step.tone === "var(--color-ink)"
                        ? "var(--color-gold)"
                        : "var(--color-ink)"
                    }
                  />
                  <h3 className="mt-3.5 font-display text-[1.1rem] font-semibold">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[0.96rem] text-ink-soft">{step.body}</p>
                </div>
              ))}
            </div>

            <div
              className="mt-7 flex flex-wrap gap-2.5"
              aria-label="Examples of Pando answer labels"
            >
              {LABELS.map((label) => (
                <span
                  key={label.text}
                  className={
                    label.gold
                      ? "rounded-full border border-gold-line bg-gold-wash px-4 py-2 text-[0.8rem] font-semibold text-gold-ink sm:text-[0.83rem]"
                      : "rounded-full border border-bark bg-card px-4 py-2 text-[0.8rem] font-semibold text-green-deep sm:text-[0.83rem]"
                  }
                >
                  {label.text}
                </span>
              ))}
            </div>
          </SectionGrid>
        </Section>

        {/* Ask anything */}
        <Section>
          <SectionGrid
            title={<>Ask what Google — and AI — can’t answer</>}
            intro="Real questions from SGV parents — the kind that only someone who’s been there can answer."
            aside={
              <p className="text-[0.95rem] leading-relaxed text-muted">
                This is where we start — the questions where knowing <em>who</em>{" "}
                said it matters most. The destination is bigger: every question
                you’d take to a trusted parent group chat, from feeding to travel to
                specialists, answered by the right parent’s real experience.
              </p>
            }
          >
            <div className="grid gap-3.5 sm:grid-cols-2">
              {ASKS.map((ask) => (
                <div
                  key={ask.kind}
                  className="rounded-2xl rounded-bl-[0.3rem] border border-bark bg-card px-4 py-4 text-[0.95rem] text-ink-soft"
                >
                  <span className="mb-1.5 block text-[0.72rem] font-bold uppercase tracking-[0.12em] text-gold">
                    {ask.kind}
                  </span>
                  {ask.text}
                </div>
              ))}
            </div>
          </SectionGrid>
        </Section>

        {/* Founding network */}
        <Section id="founding" tone="moss">
          <Wrap className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-[3.25rem]">
            <div>
              <h2 className="font-display text-[clamp(1.5rem,3vw,2.1rem)] font-bold tracking-[-0.02em] text-white">
                Pando starts with founding parents, neighborhood by neighborhood.
              </h2>
              <p className="mt-3.5 text-[1.04rem] leading-relaxed text-paper-soft">
                Every parent-sourced recommendation in Pando traces back to a real
                parent. The founding network is where that starts — and founding
                places open neighborhood by neighborhood, so every new area begins
                with enough local knowledge to be genuinely useful.
              </p>
              <ul className="mt-6">
                {[
                  {
                    lead: "Share what you know",
                    rest: "— the classes, camps, and caregivers you’d actually vouch for. Takes about ten minutes, feels like texting.",
                  },
                  {
                    lead: "Contribute, and it comes back",
                    rest: "— founding contributions are rewarded, and inviting parents who join in earns you free Network Asks for when your neighborhood goes live.",
                  },
                  {
                    lead: "Founding status, permanently",
                    rest: "— priority for your own questions and first access as Pando grows.",
                  },
                  {
                    lead: "Protected by design",
                    rest: "— the network asks for your help at most three times a month by default, you set that number yourself, you can always skip, and there is no leaderboard. Ever.",
                  },
                ].map((item) => (
                  <li
                    key={item.lead}
                    className="border-b border-paper/15 py-3 text-[0.98rem] leading-relaxed text-paper-soft last:border-b-0"
                  >
                    <strong className="font-semibold text-gold">{item.lead}</strong>{" "}
                    {item.rest}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-[1.25rem] border border-paper/20 bg-paper/5 px-7 py-8 text-center">
              <p className="font-display text-[2.8rem] font-extrabold leading-none text-gold sm:text-[3.4rem]">
                Pasadena
              </p>
              <p className="mx-auto mt-2.5 max-w-[24ch] text-[0.9rem] text-paper-soft">
                founding places now open — more SGV neighborhoods as each one is
                ready
              </p>
              {/* Straight into the Seed Tool. A visitor without an invite code
                  lands on its gate, which explains itself and takes a code by
                  hand — it replaced the Tally waitlist form. */}
              <SiteButton href="/join" tone="gold" className="mt-6 w-full">
                Join the founding network
              </SiteButton>
              <p className="mt-5 text-[0.9rem] leading-relaxed text-paper-soft">
                Know a parent everyone asks for recommendations?
                <br />
                Forward this page — that’s exactly who we’re looking for.
              </p>
            </div>
          </Wrap>
        </Section>

        {/* FAQ */}
        <Section>
          <SectionGrid
            title="Questions parents ask us about Pando"
            aside={
              <p className="text-[0.95rem] leading-relaxed text-muted">
                Something we haven’t answered?{" "}
                <a
                  href="mailto:hello@pando.is"
                  className="font-semibold text-green-deep underline decoration-gold decoration-2 underline-offset-2"
                >
                  Email us
                </a>{" "}
                — a person replies.
              </p>
            }
          >
            <div className="space-y-3">
              {FAQ.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-[0.875rem] border border-bark bg-card px-5"
                >
                  <summary className="flex min-h-[3.5rem] cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden="true"
                      className="font-display text-[1.3rem] leading-none text-green after:content-['+'] group-open:after:content-['–']"
                    />
                  </summary>
                  <p className="pb-[1.125rem] text-[0.97rem] leading-relaxed text-ink-soft">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </SectionGrid>
        </Section>
      </main>

      <SiteFooter />
    </>
  );
}
