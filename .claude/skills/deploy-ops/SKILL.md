---
name: deploy-ops
description: >-
  What a change to how Pando ships must carry: web/Dockerfile, .github/workflows,
  .github/scripts/remote-deploy.sh, deploy/docker-compose.yml, and every environment
  variable the app reads. Use when adding or renaming an env var, touching the image,
  CI or the deploy, or diagnosing a failed or rolled-back deploy. Triggers: "new env
  var", "add a secret", "deploy failed", "Dockerfile", "CI", "NEXT_PUBLIC_". Not for
  application code that only reads an existing variable, and not for migrations (the
  db-migration skill).
---

# Deploy and infrastructure changes

[DEPLOY.md](../../../DEPLOY.md) is the reference: the pipeline, the server, the secrets,
rollback. This skill is what a change to any of it must carry.

## How we do it

A deploy, infra or env change is not done until its description states three things:

1. **Impact** — what behaves differently, on which surface, from which deploy.
2. **Rollback** — the exact step back (DEPLOY.md §5: `.previous-image`, or an image by SHA).
3. **Operator actions** — what a person must do outside git: a secret or variable in
   GitHub, a line in `/docker/pando/.env` followed by `docker compose up -d`, a
   migration to run first.

A new environment variable touches every link of this chain, or it works locally and is
silently missing in production:

1. The code that reads it, at request time, with the unset case handled — Pando answers
   honestly when something is not configured (`persisted: false`, `not_configured`).
2. `web/.env.example`, with a comment on what it does and what unset means.
3. `deploy/.env.example` if the server needs it.
4. `NEXT_PUBLIC_*` only: a build arg in `web/Dockerfile` (ARG → ENV) **and** in
   `.github/workflows/deploy.yml`, plus a repo secret or variable. It is inlined at
   build time, so changing it is a redeploy, never a server `.env` edit.
5. `web/README.md` if it is a new route, hook or payload (CLAUDE.md → "Keeping this
   file current").

## Stop and ask a person when

- the change needs a secret, variable or server `.env` value only the user can set;
- the change alters the health check, the rollback script or the Traefik labels;
- anything would deploy: a push to `main` deploys. Push only after a "yes".

## Verify

- [ ] `npm --prefix web run gate` and `npm --prefix web run build` pass.
- [ ] For an image change: `docker build web/` succeeds and the container answers
      `GET /api/health`.
- [ ] The description names impact, rollback and operator actions.
- [ ] Every link of the env chain above that applies is in the diff.
