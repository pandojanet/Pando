"use client";

/**
 * What a parent sees when a page throws (28 Oct, architecture review §7.2).
 *
 * Before this there was no error boundary anywhere, so one bad value — most
 * often a progress copy on the phone that a deploy no longer reads — gave
 * Next's bare error screen on every reload, with no way out short of clearing
 * site data by hand. Two ways out: try again, or start over on this phone,
 * which forgets only what this device holds (a saved profile is in the
 * database and comes back at sign-in). Nothing about the error is shown —
 * a server error's message is generic in production anyway — and nothing is
 * logged here: the server already logged its side.
 */
import { clearSession } from "@/lib/storage";

export default function Error({ unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-5 py-10 text-ink">
      <h1 className="font-display text-step-title font-semibold">Something went wrong on this page</h1>
      <p className="text-body text-ink-soft">
        Try again first. If this page keeps coming back, start over on this phone: it forgets the
        answers this phone is holding, and anything already saved comes back when you sign in.
      </p>
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="min-h-12 rounded-full bg-moss px-5 text-control font-semibold text-paper"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => {
            clearSession();
            window.location.assign("/");
          }}
          className="min-h-12 rounded-full border border-bark bg-card px-5 text-control font-semibold text-ink"
        >
          Start over on this phone
        </button>
      </div>
    </main>
  );
}
