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
- in `.env`, set `ADMIN_PASSWORD` (without it `/admin` stays dark, by design) and
  the invite codes. Leaving the n8n block empty is fine — the app runs and
  reports `persisted: false`. Leave the Twilio block empty and
  `SEED_REQUIRE_VERIFICATION=0` until the A2P campaign is approved.

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

No registry credential is stored on the server: the deploy logs in to GHCR with
the job's own short-lived `GITHUB_TOKEN` and logs out again when it finishes.

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
