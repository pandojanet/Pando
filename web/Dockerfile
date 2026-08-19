# syntax=docker/dockerfile:1
#
# Pando web — production image.
#
# Build context is `web/`. Three stages so the final image carries the traced
# standalone output and nothing else: no source, no dev dependencies, no npm
# cache. Node 22 matches the version CI and local development run on.

FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── builder ──────────────────────────────────────────────────────────────────
# `next/font/google` downloads and self-hosts the two fonts during the build,
# so this stage needs network access. Nothing is fetched at runtime.
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `public/` is empty in this repo, and git does not track empty directories — so
# it exists on a developer's disk but not in a fresh checkout. Without this the
# runner stage's `COPY /app/public` fails on CI only ("/app/public": not found)
# while `docker build` locally succeeds, which is the worst kind of difference.
# Creating it here keeps the build independent of whether anyone has added a
# static asset yet.
RUN mkdir -p public

# `NEXT_PUBLIC_*` is the one class of config that is NOT read at request time:
# Next inlines it into the client bundle during `next build`. Putting the PostHog
# key in /docker/pando/.env therefore does nothing — the browser bundle would
# already carry `undefined` and the provider would stay inert with no error
# anywhere. It has to arrive here, as a build arg, and CI passes it from repo
# secrets (see .github/workflows/deploy.yml and DEPLOY.md §3).
#
# Both are optional: an image built without them is a working image with
# analytics switched off, which is the same honest no-op as an unset key locally.
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ARG NEXT_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com"
# QA-only screen recording. Empty here on purpose: an image built without it is
# an image that records nobody's screen, so forgetting the arg fails safe.
ARG NEXT_PUBLIC_POSTHOG_SESSION_RECORDING=""
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY \
    NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST \
    NEXT_PUBLIC_POSTHOG_SESSION_RECORDING=$NEXT_PUBLIC_POSTHOG_SESSION_RECORDING

ENV NODE_ENV=production
RUN npm run build

# ── runner ───────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# server.js only serves public/ and .next/static when they sit inside the
# standalone root, so both are copied in explicitly.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
