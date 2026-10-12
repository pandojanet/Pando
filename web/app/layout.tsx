import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { PostHogProvider, PostHogPageview } from "@/lib/posthog-provider";
import "./globals.css";

/*
 * Self-hosted, not `next/font/google` (12 Oct): the CI build fetches the
 * Google CSS at build time, and from GitHub's runners it came back in a form
 * Turbopack (Next 16.2) cannot parse — "next/font/google queries have exactly
 * one entry" on every @font-face — so the deploy failed on a file nobody had
 * touched. The same files Google served (the latin subset; each one variable,
 * covering every weight below), both under the SIL Open Font License.
 */
const bricolage = localFont({
  src: "./fonts/BricolageGrotesque-latin.woff2",
  variable: "--font-bricolage",
  weight: "600 800",
  display: "swap",
});

const instrument = localFont({
  src: "./fonts/InstrumentSans-latin.woff2",
  variable: "--font-instrument",
  weight: "400 600",
  display: "swap",
});

/**
 * Defaults only. The public site (app/(site)) sets its own indexable metadata
 * per page; the Seed Tool (app/(seed)) overrides this with noindex.
 */
export const metadata: Metadata = {
  title: {
    default: "Pando — AI knows things. Pando knows someone.",
    template: "%s — Pando",
  },
  description:
    "Pando is a text line for San Gabriel Valley parents. Ask about local classes, camps, and caregivers — get answers backed by real parents in your community.",
  appleWebApp: { capable: true, title: "Pando", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Cover so we can pad with env(safe-area-inset-*) ourselves.
  viewportFit: "cover",
  themeColor: "#F7F6F0",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${instrument.variable} antialiased`}
    >
      <body>
        <PostHogProvider>
          <PostHogPageview />
          {children}
        </PostHogProvider>
      </body>
    </html>
  );
}
