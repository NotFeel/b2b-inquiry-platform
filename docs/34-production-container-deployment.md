# Production container deployment runbook

## Architecture

Ubuntu 24.04 runs Docker only; application source is never cloned on the server. GitHub-hosted Actions builds four immutable GHCR images tagged `sha-<40-character-commit-sha>`. A repository-scoped containerized runner handles manual deploys. Compose runs PostgreSQL 16, Storefront, Admin, API, Worker, and Cloudflare Tunnel. PostgreSQL has no published host port. Named volumes preserve the database and uploads.

## 1. Prepare server

```bash
sudo install -d -m 0750 /opt/b2b-inquiry-platform/{deploy,runner,backups/database,backups/uploads,logs,data/uploads,data/geoip}
sudo chown -R "$USER":"$USER" /opt/b2b-inquiry-platform
```

Securely copy from the repository (do not clone it):
- `infra/production/compose.yaml` -> `/opt/b2b-inquiry-platform/deploy/compose.yaml`
- `infra/production/deploy.sh` -> `/opt/b2b-inquiry-platform/deploy/deploy.sh`
- `infra/production/compose.env.example` -> `/opt/b2b-inquiry-platform/deploy/.env`
- `infra/production/app.env.example` -> `/opt/b2b-inquiry-platform/.env.api`
- runner Dockerfile, entrypoint and compose file -> `/opt/b2b-inquiry-platform/runner/`

Run `chmod 700 /opt/b2b-inquiry-platform/deploy/deploy.sh` and `chmod 600 /opt/b2b-inquiry-platform/deploy/.env /opt/b2b-inquiry-platform/.env.api`. Replace every placeholder. Generate secrets using `openssl rand -hex 32`; URL-encode special characters in database passwords. Keep secrets out of Git. The compose .env holds Postgres credentials, Cloudflare token and a GHCR read-packages token; it is not injected wholesale into application containers. The separate `.env.api` is passed only to API/Worker.

If GeoIP database mode is enabled, place the licensed `GeoLite2-Country.mmdb` at `/opt/b2b-inquiry-platform/data/geoip/GeoLite2-Country.mmdb`.

## 2. Cloudflare Tunnel

Configure public hostnames in the Cloudflare dashboard:
- `wuxuanglobal.com` -> `http://storefront:3000`
- `admin.wuxuanglobal.com` -> `http://admin:3001`

Do not expose API or PostgreSQL publicly.

## 3. Build and publish only

Merge the files after review. **Actions → Publish production images** builds on GitHub-hosted infrastructure and pushes the four SHA-tagged images. It does not deploy to the server. Record the full SHA and verify all four images exist in GHCR.

## 4. Start runner and test

Create `/opt/b2b-inquiry-platform/runner/.env` with a repository-scoped fine-grained `RUNNER_PAT` that can manage self-hosted runners. `chmod 600` the file, then:

```bash
cd /opt/b2b-inquiry-platform/runner
docker compose --env-file .env -f compose.yaml build --no-cache
docker compose --env-file .env -f compose.yaml up -d
docker compose --env-file .env -f compose.yaml logs -f runner
```

Verify GitHub Settings → Actions → Runners shows the runner online with `local-deploy`. Run **Actions → Runner smoke test**. Docker socket access is effectively host-root; never run PR workflows on this runner.

## 5. Gate production

Create GitHub Environment `production`, restrict deployments to `main`, require reviewer approval if available, and limit who can trigger the workflow.

## 6. Manual deploy

Actions → **Manual production deployment** → Run workflow. Supply the exact 40-character SHA with published images and type `DEPLOY`. Check job logs and on the server run:

```bash
docker compose --env-file /opt/b2b-inquiry-platform/deploy/.env -f /opt/b2b-inquiry-platform/deploy/compose.yaml ps
```

Verify storefront, admin login, product catalogue, image upload/read, and WhatsApp inquiry flow.

## 7. Rollback test

Perform first in staging or a maintenance window:
1. Confirm `deploy/current-image-tag` records a healthy version; copy a fresh DB backup off-host.
2. Publish a dedicated test image that intentionally fails health checks. Do not introduce this failure into the normal production branch.
3. Deploy the test SHA; confirm deployment fails and attempts to restore the previous app images.
4. Verify API/site/admin, image reads, and named volumes still work.
5. Restore the SQL backup into a separate temporary PostgreSQL instance and verify it.
6. Remove the test image/workflow after recording results.

Before every migration, the deploy script creates a compressed `pg_dump` and retains the latest 14. App rollback does not reverse database migrations. Use backward-compatible expand/migrate/contract changes; for destructive changes, restore into a separate DB and review before any production cutover.

## Acceptance checklist

- [ ] Four immutable images build and publish.
- [ ] No application source checkout exists on the server.
- [ ] Runner is online with `local-deploy` and restricted to trusted workflows.
- [ ] PostgreSQL has no published port.
- [ ] Tunnel routes only storefront/admin.
- [ ] Database and uploads survive image updates.
- [ ] Failed health check attempts application rollback.
- [ ] Backup restore works on a separate PostgreSQL instance.
