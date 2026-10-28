"use client";

/**
 * When the root layout itself throws (28 Oct, architecture review §7.2): it
 * replaces the whole document, so it carries its own <html> and plain styles —
 * the stylesheet and fonts may be what failed.
 */
export default function GlobalError({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f7f6f0", color: "#223018", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: "40px 20px" }}>
          <h1 style={{ fontSize: 24 }}>Something went wrong</h1>
          <p style={{ fontSize: 16, lineHeight: 1.55 }}>Nothing you saved is lost. Please try again in a moment.</p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{ minHeight: 48, padding: "0 20px", borderRadius: 999, border: 0, background: "#26331d", color: "#f7f6f0", fontSize: 15, fontWeight: 600 }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
