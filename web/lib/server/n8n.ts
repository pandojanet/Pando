import "server-only";

/**
 * The single seam between this frontend and the n8n backend.
 *
 * Nothing else in the codebase knows a webhook URL. Until the workflows exist,
 * every hook is "unconfigured": the route handler answers with a deterministic
 * mock and reports `persisted: false`, so the UI can be exercised end to end
 * without pretending data was stored.
 */

export type N8nHook =
  | "invite"
  | "profile"
  | "chat"
  | "save"
  | "complete"
  | "admin_read"
  | "admin_write";

const ENV_BY_HOOK: Record<N8nHook, string> = {
  invite: "N8N_WEBHOOK_INVITE",
  profile: "N8N_WEBHOOK_PROFILE",
  chat: "N8N_WEBHOOK_CHAT",
  save: "N8N_WEBHOOK_SAVE",
  complete: "N8N_WEBHOOK_COMPLETE",
  admin_read: "N8N_WEBHOOK_ADMIN_READ",
  admin_write: "N8N_WEBHOOK_ADMIN_WRITE",
};

/** Explicit per-hook URL wins; otherwise N8N_BASE_URL + /webhook/pando-<hook>. */
export function hookUrl(hook: N8nHook): string | null {
  const direct = process.env[ENV_BY_HOOK[hook]];
  if (direct) return direct;
  const base = process.env.N8N_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/webhook/pando-${hook}` : null;
}

export function isHookConfigured(hook: N8nHook): boolean {
  return hookUrl(hook) !== null;
}

export type ForwardResult<T> =
  | { forwarded: true; data: T }
  | { forwarded: false; reason: "unconfigured" | "error"; error?: string };

export async function forwardToN8n<T>(
  hook: N8nHook,
  payload: unknown,
): Promise<ForwardResult<T>> {
  const url = hookUrl(hook);
  if (!url) return { forwarded: false, reason: "unconfigured" };

  const token = process.env.N8N_WEBHOOK_TOKEN;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-Pando-Token": token } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (!res.ok) {
      return {
        forwarded: false,
        reason: "error",
        error: `n8n ${hook} responded ${res.status}`,
      };
    }

    const text = await res.text();
    const data = (text ? JSON.parse(text) : {}) as T;
    return { forwarded: true, data };
  } catch (err) {
    return {
      forwarded: false,
      reason: "error",
      error: err instanceof Error ? err.message : "unknown n8n error",
    };
  }
}
