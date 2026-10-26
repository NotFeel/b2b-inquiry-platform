#!/usr/bin/env bash
set -Eeuo pipefail
: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY}"
: "${RUNNER_PAT:?Set RUNNER_PAT}"
RUNNER_NAME="${RUNNER_NAME:-b2b-local-deploy-01}"
RUNNER_LABELS="${RUNNER_LABELS:-local-deploy}"
RUNNER_WORKDIR="${RUNNER_WORKDIR:-_work}"
BASE="https://api.github.com/repos/${GITHUB_REPOSITORY}"
token(){ curl -fsSL -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer ${RUNNER_PAT}" -H "X-GitHub-Api-Version: 2022-11-28" "${BASE}/actions/runners/$1" | jq -er '.token'; }
REG="$(token registration-token)"
if [[ -f .runner ]]; then
  REM="$(token remove-token)"; ./config.sh remove --unattended --token "$REM" || true; unset REM
fi
./config.sh --url "https://github.com/${GITHUB_REPOSITORY}" --token "$REG" --name "$RUNNER_NAME" --labels "$RUNNER_LABELS" --work "$RUNNER_WORKDIR" --unattended --replace
unset REG
cleanup(){ local t; t="$(token remove-token 2>/dev/null || true)"; [[ -z "$t" ]] || ./config.sh remove --unattended --token "$t" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
./run.sh
