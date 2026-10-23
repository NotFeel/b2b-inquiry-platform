# B2B Inquiry Platform 生产服务器准备与部署执行手册

> 仓库：NotFeel/b2b-inquiry-platform
> 默认分支：main
> 文档版本：1.0
> 目标：把当前 pnpm monorepo 部署到公网服务器，支持前台产品目录、后台管理、API、后台任务、PostgreSQL、Redis、图片存储以及商品报价/PI Excel 导出。
>
> **重要现状说明**：当前仓库包含 `infra/docker-compose.dev.yml`，仅用于本地 PostgreSQL / Redis 开发依赖；检查仓库树时未发现生产 Dockerfile、生产 Docker Compose 或 GitHub Actions 部署 workflow。因此，本手册先提供“单台 Linux 服务器 + Docker 运行 PostgreSQL/Redis + Node 服务由 systemd 托管”的首发路径。不要直接使用开发 Compose 作为生产编排。

---

## 目标架构状态说明（2026-10-23）

本手册后续章节保留原有“服务器运行 Storefront/Admin/API/Worker + 本地 Postgres/Redis”的详细操作，作为旧拓扑的回滚、临时运行或迁移参考；**不得将其当作当前目标架构的最终生产部署方式**。

新的目标生产架构及逐项执行步骤见 `docs/33-lightweight-cloudflare-neon-r2-implementation.md`：
- Storefront 与 Admin 目标部署至 Cloudflare Workers，但须先通过 Next.js 15.5.27 兼容性 POC。
- PostgreSQL 使用 Neon。
- 图片/私有文件使用 R2，按 public/private 分离访问。
- 2C/1G 服务器只运行 NestJS API 与后台任务运行时；是否同一进程须由内存与延迟测试决定。
- 目标移除 Redis/BullMQ，但只能在所有任务已迁移至 PostgreSQL 持久化任务执行、旧队列安全排空、重试/租约/幂等与重启恢复均验收后执行。

迁移至目标架构后，本手册中涉及本地 PostgreSQL/Redis 安装、四个 systemd 应用进程、前后台 Nginx 代理和相关端口的步骤应标记为旧拓扑，不得照抄执行。切换之前保留本手册中的回滚指引。


## 1. 推荐部署决策

### 1.1 首发生产拓扑

建议先用一台 Linux 服务器跑应用与反向代理；数据库和 Redis 可先部署在同机 Docker 容器中，后续再把数据库/Redis迁至托管服务或独立私网节点。

```mermaid
flowchart TB
  U[海外客户 / 管理员浏览器] --> DNS[域名 DNS]
  DNS --> TLS[Nginx + HTTPS :443]
  TLS --> SF[Storefront Next.js :3000]
  TLS --> AD[Admin Next.js :3001]
  SF --> API[NestJS API :3002]
  AD --> API
  API --> PG[(PostgreSQL)]
  API --> R[(Redis / BullMQ)]
  R --> W[Worker]
  W --> PG
  W --> OBJ[S3 兼容私有对象存储]
```

### 1.2 服务器规格建议

| 场景 | CPU | 内存 | SSD | 说明 |
|---|---:|---:|---:|---|
| 测试/验收 | 2 vCPU | 4 GB | 60–80 GB | 可作预发布，同机全套生产组件会较紧张 |
| **建议首发生产** | **4 vCPU** | **8 GB** | **160 GB NVMe** | 适合低至中等访问、单副本；必须监控数据库、内存与 Excel 导出峰值 |
| 图片/PDF任务较多或流量增长 | 8 vCPU | 16 GB | 250 GB+ NVMe | 可提高 worker 并发，优先将 PostgreSQL 与对象存储外置 |

以上是规划建议，不是压测结果或容量保证。应根据并发量、图片规模、PDF频率、数据库增长和监控调整。

### 1.3 采购和资源清单

- Linux：优先 Ubuntu Server 24.04 LTS x86_64；其他发行版需调整包管理命令。
- 公网 IPv4：一个；云厂商防火墙 / Security Group 必须启用。
- 域名：一个主域名，建议 `www.example.com`（前台）和 `admin.example.com`（后台）。
- TLS：Let's Encrypt 或云厂商证书。
- 数据盘：建议系统盘以外有独立数据盘；生产图片建议用 S3 兼容对象存储。
- PostgreSQL：首发可用同机私网容器，成熟后迁移托管 PostgreSQL。
- Redis：供 BullMQ 队列使用；禁止公网访问，设置持久化、内存与告警。
- 备份目标：异地对象存储或独立备份服务，不能只留在同一台服务器。
- 告警目标：邮件或其他渠道接收服务器、证书、磁盘、备份与健康检查告警。

### 1.4 入站端口

| 端口 | 开放对象 | 策略 |
|---|---|---|
| 22/TCP SSH | 仅管理员固定 IP / VPN 出口 IP | 不对全网开放；优先密钥登录 |
| 80/TCP HTTP | 全网 | 仅 HTTPS 跳转和证书验证 |
| 443/TCP HTTPS | 全网 | 唯一正常公网 Web 入口 |
| 3000 / 3001 / 3002 | 不对公网开放 | 仅应用本机和 Nginx 访问 |
| 5432 PostgreSQL | 不对公网开放 | 仅本机 / 私网 |
| 6379 Redis | 不对公网开放 | 仅本机 / 私网 |

确认云防火墙没有把 3000、3001、3002、5432 或 6379 暴露到公网。

---

## 2. 上线前检查清单

- [ ] 仓库可访问：`https://github.com/NotFeel/b2b-inquiry-platform`
- [ ] 记录目标 commit：`git rev-parse HEAD`。
- [ ] 已确定域名和 DNS 权限。
- [ ] 已确定服务器 OS、规格、系统盘和数据盘。
- [ ] PostgreSQL 使用持久化存储或托管服务。
- [ ] Redis 持久化、内存与告警策略已确定。
- [ ] 图片使用 S3 兼容对象存储（生产建议）或独立本地持久化目录。
- [ ] 已获取 GeoIP 数据库，或确认分析功能可以降级运行。
- [ ] 已准备随机 `SESSION_SECRET` 和管理员 bootstrap 策略。
- [ ] 已制定备份频率、保留时间与恢复演练计划。
- [ ] 已知当前缺少生产 Dockerfile / Compose / CI 部署 workflow。

---

## 3. 连接服务器并做基础加固

以下 SSH 命令在本地终端执行，替换服务器地址和用户名：

```bash
ssh ubuntu@YOUR_SERVER_IP
```

登录服务器后更新系统并安装工具：

```bash
sudo apt update
sudo apt -y upgrade
sudo apt -y install ca-certificates curl gnupg git jq unzip ufw fail2ban nginx
sudo timedatectl set-timezone UTC
timedatectl status
```

配置防火墙前确认 SSH 端口和管理员来源 IP 正确，避免锁死远程连接：

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from YOUR_ADMIN_PUBLIC_IP to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

不要原样复制 `YOUR_ADMIN_PUBLIC_IP`。云厂商 Security Group / 网络 ACL 也应配置等效规则。先验证密钥登录，在另一个终端测试新连接成功后再修改 SSH 配置；修改后运行 `sudo sshd -t` 再重载。

---

## 4. 安装 Docker（仅用于 PostgreSQL / Redis）

按照 Docker 官方 Ubuntu 安装说明安装 Engine 和 Compose plugin： https://docs.docker.com/engine/install/ubuntu/

安装后验证：

```bash
docker --version
docker compose version
sudo docker run --rm hello-world
```

创建目录：

```bash
sudo mkdir -p /opt/b2b-inquiry-platform/{releases,shared,backups}
sudo chown -R "$USER":"$USER" /opt/b2b-inquiry-platform
mkdir -p /opt/b2b-inquiry-platform/shared/uploads
mkdir -p /opt/b2b-inquiry-platform/shared/geoip
chmod 750 /opt/b2b-inquiry-platform/shared
```

- `releases/<commit-sha>/`：每个发布版本的代码。
- `shared/.env`：生产变量，仅授权用户可读。
- `shared/uploads/`：仅临时采用本地文件存储时使用。
- `shared/geoip/`：GeoIP 数据库文件。
- `backups/`：临时备份落盘；最终需复制到异地存储。

---

## 5. 拉取代码并确认运行环境

仓库 `package.json` 的 `engines.node` 目前写为 `>=20.11.0`，但 `packageManager` 锁定 `pnpm@11.25.0`；pnpm 11 官方要求 Node.js 22 或更高版本。因此部署建议固定 Node.js 24 LTS（或先在 staging 验证过的 Node.js 22/24），不要在生产使用 Node 20。该仓库的 `engines.node` 声明比 pnpm 实际要求宽松，后续应同步修订并通过 CI 验证。参考：[pnpm 11 安装要求](https://github.com/pnpm/pnpm/blob/main/pnpm11/docs/installation.md)、[Node.js 发布计划](https://github.com/nodejs/Release)。

安装 Node.js 时应选官方发行版本或节点管理工具并固定版本；确保 systemd 服务使用的 PATH 能找到相同的 `node` / `corepack`。验证：

```bash
node --version
corepack --version
corepack pnpm --version
```

如 Corepack 未提供仓库要求的 pnpm，请按官方文档安装匹配版本：https://pnpm.io/installation

首次拉取（仓库公开时）：

```bash
cd /opt/b2b-inquiry-platform/releases
git clone https://github.com/NotFeel/b2b-inquiry-platform.git source
cd source
git checkout main
git pull --ff-only origin main
git rev-parse HEAD
```

正式发布应把 commit 放进新的 release 目录，而不是覆盖线上目录：

```bash
cd /opt/b2b-inquiry-platform/releases
git clone https://github.com/NotFeel/b2b-inquiry-platform.git <COMMIT_SHA>
cd <COMMIT_SHA>
git checkout <COMMIT_SHA>
```

若仓库转私有，使用只读 Deploy Key 或最小权限 GitHub App 凭据；不要把 Token 放进 clone URL 或 shell 历史。

---

## 6. 配置生产环境变量

从模板创建服务器本地配置文件，真正的生产配置不得提交 Git：

```bash
cd /opt/b2b-inquiry-platform/releases/source
cp .env.example /opt/b2b-inquiry-platform/shared/.env
chmod 600 /opt/b2b-inquiry-platform/shared/.env
nano /opt/b2b-inquiry-platform/shared/.env
```

以下是关键配置参考，所有占位值必须替换：

```dotenv
NODE_ENV=production
API_PORT=3002
APP_BASE_URL=https://www.example.com
ADMIN_BASE_URL=https://admin.example.com
API_BASE_URL=http://127.0.0.1:3002
ADMIN_API_PROXY_TARGET=http://127.0.0.1:3002
STOREFRONT_API_PROXY_TARGET=http://127.0.0.1:3002
ADMIN_ALLOWED_ORIGINS=https://admin.example.com
LOG_LEVEL=info
LOG_PRETTY=false
TRUST_PROXY=true
SITE_TIMEZONE=UTC

DATABASE_URL=postgresql://b2b_app:URL_ENCODED_STRONG_PASSWORD@127.0.0.1:5432/b2b_catalog?schema=public
REDIS_URL=redis://127.0.0.1:6379

SESSION_SECRET=REPLACE_WITH_LONG_RANDOM_SECRET
SESSION_COOKIE_NAME=b2b_admin_session
SESSION_TTL_HOURS=12

STORAGE_DRIVER=s3
S3_ENDPOINT=https://YOUR_S3_COMPATIBLE_ENDPOINT
S3_REGION=YOUR_REGION
S3_BUCKET=YOUR_PRIVATE_BUCKET
S3_ACCESS_KEY_ID=YOUR_LIMITED_ACCESS_KEY
S3_SECRET_ACCESS_KEY=YOUR_SECRET_KEY
S3_PUBLIC_BASE_URL=
S3_FORCE_PATH_STYLE=true
DOWNLOAD_URL_TTL_SECONDS=300

WHATSAPP_BUSINESS_NUMBER=YOUR_INTERNATIONAL_NUMBER
GEOIP_DATABASE_PATH=/opt/b2b-inquiry-platform/shared/geoip/GeoLite2-Country.mmdb
ANALYTICS_SALT=REPLACE_WITH_ANOTHER_RANDOM_SECRET
UPLOAD_MAX_BYTES=10485760
UPLOAD_MAX_PIXELS=50000000
IMAGE_DERIVATIVE_WIDTHS=320,640,1280
IMAGE_PROCESSING_TIMEOUT_SECONDS=20
IMAGE_PROCESSING_CONCURRENCY=1
IMAGE_WEBP_QUALITY=82
WORKER_CONCURRENCY=2
FILE_DELETE_SWEEP_INTERVAL_SECONDS=30

BOOTSTRAP_ADMIN_USERNAME=YOUR_ADMIN_USERNAME
BOOTSTRAP_ADMIN_PASSWORD=
BOOTSTRAP_ADMIN_DISPLAY_NAME=Platform Administrator
REVALIDATE_SECRET=REPLACE_WITH_RANDOM_SECRET
```

注意：

1. 域名、密码、S3 地址和号码都是占位值，必须替换。
2. `DATABASE_URL` 密码若包含 `@`、`:`、`/`、`#` 等字符，必须 URL 编码。
3. 随机值可使用 `openssl rand -base64 48` 生成；Session secret 与 analytics salt 应独立。
4. `BOOTSTRAP_ADMIN_PASSWORD` 是否为空时自动生成一次性密码，以当前 `database/scripts/bootstrap-admin.ts` 行为为准。先检查脚本并在隔离环境验证，不要假设空密码可用。
5. 生产推荐 `STORAGE_DRIVER=s3`。若使用本地存储，必须配置代码目录之外的持久化目录并单独备份。
6. `GEOIP_DATABASE_PATH` 文件必须存在且对服务用户可读；否则按代码支持情况降级 GeoIP。
7. `.env` 不应由 Nginx 提供访问，且必须限制权限。

```bash
openssl rand -base64 48
stat -c '%a %U:%G %n' /opt/b2b-inquiry-platform/shared/.env
```

---

## 7. 启动 PostgreSQL 和 Redis（单机首发方案）

下面是首发单机示例，密码必须先替换为新生成的强密码。生产数据重要时优先使用托管 PostgreSQL + 私网 Redis。

```bash
docker network create b2b-private 2>/dev/null || true
nano /opt/b2b-inquiry-platform/shared/compose.data.yml
chmod 600 /opt/b2b-inquiry-platform/shared/compose.data.yml
```

下面使用 Docker 命名 volume 保存 PostgreSQL 数据，避免把特定镜像版本的容器 UID 写死到宿主机目录权限中。若你坚持使用宿主机 bind mount，必须先核实所用镜像内 PostgreSQL 用户的实际 UID/GID，再设置目录权限。

将以下内容写入 `compose.data.yml`：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: b2b-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: b2b_catalog
      POSTGRES_USER: b2b_app
      POSTGRES_PASSWORD: REPLACE_WITH_STRONG_DATABASE_PASSWORD
    command: ["postgres", "-c", "max_connections=100"]
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    networks: [b2b-private]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U b2b_app -d b2b_catalog"]
      interval: 10s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: b2b-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "512mb", "--maxmemory-policy", "noeviction"]
    volumes:
      - redis_data:/data
    ports:
      - "127.0.0.1:6379:6379"
    networks: [b2b-private]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 10

networks:
  b2b-private:
    external: true

volumes:
  postgres_data:
  redis_data:
```

启动并验证：

```bash
docker compose -f /opt/b2b-inquiry-platform/shared/compose.data.yml up -d
docker ps
docker logs --tail=100 b2b-postgres
docker logs --tail=100 b2b-redis
docker exec b2b-postgres pg_isready -U b2b_app -d b2b_catalog
docker exec b2b-redis redis-cli ping
```

Redis 的 `noeviction` 可以避免队列键被自动淘汰，但内存达到上限时写入会失败，因此必须监控并在满之前扩容。AOF 不是 PostgreSQL 业务数据备份的替代品。

以上端口仅绑定宿主机 loopback。若将应用也放到 Docker 网络中，应用应使用容器 DNS 名称并移除不需要的宿主机端口映射；不要为了容器间通信开放公网 DB / Redis 端口。

---

## 8. 安装依赖并执行数据库迁移

```bash
cd /opt/b2b-inquiry-platform/releases/source
corepack pnpm install --frozen-lockfile
```

加载运行时变量并生成 Prisma Client：

```bash
set -a
. /opt/b2b-inquiry-platform/shared/.env
set +a
corepack pnpm run db:generate
corepack pnpm --filter @b2b/database run validate
corepack pnpm --filter @b2b/database run migrate:status
```

确认部署 commit、检查迁移目录且数据库备份可恢复后，执行生产迁移：

```bash
git rev-parse HEAD
ls -la database/prisma/migrations
corepack pnpm run db:deploy
corepack pnpm --filter @b2b/database run migrate:status
```

生产只执行已提交的迁移；不要运行 `prisma migrate dev` 或以 `db push` 代替版本化迁移。不要手工删除 `_prisma_migrations` 记录来掩盖错误。破坏性变更应遵循 expand/backfill/verify/switch/contract。

首次 seed 前检查 `database/prisma/seed.ts` 的内容和幂等性，再决定是否执行 `corepack pnpm run db:seed`；不得在每次发布时无条件重复灌入演示数据。

---

## 9. 编译并启动四个应用

仓库脚本定义：

- Storefront：端口 3000；`pnpm --filter @b2b/storefront start`。
- Admin：端口 3001；`pnpm --filter @b2b/admin start`。
- API：由 `API_PORT` 配置，默认 3002；`pnpm --filter @b2b/api start`。
- Worker：独立进程；`pnpm --filter @b2b/worker start`。

构建前先确保本机或 CI 对当前提交可安装并构建：

```bash
cd /opt/b2b-inquiry-platform/releases/source
set -a
. /opt/b2b-inquiry-platform/shared/.env
set +a
corepack pnpm run lint
corepack pnpm run typecheck
corepack pnpm run test
corepack pnpm run build
```

不要直接在正在运行的线上目录覆盖代码后再构建。正式发布应新建 release 目录，安装 frozen lockfile、构建成功后再切换服务工作目录。

### 9.1 初始化首个管理员

先检查脚本实现，不要把敏感输出发到公开 Issue：

```bash
sed -n '1,240p' database/scripts/bootstrap-admin.ts
```

确认所需变量、密码生成/输出方式和重复执行保护后，在迁移完成的目标库中执行：

```bash
set -a
. /opt/b2b-inquiry-platform/shared/.env
set +a
corepack pnpm run bootstrap:admin
```

初始化完成后，通过安全渠道取得凭据并立即登录；验证角色和菜单权限；清除不再需要的 bootstrap 凭据，不要启用后台公开注册。

---

## 10. 使用 systemd 管理服务

当前仓库没有生产 Dockerfile，因此首发可用 systemd 管理 Node 进程。后续建议补齐多阶段 Dockerfile、非 root 用户、生产 Compose 和部署流水线。

创建无登录服务用户，并保证它只拥有必要读写权限：

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin b2b || true
sudo chown -R b2b:b2b /opt/b2b-inquiry-platform/releases
sudo chown root:b2b /opt/b2b-inquiry-platform/shared/.env
sudo chmod 640 /opt/b2b-inquiry-platform/shared/.env
```

先确认 Node 路径：

```bash
command -v node
command -v corepack
```

systemd 默认不加载交互式 shell 配置；如果 Node 通过 nvm 安装，不要假定 systemd 能找到它。应把 ExecStart 改成已验证的绝对路径。

为每个服务创建 `/etc/systemd/system/<服务名>.service` 文件。四个单元共用以下模板，但分别改 `Description` 和 `ExecStart`。`EnvironmentFile` 必须是 systemd 可读格式，不能假定任意 shell `.env` 语法都兼容。

API：

```ini
[Unit]
Description=B2B Inquiry Platform API
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=b2b
WorkingDirectory=/opt/b2b-inquiry-platform/releases/source
EnvironmentFile=/opt/b2b-inquiry-platform/shared/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/env corepack pnpm --filter @b2b/api start
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

其他三个单元采用相同配置：

- Worker 的 ExecStart：`/usr/bin/env corepack pnpm --filter @b2b/worker start`
- Storefront 的 ExecStart：`/usr/bin/env corepack pnpm --filter @b2b/storefront start`
- Admin 的 ExecStart：`/usr/bin/env corepack pnpm --filter @b2b/admin start`

启用服务前确认绝对路径、工作目录、变量文件和端口：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now b2b-api b2b-worker b2b-storefront b2b-admin
sudo systemctl status b2b-api b2b-worker b2b-storefront b2b-admin --no-pager
```

查看日志：

```bash
sudo journalctl -u b2b-api -n 200 --no-pager
sudo journalctl -u b2b-worker -n 200 --no-pager
sudo journalctl -u b2b-storefront -n 200 --no-pager
sudo journalctl -u b2b-admin -n 200 --no-pager
```

如果服务启动失败，先定位 `.env` 解析、Node 路径、数据库连通、Prisma Client 生成和端口占用，不要反复重启掩盖错误。

---

## 11. 配置 Nginx 和 HTTPS

推荐域名：

- `www.example.com` → Storefront `127.0.0.1:3000`
- `admin.example.com` → Admin `127.0.0.1:3001`

API 仅允许应用内网 / Nginx 代理访问；除非有明确需求并完成安全评审，不要创建公开 API 入口。

配置文件 `/etc/nginx/sites-available/b2b-inquiry-platform` 示例：

```nginx
server {
    listen 80;
    server_name www.example.com admin.example.com;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name www.example.com;
    ssl_certificate /etc/letsencrypt/live/www.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/www.example.com/privkey.pem;
    client_max_body_size 12m;
    server_tokens off;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options SAMEORIGIN always;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}

server {
    listen 443 ssl http2;
    server_name admin.example.com;
    ssl_certificate /etc/letsencrypt/live/admin.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.example.com/privkey.pem;
    client_max_body_size 12m;
    server_tokens off;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options SAMEORIGIN always;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

注意：证书文件必须先签发才存在。先配置 HTTP 并把 DNS 指向服务器，再按 Certbot 官方指南签发证书：https://certbot.eff.org/instructions。证书签发后设置 HTTPS server block，执行 `sudo nginx -t` 成功后再 `sudo systemctl reload nginx`。验证自动续期，并设置续期失败告警。

生产环境还应评估 CSP、HSTS（确认所有子域均 HTTPS 后再启用）、速率限制、上传限制、访问日志脱敏和缓存头。不要缓存管理员页面或带认证的 API 响应。

---

## 12. 首次上线验证

检查进程和端口：

```bash
sudo systemctl is-active b2b-api b2b-worker b2b-storefront b2b-admin
sudo ss -lntp
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1:3001
```

检查应用端口应只在本机监听：3000 / 3001 为 Next 服务，3002 为 API；5432 和 6379 只在 loopback 或私网可访问。

架构文档规划了 `/health/live` 与 `/health/ready`。上线前检查 API controller 是否真的实现这两个路由；如果未实现，先补齐再作为监控目标，不能只因为文档提过就假定已存在。

```bash
curl -i http://127.0.0.1:3002/health/live
curl -i http://127.0.0.1:3002/health/ready
```

### 功能验收清单

- [ ] 前台首页可访问，默认英文文案正确。
- [ ] 产品目录、品类、搜索、分页和产品详情正常。
- [ ] **价格隔离**：检查 HTML、网络响应、SEO/OG/JSON-LD 和缓存，不得出现内部价格。
- [ ] WhatsApp 询盘打开正确聊天目标，预填内容在真实移动端和桌面端测试过。
- [ ] 未登录用户不能访问受保护的后台 API。
- [ ] 管理员角色、菜单和操作权限由服务端校验。
- [ ] 商品创建/编辑、图片上传、主图与排序正常。
- [ ] 测试图片删除确实清理存储对象；失败时留存可重试记录，不能假报成功。
- [ ] Redis 队列可被 worker 消费。
- [ ] 验证商品报价 Excel 与 PI Excel 的成功路径、大文件、超时和重试。
- [ ] 数据库备份已完成，恢复演练已记录。
- [ ] HTTPS 自动续期、服务自启、磁盘/内存告警已验证。

价格隔离快速初筛（替换产品 URL）：

```bash
curl -fsSL https://www.example.com/products/EXAMPLE-SLUG | grep -Ei 'price|cost|margin|wholesale' || true
```

该命令只能帮助人工初筛，不能代替公共 API DTO 审计、结构化数据检查和自动化测试。

---

## 13. 备份策略

### 13.1 PostgreSQL 逻辑备份

建立权限受限的备份目录：

```bash
sudo install -d -m 700 -o b2b -g b2b /opt/b2b-inquiry-platform/backups
```

一次备份示例：

```bash
docker exec b2b-postgres pg_dump -U b2b_app -d b2b_catalog -Fc > /opt/b2b-inquiry-platform/backups/b2b_catalog_$(date -u +%Y%m%dT%H%M%SZ).dump
chmod 600 /opt/b2b-inquiry-platform/backups/*.dump
```

由哪个用户执行，就检查谁拥有新生成的 dump 文件；不要让备份权限过宽，也不要在命令行参数或 shell 历史里暴露数据库密码。

每次备份后必须检查文件非空和大小、复制到不同故障域的加密存储、设定保留策略、在隔离数据库演练 `pg_restore --list` 和实际恢复，并记录 RPO（可接受数据丢失时间）与 RTO（可接受停机时间）。

### 13.2 对象存储和本地文件

- S3 bucket 应私有访问、最小权限、加密，并配置合理的生命周期与版本策略。
- 如果开启 S3 版本控制，普通 Delete 可能仅产生 delete marker；若业务要求真正物理删除，需明确清理历史版本的权限和流程。
- 本地上传目录必须放在代码 release 目录之外并独立备份。
- Redis 队列不能替代数据库中的持久化任务 / Outbox 记录。

---

## 14. 每次发布的标准流程

**不要直接在当前线上目录执行 `git pull` 后立即重启。**

每次发布：

1. 记录当前 commit、数据库迁移状态和备份状态。
2. 拉取目标 commit 到新的 release 目录。
3. 审查代码差异、依赖变化、迁移 SQL 和 `.env.example` 差异。
4. 执行 `pnpm install --frozen-lockfile`。
5. 执行 lint、typecheck、test 和 build。
6. 备份数据库并执行该版本的 `pnpm db:deploy`。
7. 切换 systemd 工作目录或 release symlink，重启服务。
8. 检查四个服务状态、健康检查、Nginx、API 和 worker 日志。
9. 执行烟雾测试与价格隔离测试。
10. 记录 commit SHA、迁移编号、验收结果、风险和回滚点。

使用符号链接管理当前版本的示例：

```bash
ln -sfn /opt/b2b-inquiry-platform/releases/<NEW_RELEASE> /opt/b2b-inquiry-platform/current
```

systemd `WorkingDirectory` 指向 `/opt/b2b-inquiry-platform/current`。切换前确认新版本完整可运行，至少保留上一个已验证 release。

回滚原则：

- 应用回滚：`current` 指回上一个版本并重启相关服务，然后重新做烟雾测试。
- 数据库回滚：默认优先前向修复；不可逆迁移按预先演练的恢复策略处理，不要盲目运行旧迁移或恢复旧备份。
- 对象存储回滚：验证旧版本与当前 object key、元数据、删除状态和签名 URL 的兼容性。
- 保留故障日志与 commit SHA，禁止为“清理现场”而直接清空数据卷。

---

## 15. 故障定位表

| 现象 | 检查方向 | 常用命令 |
|---|---|---|
| 页面 502 | Next 进程、端口、Nginx 配置 | `systemctl status b2b-storefront b2b-admin`；`nginx -t`；`journalctl -u nginx -n 100` |
| Admin 登录后 API 出错 | `ADMIN_API_PROXY_TARGET`、Session、Allowed Origins | 查看 admin/api 日志，核对代理地址与变量 |
| 询盘提交失败 | `STOREFRONT_API_PROXY_TARGET`、API 路由、限流 | `journalctl -u b2b-storefront -n 200`；`journalctl -u b2b-api -n 200` |
| Prisma 连不上 DB | DATABASE_URL、用户权限、数据库健康、URL 编码 | `docker exec b2b-postgres pg_isready -U b2b_app -d b2b_catalog` |
| migration 失败 | 数据库、权限、锁表、migration 状态与 SQL | `pnpm --filter @b2b/database run migrate:status` |
| Worker 不消费任务 | Redis URL、队列前缀、进程、worker 日志 | `systemctl status b2b-worker`；`journalctl -u b2b-worker -n 300` |
| 图片上传/删除失败 | S3 权限、Storage Driver 配置一致性、删除任务 | 查看 API/worker 日志和持久化文件操作记录 |
| 磁盘增长 | Docker 日志、journal、发布包、导出临时文件 | `df -h`；`docker system df`；`sudo journalctl --disk-usage` |
| 重启后服务不恢复 | systemd enable、路径、环境变量、持久化卷 | `systemctl is-enabled b2b-api`；检查 volume 和 WorkingDirectory |

不要把 `docker system prune -a --volumes` 当作通用清理命令；它可能删除还需要的数据卷或镜像。

---

## 16. 上线 Go / No-Go

- [ ] SSH、系统更新、云防火墙已完成。
- [ ] 只开放 SSH（限来源）、80、443；应用端口、PostgreSQL 和 Redis 不暴露公网。
- [ ] DNS 与 HTTPS 生效，证书续期已验证。
- [ ] PostgreSQL migration 通过，Redis 可用，数据卷持久化。
- [ ] Storefront、Admin、API、Worker 都有进程管理器，且主机重启后可拉起。
- [ ] 不存在示例密钥、弱密码或后台公开注册。
- [ ] 价格隔离、RBAC、上传校验、物理删除重试通过。
- [ ] 异地备份可恢复，RPO/RTO 已记录。
- [ ] 可用性、磁盘、内存、数据库和任务积压有告警。
- [ ] commit SHA、迁移编号、回滚方案和验收结果已记录。

任何涉及密钥、权限、公开端口、备份恢复或数据正确性的硬性条件未满足，都应判定为 No-Go。

---

## 17. 下一步要补齐的生产自动化

1. 为 Storefront、Admin、API、Worker 编写多阶段 Dockerfile，固定运行时版本
   并以非 root 用户运行。
2. 增加生产 `compose.yml`：内部网络、健康检查、资源限制、日志轮转、持久化卷、数据库/Redis不暴露公网。
3. 为生产应用建立最小权限数据库角色；迁移作为独立发布步骤，而不是由多个 API 实例同时执行。
4. 建立 GitHub Actions：PR 阶段执行 install/lint/typecheck/test/build；发布阶段构建不可变镜像、推送镜像仓库，并通过受控部署 Agent 更新服务器。
5. 部署密钥使用 GitHub Environment Secrets 或密钥管理器；配置审批、commit SHA、迁移前备份和发布后烟雾测试。
6. 增加真实 liveness/readiness、结构化日志、指标和告警，保持架构文档与实现一致。
7. 将异地数据库/对象存储备份及恢复演练纳入发布验收。

在生产容器构建和 staging 验收完成之前，不要声称项目已经完成容器化或 CI/CD 自动部署。

---

## 18. 参考链接

- 仓库 README：https://github.com/NotFeel/b2b-inquiry-platform
- 环境变量模板：https://github.com/NotFeel/b2b-inquiry-platform/blob/main/.env.example
- 当前运维规范：https://github.com/NotFeel/b2b-inquiry-platform/blob/main/docs/10-deployment-ops.md
- Docker Engine 安装：https://docs.docker.com/engine/install/ubuntu/
- pnpm 安装：https://pnpm.io/installation
- Node.js 发布信息：https://nodejs.org/en/about/previous-releases
- Certbot 指引：https://certbot.eff.org/instructions
- Prisma Migrate 部署：https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production

本手册与当前仓库结构对齐，但尚未在你的目标服务器实测。首次正式上线前必须在隔离 staging 环境完整演练，尤其是数据库迁移、bootstrap 管理员、systemd 环境变量、Next 同源代理、对象存储与恢复流程。
