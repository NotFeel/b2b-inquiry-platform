# B2B Inquiry Platform：东京服务器后端部署与持续更新手册

> 仓库：`NotFeel/b2b-inquiry-platform`  
> 对照分支：`main`  
> 文档核对日期：2026-10-23  
> 目标：把 NestJS API 和 PostgreSQL 持久化任务执行器部署到东京 Linux 服务器，并建立可重复发布、健康检查、失败回滚流程。

## 0. 先明确当前架构，不要部署旧拓扑

已核对仓库当前代码和文档：

- `apps/api`：NestJS HTTP API，监听 `API_PORT`，接口统一前缀 `/api/v1`。
- `apps/worker`：独立 PostgreSQL task runner，入口 `apps/worker/src/index.ts`，没有对外 HTTP 端口。
- `database`：Prisma + Neon PostgreSQL。
- 生产文件存储目标是 Cloudflare R2，运行时用 `STORAGE_DRIVER=s3`。
- 当前目标生产架构不部署 Redis/BullMQ；任务由 PostgreSQL 持久化任务表执行。
- `apps/storefront` 和 `apps/admin` 的目标托管方式是 Cloudflare Workers；本手册只部署 API/Runner，不在东京服务器运行前后台 Next.js。
- 已实现健康检查：`GET /api/v1/health/live` 和 `GET /api/v1/health/ready`。
- 根目录固定 `pnpm@11.25.0`，Node.js 需要 `>=22.13.0`。部署建议使用已验证的 Node.js 24 LTS。
- 目前仓库没有可直接使用的生产部署 Dockerfile / Compose / GitHub Actions 部署 workflow，因此需按本手册增加部署工作流与服务器脚本。

参考：
- `docs/33-lightweight-cloudflare-neon-r2-implementation.md`
- `docs/10-deployment-ops.md`
- `docs/02-architecture.md`
- `apps/api/src/main.ts`
- `apps/api/src/modules/health/health.controller.ts`
- `apps/worker/src/index.ts`

## 1. 推荐部署拓扑

```text
GitHub main
   │ 手动触发 GitHub Actions 发布；先测试和构建 Linux 运行产物
   ▼
GitHub Actions ── Prisma migrate deploy（使用 Neon Direct URL）
   │ SSH/SCP 上传发布包
   ▼
东京服务器 Ubuntu
   ├── systemd: b2b-api.service        -> NestJS API :3002
   ├── systemd: b2b-task-runner.service -> PostgreSQL 持久化任务执行器
   ├── Cloudflare Tunnel               -> api.example.com -> 127.0.0.1:3002
   └── /opt/b2b-inquiry-platform/
       ├── current -> releases/<commit-sha>
       ├── releases/<commit-sha>/       每次发布独立目录
       ├── incoming/                    临时发布包
       └── shared/.env                  生产环境变量，不进 Git

API/Runner -> Neon PostgreSQL pooled runtime URL
API/Runner -> Cloudflare R2（public/private buckets）
```

默认选择 Cloudflare Tunnel，让 API 源站不需要开放公网 3002 端口。如果已有 Nginx + Cloudflare Proxy 方案，也可以继续使用，但须限制源站入站、配置 TLS，并保证 API 端口不对公网开放。

### 服务器规格提示

仓库 `docs/33` 的目标基线是 2 vCPU / 1 GB RAM，但文档明确指出 1 GB 属于紧约束。API 和 Runner 要先分开运行、并发设为 1，监控 RSS、Swap、OOM、API P95/P99。如果启动后内存长期逼近上限、出现 OOM 或持续 Swap，应升级至至少 2–4 GB RAM，而不是为了省内存丢掉可靠的任务执行器。

## 2. 发布前准备清单

先在本地准备好以下内容：

1. 东京服务器公网 IP、SSH 登录用户、Ubuntu 版本、CPU/内存/磁盘规格。
2. 已能访问的 GitHub 仓库，默认分支为 `main`。
3. Neon 的两条连接串：
   - pooled/runtime URL：运行中的 API/Runner 使用。
   - direct URL：只给受控的迁移步骤使用。
4. Cloudflare R2 的 S3 endpoint、Access Key、Secret Key，以及两个 bucket：
   - `b2b-public-assets`
   - `b2b-private-assets`
5. 实际域名，例如 `www.example.com`、`admin.example.com`、`api.example.com`。本文的 `example.com` 都是占位值。
6. Cloudflare Tunnel 或等效源站防护配置。
7. `SESSION_SECRET`、`ANALYTICS_SALT` 两个不同的高熵随机值。

生产环境变量、SSH 私钥和 Neon/R2 密钥不得写入 Git 仓库、前端 `NEXT_PUBLIC_*` 变量、日志或聊天记录。

## 3. 东京服务器初始化（Ubuntu 24.04 示例）

以下命令在服务器 SSH 终端执行。登录账号按实际服务器情况替换：

```bash
ssh ubuntu@YOUR_TOKYO_SERVER_IP
```

更新系统并安装基础工具：

```bash
sudo apt update
sudo apt -y upgrade
sudo apt -y install ca-certificates curl git jq tar gzip ufw fail2ban
sudo timedatectl set-timezone UTC
```

建议仅允许 SSH 管理来源访问 22/TCP。使用 Cloudflare Tunnel 时，API 不需要额外开放 80/443/3002 入站端口。先确认 SSH 密钥登录成功，再启用防火墙，避免锁死连接：

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from YOUR_ADMIN_PUBLIC_IP to any port 22 proto tcp
sudo ufw enable
sudo ufw status verbose
```

同时在云厂商防火墙/安全组实施同样规则。不要把 `YOUR_ADMIN_PUBLIC_IP` 原样复制；替换成你的管理出口 IP。

### 3.1 安装 Node.js / pnpm

仓库使用 pnpm 11.25.0、Node.js `>=22.13.0`。下面以 Node.js 24 为例，生产环境应固定并记录实际小版本：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt -y install nodejs
sudo corepack enable
sudo corepack prepare pnpm@11.25.0 --activate

node --version
corepack pnpm --version
```

确认 Node 主版本为 24，pnpm 输出为 `11.25.0`。如果服务器架构不是 `x86_64`，应确认 GitHub Actions 构建产物的架构与服务器一致，避免原生依赖（Prisma/Sharp/Argon2）不兼容。

### 3.2 创建运行账户和目录

```bash
sudo groupadd --system b2bapp 2>/dev/null || true
sudo useradd --system --create-home --home-dir /opt/b2b-inquiry-platform --shell /usr/sbin/nologin --gid b2bapp b2bapp 2>/dev/null || true
id -u deploy >/dev/null 2>&1 || sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG b2bapp deploy

sudo mkdir -p /opt/b2b-inquiry-platform/{releases,incoming,shared/tmp,backups}
sudo chown -R deploy:b2bapp /opt/b2b-inquiry-platform
sudo chmod 750 /opt/b2b-inquiry-platform
sudo chmod 750 /opt/b2b-inquiry-platform/{releases,incoming,shared,shared/tmp,backups}
# Runner 需要把临时图片/Excel 处理文件写入 shared/tmp
sudo chown b2bapp:b2bapp /opt/b2b-inquiry-platform/shared/tmp
sudo chmod 750 /opt/b2b-inquiry-platform/shared/tmp
```

如果你使用的 SSH 登录账号不是 `deploy`，可创建专用 `deploy` 账号并只配置 SSH 公钥。部署账号负责上传发布包；应用由无登录权限的 `b2bapp` 用户运行。

## 4. 配置生产环境变量

在东京服务器创建环境文件：

```bash
sudo install -o b2bapp -g b2bapp -m 600 /dev/null /opt/b2b-inquiry-platform/shared/.env
sudo -u b2bapp nano /opt/b2b-inquiry-platform/shared/.env
```

内容模板如下，**必须替换所有 `REPLACE_*`、示例域名和数据库连接串**：

```dotenv
NODE_ENV=production
API_PORT=3002

# 换成真实域名
APP_BASE_URL=https://www.example.com
ADMIN_BASE_URL=https://admin.example.com
API_BASE_URL=http://127.0.0.1:3002
ADMIN_ALLOWED_ORIGINS=https://admin.example.com

LOG_LEVEL=info
LOG_PRETTY=false
TRUST_PROXY=true
SITE_TIMEZONE=UTC

# Neon pooled connection（API/Runner runtime）
DATABASE_URL=postgresql://RUNTIME_USER:URL_ENCODED_PASSWORD@POOLED_HOST/DB_NAME?sslmode=require

# 管理员 Session secret：至少 24 个字符，建议 32 字节以上随机值
SESSION_SECRET=REPLACE_WITH_RANDOM_SECRET
SESSION_COOKIE_NAME=b2b_admin_session
SESSION_TTL_HOURS=12
LOGIN_MAX_ATTEMPTS=8
LOGIN_LOCK_MINUTES=15
ANALYTICS_SALT=REPLACE_WITH_A_DIFFERENT_RANDOM_SECRET

# 生产文件必须使用 R2，不要把本机磁盘作为文件唯一副本
STORAGE_DRIVER=s3
STORAGE_LOCAL_ROOT=/opt/b2b-inquiry-platform/shared/uploads
S3_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=b2b-private-assets
S3_PUBLIC_BUCKET=b2b-public-assets
S3_PRIVATE_BUCKET=b2b-private-assets
S3_ACCESS_KEY_ID=REPLACE_WITH_R2_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=REPLACE_WITH_R2_SECRET_ACCESS_KEY
S3_PUBLIC_BASE_URL=https://images.example.com
S3_FORCE_PATH_STYLE=true
UPLOAD_URL_TTL_SECONDS=900
DOWNLOAD_URL_TTL_SECONDS=300

# 业务配置
WHATSAPP_BUSINESS_NUMBER=YOUR_INTERNATIONAL_PHONE_NUMBER
WHATSAPP_MAX_SELECTED_SKUS=20

# 如果尚未准备 MaxMind 数据库，先选择 none；准备完成后再切到 database
GEOIP_PROVIDER=none
GEOIP_DATABASE_PATH=/opt/b2b-inquiry-platform/shared/geoip/GeoLite2-Country.mmdb
ANALYTICS_ACTIVE_WINDOW_SECONDS=300
ANALYTICS_RAW_RETENTION_DAYS=90
ANALYTICS_EVENTS_PER_MINUTE=120

UPLOAD_MAX_BYTES=10485760
UPLOAD_MAX_PIXELS=50000000
IMAGE_DERIVATIVE_WIDTHS=320,640,1280
IMAGE_PROCESSING_TIMEOUT_SECONDS=20
IMAGE_PROCESSING_CONCURRENCY=1
IMAGE_WEBP_QUALITY=82
QUOTE_EXPORT_MAX_PRODUCTS=5000

JOB_MAX_ATTEMPTS=3
JOB_RETENTION_DAYS=30
TASK_RUNNER_ID=tokyo-runner-01
TASK_LEASE_SECONDS=120
TASK_POLL_INTERVAL_MS=2000
TASK_RETRY_BASE_DELAY_MS=3000
WORKER_TMP_DIR=/opt/b2b-inquiry-platform/shared/tmp
```

生成两个不同的秘密值：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

第一条用于 `SESSION_SECRET`，第二条用于 `ANALYTICS_SALT`。不要把同一个随机值重复用于多个安全用途。

注意：

- `DATABASE_URL` 必须是 Neon **pooled** URL，供 API/Runner 长期复用。不要把 direct migration URL 配进应用运行时环境。
- 若数据库密码含有 `@`、`:`、`/`、`#` 等字符，连接串中的密码段必须进行 URL 编码。
- `S3_ENDPOINT` 使用 R2 的 S3 API endpoint；bucket 名称应与实际创建的 bucket 完全一致。
- `GEOIP_PROVIDER=none` 是未安装 GeoIP 数据库时的安全起步配置。如果需要国家/地区分析，再配置数据库文件路径与许可来源。
- 不需要设置 `REDIS_URL`；当前目标代码已从 API/Worker runtime 移除 Redis/BullMQ 依赖。
- `.env` 只存服务器本地，确认权限：

```bash
sudo chown b2bapp:b2bapp /opt/b2b-inquiry-platform/shared/.env
sudo chmod 600 /opt/b2b-inquiry-platform/shared/.env
sudo stat -c '%a %U:%G %n' /opt/b2b-inquiry-platform/shared/.env
```

## 5. 建立 systemd 服务

### 5.1 API 服务

创建 `/etc/systemd/system/b2b-api.service`：

```ini
[Unit]
Description=B2B Inquiry Platform NestJS API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=b2bapp
Group=b2bapp
WorkingDirectory=/opt/b2b-inquiry-platform/current
Environment=NODE_ENV=production
Environment=ENV_FILE=/opt/b2b-inquiry-platform/shared/.env
Environment=NODE_OPTIONS=--max-old-space-size=256
ExecStart=/usr/bin/node /opt/b2b-inquiry-platform/current/apps/api/dist/main.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/b2b-inquiry-platform/shared/tmp
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

### 5.2 PostgreSQL task runner 服务

创建 `/etc/systemd/system/b2b-task-runner.service`：

```ini
[Unit]
Description=B2B Inquiry Platform PostgreSQL Task Runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=b2bapp
Group=b2bapp
WorkingDirectory=/opt/b2b-inquiry-platform/current
Environment=NODE_ENV=production
Environment=ENV_FILE=/opt/b2b-inquiry-platform/shared/.env
Environment=NODE_OPTIONS=--max-old-space-size=256
ExecStart=/usr/bin/node /opt/b2b-inquiry-platform/current/apps/worker/dist/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=60
KillSignal=SIGTERM
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/b2b-inquiry-platform/shared/tmp
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

应用代码有启用 shutdown hooks；Runner 也处理 `SIGTERM`/`SIGINT`，所以 systemd 应发送 `SIGTERM` 并给足停止时间。

启用服务（首次没有 `current` 时先完成第 7、8 节部署步骤，再执行）：

```bash
sudo systemctl daemon-reload
sudo systemctl enable b2b-api.service b2b-task-runner.service
```

## 6. 部署源站入口：推荐 Cloudflare Tunnel

在 Cloudflare Dashboard 中创建一个 Tunnel，例如 `b2b-api-tokyo`，配置 Public Hostname：

- Hostname：`api.example.com`
- Service：`http://127.0.0.1:3002`

安装并运行 Cloudflare 提供的 `cloudflared` 服务后，确认 Tunnel 在 Dashboard 中显示健康。具体安装命令应按 Cloudflare Dashboard 为此 Tunnel 生成的命令执行，不要复制其他 Tunnel 的 token 或凭据。

安全要求：

- 云防火墙和 UFW 不开放 3002、5432、6379 等端口。
- 应用健康检查在服务器本地执行：`curl http://127.0.0.1:3002/api/v1/health/ready`。
- 外部检查通过 `https://api.example.com/api/v1/health/ready`。
- Cloudflare Tunnel 只负责安全传输，不替代 NestJS 的登录认证、RBAC、CSRF 和限流。

如果改用 Nginx + Cloudflare Proxy，Nginx 应代理到 `127.0.0.1:3002`，源站防火墙只允许必要来源，且不能公开放行 3002。Cloudflare DNS 的代理状态、TLS 模式、源站防护规则要单独验收。

## 7. 在服务器安装自动发布脚本

部署流程将每个 commit 放到独立目录；只有完成依赖安装与文件检查后才切换 `current`。失败时自动切回上一个 release。

在服务器以 root 创建 `/usr/local/sbin/deploy-b2b-backend`：

```bash
sudo nano /usr/local/sbin/deploy-b2b-backend
```

写入：

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

ROOT=/opt/b2b-inquiry-platform
ARCHIVE=${1:?Usage: deploy-b2b-backend ARCHIVE_PATH COMMIT_SHA}
SHA=${2:?Usage: deploy-b2b-backend ARCHIVE_PATH COMMIT_SHA}

if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid commit SHA" >&2
  exit 2
fi
case "$ARCHIVE" in
  "$ROOT/incoming/"*) ;;
  *) echo "Archive must be under $ROOT/incoming" >&2; exit 2 ;;
esac
[[ -f "$ARCHIVE" ]] || { echo "Archive not found: $ARCHIVE" >&2; exit 2; }

RELEASE="$ROOT/releases/$SHA"
OLD_RELEASE="$(readlink -f "$ROOT/current" 2>/dev/null || true)"

if [[ -e "$RELEASE" ]]; then
  echo "Release already exists: $RELEASE" >&2
  exit 2
fi
mkdir -p "$RELEASE"
tar -xzf "$ARCHIVE" -C "$RELEASE"
chown -R deploy:b2bapp "$RELEASE"
chmod -R g+rX,o-rwx "$RELEASE"

# Install runtime dependencies only. Source builds and Prisma Client generation
# must already have succeeded on the Linux CI runner.
runuser -u deploy -- /bin/bash -lc "cd '$RELEASE' && corepack pnpm install --prod --frozen-lockfile"

test -f "$RELEASE/apps/api/dist/main.js"
test -f "$RELEASE/apps/worker/dist/index.js"
test -f "$RELEASE/database/generated/client/index.js"

ln -sfn "$RELEASE" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"

systemctl restart b2b-api.service b2b-task-runner.service

ok=0
for _ in $(seq 1 15); do
  if curl --fail --silent --show-error http://127.0.0.1:3002/api/v1/health/ready >/dev/null \
     && systemctl is-active --quiet b2b-task-runner.service; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" -eq 1 ]]; then
  echo "Deploy OK: $SHA"
  rm -f "$ARCHIVE"
  exit 0
fi

echo "New release failed health checks: $SHA" >&2
journalctl -u b2b-api.service -u b2b-task-runner.service -n 100 --no-pager >&2 || true

if [[ -n "$OLD_RELEASE" && -d "$OLD_RELEASE" ]]; then
  ln -sfn "$OLD_RELEASE" "$ROOT/current.rollback"
  mv -Tf "$ROOT/current.rollback" "$ROOT/current"
  systemctl restart b2b-api.service b2b-task-runner.service
  echo "Rolled back application symlink to $OLD_RELEASE" >&2
else
  echo "No previous release exists; inspect service logs and correct configuration." >&2
fi
exit 1
```

设置脚本权限：

```bash
sudo chown root:root /usr/local/sbin/deploy-b2b-backend
sudo chmod 750 /usr/local/sbin/deploy-b2b-backend
```

允许 `deploy` 用户仅以 root 身份执行此固定脚本：

```bash
sudo visudo -f /etc/sudoers.d/b2b-backend-deploy
```

添加一行（先执行 `command -v systemctl` 确认系统路径，但这里授权的是脚本路径）：

```text
deploy ALL=(root) NOPASSWD: /usr/local/sbin/deploy-b2b-backend
```

保存后检查语法：

```bash
sudo visudo -cf /etc/sudoers.d/b2b-backend-deploy
```

> 注意：发布脚本使用 `deploy` 作为部署账号，并假定该账号属于 `b2bapp` 组。若你采用了不同用户名，必须同步修改脚本中的 `deploy:b2bapp` 与 `runuser -u deploy`。

## 8. 配置 GitHub Actions 发布流程

建议先使用手动触发 `workflow_dispatch`，跑通后再考虑主分支自动部署。这样每次发布均由你明确发起，不会因一次未计划的提交自动修改生产数据库。

在 GitHub 仓库 Settings → Environments 创建 `production` 环境，并设置以下 Secrets：

| Secret | 用途 |
|---|---|
| `NEON_POOLED_DATABASE_URL` | API/Runner runtime pooled URL；用于构建阶段的占位/迁移上下文，不打印到日志 |
| `NEON_DIRECT_DATABASE_URL` | 只供 `pnpm db:deploy` 使用的 Neon direct URL |
| `TOKYO_SSH_HOST` | 东京服务器 IP 或 SSH 主机名 |
| `TOKYO_SSH_USER` | 服务器部署用户名，本文为 `deploy` |
| `TOKYO_SSH_PRIVATE_KEY` | `deploy` 对应私钥，仅放 GitHub Secrets |
| `TOKYO_SSH_KNOWN_HOSTS` | 事先核验过服务器指纹的 known_hosts 内容；不要关闭主机指纹校验 |

推荐给 `production` 环境加 required reviewers。GitHub Actions 发布时先运行代码检查、构建后端 Linux 产物，执行 `prisma migrate deploy`，再通过 SSH/SCP 推送发布包。

创建 `.github/workflows/deploy-backend.yml`：

```yaml
name: Deploy Tokyo Backend

on:
  workflow_dispatch:
    inputs:
      ref:
        description: "要部署的分支、tag 或 commit SHA"
        required: true
        default: "main"

permissions:
  contents: read

concurrency:
  group: production-backend
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-24.04
    environment: production
    env:
      # 非生产的占位值；构建/单元测试阶段不连接该数据库。
      DATABASE_URL: postgresql://app:app_local_only@127.0.0.1:5432/b2b_catalog?schema=public
      SESSION_SECRET: test-only-session-secret-do-not-use-in-production
    steps:
      - name: Checkout selected ref
        uses: actions/checkout@v4
        with:
          ref: ${{ inputs.ref }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "24"

      - name: Enable pinned pnpm
        run: |
          corepack enable
          corepack prepare pnpm@11.25.0 --activate
          node --version
          pnpm --version

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Quality gates
        run: |
          pnpm lint
          pnpm typecheck
          pnpm test

      - name: Generate Prisma Client and build backend
        run: |
          pnpm db:generate
          pnpm -r --filter "./packages/**" build
          pnpm --filter @b2b/api build
          pnpm --filter @b2b/worker build

      # This is a production write: the workflow should be manually triggered
      # and protected by the production Environment approval policy.
      - name: Apply production database migrations
        env:
          DATABASE_URL: ${{ secrets.NEON_POOLED_DATABASE_URL }}
          DIRECT_DATABASE_URL: ${{ secrets.NEON_DIRECT_DATABASE_URL }}
        run: |
          test -n "$DATABASE_URL" || { echo "NEON_POOLED_DATABASE_URL is missing" >&2; exit 1; }
          test -n "$DIRECT_DATABASE_URL" || { echo "NEON_DIRECT_DATABASE_URL is missing; refusing to migrate over pooled URL" >&2; exit 1; }
          pnpm db:deploy

      - name: Package backend release
        id: package
        run: |
          SHA="$(git rev-parse HEAD)"
          echo "sha=$SHA" >> "$GITHUB_OUTPUT"
          tar -czf "/tmp/b2b-backend-${SHA}.tar.gz" \
            --exclude='.git' \
            --exclude='node_modules' \
            --exclude='.env' \
            --exclude='.env.*' \
            --exclude='.data' \
            --exclude='apps/*/.next' \
            --exclude='apps/*/.open-next' \
            --exclude='apps/*/.wrangler' \
            -C "$GITHUB_WORKSPACE" .

      - name: Configure SSH
        env:
          SSH_PRIVATE_KEY: ${{ secrets.TOKYO_SSH_PRIVATE_KEY }}
          SSH_KNOWN_HOSTS: ${{ secrets.TOKYO_SSH_KNOWN_HOSTS }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
          chmod 600 ~/.ssh/known_hosts

      - name: Upload release package
        env:
          SSH_HOST: ${{ secrets.TOKYO_SSH_HOST }}
          SSH_USER: ${{ secrets.TOKYO_SSH_USER }}
          SHA: ${{ steps.package.outputs.sha }}
        run: |
          scp -o StrictHostKeyChecking=yes \
            "/tmp/b2b-backend-${SHA}.tar.gz" \
            "${SSH_USER}@${SSH_HOST}:/opt/b2b-inquiry-platform/incoming/b2b-backend-${SHA}.tar.gz"

      - name: Deploy and health-check on Tokyo server
        env:
          SSH_HOST: ${{ secrets.TOKYO_SSH_HOST }}
          SSH_USER: ${{ secrets.TOKYO_SSH_USER }}
          SHA: ${{ steps.package.outputs.sha }}
        run: |
          ssh -o StrictHostKeyChecking=yes "${SSH_USER}@${SSH_HOST}" \
            "sudo /usr/local/sbin/deploy-b2b-backend /opt/b2b-inquiry-platform/incoming/b2b-backend-${SHA}.tar.gz ${SHA}"
```

注意：

1. 这是需要按真实 GitHub Environment/Secrets 配置后才能运行的工作流模板，不代表已经在你的仓库创建或执行。
2. `actions/checkout@v4`、`actions/setup-node@v4` 是可读性较好的版本标签；正式使用前建议按组织安全策略固定为经审查的 commit SHA。
3. 生产迁移必须遵循 expand → migrate/backfill → contract。不能在一个发布里先删除旧字段，再假设仍在运行的旧 API 与新 schema 兼容。
4. 如果 `pnpm lint/typecheck/test` 发现当前分支存在失败项，发布会停止；不要为了上线直接删掉门禁。
5. workflow 触发后会先迁移生产数据库再上传应用包。应使用向前兼容迁移，且上线前确认 Neon 有可恢复的备份/恢复方案。

## 9. 首次上线步骤

按顺序执行，避免服务在环境文件或发布目录尚未准备好时启动。

### 9.1 本地修改并提交部署文件

将本手册中的 GitHub Actions 工作流提交到 `main`；同时确保 API/Runner 已在该分支通过本地/CI 构建。不要将真实 `.env` 文件加入 Git。

### 9.2 创建 GitHub Secrets

按照第 8 节表格配置 production Environment。核验 SSH 主机指纹，并确保 `deploy` 用户可写 `incoming/`，但不可读取服务器 `.env`。

### 9.3 完成服务配置

在东京服务器完成第 3–7 节，建立 `.env`、两个 systemd unit、发布脚本和 Cloudflare Tunnel。此时还没有 `current` 目录是正常的。

### 9.4 运行首次发布

GitHub 仓库 → Actions → `Deploy Tokyo Backend` → Run workflow → 输入 `main` → 手动批准 production 环境（若配置 reviewer）。

工作流成功后，在服务器执行：

```bash
sudo systemctl status b2b-api.service --no-pager
sudo systemctl status b2b-task-runner.service --no-pager
sudo journalctl -u b2b-api.service -n 100 --no-pager
sudo journalctl -u b2b-task-runner.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3002/api/v1/health/live
curl -fsS http://127.0.0.1:3002/api/v1/health/ready
curl -fsS https://api.example.com/api/v1/health/ready
readlink -f /opt/b2b-inquiry-platform/current
free -h
df -h
```

期望结果：

- `health/live` 返回 `{"status":"ok", ...}`。
- `health/ready` 返回 `status=ok`、`checks.database.ok=true`。
- 外部 `api.example.com` 健康检查可以通过 HTTPS 访问。
- `b2b-api.service` 与 `b2b-task-runner.service` 均为 `active`。
- 确认云防火墙没有开放 3002/5432/6379。

### 9.5 管理员账号初始化

仓库有 `pnpm bootstrap:admin`，它会使用现有 `super_admin` 角色创建首位管理员并设置首次登录改密要求。该命令只在首次初始化时运行一次；不要每次部署都执行，不要用临时 SQL 手工写密码 hash。可在可信开发机的仓库 checkout 中按 `database/scripts/bootstrap-admin.ts` 的说明，向该命令注入 Neon 连接串后运行；不要把数据库 URL 或生成的密码发到聊天。生成密码须保存至密码管理器并在首次登录后修改。

## 10. 后续迭代发布：每次只做这几步

正常代码更新流程：

1. VS Code 中开发，在功能分支完成检查。
2. 提交并 push，合并到 `main`。
3. GitHub Actions → `Deploy Tokyo Backend` → Run workflow → 输入 `main`。
4. 审核 production 环境批准请求。
5. 等工作流完成后确认两个 systemd 服务与健康检查。

你无需 SSH 登录服务器手动执行 `git pull`、安装全部开发依赖或重启进程。CI 会用 Linux 环境构建，服务器只安装生产依赖，减少原生依赖跨操作系统问题和低内存构建风险。

### 紧急查看命令

```bash
# 服务状态
sudo systemctl status b2b-api.service b2b-task-runner.service --no-pager

# 实时日志
sudo journalctl -u b2b-api.service -f
sudo journalctl -u b2b-task-runner.service -f

# 查看最近一次发布版本
readlink -f /opt/b2b-inquiry-platform/current
ls -1dt /opt/b2b-inquiry-platform/releases/* | head

# 本机健康检查
curl -i http://127.0.0.1:3002/api/v1/health/ready
```

## 11. 回滚策略

### 应用发布失败

发布脚本会在本机 `health/ready` 不通过或 Runner 不活跃时，把 `current` symlink 恢复到上一发布目录并重启服务。然后查日志定位原因。

### 手动回退应用版本

```bash
ls -1dt /opt/b2b-inquiry-platform/releases/*
```

从列表中选择一个完整的 40 位 commit 目录（不要猜 SHA），例如：

```bash
PREVIOUS_SHA=在这里填上一版本的完整40位commitSHA
sudo ln -sfn "/opt/b2b-inquiry-platform/releases/${PREVIOUS_SHA}" \
  /opt/b2b-inquiry-platform/current.rollback
sudo mv -Tf /opt/b2b-inquiry-platform/current.rollback \
  /opt/b2b-inquiry-platform/current
sudo systemctl restart b2b-api.service b2b-task-runner.service
curl -fsS http://127.0.0.1:3002/api/v1/health/ready
```

**回滚应用不等于回滚数据库。** 数据库迁移应优先向前修复；除非事先在隔离环境演练过，否则不要直接恢复生产数据库、删除新列或重放有副作用的文件删除/Excel 任务。

## 12. 上线验收清单

- [ ] GitHub Actions 所有质量检查成功。
- [ ] `pnpm db:deploy` 使用 Neon Direct URL 并成功，且变更向前兼容。
- [ ] API 本地与外部 HTTPS 健康检查均成功。
- [ ] API/Runner 都由 systemd 托管，重启服务器后能自动启动。
- [ ] API/Runner 使用同一 Neon pooled runtime URL，Prisma Client 进程内复用。
- [ ] R2 图片上传/确认、公开图片访问、私有文件下载权限都通过真实测试。
- [ ] 生产环境不依赖服务器本地磁盘保存唯一文件副本。
- [ ] 管理员登录、Session Cookie、CSRF、RBAC 与登出已验证。
- [ ] 产品公开接口、HTML、metadata、JSON-LD 不泄漏价格。
- [ ] 物理删除任务、图片处理、Excel 导出在 Runner 重启后能够恢复/重试。
- [ ] `/api/v1/health/ready` 数据库依赖检查通过。
- [ ] 没有把 3002、5432 或 6379 暴露到公网。
- [ ] 观察 API 响应延迟、RSS、Swap、OOM、任务积压、Neon 连接数和 R2 错误。
- [ ] 已在隔离 Neon branch/database 上进行一次恢复演练。

## 13. 常见故障定位

### API 启动失败

```bash
sudo journalctl -u b2b-api.service -n 200 --no-pager
sudo systemctl cat b2b-api.service
sudo ls -l /opt/b2b-inquiry-platform/shared/.env
```

优先检查 `DATABASE_URL`、`SESSION_SECRET`（至少 24 字符）、R2 配置、`ENV_FILE` 路径、发布目录是否包含 `apps/api/dist/main.js` 和 Prisma generated client。

### Runner 不处理任务

```bash
sudo journalctl -u b2b-task-runner.service -n 200 --no-pager
sudo systemctl status b2b-task-runner.service --no-pager
```

核对 Runner 是否指向正确的 Neon 数据库、是否有 R2 错误、任务的状态/租约/重试次数是否合理，以及当前版本是否包括 `apps/worker/dist/index.js`。不要通过删除数据库任务记录来假装队列已清空。

### 健康检查返回 `degraded`

仓库 readiness 会执行 `SELECT 1` 检查数据库连接。检查 Neon pooled URL、Neon 项目状态、连接串中的 SSL 参数、数据库权限及连接池额度。

### 部署脚本无法读取 `.env`

`.env` 通过 systemd 的 `ENV_FILE=/opt/b2b-inquiry-platform/shared/.env` 注入。应用运行用户 `b2bapp` 必须能读取它；发布用户不应在工作流里把文件内容输出到日志。

### 1 GB 内存不够

```bash
free -h
ps -eo pid,comm,rss,%mem --sort=-rss | head
sudo journalctl -k --since "24 hours ago" | grep -Ei 'oom|out of memory|killed process'
```

优先保持 Runner 并发 1、API/Runner 使用有限 Node heap、减少并发重任务；如果仍发生 OOM，升级服务器内存。不要在生产服务器编译整个 monorepo，也不要把 Swap 当作实际内存的替代品。

## 14. 重要边界

- 本文是依据仓库当前代码和架构文件形成的部署实施方案，不代表已修改你的 GitHub 仓库或已经在东京服务器执行。
- 工作流模板需要按真实服务器用户、Cloudflare Tunnel、Neon/R2 凭据与 GitHub Environment 完成配置后才能运行。
- 首发前优先验证 API/Runner 的真实 Linux build 与生产依赖安装；`pnpm lint/typecheck/test` 任何一项失败都应先处理。
- 不要照旧版 `docs/29-production-server-deployment-runbook.md` 把 PostgreSQL/Redis、前台/后台 Next.js 和所有服务一起放在东京服务器；`docs/33` 才是当前目标架构实施基线。
