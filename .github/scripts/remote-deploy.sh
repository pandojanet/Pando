# Runs on the VPS, piped into `bash -s` over SSH by .github/workflows/deploy.yml.
#
# The workflow prepends the assignments this script expects:
#   IMAGE       full image ref for this commit (ghcr.io/<owner>/<repo>/web:<sha>)
#   APP_DIR     directory on the server holding docker-compose.yml and .env
#   GHCR_USER   GitHub actor, used to log in to the registry
#   GHCR_TOKEN  short-lived GITHUB_TOKEN, valid only while the job runs
#
# It is deliberately a committed file rather than an inline heredoc: it is
# reviewable, and the only thing CI injects is data.

set -euo pipefail

cd "$APP_DIR"

if [ ! -f docker-compose.yml ]; then
  echo "no docker-compose.yml in $APP_DIR — see DEPLOY.md, one-time server setup" >&2
  exit 1
fi

# Short-lived, repo-scoped credential. Removed again at the end so nothing
# long-lived is left in ~/.docker/config.json.
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
cleanup() { docker logout ghcr.io >/dev/null 2>&1 || true; }
trap cleanup EXIT

# What is serving right now, so a failed rollout can be undone.
PREVIOUS_IMAGE=""
if [ -f .previous-image ]; then
  PREVIOUS_IMAGE="$(cat .previous-image)"
fi
CURRENT_IMAGE="$(docker inspect -f '{{.Config.Image}}' pando-web 2>/dev/null || true)"
if [ -n "$CURRENT_IMAGE" ]; then
  PREVIOUS_IMAGE="$CURRENT_IMAGE"
fi

echo "==> deploying $IMAGE"
export PANDO_IMAGE="$IMAGE"
docker compose pull
docker compose up -d --remove-orphans

# The image declares a HEALTHCHECK, so Docker itself decides when the app is
# actually answering. Wait for it rather than assuming `up -d` means healthy.
#
# 180s, and the number is arithmetic rather than taste. The HEALTHCHECK probes
# every 30s, so the old 90s budget only ever contained two or three probes —
# and /api/health opens a pooler connection, which CLAUDE.md measures at ~1300ms
# cold. One slow first probe therefore decided the rollout, which is exactly the
# pattern seen on 16 Sep: six deploys of near-identical code, four healthy and
# two rolled back, with nothing in the diff to tell them apart.
#
# ⚠ Raising this cannot hide a genuinely broken image: `unhealthy` still breaks
# out of the loop immediately, so only the *starting* case waits longer.
echo "==> waiting for health"
healthy=""
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' pando-web 2>/dev/null || echo missing)"
  case "$status" in
    healthy) healthy=1; break ;;
    unhealthy) break ;;
  esac
  sleep 3
done

if [ -z "$healthy" ]; then
  echo "==> $IMAGE never became healthy; last 80 log lines:" >&2
  docker compose logs --tail 80 web >&2 || true

  if [ -n "$PREVIOUS_IMAGE" ] && [ "$PREVIOUS_IMAGE" != "$IMAGE" ]; then
    echo "==> rolling back to $PREVIOUS_IMAGE" >&2
    export PANDO_IMAGE="$PREVIOUS_IMAGE"
    docker compose up -d --remove-orphans
  fi
  exit 1
fi

# Only record a version that actually came up healthy.
if [ -n "$PREVIOUS_IMAGE" ] && [ "$PREVIOUS_IMAGE" != "$IMAGE" ]; then
  printf '%s\n' "$PREVIOUS_IMAGE" > .previous-image
fi

docker image prune -f >/dev/null 2>&1 || true
echo "==> $IMAGE is live"
