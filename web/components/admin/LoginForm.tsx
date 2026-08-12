"use client";

import { useState } from "react";
import { PandoMark } from "@/components/ui/Logo";
import { Button, Field, inputClass } from "@/components/admin/ui";

/**
 * Admin sign-in.
 *
 * **The name is typed, never picked.** It used to be a `<select>` of everyone in
 * the credential store — a leftover from the shared-password design, where
 * choosing a name was the whole mechanism. With one password per person it was
 * wrong twice over: it made an audit name look like a preference, and it published
 * the list of people who hold admin access on an unauthenticated page. That second
 * one contradicted the module behind it, which hashes an unknown name against a
 * throwaway salt precisely so response time cannot be used to enumerate who
 * exists. Guarding the side door while the list sits in the front window is not
 * guarding anything.
 *
 * So the names are no longer sent to the browser at all, and a wrong name and a
 * wrong password are the same answer: "that didn't match".
 */
export function LoginForm({
  mode,
  next,
}: {
  /**
   * `database` is the one to run. `per_user` is the env bootstrap, `shared` the
   * deprecated one-password fallback, and `unavailable` means the credential
   * store could not be read — each says so, because "which authentication is
   * this deployment running" should not need an env dump to answer.
   */
  mode: "database" | "per_user" | "shared" | "unavailable" | "off";
  next: string;
}) {
  const configured = mode !== "off" && mode !== "unavailable";
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(detail?.error ?? "That didn't match.");
        return;
      }
      window.location.href = next;
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper px-5 py-10">
      <div className="w-full max-w-[24rem]">
        <div className="mb-6 flex items-center gap-2.5">
          <PandoMark className="h-6" />
          <span className="font-display text-[1.15rem] font-bold tracking-[-0.02em]">
            Pando admin
          </span>
        </div>

        {!configured ? (
          <div className="rounded-xl border border-gold-line bg-gold-wash p-5">
            <h1 className="font-display text-[1.15rem] font-semibold text-gold-ink">
              {mode === "unavailable"
                ? "Sign-in is temporarily unavailable"
                : "Admin isn't set up on this deployment"}
            </h1>
            {mode === "unavailable" ? (
              /*
                The credential store is configured and could not be read. Said
                plainly, because the alternative — "that didn't match" — sends
                somebody hunting for a password that was never wrong. Nothing
                falls back to an environment variable here: that is how a revoked
                admin gets their access back for the length of an outage.
              */
              <p className="mt-2 text-[13.5px] leading-relaxed text-gold-ink">
                Pando can&apos;t reach the credential store, so it isn&apos;t
                letting anyone in — including anyone whose access was removed.
                Nothing is wrong with your password. Try again in a moment.
              </p>
            ) : (
              <p className="mt-2 text-[13.5px] leading-relaxed text-gold-ink">
                Add the first person with{" "}
                <code>npm run admin:user -- add &lt;name&gt;</code>. With no
                database yet, generate an env record with{" "}
                <code>npm run admin:credential -- &lt;name&gt;</code> and put it in{" "}
                <code>ADMIN_CREDENTIALS</code>. Until one of those exists the admin
                stays closed rather than open without a password.
              </p>
            )}
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="rounded-xl border border-bark bg-card p-5 shadow-card"
          >
            <h1 className="font-display text-[1.25rem] font-bold">Sign in</h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
              {mode === "shared"
                ? "Your name and the shared password. Sensitive actions are recorded against the name you type."
                : "Your own name and password. Sensitive actions are recorded against them."}
            </p>

            {mode === "per_user" && (
              /*
                Not a warning — this mode is per-person and safe. It is a note
                that the deployment is running on the bootstrap path, where
                adding or removing someone means an env edit and a redeploy.
              */
              <p className="mt-3 rounded-lg border border-bark bg-paper px-3 py-2 text-[12.5px] leading-relaxed text-muted">
                Credentials are coming from <code>ADMIN_CREDENTIALS</code> because{" "}
                <code>admin_users</code> is empty. Add the first person with{" "}
                <code>npm run admin:user -- add &lt;name&gt;</code> and the table
                takes over — after which revoking access no longer needs a deploy.
              </p>
            )}

            {mode === "shared" && (
              /*
                Said out loud, because in this mode the name on an audit row is
                chosen rather than proved: anyone with the shared password can sign
                in as anyone on the list.
              */
              <p className="mt-3 rounded-lg border border-gold-line bg-gold-wash px-3 py-2 text-[12.5px] leading-relaxed text-gold-ink">
                This deployment still uses one shared password, so the name on an
                audit row is picked, not proved. Run{" "}
                <code>npm run admin:user -- add &lt;name&gt;</code> per person, then
                remove <code>ADMIN_PASSWORD</code> and <code>ADMIN_USERS</code>.
              </p>
            )}

            <div className="mt-5 space-y-4">
              <Field label="Name">
                <input
                  type="text"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  /* Names are lowercase slugs (`admin_users_name_check`), and a
                     phone keyboard capitalising the first letter would turn a
                     correct sign-in into "that didn't match". */
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </Field>

              <Field label="Password">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className={inputClass}
                />
              </Field>
            </div>

            {error && (
              <p className="mt-3 text-[13.5px] font-medium text-alert">{error}</p>
            )}

            <Button
              type="submit"
              tone="primary"
              disabled={busy || user.trim().length === 0 || password.length === 0}
              className="mt-5 w-full"
            >
              {busy ? "Checking…" : "Sign in"}
            </Button>

            <p className="mt-3 text-[12px] leading-relaxed text-muted">
              Five wrong attempts locks sign-in for 15 minutes.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
