import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
      <body>{children}</body>
    </html>
  );
}
