import type { ReactNode } from "react";
import { SiteFooter, SiteHeader, Wrap } from "./Shell";

/**
 * Layout for the two document pages (/privacy, /terms).
 *
 * Phone: title, date, text — one column, exactly as the original pages read.
 * lg and up: the title and metadata become a sticky rail with a section index
 * beside the text, and the measure is capped at ~70 characters. A 1440px screen
 * showing one narrow ribbon of 15px legal text was the thing that felt unfinished.
 */
export function DocShell({
  title,
  effective,
  sections,
  children,
}: {
  title: string;
  effective?: string;
  /** Anchor list for the desktop index. Ids must exist on the headings. */
  sections?: Array<{ id: string; label: string }>;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader variant="back" />

      <main id="main" tabIndex={-1} className="py-10 sm:py-14 lg:py-20">
        {/* Fixed measure rather than a fluid column: legal text at ~75 characters
            a line reads; the same text across 750px does not. The pair is centred
            so the page looks composed instead of left-anchored. */}
        <Wrap className="lg:grid lg:grid-cols-[minmax(0,16rem)_minmax(0,36rem)] lg:justify-center lg:gap-14 xl:gap-20">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <h1 className="font-display text-[1.6rem] font-bold tracking-[-0.02em] sm:text-[2rem] lg:text-[2.2rem] lg:leading-[1.1]">
              {title}
            </h1>
            {effective && (
              <p className="mt-2.5 text-[0.85rem] leading-relaxed text-muted">
                {effective}
              </p>
            )}

            {sections && sections.length > 0 && (
              <nav aria-label="On this page" className="mt-7 hidden lg:block">
                <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-muted">
                  On this page
                </p>
                <ul className="mt-3 space-y-0.5 border-l border-bark">
                  {sections.map((section) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="-ml-px block border-l border-transparent py-1.5 pl-3.5 text-[0.9rem] text-muted transition-colors hover:border-green hover:text-green-deep"
                      >
                        {section.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}

            <p className="mt-7 hidden text-[0.85rem] leading-relaxed text-muted lg:block">
              Questions about any of this?
              <br />
              <a
                href="mailto:hello@pando.is"
                className="font-medium text-green-deep underline underline-offset-2"
              >
                hello@pando.is
              </a>{" "}
              — a person answers.
            </p>
          </div>

          <div className="legal mt-7 lg:mt-0">{children}</div>
        </Wrap>
      </main>

      <SiteFooter />
    </>
  );
}
