# Containerized GitHub Actions runner

The runner mounts `/var/run/docker.sock`; workflows on it can effectively control the host as root. Use it only for trusted deployment workflows. Never run PR/fork or untrusted branch workflows on this runner. The deployment workflow intentionally has no checkout step.

1. Copy `Dockerfile`, `entrypoint.sh`, and `compose.yaml` to `/opt/b2b-inquiry-platform/runner/`.
2. Create `runner/.env` containing a repository-scoped fine-grained `RUNNER_PAT` with the repository Administration permission needed to manage self-hosted runners. Then `chmod 600 runner/.env`.
3. Start it:
   ```bash
   cd /opt/b2b-inquiry-platform/runner
   docker compose --env-file .env -f compose.yaml build --no-cache
   docker compose --env-file .env -f compose.yaml up -d
   docker compose --env-file .env -f compose.yaml logs -f runner
   ```
4. GitHub Settings → Actions → Runners should show `b2b-local-deploy-01` online with `local-deploy`.
5. Run **Actions → Runner smoke test**. The test prints diagnostics only.

The entrypoint requests short-lived registration tokens at startup/shutdown. Do not store a registration token. Review and deliberately update the pinned runner version.
