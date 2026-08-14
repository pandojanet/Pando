# Deploying Pando

Push to `main` → GitHub Actions type-checks and builds → a Docker image is
pushed to GHCR → the VPS pulls it and restarts. A rollout that never reports
healthy is rolled back automatically and the job fails.

| File                                | What it is                                                  |
| ----------------------------------- | ----------------------------------------------------------- |
| `web/Dockerfile`                    | Production image (Next.js `output: "standalone"`, Node 22).  |
| `.github/workflows/ci.yml`          | `npm ci` → `tsc --noEmit` → `next build`. Every branch/PR.   |
| `.github/workflows/deploy.yml`      | CI → build/push image → SSH deploy. `main` only.             |
| `.github/scripts/remote-deploy.sh`  | What actually runs on the server.                            |
| `deploy/docker-compose.yml`         | What runs on the VPS, incl. the Traefik labels. Lives on the server, not deployed by CI. |
| `deploy/.env.example`               | Runtime environment template for the server.                 |

The target box already runs Traefik as its ingress and hosts n8n alongside. The
app replaces the static holding page **in place** at `/docker/pando` — see §4 for
why the path matters.

Every environment variable the app reads (`SEED_INVITE_CODES`, the `N8N_*`
group) is read **at request time**, so one image is promotable and changing a
value is `docker compose up -d`, not a rebuild. The exception is anything
`NEXT_PUBLIC_*` — those are inlined during `next build`, so when PostHog gets
wired (`NEXT_PUBLIC_POSTHOG_KEY`) it has to become a build arg in the Dockerfile
and a repo secret, not a line in the server's `.env`.

---

## 1. One-time: the GitHub repo

The repo does not exist yet. From `D:\Work\pando`:

```bash
git init -b main
git add -A
git commit -m "Pando web: app, Docker image and deploy pipeline"
```

Create an empty repo on GitHub (no README, no .gitignore), then:

```bash
git remote add origin git@github.com:OWNER/REPO.git
git push -u origin main
```

The first push runs CI. Deploy will run too and fail at the SSH step until the
secrets below exist — that is expected.

## 2. One-time: the server

The production box (Hostinger VPS, `srv1576782`) already runs Docker, **Traefik**
as its ingress, and n8n. The deploy directory is **`/docker/pando`** — it is where
the static holding page lived, and the app replaces it in place. That matters:
the compose project name is derived from the directory, and the project name is
what puts the container on the existing `pando_default` network that Traefik
already reaches. See §4.

Copy `deploy/docker-compose.yml` and `deploy/.env.example` into `/docker/pando`,
rename the second to `.env`, then:

- in `docker-compose.yml`, replace `OWNER/REPO` in the fallback image with your
  GitHub owner and repo, lowercase;
- in `.env`, set the invite codes. **Admin sign-in no longer belongs in this
  file** — credentials live in the `admin_users` table (§3, step 7). Without
  either that table or the `ADMIN_CREDENTIALS` bootstrap, `/admin` stays dark, by
  design. Leaving the n8n block empty is fine — the app runs and
  reports `persisted: false`.

**While the A2P campaign is still with the carriers**, leave the Twilio block empty
and pick one of two, because with neither the server stores *nothing*: no code can
be sent, so every founding parent takes the deferred path and never gets past it.

| Set in `/docker/pando/.env` | What you get |
| --- | --- |
| `SEED_VERIFY_DEV_CODES=1` | The **whole** OTP runs — 6 digits, 5-minute expiry, 3 sends, 3 guesses, 15-minute lock — with the code printed on screen instead of texted. Use this to test the real flow. |
| `SEED_REQUIRE_VERIFICATION=0` | No OTP at all. Everything stores, `phone_verified_at` stays null, nobody reaches Founding until they confirm later. Tests less. |

`SEED_VERIFY_DEV_CODES=1` removes proof that a parent holds the number they typed,
so rows created under it are not evidence of consent — clear them or mark them
`is_test` before the pilot, and unset the variable before the first real founding
contributor (same deadline as the `pando` starter password).

**It must be in `/docker/pando/.env`, not in a `.env.local` in the image.** The
container runs the standalone build, which reads the process environment that
compose passes in; a `.env.local` baked into the image is not read. Verify after a
deploy with `curl https://<host>/api/seed/verify/status` — `sendable` must be true.

```bash
chmod 600 /docker/pando/.env
```

### Deploy key

On your machine (not the server):

```bash
ssh-keygen -t ed25519 -f pando-deploy -C "github-actions" -N ""
```

Append `pando-deploy.pub` to `~/.ssh/authorized_keys` on the server. Keep
`pando-deploy` (the private half) for the secret below and delete your local
copy afterwards.

Then capture the server's host key, so the workflow is not trusting whatever
answers on first connect:

```bash
ssh-keyscan -H YOUR_SERVER_HOST
```

## 3. One-time: repo secrets

**Settings → Secrets and variables → Actions**:

| Secret              | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| `VPS_HOST`          | Server hostname or IP.                                        |
| `VPS_USER`          | The user whose `authorized_keys` you appended to.              |
| `VPS_SSH_KEY`       | Contents of the private `pando-deploy` file.                   |
| `VPS_APP_DIR`       | `/docker/pando`.                                               |
| `VPS_SSH_HOST_KEY`  | The `ssh-keyscan` output. Optional, strongly recommended.      |
| `VPS_PORT`          | Only if SSH is not on 22.                                      |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project API key. Optional — see below.           |

And under **Variables** (not secrets — it is not one), optionally
`NEXT_PUBLIC_POSTHOG_HOST` if the project is not on `https://us.i.posthog.com`
(EU projects are `https://eu.i.posthog.com`).

**Why PostHog is a repo secret and not a server `.env` value.** Everything in
`/docker/pando/.env` is read at request time by the running server. `NEXT_PUBLIC_*`
is the exception: Next inlines it into the client bundle during `next build`, so
by the time the container starts it is already baked in — or already `undefined`.
The deploy workflow passes it to `docker build` as a build arg. Set the secret and
push; there is nothing to change on the server. Leave it unset and the image is a
working image with analytics off, which fails safe rather than loudly.

No registry credential is stored on the server: the deploy logs in to GHCR with
the job's own short-lived `GITHUB_TOKEN` and logs out again when it finishes.

## 3b. One-time: the database

Supabase hosts the Postgres; the app owns the schema. Nothing here runs on the
VPS — you apply the migrations from your own machine, once, before the first
deploy that has `DATABASE_URL` set.

1. Create the Supabase project. Note the database password it shows you — it is
   shown **once**, and the only fix is a reset.
2. Take the **pooler** connection string (Connect → *Connection pooling*), not the
   direct one. The direct host is IPv6-only without the paid add-on, and an IPv4
   VPS cannot reach it — the same constraint that shaped `lib/server/db.ts`.
3. Put it in `web/.env.local` as `DATABASE_URL`, and apply the schema:

   ```bash
   npm run migrate
   ```

   Safe to re-run: Drizzle records what it has applied in a
   `drizzle.__drizzle_migrations` table and skips those.

   **Use port 5432 for this command**, not 6543. Both are the same pooler host;
   6543 is transaction mode, which the app wants and a migration does not. The
   script warns if it sees 6543 and continues anyway. To keep the app on 6543 while
   migrating over 5432, set `MIGRATE_DATABASE_URL` to the 5432 form.

4. `web/drizzle/0002_rls.sql` asserts eight product invariants as it runs. If the
   migration fails there, that is the assertion doing its job — read the message
   before touching the SQL.
5. Load the reference data the tap lists read, once:

   ```bash
   npm run seed
   ```

6. Put the same `DATABASE_URL` (the **6543** form) into `/docker/pando/.env` on the
   server and redeploy. Until it is set, every write route answers
   `persisted: false` and no screen claims a contribution was stored.

7. Create the people who may sign in to the admin. Same place as the two commands
   above — a checkout, pointed at this database — because the runtime image is a
   standalone bundle with no scripts in it:

   ```bash
   npm run admin:user -- add janet
   ```

   It prints a passphrase once, hashes it with scrypt, and stores only the hash;
   `admin_users_hash_check` is what stops anything else reaching that column. From
   then on `admin_users` is authoritative and `ADMIN_CREDENTIALS` /
   `ADMIN_PASSWORD` are ignored — which is the point: **taking access away is one
   command, not a redeploy.**

   ```bash
   npm run admin:user -- list          # who can sign in, and when they last did
   npm run admin:user -- password janet # rotate; ends that person's sessions
   npm run admin:user -- disable someone
   ```

   A change reaches a running server within a minute, and immediately on the next
   sign-in attempt. Set `ADMIN_SESSION_SECRET` in `/docker/pando/.env` too, or
   rotating one password signs everyone out (see `lib/admin/auth.ts`).

Re-run `npm run migrate` after any change to `web/lib/db/schema.ts` that
`drizzle-kit generate` turns into a new file in `web/drizzle/`.

## 4. Ingress — Traefik, not nginx

**Do not install nginx or certbot on this box.** Traefik
(`traefik-gizz-traefik-1`) already owns 80/443 and issues the Let's Encrypt
certificate; the host's `nginx` service is `inactive` and its config is the
untouched Debian default. Installing either would fight Traefik for the ports.

Traefik discovers backends by reading container labels off the Docker socket, so
there is no proxy config file to edit — routing lives in
`deploy/docker-compose.yml`:

```
traefik.enable=true
traefik.http.routers.pando.entrypoints=websecure
traefik.http.routers.pando.rule=Host(`pando.is`) || Host(`www.pando.is`)
traefik.http.routers.pando.tls.certresolver=letsencrypt
traefik.http.services.pando.loadbalancer.server.port=3000
```

These are exactly the labels the static site carried, with one change: the
upstream port is 3000 (Next.js) rather than 80 (nginx). The router name stays
`pando`, so the existing certificate and router carry over.

Two things quietly break this:

- **Moving or renaming `/docker/pando`.** The compose project name comes from the
  directory, and the project name determines the network (`pando_default`). A
  different network means Traefik cannot see the container, and the only symptom
  is a 404 from Traefik with a perfectly healthy app behind it.
- **Dropping the labels.** Same symptom.

The `127.0.0.1:3000` publish in the compose file is not used by Traefik. It is
there so `curl 127.0.0.1:3000/api/health` on the box can distinguish "the app is
broken" from "the proxy in front of it is".

## 5. Deploying

Push to `main`. Or **Actions → Deploy → Run workflow** to redeploy the current
`main` — which is also how you apply a change to the server's `.env`.

Health: `GET /api/health` returns `{ ok, uptime_s, n8n: {…} }` and is what the
container's `HEALTHCHECK` polls. `docker compose ps` on the server shows
`healthy` once the app is answering.

### Rolling back

The deploy script records the previously healthy image in
`/srv/pando/.previous-image` and reverts to it by itself if the new one fails
its health check. To go back manually:

```bash
cd /docker/pando && PANDO_IMAGE="$(cat .previous-image)" docker compose up -d
```

Any commit is deployable by SHA:

```bash
cd /docker/pando && PANDO_IMAGE=ghcr.io/OWNER/REPO/web:<sha> docker compose up -d
```

### The first deploy has no automatic rollback

`.previous-image` is written only after an image has come up healthy, so on the
very first deploy there is nothing to fall back to — and `--remove-orphans` will
already have removed the old `pando-site` container. Keep the previous compose
file as `docker-compose.static.yml` before switching, so the holding page is one
command away:

```bash
cd /docker/pando && docker compose -f docker-compose.static.yml up -d
```

## Building the image locally

```bash
docker build -t pando-web ./web
```

```bash
docker run --rm -p 3000:3000 --env-file deploy/.env pando-web
```
