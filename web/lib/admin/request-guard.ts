/**
 * The admin API's cross-site guard (27 Oct).
 *
 * Every state-changing admin route — `POST`/`PUT`/`PATCH`/`DELETE` under
 * `app/api/admin` — calls `refuseForeignAdminWrite(request)` before it reads
 * the session or the body. The cookie is `SameSite=Lax`, which already keeps it
 * off a cross-site `POST`; this is the second wall, so the admin does not rest
 * on one browser default:
 *
 *  - **Origin.** A browser sends `Origin` on every `POST`/`PUT`/`PATCH`/`DELETE`
 *    fetch, same-origin included. One that names another host, or `null` (a
 *    sandboxed frame, a `data:` page), is refused. Without `Origin` the
 *    `Referer` is read instead, the same way.
 *  - **Neither header** is allowed through. A browser cannot make a cross-site
 *    request without `Origin`, and the server-side suites (`test:e2e`,
 *    `test:relay-live`) call these routes with Node's `fetch`, which sends
 *    neither. The JSON rule below still applies to them.
 *  - **JSON only.** Every admin write sends `application/json`, and a browser
 *    will not send that cross-site without a CORS preflight this app never
 *    answers — so an HTML form, or a `no-cors` fetch, cannot reach a handler.
 *    Sign-out (`DELETE /api/admin/session`) sends no body, so it is checked for
 *    origin only (`{ body: false }`).
 *
 * "This site" is the request's own `Host` (Traefik passes it through), plus
 * `X-Forwarded-Host` and the URL's host — a browser cannot set either of the
 * first two cross-site without the same preflight. No configured list: one
 * would have to name every preview and lab host, and a wrong one fails closed.
 *
 * No imports, so `npm run test:security` can load it under plain Node.
 */

export type AdminWriteRefusal = "foreign_origin" | "not_json";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostOf(value: string | null): string | null {
  if (!value || value === "null") return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function ownHosts(request: Request): Set<string> {
  const hosts = new Set<string>();
  const add = (h: string | null | undefined) => {
    const v = h?.split(",")[0]?.trim().toLowerCase();
    if (v) hosts.add(v);
  };
  add(request.headers.get("host"));
  add(request.headers.get("x-forwarded-host"));
  try {
    add(new URL(request.url).host);
  } catch {
    /* A relative URL only happens in a hand-built test request. */
  }
  return hosts;
}

/**
 * Why this request must not reach an admin handler, or `null` when it may.
 * Reads headers only; never the body.
 */
export function adminWriteRefusal(
  request: Request,
  options: { body?: boolean } = {},
): AdminWriteRefusal | null {
  if (!WRITE_METHODS.has(request.method.toUpperCase())) return null;

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const claimed = origin !== null ? origin : referer;
  if (claimed !== null) {
    const host = hostOf(claimed);
    if (!host || !ownHosts(request).has(host)) return "foreign_origin";
  }

  if (options.body !== false) {
    const type = (request.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (type !== "application/json") return "not_json";
  }
  return null;
}

/**
 * The response for a refused request, or `null` to carry on. Logged as the
 * route and the reason — two enums, never a header value (invariant 7).
 */
export function refuseForeignAdminWrite(
  request: Request,
  route: string,
  options: { body?: boolean } = {},
): Response | null {
  const refusal = adminWriteRefusal(request, options);
  if (!refusal) return null;
  console.warn("[admin:guard] refused", { route, reason: refusal });
  return refusal === "not_json"
    ? Response.json({ error: "Send JSON" }, { status: 415 })
    : Response.json({ error: "Not from this site" }, { status: 403 });
}
