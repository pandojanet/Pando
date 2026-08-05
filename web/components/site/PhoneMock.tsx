import { cn } from "@/lib/cn";

/**
 * The hero illustration: an example text conversation with Pando.
 *
 * Pure CSS — staggered `animate-rise` delays, no JavaScript, no client boundary.
 * `prefers-reduced-motion` is handled globally in globals.css, so the whole
 * conversation is simply present for anyone who asked for less movement.
 */
const TURNS = [
  {
    from: "parent" as const,
    text: "Any good toddler music classes near South Pasadena?",
    delay: 0.3,
  },
  {
    from: "pando" as const,
    text: "Happy to help — how old is your little one?",
    delay: 1.1,
  },
  { from: "parent" as const, text: "20 months", delay: 1.9 },
  {
    from: "pando" as const,
    text: "Little Maestros on Mission Ave gets strong recommendations from local parents for ages 1–3. Small groups and a warm teacher come up a lot. Want me to check the network for anything fresher?",
    delay: 2.7,
    tags: [
      "Recommended by 3 nearby parents · kids 1–3",
      "2 mentioned the patient teacher · one flags busy Saturdays",
      "Last confirmed 4 wks ago",
    ],
  },
];

export function PhoneMock() {
  return (
    <div
      role="img"
      aria-label="Example text conversation with Pando: a parent asks about toddler music classes near South Pasadena and gets a recommendation labelled as recommended by three nearby parents and last confirmed four weeks ago."
      className="mx-auto w-full max-w-[24.5rem] rounded-[1.875rem] border border-bark bg-card px-4 pb-4 pt-5 shadow-card lg:ml-auto lg:mr-0"
    >
      <p className="mb-3.5 border-b border-bark-soft pb-3.5 text-center text-[0.8rem] font-semibold tracking-[0.02em] text-muted">
        Pando
      </p>

      <div className="space-y-2">
        {TURNS.map((turn) => (
          <div
            key={turn.text}
            style={{ animationDelay: `${turn.delay}s` }}
            className={cn(
              "flex animate-rise",
              turn.from === "parent" ? "justify-end" : "justify-start",
            )}
          >
            <div
              className={cn(
                "max-w-[84%] rounded-[1.125rem] px-3.5 py-2.5 text-[0.92rem] leading-[1.45]",
                turn.from === "parent"
                  ? "rounded-br-[0.3rem] bg-green text-white"
                  : "rounded-bl-[0.3rem] bg-bark-soft text-ink",
              )}
            >
              {turn.text}
              {turn.tags && (
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {turn.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-bark bg-card px-2 py-0.5 text-[0.71rem] font-semibold leading-relaxed text-green-deep"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-center text-[0.7rem] leading-[1.5] text-muted/80">
        Msg &amp; data rates may apply. Message frequency varies.
        <br />
        Reply STOP to opt out, HELP for help.
      </p>
    </div>
  );
}
