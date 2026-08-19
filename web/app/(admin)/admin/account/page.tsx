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
        intro="Change your own password. Adding or removing someone else isn't done here — ask a developer, so that giving somebody access is always a deliberate act."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {done ? (
        <Card>
          <div className="px-4 py-5">
            <p className="text-[15px] font-semibold text-green-deep">
              Password changed.
            </p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
              You&apos;re still signed in here. Anywhere else you were signed in is
              now signed out — that is what rotating a password is for.
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
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
            </Field>
            {mismatch && (
              <p className="text-[13px] font-medium text-alert">
                Those two don&apos;t match.
              </p>
            )}
          </div>
          <div className="border-t border-bark/70 px-4 py-3">
            <Button tone="primary" disabled={!ready} onClick={() => void submit()}>
              {busy ? "Changing…" : "Change password"}
            </Button>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              Pando stores a scrypt record, never the password itself — not here,
              not in the audit log, not in a server log. If you forget it, an
              operator rotates it with{" "}
              <code>npm run admin:user -- password &lt;name&gt;</code>; nobody can
              read the old one back.
            </p>
          </div>
        </Card>
      )}
    </>
  );
}
