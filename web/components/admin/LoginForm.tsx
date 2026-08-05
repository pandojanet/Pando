"use client";

import { useState } from "react";
import { PandoMark } from "@/components/ui/Logo";
import { Button, Field, inputClass } from "@/components/admin/ui";

export function LoginForm({
  users,
  configured,
  next,
}: {
  users: string[];
  configured: boolean;
  next: string;
}) {
  const [user, setUser] = useState(users[0] ?? "");
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
              Admin isn&apos;t set up on this deployment
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-gold-ink">
              Set <code>ADMIN_PASSWORD</code> and <code>ADMIN_USERS</code> (a
              comma-separated list of names) and restart. Until both exist the admin
              stays closed rather than open without a password.
            </p>
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="rounded-xl border border-bark bg-card p-5 shadow-card"
          >
            <h1 className="font-display text-[1.25rem] font-bold">Sign in</h1>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">
              Pick who you are — sensitive actions are recorded against your name.
            </p>

            <div className="mt-5 space-y-4">
              <Field label="You are">
                <select
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  className={inputClass}
                >
                  {users.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
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
              <p className="mt-3 text-[13.5px] font-medium text-[#8a2f2f]">{error}</p>
            )}

            <Button
              type="submit"
              tone="primary"
              disabled={busy || password.length === 0}
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
