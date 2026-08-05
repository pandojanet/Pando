import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PandoMark } from "@/components/ui/Logo";

/**
 * The public site shell (pando.is): a normal responsive website, deliberately
 * *not* the phone-framed app shell in components/ui/Screen.tsx. Same tokens,
 * same fonts, different job — this one is meant to be read on a laptop too.
 *
 * Widths carried over from the original pages: 1080px for the marketing home,
 * 860px for legal text, 760px for the story.
 */
const WIDTHS = {
  wide: "max-w-[67.5rem] xl:max-w-[72rem]", // 1080px, a little more air on big screens
  text: "max-w-[53.75rem]", // 860px
  story: "max-w-[44rem]", // 704px — ~78 characters a line, the comfortable measure
} as const;

export function Wrap({
  children,
  size = "wide",
  className,
}: {
  children: ReactNode;
  size?: keyof typeof WIDTHS;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full px-[1.125rem] sm:px-6", WIDTHS[size], className)}>
      {children}
    </div>
  );
}

export function SiteShell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-paper">{children}</div>;
}

/** Section with the hairline rule the original pages used between blocks. */
export function Section({
  id,
  children,
  className,
  tone = "paper",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  tone?: "paper" | "moss";
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-16 border-t border-bark py-12 sm:py-[4.5rem]",
        tone === "moss" && "border-t-0 bg-moss text-paper",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[0.78rem] font-semibold uppercase tracking-[0.15em] text-green">
      {children}
    </p>
  );
}

/**
 * The desktop layout of a section: heading and intro become a left rail that
 * stays put while the content scrolls past it. On a phone this collapses to
 * exactly what it was before — title, intro, content, stacked.
 *
 * This is the one pattern that makes the site read as designed for a laptop
 * rather than as a stretched phone page, so most sections use it.
 */
export function SectionGrid({
  eyebrow,
  title,
  intro,
  aside,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  intro?: ReactNode;
  /** Extra note under the intro, in the rail. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Wrap className="lg:grid lg:grid-cols-[minmax(15rem,19rem)_minmax(0,1fr)] lg:gap-14 xl:gap-20">
      <div className="lg:sticky lg:top-24 lg:self-start">
        {eyebrow && <div className="mb-3">{eyebrow}</div>}
        <h2 className="font-display text-[1.5rem] font-bold tracking-[-0.02em] sm:text-[1.85rem] lg:text-[2.1rem] lg:leading-[1.1]">
          {title}
        </h2>
        {intro && (
          <p className="mt-3.5 max-w-[46ch] text-[1.02rem] leading-relaxed text-ink-soft">
            {intro}
          </p>
        )}
        {aside && <div className="mt-5 max-w-[46ch]">{aside}</div>}
      </div>

      <div className="mt-8 lg:mt-0">{children}</div>
    </Wrap>
  );
}

export function SiteHeader({
  variant = "full",
}: {
  /** "back" is the reduced header the legal pages use. */
  variant?: "full" | "back";
}) {
  return (
    <header className="sticky top-0 z-50 border-b border-bark bg-paper/[0.92] backdrop-blur-md">
      <Wrap className="flex items-center justify-between gap-4 py-3.5">
        <Link
          href="/"
          aria-label="Pando home"
          className="flex min-h-11 items-center gap-2.5 text-ink"
        >
          <PandoMark className="h-[1.8rem]" pulse />
          <span className="font-display text-[1.4rem] font-bold tracking-[-0.02em]">
            Pando
          </span>
        </Link>

        {variant === "full" ? (
          <nav className="flex items-center gap-6" aria-label="Main">
            <NavLink href="/#how">How it works</NavLink>
            <NavLink href="/about">Our story</NavLink>
            <NavLink href="/#founding">Founding parents</NavLink>
            <Link
              href="/#founding"
              className="inline-flex min-h-11 items-center rounded-full bg-gold px-5 text-[0.95rem] font-semibold text-ink transition-colors duration-150 hover:bg-gold-deep"
            >
              Join the founding network
            </Link>
          </nav>
        ) : (
          <Link
            href="/"
            className="inline-flex min-h-11 items-center text-[0.93rem] font-medium text-muted transition-colors hover:text-green-deep"
          >
            ← Back to pando.is
          </Link>
        )}
      </Wrap>
    </header>
  );
}

/** Secondary nav items stand down on phones, as they did on the original site. */
function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="hidden text-[0.93rem] font-medium text-muted transition-colors hover:text-green-deep md:inline"
    >
      {children}
    </Link>
  );
}

export function SiteFooter({ home }: { home?: boolean }) {
  return (
    <footer className="mt-auto border-t border-bark py-6 text-[0.9rem] text-muted sm:py-8">
      <Wrap className="flex flex-wrap items-center gap-x-7">
        <span>© 2026 Pando Systems, Inc</span>
        {home && <FooterLink href="/">Home</FooterLink>}
        <FooterLink href="/about">Our story</FooterLink>
        <FooterLink href="/privacy">Privacy policy</FooterLink>
        <FooterLink href="/terms">Text messaging terms</FooterLink>
        <FooterLink href="/#founding">Founding parents</FooterLink>
        <FooterLink href="mailto:hello@pando.is">hello@pando.is</FooterLink>
        <span>Pasadena, CA</span>
      </Wrap>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  // min-h-11: on a phone these wrap into rows and become the only tap targets
  // down here, so they get a real target height rather than 22px of text.
  const className =
    "inline-flex min-h-11 items-center font-medium text-green-deep underline-offset-2 hover:underline";
  return href.startsWith("mailto:") ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** Pill button used across the site. */
export function SiteButton({
  href,
  children,
  tone = "green",
  external,
  className,
}: {
  href: string;
  children: ReactNode;
  tone?: "green" | "gold";
  external?: boolean;
  className?: string;
}) {
  const classes = cn(
    "inline-flex min-h-[3.25rem] items-center justify-center rounded-full px-6 text-[0.98rem] font-semibold",
    "transition-[background-color,transform] duration-150 hover:-translate-y-px",
    tone === "green"
      ? "bg-green-deep text-white hover:bg-ink"
      : "bg-gold text-ink hover:bg-gold-deep",
    className,
  );

  return external ? (
    <a href={href} target="_blank" rel="noopener" className={classes}>
      {children}
    </a>
  ) : (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}

/** The mark at display size, centred — the story page's one piece of ornament. */
export function PandoGrove() {
  return (
    <div className="flex justify-center py-8 pb-2" aria-hidden="true">
      <PandoMark className="h-16 sm:h-20" pulse />
    </div>
  );
}

/** The little aspen leaf used as a step marker. */
export function LeafIcon({
  fill = "var(--color-green)",
  stem = "var(--color-ink)",
}: {
  fill?: string;
  stem?: string;
}) {
  return (
    <svg viewBox="0 0 26 26" className="h-[1.6rem] w-[1.6rem]" fill="none" aria-hidden="true">
      <path
        d="M13 3C9.5 7 8.2 9.6 8.2 12.2C8.2 15.2 10.4 17.4 13 17.4C15.6 17.4 17.8 15.2 17.8 12.2C17.8 9.6 16.5 7 13 3Z"
        fill={fill}
      />
      <path d="M13 17.4V23" stroke={stem} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
