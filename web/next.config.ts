import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployed as a Docker image on our own VPS: `next build` emits
  // .next/standalone with a self-contained server.js, so the runtime layer
  // carries no node_modules install of its own.
  output: "standalone",

  // Dev only, and not cosmetic: the indicator's default corner is bottom-left,
  // which is exactly where the admin sidebar keeps "Signed in as / Change
  // password / Sign out". It sat on top of them, so a control we needed to click
  // during QA was unreachable and looked broken. Nothing about production.
  devIndicators: { position: "bottom-right" },

  /**
   * Security headers on every response (22 Oct audit: there were none).
   *
   * ⚠ **Deliberately not a script/style/connect CSP.** PostHog talks to its own
   * host and Next inlines its bootstrap scripts; a `default-src 'self'` policy
   * written without walking every page would silently break analytics or a
   * flow, and a nonce policy makes every page dynamic. What is here closes the
   * holes that cost nothing to close: no page may be framed (clickjacking on
   * the admin and the consent screens), no `<base>` or plugin injection, no
   * form posting off-site, no MIME sniffing, and no full URL — which can carry
   * an invite code — sent to another site as a referrer. Nothing here uses the
   * camera, microphone or location (checked by grep), so they are switched off.
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },

  async redirects() {
    return [
      // The public site used to be four static .html files at the repo root.
      // Anything already shared or indexed keeps working.
      { source: "/index.html", destination: "/", permanent: true },
      { source: "/about.html", destination: "/about", permanent: true },
      { source: "/privacy.html", destination: "/privacy", permanent: true },
      { source: "/terms.html", destination: "/terms", permanent: true },

      // The Seed Tool moved off "/" so the marketing page could have it. Invite
      // links already in parent group chats (/?i=<code>) still land correctly.
      {
        source: "/",
        has: [{ type: "query", key: "i", value: "(?<code>.*)" }],
        destination: "/join?i=:code",
        permanent: false,
      },
      {
        source: "/",
        has: [{ type: "query", key: "invite", value: "(?<code>.*)" }],
        destination: "/join?i=:code",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
