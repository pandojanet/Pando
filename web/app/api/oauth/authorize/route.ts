import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE } from "@/lib/admin/auth";
import { refuseForeignAdminWrite } from "@/lib/admin/request-guard";
import { readAdminSession } from "@/lib/server/admin-auth";
import { baseUrl } from "@/lib/mcp/oauth";
import { rateLimited } from "@/lib/server/rate-limit";
import { checkAuthorize, codeRedirect, errorRedirect } from "@/lib/server/mcp/authorize";
import { issueCode } from "@/lib/server/repo/mcp";

/**
 * GET /api/oauth/authorize — where Claude sends a person to connect Pando MCP (20 Nov). The request
 * is checked, then the person goes to `/admin/connect` with the same parameters: the admin sign-in
 * (if they are not signed in) and then the consent screen.
 *
 * POST — the consent screen's answer, from a signed-in admin on Pando's own origin. The request is
 * checked again and only then is a code made. The browser is sent on by the page, not by a redirect
 * from a form: the site's CSP `form-action 'self'` would block a form redirected to claude.ai.
 */
export async function GET(request: Request) {
  const limited = rateLimited(request, "oauth");
  if (limited) return limited;
  const params = new URL(request.url).searchParams;
  const base = baseUrl(request.url);
  const checked = await checkAuthorize(params, base);
  if (!checked.ok) {
    console.info("[mcp:oauth] authorize refused", { redirect: checked.redirect !== null });
    return checked.redirect
      ? NextResponse.redirect(checked.redirect, 302)
      : new NextResponse(`Pando could not start this sign-in: ${checked.reason}.`, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const to = new URL("/admin/connect", base);
  params.forEach((v, k) => to.searchParams.set(k, v));
  return NextResponse.redirect(to, 302);
}

export async function POST(request: Request) {
  const refused = refuseForeignAdminWrite(request, "oauth-authorize");
  if (refused) return refused;
  const session = await readAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const checked = await checkAuthorize(body, baseUrl(request.url));
  if (!checked.ok) return NextResponse.json({ error: checked.reason, redirect: checked.redirect }, { status: 400 });
  const { request: r } = checked;
  if (body.decision !== "allow") {
    console.info("[mcp:oauth] consent declined");
    return NextResponse.json({ redirect: errorRedirect(r.redirectUri, "access_denied", r.state) });
  }
  const code = await issueCode({ clientId: r.clientId, adminUser: session.user, redirectUri: r.redirectUri, codeChallenge: r.codeChallenge, scope: r.scope, resource: r.resource });
  if (!code) return NextResponse.json({ error: "Could not continue right now" }, { status: 503 });
  console.info("[mcp:oauth] consent given");
  return NextResponse.json({ redirect: codeRedirect(r.redirectUri, code, r.state) });
}
