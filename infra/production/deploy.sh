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
  for svc in api worker storefront admin; do
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

# Remove only obsolete local images from this application's four GHCR repositories.
# Retain the current deployed tag and the two most recent distinct published SHA tags.
# Never prune volumes, networks, unrelated images, or images referenced by containers.
cleanup_old_project_images(){
  local keep_count=3
  local repo tag image_id ref_id ref_tag
  local -a repos=(
    "ghcr.io/notfeel/b2b-inquiry-platform-storefront"
    "ghcr.io/notfeel/b2b-inquiry-platform-admin"
    "ghcr.io/notfeel/b2b-inquiry-platform-api"
    "ghcr.io/notfeel/b2b-inquiry-platform-worker"
  )
  local -A keep_tags=()
  local -A seen_tags=()

  # Always keep the image tag that this deployment has just made current.
  keep_tags["$NEW_TAG"]=1

  # Also keep the previously deployed tag for one-step rollback.
  if [[ -n "$PREVIOUS" && "$PREVIOUS" =~ ^sha-[0-9a-f]{40}$ ]]; then
    keep_tags["$PREVIOUS"]=1
  fi

  # Keep two additional most recent published tags, ordered by image creation
  # time. Deduplicate tags across the four services to represent releases rather
  # than counting the four images of a single release as four versions.
  local -a release_candidates=()
  for repo in "${repos[@]}"; do
    while IFS='|' read -r tag created; do
      [[ "$tag" =~ ^sha-[0-9a-f]{40}$ ]] || continue
      [[ -n "$created" ]] || continue
      release_candidates+=("$created|$tag")
    done < <(
      docker image ls "$repo" --format '{{.Tag}}|{{.CreatedAt}}' 2>/dev/null || true
    )
  done

  if (("${#release_candidates[@]}" > 0)); then
    while IFS='|' read -r created tag; do
      [[ -n "$tag" ]] || continue
      [[ -n "${seen_tags[$tag]:-}" ]] && continue
      seen_tags["$tag"]=1
      keep_tags["$tag"]=1
      local retained=0
      for ref_tag in "${!keep_tags[@]}"; do
        [[ "$ref_tag" =~ ^sha-[0-9a-f]{40}$ ]] && ((retained+=1))
      done
      # The current and previous tags count toward the retention total.
      (( retained >= keep_count )) && break
    done < <(printf '%s\n' "${release_candidates[@]}" | sort -r)
  fi

  echo "Cleaning obsolete local project images (retaining current and recent rollback tags)."
  for repo in "${repos[@]}"; do
    while IFS= read -r tag; do
      [[ "$tag" =~ ^sha-[0-9a-f]{40}$ ]] || continue
      [[ -n "${keep_tags[$tag]:-}" ]] && continue

      image_id="$(docker image inspect "$repo:$tag" --format '{{.Id}}' 2>/dev/null || true)"
      [[ -n "$image_id" ]] || continue

      # Docker will refuse to remove images referenced by any existing container.
      # Explicitly check first to avoid touching a current or rollback container.
      if docker ps -a --no-trunc --format '{{.Image}}' | grep -Fqx "$repo:$tag"; then
        echo "Keeping image referenced by a container: $repo:$tag"
        continue
      fi

      echo "Removing obsolete image: $repo:$tag"
      if ! docker image rm "$repo:$tag"; then
        echo "WARNING: could not remove $repo:$tag; deployment remains successful." >&2
      fi
    done < <(docker image ls "$repo" --format '{{.Tag}}' 2>/dev/null || true)
  done
}

export IMAGE_TAG="$NEW_TAG"
if ! dc run --rm --no-deps api node /workspace/database/scripts/exec.mjs prisma migrate deploy; then
  echo "Migration failed; trying previous app images" >&2
  rollback || true
  exit 1
fi

# Schema migrations do not insert code-defined permissions, menus, translations,
# or built-in status options. Sync only those release-owned reference records
# after migrations and before switching app containers. This mode preserves
# business content, global setting values, custom menu labels, custom menu rows,
# and manually assigned grants on existing non-super-admin roles.
if ! dc run --rm --no-deps api node /workspace/database/scripts/exec.mjs tsx prisma/seed.ts --reference-only; then
  echo "Production reference-data seed failed; trying previous app images" >&2
  rollback || true
  exit 1
fi
if ! dc run --rm --no-deps api node /workspace/database/scripts/exec.mjs tsx scripts/check-menu-translations.ts; then
  echo "Menu translation validation failed; trying previous app images" >&2
  rollback || true
  exit 1
fi
if ! dc run --rm --no-deps api node /workspace/database/scripts/exec.mjs tsx scripts/check-production-reference-data.ts; then
  echo "Production reference-data validation failed; trying previous app images" >&2
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
# Cleanup is deliberately best-effort: never turn a healthy deployment into a failure.
cleanup_old_project_images || echo "WARNING: old-image cleanup encountered an error; deployment remains successful." >&2
echo "Deployment succeeded: $NEW_TAG; backup: $BACKUP"
