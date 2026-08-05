import { SiteShell } from "@/components/site/Shell";

/**
 * The public site: /, /about, /privacy, /terms — ported from the four static
 * HTML pages that used to sit at the repo root. Indexable, unlike (seed).
 *
 * Each page composes its own header and footer because the legal pages use the
 * reduced "back to pando.is" header; the shell here only owns the page frame.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SiteShell>{children}</SiteShell>;
}
