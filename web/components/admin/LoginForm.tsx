"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { PandoMark } from "@/components/ui/Logo";
import { cn } from "@/lib/cn";
import { DEFAULT_MARKET_ID, QUIET_HOURS, hourIn, marketConfig } from "@/lib/markets";
import { Button, ErrorNote, Field, inputClass } from "@/components/admin/ui";

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
  const [shown, setShown] = useState(false);
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
    <main className="flex min-h-dvh items-center justify-center bg-paper px-5 py-10">
      <div className="w-full max-w-[23rem] animate-rise">
      <div className="overflow-hidden rounded-2xl border border-bark bg-card shadow-card">
        {/* 26 Nov — the developer: simple, no explanations, and good-looking. The moss band carries
            the brand (the leaf in gold, as on the parents' panel); the white below is only the form. */}
        <div className="flex items-center gap-3 bg-moss px-7 py-6 text-paper">
          <PandoMark tone="light" className="h-9" />
          <h1 className="font-display text-[1.35rem] font-bold leading-none tracking-[-0.022em]">
            Pando <span className="font-semibold text-paper-faint">admin</span>
          </h1>
        </div>

        <div className="px-7 pb-7 pt-6">

        {!configured ? (
          <div className="rounded-xl border border-gold-line bg-gold-wash p-5">
            <h2 className="font-display text-[1.15rem] font-semibold text-gold-ink">
              {mode === "unavailable"
                ? "Sign-in is temporarily unavailable"
                : "Admin isn't set up on this deployment"}
            </h2>
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
          <form onSubmit={submit}>

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

            <div className="space-y-4 [p+&]:mt-5">
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
                  autoFocus
                  className={`${inputClass} h-11`}
                />
              </Field>

              <Field label="Password">
                {/* 26 Nov: a way to check what was typed, on a phone above all — "that
                    didn't match" on a mistyped password was the commonest dead end. */}
                <span className="relative block">
                  <input
                    type={shown ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className={`${inputClass} h-11 pr-11`}
                  />
                  <button
                    type="button"
                    /* The pointer leaves the caret in the field, so Enter still signs in rather
                       than toggling again; a keyboard still reaches it with Tab. */
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setShown((s) => !s)}
                    aria-label={shown ? "Hide password" : "Show password"}
                    aria-pressed={shown}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted transition-colors hover:text-ink"
                  >
                    {shown ? <EyeOff className="size-[18px]" strokeWidth={1.75} /> : <Eye className="size-[18px]" strokeWidth={1.75} />}
                  </button>
                </span>
              </Field>
            </div>

            {/* `ErrorNote`, not a hand-written line: it carries `role="alert"`,
                and without it "that didn't match" was announced to nobody at
                all — on the one screen where the only thing to do next is read
                the message. */}
            {error && <ErrorNote className="mt-4">{error}</ErrorNote>}

            <Button
              type="submit"
              tone="primary"
              disabled={busy || user.trim().length === 0 || password.length === 0}
              className="mt-6 h-11 w-full"
            >
              {busy ? "Checking…" : "Sign in"}
            </Button>
          </form>
        )}
        </div>
      </div>

      {/* Under the card, quiet: the way back to the site, and the market's clock with whether texts
          go out now (invariant 6's window) — the one fact an admin acts on before sending anything. */}
      <div className="mt-4 flex items-center justify-between px-1 text-[12.5px] text-muted">
        <a href="/" className="-my-1 py-1 transition-colors hover:text-ink">
          ← pando.is
        </a>
        <LocalTime />
      </div>
      </div>
    </main>
  );
}

const MARKET = marketConfig(DEFAULT_MARKET_ID);
const hour12 = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;

/** Drawn after mount, so the server's own time zone never reaches the markup. */
function LocalTime() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(tick);
  }, []);
  if (!now) return <span className="min-h-5" />;
  const time = new Intl.DateTimeFormat("en-US", { timeZone: MARKET.timeZone, hour: "numeric", minute: "2-digit" }).format(now).toLowerCase();
  const h = hourIn(MARKET.timeZone, now);
  const sending = h >= QUIET_HOURS.start && h < QUIET_HOURS.end;
  const label = sending ? `Texts until ${hour12(QUIET_HOURS.end)}` : `Quiet until ${hour12(QUIET_HOURS.start)}`;
  return (
    <span className="flex items-center gap-1.5 tabular-nums">
      <span aria-hidden className={cn("size-1.5 rounded-full", sending ? "bg-green" : "bg-gold")} />
      {time} Pasadena · {label}
    </span>
  );
}

