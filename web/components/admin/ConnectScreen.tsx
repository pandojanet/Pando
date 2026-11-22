"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeftRight, BarChart3, BookOpen, GitPullRequestArrow, Link2Off, LockKeyhole, ShieldCheck, Sparkles, SquareTerminal } from "lucide-react";
import { PandoMark } from "@/components/ui/Logo";
import { cn } from "@/lib/cn";

/**
 * Connecting Claude to Pando MCP (20 Nov; redrawn the same day on the developer's "make it a proper
 * connect page"): the OAuth consent screen, on its own like any service's — no admin menu around it.
 *
 * Claude sends the person to `/api/oauth/authorize`, which checks the request and brings them here,
 * through the admin sign-in first (`/admin` is guarded). Allow asks the server to check everything
 * again and make a code; the page then goes on to Claude itself (a redirect from a form would hit the
 * CSP `form-action`). Where it returns to is shown, as the MCP authorization spec asks of a consent
 * screen. Codes go only to Claude's callback or a loopback address (`acceptableRedirect`), so the
 * client is named by where it returns to, not by the name it gave itself.
 */

type Phase = "ask" | "allowed" | "cancelled";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function Tile({ children, dark }: { children: ReactNode; dark?: boolean }) {
  return (
    <div
      className={cn(
        "flex size-16 items-center justify-center rounded-2xl border shadow-card",
        dark ? "border-moss bg-moss text-paper" : "border-bark bg-card",
      )}
    >
      {children}
    </div>
  );
}

function Access({ icon, title, detail }: { icon: ReactNode; title: string; detail: ReactNode }) {
  return (
    <li className="flex gap-3.5 py-3">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-green-wash text-green-deep">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[13.5px] leading-snug text-muted">{detail}</span>
      </span>
    </li>
  );
}

export function ConnectScreen({ user }: { user: string }) {
  const [params, setParams] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [phase, setPhase] = useState<Phase>("ask");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setParams(Object.fromEntries(new URLSearchParams(window.location.search)));
  }, []);

  const target = (() => {
    try {
      return params?.redirect_uri ? new URL(params.redirect_uri) : null;
    } catch {
      return null;
    }
  })();
  const local = target ? LOOPBACK.has(target.hostname) : false;
  const client = local ? "Claude Code" : "Claude";
  const scope = (params?.scope ?? "").split(/\s+/).filter(Boolean);
  const readOnly = scope.includes("pando:read") && !scope.includes("pando:propose");

  async function decide(decision: "allow" | "deny") {
    if (!params) return;
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...params, decision }),
      });
      const body = (await res.json().catch(() => null)) as { redirect?: string | null; error?: string } | null;
      if (body?.redirect) {
        setPhase(decision === "allow" ? "allowed" : "cancelled");
        window.location.href = body.redirect;
        return;
      }
      setError(body?.error ?? /* copy: kept — what failed and the one way on */ "That didn't go through. Start again from Claude.");
    } catch {
      setError("Pando couldn't be reached. Try again.");
    }
    setBusy(null);
  }

  const invalid = params !== null && !target;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-paper px-5 py-10">
      <div className="w-full max-w-[26rem]">
        {/* Who is connecting to whom. */}
        <div className="mb-7 flex items-center justify-center gap-3" aria-hidden>
          <Tile dark>
            {params === null ? null : local ? <SquareTerminal className="size-7" strokeWidth={1.75} /> : <Sparkles className="size-7" strokeWidth={1.75} />}
          </Tile>
          <div className="flex items-center gap-1.5 text-paper-faint">
            <span className="h-px w-5 border-t border-dashed border-paper-faint" />
            <span className="flex size-7 items-center justify-center rounded-full border border-bark bg-card text-green-deep">
              {invalid ? <Link2Off className="size-3.5" /> : <ArrowLeftRight className="size-3.5" />}
            </span>
            <span className="h-px w-5 border-t border-dashed border-paper-faint" />
          </div>
          <Tile>
            <PandoMark className="h-8" />
          </Tile>
        </div>

        {params === null ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading">
            <div className="mx-auto h-7 w-3/4 animate-pulse rounded-lg bg-bark-soft" />
            <div className="mx-auto h-4 w-1/3 animate-pulse rounded bg-bark-soft" />
            <div className="mt-6 h-56 animate-pulse rounded-2xl bg-bark-soft" />
          </div>
        ) : invalid ? (
          <div className="text-center">
            <h1 className="font-display text-[1.6rem] font-bold leading-tight tracking-[-0.022em] text-balance">
              {/* copy: kept — what this page is, when it was opened without Claude */}This link isn&apos;t a sign‑in from Claude
            </h1>
            <p className="mt-2 text-[14px] text-muted">
              {/* copy: kept — the one thing to do instead */}Start the connection from Claude, and it brings you here.
            </p>
            <a href="/admin" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl border border-bark bg-card px-5 text-[14.5px] font-semibold text-ink hover:border-green/60">
              Go to Pando admin
            </a>
          </div>
        ) : (
          <>
            <h1 className="text-center font-display text-[1.6rem] font-bold leading-tight tracking-[-0.022em] text-balance">
              {client} wants to connect to Pando
            </h1>
            <p className="mt-2 flex items-center justify-center gap-2 text-[14px] text-muted">
              <span className="flex size-6 items-center justify-center rounded-full bg-green-wash text-[12px] font-bold text-green-deep" aria-hidden>
                {user.slice(0, 1).toUpperCase()}
              </span>
              <span>
                Signed in as <span className="font-semibold text-ink">{user}</span>
              </span>
            </p>

            <section className="mt-6 rounded-2xl border border-bark bg-card px-5 pb-2 pt-4 shadow-card" aria-labelledby="access">
              <h2 id="access" className="text-[13.5px] font-semibold text-muted">
                {client} will be able to
              </h2>
              <ul className="divide-y divide-bark/70">
                <Access
                  icon={<BarChart3 className="size-[18px]" />}
                  title="See Pando's numbers"
                  detail={<>{/* copy: kept — what reading the numbers does and does not include */}Totals and trends, never a parent&apos;s name or phone</>}
                />
                <Access
                  icon={<BookOpen className="size-[18px]" />}
                  title="Read records and what parents shared"
                  detail={<>{/* copy: kept — the approved words, without who wrote them */}Approved words only, without who wrote them</>}
                />
                {!readOnly && (
                  <Access
                    icon={<GitPullRequestArrow className="size-[18px]" />}
                    title="Propose changes"
                    detail={<>{/* copy: kept — proposals wait for a person */}Nothing changes until an admin says yes</>}
                  />
                )}
              </ul>
            </section>

            <dl className="mt-4 space-y-2 px-1 text-[13px] text-muted">
              <div className="flex items-start gap-2">
                <LockKeyhole className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <dt className="inline">Returns to </dt>
                  <dd className="inline font-semibold text-ink">{target?.host}</dd>
                  {local && <span>{" · Claude Code on this computer"}</span>}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <dt className="sr-only">Control</dt>
                  <dd className="inline">
                    {/* copy: kept — the person can see and end this connection */}Every request is logged. Turn it off or revoke it in{" "}
                    <a href="/admin/mcp" className="font-semibold text-green-deep underline-offset-2 hover:underline">
                      Pando MCP
                    </a>
                    .
                  </dd>
                </span>
              </div>
            </dl>

            {error && (
              <p role="alert" className="mt-4 rounded-xl border border-alert-line bg-alert-wash px-4 py-3 text-[13.5px] text-alert">
                {error}
              </p>
            )}

            {phase === "ask" ? (
              <div className="mt-6 grid gap-2.5">
                <button
                  type="button"
                  onClick={() => void decide("allow")}
                  disabled={busy !== null}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-deep px-5 text-[15.5px] font-semibold text-white transition-colors hover:bg-ink disabled:cursor-wait disabled:opacity-70"
                >
                  {busy === "allow" && <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />}
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => void decide("deny")}
                  disabled={busy !== null}
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-bark bg-card px-5 text-[15.5px] font-semibold text-ink transition-colors hover:border-green/60 disabled:cursor-wait disabled:opacity-70"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <p role="status" className="mt-6 flex items-center justify-center gap-2.5 rounded-xl bg-green-wash px-4 py-3.5 text-[14.5px] font-semibold text-green-deep">
                <span className="size-4 animate-spin rounded-full border-2 border-green/30 border-t-green-deep" aria-hidden />
                {phase === "allowed" ? `Connected. Returning to ${client}…` : `Cancelled. Returning to ${client}…`}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
