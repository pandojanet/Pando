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
