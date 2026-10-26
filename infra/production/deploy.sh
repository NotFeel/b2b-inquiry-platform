#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=/opt/b2b-inquiry-platform
DEPLOY="$ROOT/deploy"
COMPOSE="$DEPLOY/compose.yaml"
ENV_FILE="$DEPLOY/.env"
STATE="$DEPLOY/current-image-tag"
BACKUPS="$ROOT/backups/database"
mkdir -p "$BACKUPS" "$ROOT/logs"
[[ -f "$ENV_FILE" && -f "$ROOT/.env.api" && -f "$COMPOSE" ]] || { echo "Missing production config" >&2; exit 2; }
NEW_TAG="${IMAGE_TAG:-}"
[[ "$NEW_TAG" =~ ^sha-[0-9a-f]{40}$ ]] || { echo "IMAGE_TAG must be sha-<40 lowercase hex>" >&2; exit 2; }
dc(){ docker compose --env-file "$ENV_FILE" -f "$COMPOSE" "$@"; }
set -a; source "$ENV_FILE"; set +a
export IMAGE_TAG="$NEW_TAG"
: "${GHCR_USERNAME:?Missing GHCR_USERNAME}"
: "${GHCR_READ_TOKEN:?Missing GHCR_READ_TOKEN}"
PREVIOUS=""
[[ -f "$STATE" ]] && PREVIOUS="$(cat "$STATE")"
printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
dc pull api worker storefront admin
dc up -d postgres
for i in $(seq 1 30); do
  dc exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1 && break
  [[ "$i" -lt 30 ]] || { echo "PostgreSQL not ready" >&2; exit 1; }
  sleep 2
done
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUPS/pre-migration-$STAMP.sql.gz"
dc exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges | gzip -1 > "$BACKUP"
test -s "$BACKUP"
find "$BACKUPS" -maxdepth 1 -type f -name 'pre-migration-*.sql.gz' -printf '%T@ %p\n' | sort -nr | awk 'NR>14 {print $2}' | xargs -r rm -f
healthy(){
  local svc cid status
  for svc in api storefront admin; do
    for i in $(seq 1 30); do
      cid="$(dc ps -q "$svc" 2>/dev/null || true)"
      status=""
      [[ -n "$cid" ]] && status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      [[ "$status" == healthy ]] && break
      sleep 5
    done
    if [[ "$status" != healthy ]]; then dc logs --tail=100 "$svc" || true; return 1; fi
  done
}
rollback(){
  [[ -n "$PREVIOUS" ]] || { echo "No previous tag to roll back to" >&2; return 1; }
  export IMAGE_TAG="$PREVIOUS"
  dc pull api worker storefront admin
  dc up -d --no-deps api worker storefront admin
  healthy
}
export IMAGE_TAG="$NEW_TAG"
if ! dc run --rm --no-deps api node /workspace/database/scripts/exec.mjs prisma migrate deploy; then
  echo "Migration failed; trying previous app images" >&2
  rollback || true
  exit 1
fi
if ! dc up -d --no-deps api worker storefront admin || ! healthy; then
  echo "Deployment health check failed; rolling back app images" >&2
  rollback || echo "Rollback failed; preserve $BACKUP and inspect logs" >&2
  exit 1
fi
dc up -d cloudflared
printf '%s\n' "$NEW_TAG" > "$STATE.tmp"; mv "$STATE.tmp" "$STATE"
echo "Deployment succeeded: $NEW_TAG; backup: $BACKUP"
