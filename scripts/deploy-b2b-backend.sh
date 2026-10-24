#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

ROOT=/opt/b2b-inquiry-platform
ARCHIVE=${1:?Usage: deploy-b2b-backend ARCHIVE_PATH COMMIT_SHA}
SHA=${2:?Usage: deploy-b2b-backend ARCHIVE_PATH COMMIT_SHA}
MIN_FREE_KB=$((1536 * 1024))
LOCK_FILE=/run/lock/deploy-b2b-backend.lock
STAGING=""

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid commit SHA" >&2
  exit 2
fi
case "$ARCHIVE" in
  "$ROOT/incoming/b2b-backend-$SHA.tar.gz") ;;
  *) echo "Archive path does not match expected release SHA" >&2; exit 2 ;;
esac
[[ -f "$ARCHIVE" ]] || { echo "Archive not found: $ARCHIVE" >&2; exit 2; }
[[ -d "$ROOT/releases" && -d "$ROOT/incoming" ]] || {
  echo "Deployment directories are missing under $ROOT" >&2
  exit 2
}

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Another backend deployment is running" >&2; exit 2; }

free_kb="$(df -Pk "$ROOT" | awk 'NR == 2 {print $4}')"
if [[ ! "$free_kb" =~ ^[0-9]+$ ]] || (( free_kb < MIN_FREE_KB )); then
  echo "Refusing deployment: at least 1.5 GiB free disk space is required; available KB=${free_kb:-unknown}" >&2
  exit 2
fi

# Reject absolute paths and parent-directory traversal before extracting an archive.
tar -tzf "$ARCHIVE" >/dev/null
if tar -tzf "$ARCHIVE" | awk '$0 ~ /^\// || $0 ~ /(^|\/)\.\.(\/|$)/ { bad=1 } END { exit bad ? 0 : 1 }'; then
  echo "Unsafe path found in release archive" >&2
  exit 2
fi

RELEASE="$ROOT/releases/$SHA"
OLD_RELEASE="$(readlink -f "$ROOT/current" 2>/dev/null || true)"

is_valid_release() {
  local dir="$1"
  [[ -f "$dir/node_modules/.modules.yaml"     && -f "$dir/apps/api/node_modules/@nestjs/core/package.json"     && -f "$dir/apps/api/node_modules/@nestjs/platform-express/package.json"     && -f "$dir/apps/api/node_modules/express/package.json"     && -f "$dir/database/node_modules/@prisma/client/package.json"     && -f "$dir/apps/api/dist/main.js"     && -f "$dir/apps/worker/dist/index.js"     && -f "$dir/database/generated/client/index.js" ]]
}

if [[ -e "$RELEASE" ]]; then
  if [[ "$OLD_RELEASE" == "$RELEASE" ]]; then
    echo "This SHA is already the current release: $SHA" >&2
    exit 2
  fi
  if is_valid_release "$RELEASE"; then
    echo "A complete release for this SHA already exists: $RELEASE" >&2
    exit 2
  fi
  echo "Removing incomplete, non-current release directory for retry: $RELEASE"
  rm -rf -- "$RELEASE"
fi

STAGING="$(mktemp -d "$ROOT/releases/.staging-$SHA-XXXXXX")"
cleanup_staging() {
  if [[ -n "$STAGING" && -d "$STAGING" ]]; then
    rm -rf -- "$STAGING"
  fi
}
trap cleanup_staging EXIT

echo "Extracting release $SHA"
tar -xzf "$ARCHIVE" -C "$STAGING"
if ! is_valid_release "$STAGING"; then
  echo "Release package is incomplete; refusing to switch current" >&2
  exit 1
fi

chown -R deploy:b2bapp "$STAGING"
chmod -R g+rX,o-rwx "$STAGING"
mv "$STAGING" "$RELEASE"
STAGING=""

ln -sfn "$RELEASE" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"

echo "Restarting backend services"
systemctl restart b2b-api.service b2b-task-runner.service

ok=0
for _ in $(seq 1 15); do
  if curl --fail --silent --show-error http://127.0.0.1:3002/api/v1/health/ready >/dev/null      && systemctl is-active --quiet b2b-task-runner.service; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -eq 1 ]]; then
  echo "Deploy OK: $SHA"
  rm -f -- "$ARCHIVE" "$ROOT/incoming/deploy-b2b-backend-$SHA.sh"

  # Keep current + the two newest complete historical releases.
  # Incomplete non-current directories are safe to remove; current is never deleted.
  current_real="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
  while IFS= read -r dir; do
    [[ -n "$dir" ]] || continue
    [[ "$dir" == "$current_real" ]] && continue
    if ! is_valid_release "$dir"; then
      echo "Removing incomplete historical release: $dir"
      rm -rf -- "$dir"
    fi
  done < <(find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d ! -name '.staging-*' -print)

  kept=0
  while IFS= read -r dir; do
    [[ -n "$dir" ]] || continue
    [[ "$dir" == "$current_real" ]] && continue
    if ! is_valid_release "$dir"; then
      continue
    fi
    if (( kept < 2 )); then
      kept=$((kept + 1))
    else
      echo "Removing old release beyond retention limit: $dir"
      rm -rf -- "$dir"
    fi
  done < <(find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d ! -name '.staging-*' -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)

  # Failed uploads are kept for at most 24 hours for diagnosis, then removed.
  find "$ROOT/incoming" -maxdepth 1 -type f \( -name 'b2b-backend-*.tar.gz' -o -name 'deploy-b2b-backend-*.sh' \) -mmin +1440 -delete
  exit 0
fi

echo "New release failed health checks: $SHA" >&2
journalctl -u b2b-api.service -u b2b-task-runner.service -n 100 --no-pager >&2 || true

if [[ -n "$OLD_RELEASE" && -d "$OLD_RELEASE" && "$OLD_RELEASE" != "$RELEASE" ]]; then
  ln -sfn "$OLD_RELEASE" "$ROOT/current.rollback"
  mv -Tf "$ROOT/current.rollback" "$ROOT/current"
  systemctl restart b2b-api.service b2b-task-runner.service
  echo "Rolled back application symlink to $OLD_RELEASE" >&2
else
  # First deployment has no known-good release to restore.
  rm -f "$ROOT/current" "$ROOT/current.next"
  systemctl stop b2b-api.service b2b-task-runner.service || true
  echo "No previous valid release exists; current symlink removed." >&2
fi

# The failed release is not a rollback candidate. Preserve the uploaded archive for
# diagnosis (up to 24 hours), but remove the extracted directory to protect disk.
if [[ "$(readlink -f "$ROOT/current" 2>/dev/null || true)" != "$RELEASE" ]]; then
  rm -rf -- "$RELEASE"
fi
exit 1
