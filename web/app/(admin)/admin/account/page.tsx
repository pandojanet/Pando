"use client";

import { useState } from "react";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  PageHead,
  inputClass,
} from "@/components/admin/ui";

/**
 * Your own account — which, in this admin, means exactly one thing: changing your
 * password without waiting for somebody with a terminal.
 *
 * What is deliberately not here: anything about *other* people. Creating an
 * admin, disabling one, or resetting somebody else's password stays in
 * `npm run admin:user`, because a session that can grant a session is a different
 * security surface, and the client asked for one admin and maybe two
 * (QC Answers Q6). This page can only ever act on the person already signed in.
 *
 * The current password is asked for even though the session already proves who
 * they are. A live tab on a borrowed laptop must not be enough to lock the owner
 * out of their own account — and the route throttles that check the same way the
 * sign-in screen does.
 */

const MIN_LENGTH = 12;

export default function AccountPage() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = again.length > 0 && next !== again;
  const ready =
    current.length > 0 && next.length >= MIN_LENGTH && next === again && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!res.ok) {
        setError(body?.error ?? "That didn't go through.");
        return;
      }

      setDone(true);
      setCurrent("");
      setNext("");
      setAgain("");
    } catch {
      setError("Couldn't reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title="Your account"
        intro="Change your own password. Adding or removing someone else — ask a developer."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {done ? (
        <Card>
          {/* Announced: the form it replaces is gone from the page, so without
              a role the only signal that anything happened is visual. */}
          <div className="px-4 py-5" role="status">
            <p className="text-[15px] font-semibold text-green-deep">
              Password changed.
            </p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
              You&apos;re still signed in here. Anywhere else has been signed out.
            </p>
            <Button
              tone="secondary"
              className="mt-3"
              onClick={() => setDone(false)}
            >
              Change it again
            </Button>
          </div>
        </Card>
      ) : (
        <Card title="Change password">
          {/**
           * A real `<form>`, which it was not.
           *
           * Three password fields and a button, and pressing Enter in any of
           * them did nothing — the one keystroke every browser and password
           * manager expects to submit. `type="submit"` on the button plus
           * `onSubmit` here is the whole fix; the click path is unchanged
           * because a submit button still fires it.
           */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) void submit();
            }}
          >
          <div className="grid max-w-[34rem] gap-3 px-4 py-3">
            <Field label="Current password">
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field
              label="New password"
              hint={`At least ${MIN_LENGTH} characters. A passphrase of a few words beats a short one with symbols in it.`}
            >
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </Field>
            <Field label="New password again">
              <input
                id="password-again"
                className={inputClass}
                type="password"
                autoComplete="new-password"
                aria-invalid={mismatch || undefined}
                aria-describedby={mismatch ? "password-mismatch" : undefined}
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
            </Field>
            {/* `role="alert"`, and linked to the field it is about. It was a
                plain `<p>`: a sighted user saw why the button stayed disabled
                and a screen-reader user did not. */}
            {mismatch && (
              <p
                id="password-mismatch"
                role="alert"
                className="text-[13px] font-medium text-alert"
              >
                Those two don&apos;t match.
              </p>
            )}
          </div>
          <div className="border-t border-bark/70 px-4 py-3">
            <Button type="submit" tone="primary" disabled={!ready}>
              {busy ? "Changing…" : "Change password"}
            </Button>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              Your password is never stored anywhere it could be read back. If you
              forget it, a developer can set a new one — nobody can recover the old.
            </p>
          </div>
          </form>
        </Card>
      )}
    </>
  );
}
