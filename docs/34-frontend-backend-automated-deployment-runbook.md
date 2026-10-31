# 34. 前后台与后端自动化部署落地教程

> 适用仓库：`NotFeel/b2b-inquiry-platform`  
> 分支：`main`  
> 文档版本：1.0  
> 目标域名：`www.wuxuanglobal.com`、`admin.wuxuanglobal.com`、`api.wuxuanglobal.com`  
> 当前目标架构：Cloudflare Workers（Storefront/Admin）+ Linux VPS（NestJS API/任务 Runner）+ PostgreSQL/Neon + Cloudflare R2。  
> **重要：本文件是操作手册，不代表 GitHub Actions、Cloudflare Builds、服务器 SSH 密钥或 Secret 已配置完成。首次实施必须按本文先配置、再用受控提交验证。**

---

## 1. 目标与部署边界

将部署分为三个相互独立的生产发布目标：

| 组件 | 仓库目录 | 生产运行位置 | 触发方式 | 生产地址 |
|---|---|---|---|---|
| Storefront 前台 | `apps/storefront` | Cloudflare Worker `b2b-storefront` | 推送 `main` 后由 Cloudflare Workers Builds 构建/部署 | `https://www.wuxuanglobal.com` |
| Admin 后台 | `apps/admin` | Cloudflare Worker `b2b-admin` | 推送 `main` 后由 Cloudflare Workers Builds 构建/部署 | `https://admin.wuxuanglobal.com` |
| NestJS API | `apps/api` 及工作区依赖 | Linux VPS，由 systemd 管理 | GitHub Actions 构建发布包，通过 SSH 上传并在服务器切换版本 | `https://api.wuxuanglobal.com` |
| Task Runner | 仓库中对应 Worker/Runner 应用（以当前实际 package 为准） | Linux VPS，由 systemd 管理；不监听公网 | 与 API 同一发布版本或单独 workflow 发布 | 不对公网提供地址 |

API 发布必须与数据库迁移分开控制。不要让每次前端发布都自动执行生产数据库迁移；也不要让 API
发布时执行包含 demo/业务数据的完整 seed。API 启动会在监听端口前自动执行带事务锁的
`--reference-only` 同步，只补齐版本化权限、菜单、翻译和系统字典。

## 2. 部署前核对仓库基线

在仓库根目录执行：

```bash
git checkout main
git pull --ff-only origin main
node --version
corepack pnpm --version
```

当前根 `package.json` 声明 Node `>=22.13.0`、pnpm `11.25.0`。CI 使用相同 Node 主版本并固定 pnpm 版本。

当前根脚本包含：

- `pnpm build:workers`：构建共享 packages，再构建 Storefront 与 Admin 的 OpenNext Worker 产物。
- `pnpm --filter @b2b/api run build`：NestJS API 编译。
- `pnpm run db:generate`：生成 Prisma Client。

先确认以下文件存在且与当前生产配置一致：

- `apps/storefront/wrangler.jsonc`
- `apps/admin/wrangler.jsonc`
- `apps/storefront/open-next.config.ts`
- `apps/admin/open-next.config.ts`
- `apps/api/package.json`
- `docs/33-lightweight-cloudflare-neon-r2-implementation.md`
- `docs/10-deployment-ops.md`
- `docs/29-production-server-deployment-runbook.md`

如果仓库文件已更新，以代码和锁文件为准，修改本文中对应命令前先在本地验证。禁止把 `.env`、私钥、Cloudflare API Token、数据库 URL 或 R2 Secret 提交到 Git。

## 3. 前台和后台：Cloudflare Workers Builds 自动部署

### 3.1 Cloudflare 资源准备

在 Cloudflare Dashboard → Workers & Pages 中分别创建/配置两个 Worker：

- `b2b-storefront`
- `b2b-admin`

两者都连接 GitHub 仓库 `NotFeel/b2b-inquiry-platform`，生产分支选择 `main`。由于项目是 pnpm monorepo，**Root directory 必须是仓库根目录**，不能设置成 `apps/storefront` 或 `apps/admin`，否则构建无法读取根 lockfile 和共享 packages。

在每个 Worker 的 Settings/Builds（页面名称可能随 Cloudflare UI 调整）设置：

- Node.js 版本：22.13 或更高的兼容 22.x 版本。
- 包管理器：pnpm 11.25.0。
- 安装命令：`corepack enable && corepack prepare pnpm@11.25.0 --activate && pnpm install --frozen-lockfile`。
- 生产分支：`main`。
- 构建目录：不设置为某个子应用目录；使用仓库根目录执行命令。

### 3.2 Storefront 构建/部署命令

在 `b2b-storefront` 的 Build configuration 中填写：

**Build command**

```bash
pnpm -r --filter "./packages/**" build && pnpm --filter @b2b/storefront run build:worker
```

**Deploy command**

```bash
pnpm --filter @b2b/storefront exec wrangler deploy
```

**构建环境变量（非密钥）**

```dotenv
API_BASE_URL=https://api.wuxuanglobal.com
STOREFRONT_API_PROXY_TARGET=https://api.wuxuanglobal.com
```

这两个值必须在构建阶段可被 `next.config.mjs` 读取，因为 Next rewrite 会在构建配置中生成。它们不是数据库或对象存储密钥，不要使用 `NEXT_PUBLIC_*` 暴露服务端内部地址。

### 3.3 Admin 构建/部署命令

在 `b2b-admin` 的 Build configuration 中填写：

**Build command**

```bash
pnpm -r --filter "./packages/**" build && pnpm --filter @b2b/admin run build:worker
```

**Deploy command**

```bash
pnpm --filter @b2b/admin exec wrangler deploy
```

**构建环境变量（非密钥）**

```dotenv
API_BASE_URL=https://api.wuxuanglobal.com
ADMIN_API_PROXY_TARGET=https://api.wuxuanglobal.com
```

### 3.4 OpenNext R2 cache bucket 与 Worker 绑定

两个 Worker 的 `wrangler.jsonc` 声明了独立的增量缓存 bucket，必须在同一 Cloudflare 账户中提前创建，并且名称逐字匹配：

- Storefront：`b2b-storefront-opennext-cache`
- Admin：`b2b-admin-opennext-cache`

这些是 **OpenNext/Next 增量缓存桶**，不是业务图片桶。业务对象存储仍按 API 的配置使用独立的 public/private R2 bucket。不要把私有文件、PI、报价 Excel 放入公共 bucket。

检查每个 Worker 的绑定与配置一致：

- `NEXT_INC_CACHE_R2_BUCKET` → 对应应用的 cache bucket。
- `WORKER_SELF_REFERENCE` → 对应 Worker 自身的 service name。
- Storefront 另外需要 `IMAGES` 图片绑定（以当前 `wrangler.jsonc` 为准）。

如果 Cloudflare Build 已自动根据 Wrangler 配置创建绑定，仍应在部署后核对实际绑定状态。

### 3.5 绑定域名

分别在 Worker 的 Domains & Routes 中绑定：

- `b2b-storefront` → `www.wuxuanglobal.com`
- `b2b-admin` → `admin.wuxuanglobal.com`

不要修改 API 当前使用的 `api.wuxuanglobal.com` DNS/Tunnel 路由来绑定前端。域名必须属于当前 Cloudflare zone，证书状态应正常。

### 3.6 首次生产构建的安全流程

1. 确认两个 Worker 的 Build configuration、生产分支、环境变量、R2 binding 均已保存。
2. 在本地从最新 `main` 安装依赖并构建：

   ```bash
   corepack pnpm install --frozen-lockfile
   corepack pnpm -r --filter "./packages/**" build
   corepack pnpm --filter @b2b/storefront run build:worker
   corepack pnpm --filter @b2b/admin run build:worker
   ```

3. 本地构建成功后，提交一个有实际意义、经过检查的文档/代码变更并推送 `main`。不要为了触发部署而修改业务逻辑或提交空的无意义变更。
4. 在 Cloudflare 的每个 Worker 查看 Builds/Deployments 日志。确认触发 commit SHA 与 GitHub 的 `main` HEAD 一致，构建和部署均成功。
5. 分别验证前台和后台域名。前后台接入同一仓库不代表每次提交一定只部署一个应用；按 Cloudflare 实际构建触发配置检查。

### 3.7 前后台验收

```bash
curl -sS -o /dev/null -w "storefront HTTP %{http_code}\n" https://www.wuxuanglobal.com/
curl -sS -o /dev/null -w "admin HTTP %{http_code}\n" https://admin.wuxuanglobal.com/
curl -i https://api.wuxuanglobal.com/api/v1/health/live
curl -i https://api.wuxuanglobal.com/api/v1/health/ready
```

预期：前台首页正常返回；后台登录页正常返回；API live 为成功状态；ready 返回健康状态且数据库检查通过。若 ready 返回 `degraded`，即使 HTTP 状态码为 200，也必须按应用响应体排查数据库/依赖。

浏览器验收还必须覆盖：

- Storefront 首页、品类列表、商品详情、语言/路由跳转、图片加载。
- 页面源代码、页面 metadata、公共 API 和结构化数据均不包含内部价格。
- Admin 登录、刷新后会话保持、退出登录、权限菜单、CRUD 页面。
- Admin 通过同源 `/api/v1/*` 请求 API；检查登录 Cookie、CSRF、文件上传/下载和错误响应。
- 登录、管理 API、询盘私有数据、Excel/PI、带 Cookie 响应不能被共享缓存错误缓存。
- 检查 Cloudflare Worker Observability/Logs，无持续 5xx、兼容性异常或 R2 binding 错误。

---

## 4. 后端 API：GitHub Actions 自动发布到 Linux VPS

### 4.1 发布模型

推荐采用以下流程：

1. GitHub Actions 在干净的 Ubuntu runner 中检出 `main` 对应 commit。
2. 使用 Node 22、pnpm 11.25.0 安装锁定依赖。
3. 执行数据库客户端生成、lint/typecheck/test/build（按仓库实际可运行脚本）。
4. 将 API 运行所需的编译产物、工作区包、Prisma Client/引擎、生产依赖和部署元数据打成版本化发布包。
5. 通过 GitHub Actions Secrets 中的 SSH 凭据上传发布包到服务器的 `incoming` 目录。
6. 服务器端部署脚本校验包、解压到新的 release 目录、执行预先批准的数据库迁移（若本次发布明确需要）、切换 `current`、重启 systemd 服务并做 health check。
7. 健康检查失败则切回上一个兼容版本，保留诊断日志；成功后保留当前版本和最近两个完整历史版本。

仓库现有 `docs/10-deployment-ops.md` 对发布包、版本目录和磁盘清理已有约束；应复用已有部署脚本/路径，避免另外创建一套不一致的清理逻辑。

**不要把服务器密码放进 GitHub。不要在每次部署时直接覆盖正在运行的目录。不要在生产服务器执行整个 monorepo 的 `pnpm install` 或前端构建。**

### 4.2 服务器一次性准备

先登录 VPS，按现有生产 runbook 核对用户、目录、systemd unit、Node 运行时和 API health endpoint。示例路径如下，若服务器已有不同路径，以实际服务配置为准：

```bash
sudo install -d -o root -g root -m 0755 /opt/b2b-inquiry-platform
sudo install -d -o b2b -g b2b -m 0750 /opt/b2b-inquiry-platform/releases
sudo install -d -o b2b -g b2b -m 0750 /opt/b2b-inquiry-platform/incoming
sudo install -d -o root -g b2b -m 0750 /opt/b2b-inquiry-platform/shared
```

必须确认：

- 服务器存在专用无登录用户（例如 `b2b`），服务不以 root 运行。
- `/opt/b2b-inquiry-platform/shared/.env` 由 root 管理、服务组可读，权限建议 `0640`；文件中包含真实生产环境变量，不进入 Git。
- API 的 systemd unit 指向 `/opt/b2b-inquiry-platform/current` 或等价的可切换路径。
- API 只在本机/私网监听，公网入口由 Cloudflare Tunnel 或受控反向代理转发。
- `/api/v1/health/live` 和 `/api/v1/health/ready` 可用。
- 生产数据库已备份且恢复流程已验证。
- 已核对磁盘空间、服务日志和部署失败回滚方式。

不要直接照抄示例去覆盖现有 systemd unit、生产环境文件或数据库配置。

### 4.3 配置 GitHub Actions Secrets

在 GitHub 仓库 → Settings → Secrets and variables → Actions 中添加部署所需 secrets。变量名需与最终 workflow 保持一致；推荐：

| Secret | 内容 |
|---|---|
| `DEPLOY_HOST` | VPS 公网 IP 或 SSH 可达主机名 |
| `DEPLOY_USER` | 仅用于部署的受限 SSH 用户 |
| `DEPLOY_SSH_KEY` | 专用私钥的完整内容（PEM/OpenSSH 格式） |
| `DEPLOY_KNOWN_HOSTS` | 通过可信渠道核验过的服务器 SSH host key 行 |
| `DEPLOY_PATH` | 服务器部署根目录，例如 `/opt/b2b-inquiry-platform` |

如果现有部署脚本需要端口，可另设 `DEPLOY_PORT`。不要通过 `ssh-keyscan` 的即时未验证结果直接信任服务器；应通过独立可信通道核对 host key fingerprint。私钥使用专用部署密钥，不复用个人日常 SSH 私钥。

建议在服务器限制部署账号权限：只允许上传到 `incoming` 并执行经过审查的部署入口；不要把通用 root SSH 私钥放到 Actions。若当前脚本确实需要 sudo，配置最小化的 sudoers 规则，仅允许执行明确列出的部署脚本和 systemctl 操作。

### 4.4 建议的 workflow 触发规则

后端 workflow 应使用路径过滤，避免只改前台文档时重发 API。触发范围至少包含：

- `apps/api/**`
- `apps/worker/**`（如果 Runner package 在该路径）
- `packages/**`
- `database/**`
- 根目录 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`
- 后端构建/发布脚本和 workflow 文件本身
- 与 API/Runner 运行时相关的部署文档或 Docker/systemd 模板（按项目实际路径选择）

推荐事件：

- `push` 到 `main`：先跑 CI；只有 CI 成功后才允许部署。
- `workflow_dispatch`：允许有权限的维护者手动选择并运行发布。
- 不应在 Pull Request 验证任务中使用生产 SSH secrets。
- 不应在 fork PR 中部署生产。
- 若 workflow 采用 `paths` 过滤，确保 workflow 自身文件变更也能触发检查。

### 4.5 Workflow 必须执行的构建检查

CI 至少执行以下步骤，按仓库脚本实际可运行性调整：

```bash
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm run db:generate
pnpm -r --filter "./packages/**" build
pnpm --filter @b2b/api run typecheck
pnpm --filter @b2b/api run test
pnpm --filter @b2b/api run build
```

若要执行全仓库测试，应在独立 CI 阶段运行 `pnpm run lint`、`pnpm run typecheck`、`pnpm run test`。如果某条现有脚本需要真实数据库或外部服务，必须使用独立测试服务/测试数据库；不要将生产数据库 URL 注入普通 PR 测试任务。

**发布包必须经过实测验证。** 本文不假设单独打包 `apps/api/dist` 就足够：本仓库 API 依赖 `@b2b/contracts`、`@b2b/database`、`@b2b/i18n`、`@b2b/validation` 等 workspace 包，并使用 Prisma。必须验证新服务器 release 在不依赖 Actions runner 文件系统的情况下能独立启动。

### 4.6 数据库迁移控制

默认不要让 API 自动部署每次都执行迁移。推荐在 workflow 中使用单独的受保护环境（例如 GitHub Environment `production`）与人工审批：

1. 先确认本次 commit 的 migration diff。
2. 创建并验证数据库备份/恢复点。
3. 运行只适用于生产的迁移命令：`pnpm run db:deploy`（仅在 workflow 已正确提供迁移连接变量并且确认该命令与当前 Prisma schema/配置一致后执行）。
4. 检查迁移状态。
5. 再部署应用包。

数据库迁移遵循 expand → backfill → verify → switch → contract。应用回滚不代表数据库可以回滚；迁移不兼容旧应用时，不要自动切回旧版本。禁止生产执行 `prisma migrate dev`、无审查的 `db push` 或完整 `db:seed`。允许的自动同步仅限 API 启动时的 `--reference-only` reference data，且失败必须阻断启动。

### 4.7 SSH 发布与服务器端切换

在真正启用 workflow 前，必须确认仓库中已有可用的部署入口脚本；若不存在，应先实现并测试服务器端部署脚本，再启用自动部署。部署脚本至少要实现：

1. 参数校验：只接受合法 commit SHA/发布包名，禁止路径穿越。
2. 完整性校验：验证文件存在、大小非零、SHA256 一致。
3. 空间检查：可用空间低于安全阈值时拒绝部署；不删除 `shared`、日志、数据库或对象存储数据。
4. 创建独立 release 目录，不覆盖当前版本。
5. 以受限权限解压，不允许归档路径逃逸。
6. 设置/校验运行时变量，不能将密钥写入发布包。
7. 原子切换 `current` 符号链接或等价版本指针。
8. 重启 API（以及需要同步发布的 Runner），等待 live/ready 健康检查。
9. 若失败，恢复原版本指针并重启旧服务，保留本次错误日志。
10. 成功后清理本次上传包和过期历史版本，始终保留当前版本与最近两个有效版本。

示例健康检查：

```bash
curl --fail --silent --show-error https://api.wuxuanglobal.com/api/v1/health/live
curl --fail --silent --show-error https://api.wuxuanglobal.com/api/v1/health/ready
```

ready 端点的 HTTP 200 不一定代表所有依赖健康；部署脚本应解析实际响应体中的状态，不能只依赖 curl 的退出码。

### 4.8 API 发布后验收

- 检查 GitHub Actions workflow run 对应的 commit SHA、CI job 和 deploy job。
- 在服务器检查 systemd 状态和最新日志。
- 验证 live/ready，确认数据库连接成功。
- 验证后台登录、Cookie/CSRF/RBAC、前台公开 API 和 WhatsApp 询盘提交。
- 验证 R2 上传、确认上传、图片处理、物理删除任务及私有文件授权下载。
- 验证报价 Excel 任务可创建、完成、下载且权限正确。
- 查看任务队列积压、失败任务、RSS、磁盘、API 5xx/P95。
- 记录版本 SHA、迁移编号、验收结果和回滚版本。

---

## 5. 三条发布流水线的推荐关系

```text
开发者提交代码
       |
       v
GitHub main
       |
       +---- Cloudflare Workers Builds ----> b2b-storefront
       |                                  \\-> www.wuxuanglobal.com
       |
       +---- Cloudflare Workers Builds ----> b2b-admin
       |                                  \\-> admin.wuxuanglobal.com
       |
       +---- GitHub Actions CI
                    |
                    +-- 后端路径有变化且 CI 通过
                    |
                    +-- production Environment 审批（若启用）
                    |
                    +-- 构建版本化 API/Runner 发布包
                    |
                    +-- SSH 上传 + 服务器端原子切换
                    |
                    +-- health check / rollback
                                       |
                                       v
                              api.wuxuanglobal.com
```

前端 Worker 发布与后端服务器发布是独立目标。若一个 commit 同时修改前后端，三条流水线可能并行执行；若某次 API 变更要求先迁移数据库或先发布后端，使用兼容性设计、受保护环境或手动发布顺序控制，不要依赖流水线偶然的执行先后。

## 6. 首次启用的分阶段清单

### 阶段 A：前后台自动部署

- [ ] 两个 Worker 都连接正确仓库和 `main`。
- [ ] 两者 Root directory 都是仓库根目录。
- [ ] Node/pnpm 版本与仓库一致。
- [ ] Storefront/Admin 各自 Build command 和 Deploy command 正确。
- [ ] 构建时 API 代理变量已设置。
- [ ] 两个 OpenNext cache bucket 已创建并正确绑定。
- [ ] 域名分别绑定到正确 Worker。
- [ ] 本地两个 Worker build 均通过。
- [ ] 通过一个真实、经过审查的提交触发首次生产部署。
- [ ] 两个 Worker 的日志、域名、登录/页面与 API 代理验收通过。

### 阶段 B：后端 CI

- [ ] GitHub Actions workflow 已审查，PR 不会使用生产 secrets。
- [ ] Node/pnpm 版本固定，依赖安装使用 frozen lockfile。
- [ ] 测试数据库与生产数据库隔离。
- [ ] typecheck/test/build 成功。
- [ ] API/Runner 发布包能在干净 Linux 环境独立启动。
- [ ] 发布包不包含 `.env`、密钥、缓存和开发依赖中不必要的文件。

### 阶段 C：后端自动部署

- [ ] VPS 部署用户、目录、systemd、SSH key 和 host key 已配置。
- [ ] GitHub Actions production secrets/environment 已设置。
- [ ] 服务器端部署脚本支持完整性检查、原子切换、health check 和回滚。
- [ ] 数据库迁移使用独立受控步骤，不会无审批地自动执行破坏性迁移。
- [ ] 在维护窗口先手动发布一次并验证回滚。
- [ ] 再启用 push-to-main 自动部署。
- [ ] 首次自动部署后完成业务烟雾测试和日志检查。

## 7. 故障排查

| 现象 | 首先检查 |
|---|---|
| 推送 main 后 Worker 没有构建 | Cloudflare Worker 的 Git integration、生产分支、Builds 设置、最近构建记录；确认提交进入了 `main` |
| Worker build 找不到 workspace package | Root directory 是否误设为子目录；安装命令是否在仓库根目录执行 |
| OpenNext 报 R2 binding 缺失 | Wrangler 配置中的 bucket 名称、账户、绑定和 bucket 是否实际存在 |
| Worker 部署成功但页面 5xx | Worker Logs、Node compatibility、OpenNext runtime、环境变量和 server-side API proxy target |
| Admin 登录后循环跳转 | Cookie/SameSite/Secure、多个 Set-Cookie 头、代理头、CSRF、API origin 与系统时间 |
| API ready 不健康 | systemd 日志、生产 env、Neon/PG 连接、迁移状态；HTTP 200 不能单独作为健康判断 |
| Actions SSH 失败 | Secret 名称、部署用户权限、SSH key 格式、host key 是否可信、服务器 SSH/防火墙 |
| 发布包在服务器无法启动 | 是否包含 workspace 包、Prisma Client/engine、生产依赖；Node 版本/架构是否一致 |
| 部署失败但旧版也无法恢复 | current 指针、旧 release 是否完整、数据库迁移是否向前兼容；保留日志，禁止清空 releases/shared |
| 磁盘空间不足 | `df -h`、`du -sh /opt/b2b-inquiry-platform/releases /opt/b2b-inquiry-platform/incoming`；仅清理经过确认的过期发布文件 |

## 8. 回滚原则

- **Cloudflare 前后台**：在 Worker 部署历史中选择上一个已验证版本回滚；回滚后再次验证域名、登录、API 代理和缓存。
- **API/Runner**：切回上一个完整 release 并重启对应 systemd 服务，验证 live/ready 与关键业务。
- **数据库**：不要把应用回滚等同于数据库回滚。优先前向修复；只有经过演练的恢复计划才可恢复数据。
- **R2**：不要通过清理对象或 cache bucket 来回滚业务数据。公开缓存与 OpenNext 增量缓存是不同资源。
- 回滚记录必须包括触发 commit、失败步骤、恢复版本、数据库迁移状态和后续修复计划。

## 9. 官方参考

- Cloudflare OpenNext：<https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/>
- Cloudflare Workers Builds 配置：<https://developers.cloudflare.com/workers/ci-cd/builds/configuration/>
- Cloudflare R2 Workers binding：<https://developers.cloudflare.com/r2/get-started/workers-api/>
- GitHub Actions：<https://docs.github.com/actions>
- GitHub Actions secrets：<https://docs.github.com/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions>

---

## 10. 生产发布记录模板

每次生产发布填写：

- 发布日期/时间：
- 发布人：
- Git commit SHA：
- Storefront Worker 版本：
- Admin Worker 版本：
- API/Runner release：
- 数据库迁移编号（无则写无）：
- CI 与构建结果：
- 健康检查结果：
- 业务烟雾测试：
- 风险与异常：
- 回滚版本/是否回滚：
- 后续行动：
