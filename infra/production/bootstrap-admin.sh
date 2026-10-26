#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT=/opt/b2b-inquiry-platform
DEPLOY="$ROOT/deploy"
ENV_FILE="$DEPLOY/.env"
BOOTSTRAP_ENV="$ROOT/.env.bootstrap"
STATE="$DEPLOY/current-image-tag"
COMPOSE="$DEPLOY/compose.yaml"
[[ -f "$ENV_FILE" && -f "$BOOTSTRAP_ENV" && -f "$STATE" ]] || { echo "Missing deployment env, bootstrap env, or deployed image tag" >&2; exit 2; }
set -a
source "$ENV_FILE"
source "$BOOTSTRAP_ENV"
set +a
export IMAGE_TAG="$(cat "$STATE")"
dc(){ docker compose --env-file "$ENV_FILE" -f "$COMPOSE" "$@"; }
echo "Seeding initial roles, permissions, dictionaries and baseline content..."
dc run --rm --no-deps api node /workspace/database/scripts/exec.mjs tsx prisma/seed.ts
echo "Creating initial super administrator..."
dc run --rm --no-deps \
  -e BOOTSTRAP_ADMIN_USERNAME="$BOOTSTRAP_ADMIN_USERNAME" \
  -e BOOTSTRAP_ADMIN_DISPLAY_NAME="$BOOTSTRAP_ADMIN_DISPLAY_NAME" \
  -e BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD" \
  api node /workspace/database/scripts/exec.mjs tsx scripts/bootstrap-admin.ts
echo "Bootstrap finished. Remove $BOOTSTRAP_ENV after confirming sign-in and changing the initial password."
