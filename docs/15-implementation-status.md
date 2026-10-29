# 15. 实现状态与运行指南

> 版本：0.1.0（首个可运行版本）
> 范围：按 `docs/01`~`docs/14` 基线实现目录、商品、WhatsApp 询盘、后台管理、单据与访问分析。

## 1. 已完成

| 领域 | 交付内容 | 位置 |
|---|---|---|
| 数据模型 | 43 张表、枚举、唯一约束与索引；初始迁移已在本机 PostgreSQL 16 上验证通过 | `database/prisma/schema.prisma`、`database/prisma/migrations/20261014100500_init_catalog_inquiry_platform` |
| 参考数据 | 权限码、角色、菜单、字典、全局设置、内容页、FAQ、标签（幂等） | `database/prisma/seed.ts`（`--demo` 生成演示目录） |
| 初始管理员 | 受控 bootstrap，命令内生成随机密码，首次登录强制改密，禁止自助注册 | `database/scripts/bootstrap-admin.ts` |
| API | NestJS + Prisma，公共/管理端点分离，RBAC 守卫默认拒绝 | `apps/api/src` |
| 价格隔离 | 公共 DTO 显式白名单（`PUBLIC_PRODUCT_SELECT`），类型层与测试层双重校验 | `apps/api/src/modules/products/public-catalog.service.ts` |
| 询盘 | `POST /public/inquiry-intents` 仅记录意向，SKU 校验 + 批量上限 + 限流 | `apps/api/src/modules/inquiry` |
| 客户去重 | E.164 规范化、国家码缺失需人工选择、唯一约束兜底、并发冲突转接待记录 | `apps/api/src/modules/leads` |
| 访问分析 | 匿名会话哈希、国家聚合、实时（心跳窗口）、原始事件保留期清理任务 | `apps/api/src/modules/analytics`、`apps/worker/src/jobs/analytics-rollup.ts` |
| 单据 | 报价模板版本化、商品报价/PI Excel 异步导出、两步删除（记录+对象存储）、PI 服务端 Decimal 重算与修订版本 | `apps/api/src/modules/{quote,pi}`、`apps/worker/src/jobs` |
| 前台 | 英文目录站：首页、目录/搜索/分类树/分页、详情、批量询盘清单、About/Contact/FAQ、sitemap/robots | `apps/storefront` |
| 后台 | 中英双语：登录、总览、商品、品类、标签、广告、内容、WhatsApp 客户、访问分析、单据、用户/角色/菜单/字典/设置/审计 | `apps/admin` |
| 设计系统 | 单一 Token 源 + 组件库 + 响应式/无障碍基线 | `packages/ui` |
| 测试 | WhatsApp 消息与号码、货币精度/舍入、PI 重算、公共投影白名单、前台价格泄漏源码扫描 | `*.spec.ts` |

## 2. 尚未完成（下一阶段）

> UI 重设计（`docs/16`）的落地情况见第 6 节。

1. **端到端/E2E 测试**：Playwright 主流程（登录 → 维护商品 → 前台选品 → WhatsApp 跳转）尚未编写。
2. **文件库 UI**：上传与文件资产管理 API 已实现（`/admin/files/*`），后台暂未提供独立管理页面；商品/广告表单通过 file asset id 关联。
3. **S3 驱动**：`S3StorageDriver` 已实现 SigV4 签名逻辑，但未在真实 S3/MinIO 上验证。
4. **GeoIP**：需要自行放置 `GeoLite2-Country.mmdb`；未放置时国家一律记为未知（合法分类）。
5. **缓存失效**：前台采用 ISR（`revalidate` 60~300s），尚未接入按 tag 的主动失效。
6. **CI**：`lint / typecheck / test / build` 已可本地执行，尚未配置流水线文件与迁移校验作业。

## 3. 本地运行

```bash
pnpm install
docker compose -f infra/docker-compose.dev.yml up -d postgres
cp .env.example .env      # 修改 DATABASE_URL / SESSION_SECRET / WHATSAPP_BUSINESS_NUMBER

pnpm db:seed -- --demo            # 演示目录数据（明确标注 demo）
BOOTSTRAP_ADMIN_USERNAME=admin pnpm bootstrap:admin

pnpm dev                          # 读取仓库 .env、生成 Client、应用迁移、构建 packages，再并行启动四个应用
pnpm build                        # 生产构建；不会自动应用数据库迁移
pnpm --filter @b2b/api start      # http://localhost:3002
pnpm --filter @b2b/worker start
pnpm --filter @b2b/storefront start   # http://localhost:3000
pnpm --filter @b2b/admin start        # http://localhost:3001
```

`pnpm dev` 在开发环境以仓库 `.env` 为准，避免终端残留的 Neon `DATABASE_URL` 覆盖本地配置。
它会先执行 `prisma migrate deploy`；如果 PostgreSQL 未启动，命令会在 API 启动前以 P1001
失败，而不是留下“Admin 已启动、API 未监听”的半启动状态。需要连接隔离测试库时，可显式
指定 `ENV_FILE=/absolute/path/to/test.env`。

## 4. 环境注意事项

- **Prisma 引擎下载**：当本机 Node 的信任链不包含镜像根证书时，需要
  `NODE_EXTRA_CA_CERTS=<导出的根证书链> PRISMA_ENGINES_MIRROR=<可达镜像> pnpm db:generate`。
  该设置只影响构建期下载，不写入代码仓库。
- **端口占用**：`docker compose` 的宿主端口可用 `POSTGRES_HOST_PORT` 覆盖，避免与本机
  已有 PostgreSQL 冲突（此时同步修改 `.env` 的 `DATABASE_URL`）。
- **任务运行**：后台任务写入 PostgreSQL；必须启动 `@b2b/worker` task runner 才会执行。

## 5. 验证记录（本机）

| 检查 | 命令 | 结果 |
|---|---|---|
| 依赖安装 | `pnpm install` | 695 包，lockfile 通过供应链策略校验 |
| 共享包构建 | `pnpm -r --filter "./packages/**" build` | 通过 |
| 类型检查 | `pnpm --filter @b2b/api typecheck` 等 | 通过 |
| 数据库迁移 | `pnpm db:deploy` | 43 张表创建成功 |
| 单元测试 | `pnpm --filter @b2b/contracts test`、`pnpm --filter @b2b/api test` | 13 项通过 |
| 应用构建 | API `nest build`、storefront/admin `next build` | 通过 |
| 价格泄漏（接口） | `GET /api/v1/public/products` | 响应中无 price/amount/cost 字段 |
| 未授权访问 | `GET /api/v1/admin/products`（无 Cookie） | `401 UNAUTHORIZED` |
| 询盘意图 | `POST /api/v1/public/inquiry-intents` | 返回 intentId 与仅含 SKU 的预填文案 |
| 健康检查 | `GET /api/v1/health/ready` | `database.ok=true` |

## 6. UI 重设计落地情况（`docs/16`）

### 6.1 已实现

**设计系统（P1）**

- `packages/ui/styles/tokens.css` 按 §3 重写：品牌色 `#0F766E`、语义色、`#F5F7FA` 页面底色、阴影、圆角 8/12/16、间距基线 4–48、控件高度 40/32/36 与 44 触控目标、断点 sm/md/lg/xl/2xl。
- 组件层补齐：`PageHeader`（面包屑 + H1 + 说明 + 操作区）、`Toolbar`（显式筛选工具栏）、`CopyButton`（含回退与 aria-live）、`IdCell`（长 ID 省略 + 复制）、`CategoryArt`（统一线性插画）、`icons`（22 个统一图标，替换原 emoji/▲ 写法）。
- `DataTable` 支持固定表头、行 hover、44–48 表头 / 52–56 行高、可点击行、省略号 + Tooltip；`Pagination` 显示 `1–20 / 共 126 条`；`EmptyState/ErrorState` 增加图标与操作区，错误态提供 requestId 复制。

**后台（P0+P1）**

- App Shell 重写：248px 侧栏（桌面可折叠为 72px 图标栏）、<1024px 改 Drawer、64px 顶部栏（面包屑 + 语言切换 + 用户菜单，含改密入口）、内容区 padding 桌面 28 / 平板 20 / 手机 16。
- 菜单按 `docs/16 §4.2` 重组为 6 个业务分组（工作台 / 商品目录 / 询盘与分析 / 报价与文件 / 内容管理 / 系统管理），支持分组折叠与当前项高亮；种子脚本会自动停用重组后遗留的旧菜单项。
- 所有列表页统一模板：面包屑（由可见菜单推导）、标题 + 说明、显式筛选工具栏（搜索/重置 + 已选条件 chips）、表格、分页范围、右侧 Drawer 编辑（窄屏全宽）。
- **审计日志专项**：关键词（requestId / 对象 ID / action）、操作者、事件类型、日期范围筛选；事件名称本地化展示并保留技术 code；长 ID 省略 + 复制；行内详情 Drawer 展示完整元数据（已脱敏）；空态提供清除筛选。
- 页面文案全部改为 i18n key（新增 `list.*`、`audit.*`、`columns.*`、`auditActions.*` 等），中英文同步维护。

**前台（P0+P1）**

- 容器调整为 `min(100% - 32px, 1280px)`；Header 72px、导航 + 搜索组合控件（桌面 240–340px，<1024px 收为图标 + 独立搜索面板）、询盘清单入口带数量徽标。
- 首页顺序按 §6.2：Hero（55/45 两栏、最小 320px、右侧真实商品图拼贴）→ 类目卡片 → 精选/新品/预售（无数据自动隐藏）→ Choose/Send/Quote 三步说明 → 询盘 CTA → Footer。
- 商品卡片按 §6.5 重构：1:1 图片、左上角标签、右上角多选框（选中态整卡描边）、2 行标题、SKU + 复制、2 行摘要、`View details` 与 `Ask via WhatsApp` 双动作。
- 产品网格 4/3/2/1 列（1279/767/360 断点）；目录页左侧 260px 分类树 + 筛选（含子类目缩进、标签筛选），<1024px 收进 Drawer。
- 详情页 2 栏（48/52），下方 Description / Specifications / Packaging & Carton 分区；主 CTA 为单品 WhatsApp 询盘，次 CTA 加入清单；手机端底部固定 CTA 并适配 `env(safe-area-inset-bottom)`。
- 批量询盘：勾选即出现底部固定栏（数量 / 查看清单 / 清空 / Ask via WhatsApp），内容区自动留出底部间距避免遮挡；WhatsApp 文案按 §6.7 改为编号 + SKU + 产品名 + Source 链接，全部 URL 编码，号码来自站点配置。
- 图片管线（§7）：演示环境的商品图为**明确命名的占位图**（`demo-*.png`，由 `apps/worker/src/tools/seed-demo-media.ts` 生成并走真实存储写入），缺图时使用统一线性插画 + `Image unavailable`，不再出现裸灰块。

### 6.2 顺带修复的真实缺陷

1. **存储根目录按 cwd 解析**：API 与 Worker 使用不同的相对 `STORAGE_LOCAL_ROOT`，导致入库的 key 指向其它目录、图片 404。现统一解析到仓库根目录（`storage-path.ts`）。
2. **公共文件路由缺对象时断开连接**：数据库有记录但对象缺失会直接 destroy 响应；现先探测对象存在性并返回标准 JSON 404。
3. **Worker 无法启动**：`S3_FORCE_PATH_STYLE` 缺少默认值导致环境校验必然失败。
4. **审计日志接口缺少筛选能力**：新增 `q` / `requestId` / 排序参数。

### 6.3 未完成 / 未验证

- **未做像素级截图验收**：本机无法在两次工具调用之间保持前后端进程存活，浏览器工具连接被拒绝，因此 §11 的 1440/1024/768/390/360 逐档视觉核对**未执行**；已核对的是 CSS 结构（流式容器、断点齐全、无固定页宽、safe-area、focus ring）。
- **Hero 与商品图仍是占位图**：本会话未提供 `imagegen` 内置工具（仅 CLI 回退，需要 `OPENAI_API_KEY`），因此没有生成 AI 商品照片；正式上线必须替换为客户自有产品图。
- 后台「商品目录」分组下未新增“目录总览”页（文档 §4.2 列出的条目），避免出现无对应路由的菜单。
- 商品/广告表单仍以 file asset ID 关联图片，未提供文件库上传界面；批量询盘未接入 `next/image` 优化。

## 7. 后台 Shell 丢失问题修复（`docs/16-dashboard-layout-sidebar-fix.md`）

### 7.1 根因

同一路径表现不一致的原因是 **Admin Shell 被条件性卸载，而不只是被隐藏**。`apps/admin/src/components/admin-shell.tsx` 原有实现：

```tsx
if (loading) return <div className="admin-content"><LoadingState/></div>;  // 无 Header / Sidebar / 菜单按钮
if (!user)   return <ToastProvider>{children}</ToastProvider>;             // 受保护页面在无 Shell 情况下渲染
```

1. 每次硬刷新或直接访问 `/[locale]/dashboard` 时 `/admin/auth/me` 处于请求中，`loading` 为真即把整套导航壳层替换成一个空白内容块——因此“有时消失”取决于接口响应速度。
2. `/me` 若以 401 以外的原因失败（5xx、超时、API 重启），`refresh()` 只清空 `user` 而不跳转，受保护页面会一直走 `!user` 分支：**永久无导航**，且因菜单按钮位于 Shell 内部而无法恢复。
3. `[locale]/layout.tsx` 把 Shell 挂在所有 `[locale]/*` 路由上（含 `/login`），迫使 Shell 用“无用户就裸渲染 children”的分支兜底，这正是泄漏受保护页面的路径。
4. 导航状态只有一个 `collapsed` 布尔值，且在 `useEffect` 中读 localStorage（首屏与服务端不一致），没有 `closed` 状态，平板断点下也没有恢复入口。

### 7.2 改动

| 层面 | 改动 |
|---|---|
| 路由 | 拆分为 `(auth)/login`（无导航）与 `(admin)` 路由组；Shell 只在 `app/[locale]/(admin)/layout.tsx` 挂载一次，19 个后台页面 URL 不变 |
| 会话 | `SessionProvider` 改为显式状态机 `loading / authenticated / unauthenticated / error`；瞬时失败保留当前会话并在 Shell 内提示，401 交给 Gate 跳转 |
| Shell | 无论加载、未登录、会话校验失败都渲染 Header + 菜单按钮 + 内容占位；未登录跳转 `/[locale]/login?returnTo=...`（仅接受站内相对路径） |
| 导航状态 | `expanded / rail / closed` 三态 + 移动端临时抽屉；`nextModeOnMenuToggle/nextModeOnRailToggle/resolveMode` 为纯函数（15 项单测） |
| 持久化 | 桌面偏好写入 cookie `admin_sidebar_mode`，服务端首屏即按偏好渲染（`auto` 由 CSS 解析为桌面 expanded、平板 rail），避免 hydration 不一致；移动抽屉状态不持久化 |
| 交互 | 菜单按钮常驻 Header；Escape / 遮罩点击 / 选中菜单关闭抽屉；关闭后焦点回到按钮；打开时锁定 body 滚动并在关闭时恢复 |
| Token | 单一层级表：`--z-header 30 / --z-overlay 40 / --z-admin-drawer 50`（与既有 20/60/70/80 并列）；Header 高度按规格改为 56px；新增 `--admin-page-padding` |
| 响应式 | 移动 <768 抽屉；平板 768–1279 默认 rail（72px，仅图标 + Tooltip/aria-label）；桌面 ≥1280 expanded/closed/rail |
| 修复 | `html { overflow-x: hidden }` + `.table-wrap { max-width: 100% }`，消除表格页在 360px 下 `documentElement.scrollWidth` 超过视口的问题 |

### 7.3 端到端验证（真实浏览器，非模拟）

在本机启动 API 与 `next start`，用 Codex 内置浏览器（Playwright 定位器 + 视口能力）执行：

| 步骤 | 结果 |
|---|---|
| `login → dashboard` | `POST /admin/auth/login 201` → `/me 200` → 看板数据接口 200；`/zh-CN/dashboard` 显示侧栏 + 面包屑 + 菜单按钮 |
| 桌面 1600×900 | `data-sidebar=auto`、侧栏 248px、标签可见、内容左偏移 248px、rail 控件可见、18 个菜单项、当前项高亮 |
| 隐藏导航 | `mode=closed`、侧栏 `display:none`、内容宽度 1600px（无 248px 空白）、**菜单按钮仍可见**且 `aria-label=打开导航` |
| 恢复导航 | 再次点击回到 `expanded`（248px）；状态切换即时生效 |
| 跳转其他管理页 | 点击侧栏“商品管理” → `/zh-CN/products`，面包屑“商品目录 / 商品管理”，当前项高亮，表格与分页正常 |
| 刷新 | `/zh-CN/products` 刷新后 Shell 完整（服务端已按 cookie 渲染 `data-sidebar=expanded`） |
| 直接访问 | 深链 `/zh-CN/audit-logs` 直接打开，Shell 完整、当前项高亮、审计表格 20 行 |
| 未登录深链 | 跳转 `/zh-CN/login?returnTo=%2Fzh-CN%2Faudit-logs`（无 Shell，符合登录页独立约定） |
| `returnTo` 回跳 | 登录后直接落到 `/zh-CN/audit-logs`，Shell 完整 |
| 移动 390×844 | 抽屉默认关闭（`translateX(-288px)`）；点击按钮后抽屉滑入、遮罩显示、`body.overflow=hidden`、`aria-expanded=true`；Escape 关闭并**焦点回到菜单按钮**、滚动恢复；点遮罩关闭；点菜单项跳转后自动关闭 |
| 平板 1024×768 | rail 模式：侧栏 72px、标签隐藏、`title`/`aria-label` 保留、菜单按钮可见 |
| 360×800 | 三个页面均无用户可见的整页横向滚动，`html/body overflow-x: hidden`，超宽元素全部位于带裁剪的滚动容器内，菜单按钮可见 |

质量门禁：`pnpm lint`、`pnpm -r typecheck`（9 个包）、`pnpm -r test`（29 项：contracts 6 + api 8 + admin 15）、`pnpm build`（API、Worker、两个 Next 应用）全部通过。

### 7.4 验证过程说明与遗留风险

- 验证使用临时账号 `e2e_check`（super_admin 角色），完成后已删除；其创建/删除留有审计记录 `maintenance.e2e_account_*`。
- 为让登录步骤可验证，曾临时把 `admin` 账号的 `mustChangePassword` 置为 false，验证后已还原为 true 并将 `failedLoginCount`/`lockedUntil` 复位。**未修改 admin 账号密码**；该账号仍要求下次登录改密。
- 未执行项：`docs/16` §10.3 建议的 Playwright 视口截图基线（无基准图可比）与 CI 中的自动化 E2E 流水线；本次为人工驱动的真实浏览器验证。
- 已知风险：桌面偏好依赖 cookie，若浏览器禁用 cookie 则回退到 localStorage，二者都不可用时仅当次会话内生效（不影响可用性，仅不记住偏好）。

## 8. 用户管理编辑能力与角色选择器（`docs/17`）

### 8.1 复用的现有实现（未新建平行模块）

`GET/POST /admin/users`、`PATCH /admin/users/:id`、`POST /admin/users/:id/reset-password`、`GET /admin/roles` 与 `user.*` / `role.read` 权限码均已存在，本次在其上扩展，未新增重复模块，也**未新增数据库表或迁移**（`AdminUser` / `Role` / `UserRole` 已满足需求）。

### 8.2 后端

| 项 | 内容 |
|---|---|
| 角色契约 | `create`/`update` 改为 `roleIds: string[]`（不再接受 `roleCodes` 或逗号分隔字符串）；创建至少一个角色；重复 id 去重 |
| 可分配角色 API | 新增 `GET /admin/roles/assignable`（`role.read`），返回全部角色 + `assignable` 标志（由操作者角色推导）；不可分配的角色**保留可见并标记**，不会静默从表单消失 |
| 服务端校验 | `user-role-policy.ts` 纯策略：角色存在性、可分配性、特权角色（`super_admin`）仅超级管理员可授予 → `ROLE_NOT_FOUND`(400) / `ROLE_NOT_ASSIGNABLE`(403) |
| 事务 | `update` / `setStatus` / `remove` 使用 **Serializable** 事务，事务内校验“最后一个有效超级管理员”（ACTIVE 且持有该角色），冲突 P2034 重试一次后返回 `USER_MODIFIED` |
| 并发保护 | `PATCH /admin/users/:id` 支持 `expectedUpdatedAt`，不匹配返回 `USER_MODIFIED`(409) |
| 状态独立 | 新增 `PATCH /admin/users/:id/status`，状态不再混入通用编辑 DTO；停用会吊销该用户全部会话 |
| 审计 | 事务内写入 `user.create` / `user.update` / `user.roles_changed`（记录 before/after 角色 code）/ `user.status_changed` / `user.password_reset`；审计写入失败回滚整个变更；不记录密码或哈希 |
| 权限即时生效 | 会话守卫每个请求都从数据库加载角色与权限，因此角色变更在目标用户的下一个请求即刻生效，无需缓存失效（并已实测） |

### 8.3 前端

| 项 | 内容 |
|---|---|
| 统一表单 | `components/user-form-dialog.tsx` 同时服务新建/编辑（`mode` 控制标题与提交接口）；编辑时登录账号只读，显示姓名与角色可改 |
| 角色选择器 | `packages/ui` 新增可复用 `MultiSelect`（搜索、多选 Tag、键盘上下/Enter/Escape/Backspace、`role=combobox`+`listbox` 语义）；`users` 页面用它提交 `roleIds`，**不存在角色自由文本输入或逗号解析** |
| 加载/失败/空态 | 角色选项 loading / error+重试 / 空列表禁用提交 / 无权限提示，四种状态齐全，失败时**不回退为文本框** |
| 列表 | 新增编辑入口；角色显示本地化名称 Tag（超过 2 个显示 `+N`）；状态为带文字的状态标记；筛选支持关键词、状态、角色（角色下拉由 API 驱动），服务端分页与稳定排序 |
| 其它操作 | 重置密码、停用/启用保持独立入口并二次确认；一次性临时密码带复制按钮且仅显示一次 |
| 未保存提醒 | 表单有改动时关闭弹窗会提示放弃更改 |
| 文案 | 新增 `users.*`、`role.*`（角色显示名）与 `user.roles_changed` / `user.status_changed` 审计标签，中英同步 |

### 8.4 顺带修复的真实缺陷（E2E 发现）

1. **强制改密的账号被权限守卫拦死**：`PermissionsGuard` 默认拒绝且 `change-password` 等自助接口未声明权限，导致非超级管理员（含新建的销售人员）登录后连改密接口都返回 403，账号完全不可用。现抽出 `common/auth-paths.ts` 的 `SELF_SERVICE_PATHS`，会话守卫与权限守卫共用同一清单。
2. **侧栏出现空分组**：`permissionCode` 为空的分组（系统管理）在子项全部被权限过滤后仍渲染为空标题；现按“有路由或至少一个可见子项”裁剪。
3. **`AdminApiError` 丢失字段级错误**：前端无法把服务端 `details` 映射到表单项，现补齐 `details` 透传。

### 8.5 端到端验证（真实浏览器 + 真实 API）

按 `docs/17 §10.3` 执行，使用一次性验证账号（完成后删除）：

| 步骤 | 实测结果 |
|---|---|
| 登录后台 → 用户管理 | 列表正常，角色列显示“超级管理员”等本地化名称（不再是机器码） |
| 新建销售用户 | 弹窗内角色为 API 驱动的多选：搜索“销售”命中“销售人员 / sales”，选中后生成可移除 Tag；提交后弹窗关闭、Toast 成功、列表立即出现 `sales01 … 销售人员` |
| 一次性临时密码 | 响应仅返回一次并在页面提示条展示（含复制按钮），可由管理员安全转交 |
| 编辑姓名 | 打开编辑弹窗：登录账号字段为**只读**、显示姓名与角色已回填；改名为 `Alex Chen` 保存后列表即时更新（无需手动刷新） |
| 修改角色 | 增加“只读访客”后列表显示 `销售人员 只读访客` |
| 刷新页面 | 名称与两个角色均保持（`sales01 Alex Chen 启用 销售人员 只读访客`） |
| 以该用户登录 | 首次登录被要求改密（符合设计），改密后 `/me` 返回 `roles: [sales, viewer]`、15 项权限 |
| 权限即时生效 | 该用户会话中 `/admin/users` → **403 FORBIDDEN**、`/admin/roles` → 403；而 `/admin/categories/tree`、`/admin/inquiry-activities` → 200 |
| 侧栏按权限裁剪 | 该用户看到 工作台 / 商品目录 / 询盘与分析 / 报价与文件(仅 PI) / 内容管理（viewer 带来的广告与内容页面），系统管理分组不再出现空标题 |
| 越权授予特权角色 | 临时授予该用户 `user.update` + `user.role.assign` 后，`PATCH` 给自己加 `super_admin` → **403 ROLE_NOT_ASSIGNABLE** |
| 最后一名超级管理员保护 | 仅剩一名有效超级管理员时，移除其 `super_admin` → **409 LAST_SUPER_ADMIN_PROTECTED**，角色保持不变；停用同一账号 → 同样 409 |
| 乐观锁 | 使用过期 `expectedUpdatedAt` → **409 USER_MODIFIED** |
| 权限撤销即时生效 | 撤销临时权限后，**同一会话**再次发送相同请求 → **403 FORBIDDEN**（无需等待缓存过期） |

自动化：`user-role-policy.spec.ts`（8 项：去重/缺失/可分配性/特权角色/最后管理员/签名）与 `user-form.spec.ts`（10 项：校验、回填、脏检查、选项禁用标记、字段错误映射）。

### 8.6 交付说明与风险

- 质量门禁：`pnpm lint`、`pnpm -r typecheck`（9 包）、`pnpm -r test`（**51 项**）、`pnpm build` 全部通过；**无需数据库迁移**（仅新增权限码与种子权限，已通过重跑 seed 生效）。
- 权限模型：沿用现有粗粒度权限码（`user.update` / `role.read`），按 `docs/17 §7` 允许的方式，把“字段级变更限制”和“特权角色仅超级管理员可授予”落实到服务端；若后续需要独立 `user.role.assign` 之外的细分权限，可在此边界上继续拆分。
- 验证副作用（已还原）：为验证“特权角色”与“最后一名超级管理员”规则，曾临时给 `sales` 角色增加两项权限并用一次性账号发送请求，随后**重跑 seed 已撤销**；验证期间一次测试意外移除了 `admin` 账号的超级管理员角色，已立即通过 SQL 恢复为 `super_admin`（审计表保留了当时的真实变更记录 `user.roles_changed`）。
- 未执行项：`docs/17 §10.1` 的前端组件级测试（FE-01…FE-12）未逐条写自动化用例，其中 FE-01/02/03/06/07/10/11 由本次真实浏览器 E2E 覆盖，FE-04/05、FE-09、FE-12 仅做了代码层面保证与人工检查；`docs/17 §10.2` 的 BE-09 并发冲突仅通过 Serializable + P2034 重试逻辑与 `expectedUpdatedAt` 的 409 结果覆盖，未做双管理员并发压测。

## 9. 弹窗输入框无法连续输入的修复（用户反馈 bug）

### 9.1 根因

`packages/ui/src/components/Modal.tsx` 的焦点管理 effect 依赖 `[open, onClose]`，而调用方（`UserFormDialog`、`ResourcePage` 等）普遍传入**每次渲染都会新建**的 `onClose`：

```tsx
useEffect(() => { /* 记录 previouslyFocused → 聚焦弹窗内第一个可聚焦元素 */ }, [open, onClose]);
```

于是每敲一个键 → 表单 `setState` → 父组件重渲染 → `onClose` 引用变化 → effect 先 cleanup（把焦点还给打开弹窗的按钮）再重新执行（聚焦弹窗内**第一个可聚焦元素**，即头部的 `×` 关闭按钮）。表现就是"输入一个字符后焦点跳到关闭按钮"，无法连续输入。

实测（修复前，逐字符输入 `sales02`）：

| 按键 | 焦点 |
|---|---|
| s / a / l / e / s / 0 / 2 | 每次都变成 `BUTTON aria-label="关闭"` |

`Drawer` 存在同类问题（effect 依赖 `[open, onClose]`），每次按键会清空并重设 `body` 滚动锁、重复注册键盘监听。

### 9.2 修复

- `Modal`：焦点捕获 effect 改为只依赖 `[open]`，`onClose` 通过 ref 读取；**仅当焦点不在弹窗内时**才主动聚焦，且优先聚焦第一个表单控件（`input/select/textarea`）而非头部关闭按钮；容器加 `tabIndex={-1}` 作为兜底焦点；关闭时只在触发元素仍存在于文档时才归还焦点，并恢复进入前的 `body` 滚动锁值。键盘监听同样只依赖 `[open]`，焦点陷阱逻辑不变。
- `Drawer`：同样的依赖与滚动锁处理（`onClose` 走 ref，保存并恢复进入前的 `overflow`）。
- 修复位于组件层，因此**所有**使用弹窗/抽屉的表单（用户管理、商品管理、品类、字典、广告、PI 等）一并受益，调用方无需再记忆化回调。

### 9.3 验证（真实浏览器）

| 检查 | 修复前 | 修复后 |
|---|---|---|
| 打开弹窗后的初始焦点 | `×` 关闭按钮 | 第一个输入框「登录账号」 |
| 逐字符输入 `sales02` | 每键后焦点跳到 `×`（值仅因自动化逐键聚焦才累积） | 焦点始终在输入框，值 `s→sa→…→sales02` |
| 连续输入带空格的文本 `Alex Chen` | 同样被抢焦点 | 完整输入，焦点保持 |
| 仅用键盘完成创建 | —— | 角色多选输入「销售」→ Enter 选中 → 提交成功，列表出现 `sales02 Alex Chen 启用 销售人员`，一次性临时密码正常展示 |
| 编辑弹窗 | —— | 账号字段只读、姓名可连续输入 |
| 其它调用方（商品管理抽屉表单） | 每键重置滚动锁 | 连续输入 `DEMO-9001`，焦点保持 |
| 焦点陷阱 | —— | 末位 Tab 回卷到首位、首位 Shift+Tab 回卷到末位，焦点不逃出弹窗 |
| Escape / 关闭 | —— | 表单有改动时弹出「放弃未保存的修改？」确认；关闭后 `body` 滚动锁恢复 |

质量门禁：`pnpm lint`、`pnpm -r typecheck`（9 包）、`pnpm -r test`（51 项）、`pnpm build` 全部通过。验证使用的一次性账号（`e2e_admin`、`sales02`）与临时脚本均已删除，`admin` 账号状态未受影响（`ACTIVE`、`super_admin`、`mustChangePassword=false`）。

### 9.4 遗留

- `Drawer` 仍没有初始焦点捕获与焦点陷阱（本次只修了它重复执行 effect 的问题）。使用 `Drawer` 的表单（如 ResourcePage 的编辑抽屉）键盘 Tab 可以走出抽屉；若需要与 `Modal` 一致的模态语义，建议后续把抽屉也接入同一套焦点管理。
- 未新增 DOM 测试环境依赖，因此该 bug 没有自动化回归用例；本次以真实浏览器逐键验证作为证据，后续如引入 jsdom/happy-dom 可补组件级回归。

## 10. 角色权限 CRUD 与菜单权限配置（`docs/18`）

### 10.1 实施前审查（先定位缺口，不新建平行模块）

复用现有模块：`apps/api/src/modules/rbac/`（Controller/Service/Module）、`SessionAuthGuard` + `PermissionsGuard`（deny-by-default）、`AuditService`/审计表、`MenusService`、`packages/ui` 的 `Modal`/`Drawer`/`DataTable`/`Toolbar`/`Pagination`/`Field`/`Input`。

改造前已有端点：`GET /admin/roles`（**扁平、无分页/筛选**）、`GET /admin/permissions`（扁平码列表）、`GET /admin/roles/assignable`、`POST /admin/roles`、`PATCH /admin/roles/:id`（把权限内联替换、无审计差异）、`DELETE /admin/roles/:id`。缺口：无列表分页/筛选、无角色详情、无权限树、无当前授权读取、无角色关联用户、无并发保护、无错误码细分、前端页面只读。

只读数据盘点（`GET` 级脚本，运行后已删除）：

| 检查项 | 结果 |
|---|---|
| `Menu.permissionCode` → `Permission.code` 映射 | 21 个非空映射全部 `ok`；仅 `administration`/`system` 两个分组为 `null` |
| 菜单表 | 27 行，其中 `enabled=true` 24 行（`documents`/`leads`/`system` 等旧结构已停用） |
| 权限字典 | 改造前 52 条，改造后 54 条（新增 `role.permissions.read` / `role.permissions.update`） |
| 未被任何菜单引用的权限模块 | `file`、`job`、`lead` → 权限树中作为「模块分组」节点呈现，不会丢失 |
| 内置角色 | `super_admin`（系统，54 权限，1 用户）、`catalog_manager`（28）、`sales`（11）、`viewer`（8，1 用户） |
| 角色名称显示 | **真实缺陷**：`Role.nameKey`（`role.sales`）被直接渲染 → 用户看到 `role.sales` |
| 权限缓存 | **无缓存**：`SessionAuthGuard` 每次请求都从数据库读取 roles→permissions，因此权限变更在下一个请求即生效，无需失效动作 |

### 10.2 顺带修复的真实缺陷（E2E 前置发现）

1. **`database/prisma/schema.prisma` 被早期草稿覆盖**：该文件缺少 `AdminUser.failedLoginCount`、`lockedUntil`、`PurgeState`、`InquiryIntent`、`OutboxEvent`、`PdfConversionJob` 等模型/字段，与 `prisma/migrations/` 及 API 代码不一致（`prisma generate` 会产出缺少字段的客户端）。已用仓库内 `database/generated/client/schema.prisma`（上一次成功生成时的完整副本，含显式 `output = "../generated/client"`）恢复，并重新 `prisma validate` + `db:generate`；被覆盖的旧草稿另存于 `/private/tmp/schema-draft-backup.prisma` 供核对。**如果该草稿来自你有意保留的版本，请告知，我把差异合并回来。**
2. 角色名称显示 `role.sales`：新增 `RoleTranslation` 名称解析链 `names[locale] → i18n(nameKey) → names['en-US'] → code`，`nameKey` 不再被当作显示文案。

### 10.3 数据库变更

新增 `RoleTranslation(roleId, locale, name, description?)`（联合主键，`onDelete: Cascade`）与 `Role.translations` 关系。

- 迁移：`database/prisma/migrations/20261015120000_add_role_translations/`，已通过 `pnpm db:deploy` 应用（2 个迁移全部应用）。
- 回填：无需回填；内置角色继续走 `nameKey` + i18n 字典，只有后台新建的自定义角色写入该表。
- 回滚：`DROP TABLE "role_translations";`（仅丢失自定义角色的显示名，不影响任何授权判断，授权事实来源仍是 `Permission.code` + `RolePermission`）。
- **未新增** `RoleMenu`、`isActive` 等字段。

### 10.4 后端

新增权限码：`role.permissions.read`、`role.permissions.update`（与 `role.read/create/update/delete` 分离，读写授权分离）；`seed.ts` 已同步，`super_admin` 通过 `permissions: 'all'` 自动获得（现 54 条）。

新增错误码与文案（zh-CN/en-US）：`ROLE_SYSTEM_PROTECTED`(409)、`ROLE_IN_USE`(409)、`PERMISSION_CODE_INVALID`(400)、`PERMISSION_ASSIGNMENT_FORBIDDEN`(403)、`CONCURRENT_ROLE_UPDATE`(409)。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/roles` | `role.read` | 分页 + `keyword`（code/名称/描述）+ `type=all\|system\|custom`，`pageSize` 上限 100 |
| GET | `/admin/roles/:id` | `role.read` | 角色详情 |
| POST | `/admin/roles` | `role.create` | 仅创建自定义角色，`isSystem=false` 由服务端写死，新角色零权限 |
| PATCH | `/admin/roles/:id` | `role.update` | 仅名称/描述；支持 `expectedUpdatedAt` 乐观并发 |
| GET | `/admin/roles/:id/permissions` | `role.permissions.read` | 当前授权 code 列表（排序去重） |
| PUT | `/admin/roles/:id/permissions` | `role.permissions.update` | 事务内**整体替换**，返回规范化结果 |
| GET | `/admin/permissions/tree` | `role.permissions.read` | 菜单/模块权限树 |
| GET | `/admin/roles/:id/users` | `role.read` | 关联用户（删除影响说明） |
| DELETE | `/admin/roles/:id` | `role.delete` | 二次校验系统角色与在用状态 |

权限树由 `permission-tree.ts`（纯函数）从真实 `Menu` + `Permission` 行构建：菜单节点携带自身 `permissionCode` 作为「菜单访问」权限；某模块的「操作权限」只挂在**引用该模块的最深菜单叶**上（避免同一权限在多处出现）；没有任何菜单引用的模块（`file`/`job`/`lead`）追加为模块分组。`depth`/`order` 等布局字段在序列化时剥离。

授权与保护规则（`role-permission-policy.ts`，纯函数 + 单测）：

- 系统角色（`isSystem=true` 或 `code=super_admin`）不可编辑基本信息、不可改权限、不可删除 → 409 `ROLE_SYSTEM_PROTECTED`。
- 删除前在**事务内**重查关联用户数，`>0` → 409 `ROLE_IN_USE`（携带 `userCount`），不信任前端计数。
- 提交的 permission code 必须在字典中存在，否则整体 400 `PERMISSION_CODE_INVALID`（**不静默忽略、不部分保存**）。
- 非超级管理员只能授予**自己已持有**的权限（按「新增的 code」判定，已存在的授权可原样保存）→ 403 `PERMISSION_ASSIGNMENT_FORBIDDEN`。
- 并发：`PATCH`/`PUT` 支持 `expectedUpdatedAt`，不匹配 → 409 `CONCURRENT_ROLE_UPDATE`；写入使用 Serializable 事务，序列化冲突重试一次后报同一错误码。
- 事务与审计：角色创建/信息更新/权限变更/删除全部在事务内写审计（审计写入失败则整体回滚），动作 `role.create` / `role.update` / `role.permissions_changed` / `role.delete`，`role.permissions_changed` 记录 `added`/`removed`/前后数量，`role.delete` 保留 code/name/权限数快照。
- 权限缓存：**没有缓存需要失效**——`SessionAuthGuard` 每请求从数据库加载 roles→permissions，保存后对持有该角色的账号在下一个请求即生效。

### 10.5 前端

`apps/admin/src/app/[locale]/(admin)/roles/page.tsx` 重写为完整页面（不再使用只读 `ResourcePage`）：标题/说明、关键词 + 类型筛选（显式「搜索/重置」）、表格（编码/名称/类型/用户数/权限数/更新时间/操作）、分页（20/50/100）。

- 操作列按授权动态渲染：`查看权限`（无 `role.permissions.update` 或系统角色）/`配置权限`、`编辑信息`、`删除角色`；系统角色不渲染编辑与删除。
- 新建/编辑共用一个 `RoleFormDialog`（规则同账号/姓名一致：`role.create` / `role.update`）。编码创建后只读且不可修改；zh-CN/en-US 名称均必填；重复编码映射到字段级错误。
- `RolePermissionDrawer`：左侧菜单/模块树 + 复选框，含搜索（纯视图过滤，保留父级路径、绝不改动已选集合）、全部展开/折叠、清空选择、`已选择 N 项 / 共 M 项`、加载/错误重试、保存中禁用重复提交、保存失败保留勾选并显示可重试错误、未保存关闭需二次确认、保存后用服务端返回结果回校 UI 并刷新列表权限数。
- 权限树状态（`permission-tree-state.ts`，纯函数 + 单测）：唯一事实来源是 `Set<permissionCode>`，父节点 checked/indeterminate 全部由它推导；勾选/取消父节点作用于整棵子树；字典中已不存在的历史授权码会以警示条列出而不是被静默丢弃。
- 删除确认：打开时先查关联用户；有用户在用时列出账号并**禁用**确认按钮（`ConfirmDialog` 新增可选 `confirmDisabled`）。
- 文案：`apps/admin/src/messages/{zh-CN,en-US}.json` 新增 `roles.*`、`permission.*`（54 条权限名）、`permissionModules.*`（模块分组名）与 `auditActions.role_permissions_changed`；权限 code / menu code / role code 始终是机器标识，不翻译。
- 样式：`packages/ui/styles/components.css` 新增 `permission-*` 与 `.role-name`，全部使用设计 Token，<768px 收窄缩进并保持 44px 触控目标。

### 10.6 端到端验收

**API 级（真实 API + 真实数据库，`PASS 65 / FAIL 0`）**：管理员登录 → 权限树结构（54 码、模块分组 `file,job,lead`）→ 创建 `catalog_editor` → 重复 code 409 → 授予 `product.read`/`product.update`/`category.read`（去重排序）→ 重新读取一致 → 列表 `permissionCount=3` → 非法 code 400 且无部分写入 → 系统角色改信息/清权限/删除均 409 且 `super_admin` 仍 54 权限 → 陈旧 `expectedUpdatedAt` 409 → 编辑基本信息不影响权限 → 创建测试用户 → 在用角色删除 409 且返回影响用户 → 测试用户登录后 `/me` 权限仅 3 项、菜单仅 `categories,products` → 改密前所有后台接口 403 `AUTH_PASSWORD_CHANGE_REQUIRED` → 改密后 `GET /admin/products`、`GET /admin/categories/tree` 200，`DELETE /admin/products/:id`、`GET/PUT /admin/roles*`、`DELETE /admin/roles/:id` 全部 403 → 非超管的克隆角色无法授予自身没有的 `user.delete`（403 `PERMISSION_ASSIGNMENT_FORBIDDEN`）、原样重存 200 → 审计含 `role.create`/`role.update`/`role.permissions_changed`/`role.delete` 及 diff、无凭据材料 → 清理：解除关联后删除成功、再删 404、角色回到 4 个种子角色、`admin` 仍为 `super_admin`。

**浏览器级（真实浏览器 + 真实后台，zh-CN 与 en-US）**：

| 步骤 | 结果 |
|---|---|
| `admin/@Abcd123456@` 登录 | 成功，进入工作台 |
| 角色页 | 4 条记录；`super_admin` 仅「查看权限」，自定义角色有「配置权限/编辑信息/删除角色」；内置角色显示为「超级管理员/商品运营/销售人员/只读访客」（不再出现 `role.sales`） |
| 新建角色（真实逐键输入 `ui_catalog_editor`） | 弹窗内可连续输入、焦点不跳走；创建成功，提示「角色已创建，请继续配置权限」，列表出现新行（权限数 0） |
| 配置权限 | 树来自真实 API（21 个菜单节点 + 3 个模块分组）；勾选「查看商品」「编辑商品」「查看品类」后计数 3/54，父节点 `catalog`/`products`/`categories` 呈 indeterminate(2) |
| 保存 | 「权限已保存」，列表权限数即时变 3，保存按钮回到禁用 |
| 重新打开 | 回显一致（3/54，勾选与 indeterminate 状态与保存前相同），无脏数据时空保存被禁用 |
| 搜索 `product.update` | 仅显示匹配分支且保留父级路径，已选中的 `product.read`/`product.update` 仍为勾选，计数不变 |
| 系统角色「查看权限」 | 只读提示 + 全部复选框禁用 + 54/54，无保存按钮 |
| 删除（无用户） | 确认弹窗显示角色名/编码与「可以安全删除」；确认后行消失、回到 4 条 |
| 删除（`viewer` 有 1 用户） | 弹窗列出 `test` 并禁用确认按钮，提示先重新分配用户 |
| en-US | 标题/说明/表头/按钮/权限名全部英文，权限 code 不变 |

质量门禁：`pnpm lint`、`pnpm -r typecheck`、`pnpm -r test`（93 项：contracts 6 / api 41 / admin 46）、`pnpm build`（含 storefront）全部通过。验证过程中创建的 `catalog_editor`、`ui_catalog_editor`、`e2e_*` 用户与临时脚本均已删除；`admin` 账号保持 `ACTIVE` + `super_admin`。

### 10.7 已知风险与遗留

- `Menu.permissionCode`（单值，如 `product.read`）与 `Permission.module`（如 `product`）不是一对一：树里「菜单访问」按每个菜单自身声明展示，「操作权限」按模块只挂一处。若后续希望两者严格映射，需要先统一菜单/权限命名规范。
- 非超管可在自己无权的情况下**撤销**角色已有的权限（本次只按文档要求限制「授予」）。若需同时限制撤销，可在 `findForbiddenGrants` 增加 removed 分支。
- 未新增前端组件级测试环境（沿用既有约定，纯逻辑已用 vitest 覆盖）；权限树的 DOM 行为以真实浏览器验收为准。
- 抽屉沿用 `Drawer` 组件，仍无初始焦点捕获与焦点陷阱（见 9.4 遗留）。

## 11. 菜单管理与子菜单配置（`docs/19`）

### 11.1 实施前盘点（先查真实代码与数据，再改）

复用现有模块：`apps/api/src/modules/menus/`（Controller/Service/Module + `PublicMenusController`）、`Menu`/`MenuTranslation`/`Permission` 模型、`PermissionsGuard`、审计表、`packages/ui` 的 `DataTable`/`Drawer`/`Toolbar`/`Field`/`Input`/`Select`/`MultiSelect`。

改造前已有端点：`GET /admin/menus?locale=`（整棵后台树，无筛选、无 labels/parentId/updatedAt）、`POST`、`PATCH :id`、`DELETE :id`（全部只校验 `menu.update`，无审计、无图标白名单、无深度校验、无并发保护），以及公开的 `GET /public/menus`。缺口：无详情、无筛选、无排序端点、无权限选项来源、无操作级权限码、无审计、无缓存说明。

只读数据盘点（脚本运行后已删除）：

| 检查项 | 结果 |
|---|---|
| 菜单总量 | 27 条（启用 24），全部 `Menu.permissionCode` 都能在 `Permission.code` 找到 |
| 图标 | 全部落在支持的图标集合内；但 `quotes-files` 使用的 `folder` 在 `MenuIcon` 映射中缺失（回退成通用图标）→ 已补上 `folder` 映射 |
| 路由冲突 | 启用菜单之间无重复路由；`leads`（停用）与 `customers`（启用）共用 `/leads`，说明唯一性必须只在启用菜单之间比较 |
| 翻译 | 每个菜单都有 `zh-CN` 与 `en-US` 标签，无缺失 |
| 菜单权限持有者 | 仅 `super_admin` 持有 `menu.read`/`menu.update` |
| 菜单树缓存 | **不存在**：菜单与权限每次都直接查库，因此变更后无需失效动作 |

**重复「系统管理」节点追踪（docs/19 §7.3）**：

| 节点 | id | 父级 | 子菜单 | route | permissionCode | 状态 | 翻译 | 引用 |
|---|---|---|---|---|---|---|---|---|
| `administration` | `7b4fc6b5-…-feb14e037051` | 根 | 6（users/roles/menus/dictionary/settings/audit-logs） | — | 未绑定 | 启用/可见 | 系统管理 / Administration | 侧栏实际使用的分组 |
| `system` | `ceb64c7f-…-761e1cce7ea2` | 根 | 0 | — | 未绑定 | 停用/可见 | 系统管理 / System | 不在 `MENU_SEED`、无子节点、无路由、无权限码、无任何角色/路由/书签引用 |

结论：`system` 是早期扁平结构改成六分组后遗留的孤儿行（种子只把它 `enabled=false`），保留 `administration` 为唯一「系统管理」父级，并在验收中通过新菜单管理 API 删除 `system`（写入审计）。回滚：`INSERT INTO menus(code, "parentId", route, icon, "permissionCode", "sortOrder", visible, enabled) VALUES ('system', NULL, NULL, 'settings', NULL, 90, true, false);` + 恢复两条 `menu_translations`。

### 11.2 数据库

**未新增表、未新增字段**（docs/19 §5.1、§14.6）：`Menu` + `MenuTranslation` 已满足 CRUD 与多语言需求，菜单类型由 `external`/`route` 派生。

### 11.3 后端

新增权限码 `menu.create`、`menu.delete`（与 `menu.read`/`menu.update` 分离，读写与删除分权；`super_admin` 经 `permissions: 'all'` 自动获得，现 56 条）。新增错误码与中英文案：`MENU_CODE_EXISTS`(409)、`MENU_ROUTE_EXISTS`(409)、`MENU_TYPE_ROUTE_MISMATCH`(400)、`MENU_PARENT_INVALID`(400)、`MENU_PARENT_CYCLE`(409)、`MENU_DEPTH_EXCEEDED`(409)、`MENU_HAS_CHILDREN`(409)、`MENU_SYSTEM_PROTECTED`(409)、`MENU_ICON_INVALID`(400)、`MENU_MODIFIED`(409)。顺带把这一批业务码补进 `ApiError.DEFAULT_STATUS`——此前未映射的码会一律退化成 HTTP 400（改造中发现并修复）。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/menus` | `menu.read` | 树 + `q`/`type`/`status`/`visibility`/`rootOnly`/`locale`；命中节点保留祖先路径与整棵子树 |
| GET | `/admin/menus/:id` | `menu.read` | 单菜单详情（含全部翻译、`parentId`、`updatedAt`） |
| GET | `/admin/menus/permission-options` | `menu.read` | 权限目录（供表单选择；只读，不授予任何权限） |
| POST | `/admin/menus` | `menu.create` | 新建，事务内校验并写审计 |
| PATCH | `/admin/menus/:id` | `menu.update` | 更新；`code` 不可改，支持 `expectedUpdatedAt` 乐观并发 |
| PATCH | `/admin/menus/reorder` | `menu.update` | 同级排序，提交完整同级 ID 列表 |
| DELETE | `/admin/menus/:id` | `menu.delete` | 受保护删除 |

树与写入规则（`menu-policy.ts`，纯函数 + 18 项单测）：父节点必须存在、不可为自身或自身子孙（防环）、层级上限 5（移动时按子树高度计算）、路由与类型一致（分组无路由 / 站内以 `/` 开头 / 外链必须 `https://`）、启用菜单之间路由唯一、图标必须在白名单、`permissionCode` 必须存在于权限字典、`labels` 的 locale 必须合法且至少一条、排序必须覆盖全部同级节点、删除先判子节点再判受保护 code（`PROTECTED_MENU_CODES`＝种子导航骨架，`database/prisma/seed.ts` 会断言种子码全部在其中，防止两边漂移）。菜单 + 翻译在同一 Serializable 事务中提交，审计写失败整体回滚。**菜单与权限解耦**：绑定 `permissionCode` 不会给任何角色授权，删除菜单也不会级联删除 `Permission`/`RolePermission`（E2E 有断言）。菜单树无缓存，改动下一个请求即生效。

### 11.4 前端

[menus/page.tsx](/Users/bo.zhou/Documents/Codex/b2b-inquiry-platform/apps/admin/src/app/[locale]/(admin)/menus/page.tsx) 由只读平铺表改为可展开树形表格：查询栏（关键词/类型/启用状态/导航可见/仅一级 + 查询/重置，条件写入 URL query，刷新后保留）、展开全部/折叠全部/刷新、按层级缩进的行、类型徽标、路由与权限码（等宽+截断提示）、子菜单数、排序（上移/下移调用排序端点，失败回滚提示）、启用/可见两个独立状态、操作列（添加子菜单仅对分组显示、编辑、删除——有子节点或受保护时禁用并在 title 说明原因）。

[menu-form-drawer.tsx](/Users/bo.zhou/Documents/Codex/b2b-inquiry-platform/apps/admin/src/components/menu-form-drawer.tsx)：新建/编辑复用同一 Drawer；编码创建后只读；类型选择在「目录分组/页面/外部链接」之间切换并联动路由字段（分组自动清空路由）；父菜单下拉排除自身与子孙；翻译输入按 `ADMIN_LOCALES` 动态生成（非固定中文/英文列）；图标下拉来自 `MENU_ICON_NAMES` 并实时预览；权限选择复用可搜索的 `MultiSelect`（单选语义，选项来自权限目录 API）；未保存关闭需二次确认；保存失败保留输入与字段级错误（重复编码、非法父级、未知权限码分别落到对应字段）。

其余：[menus-api.ts](/Users/bo.zhou/Documents/Codex/b2b-inquiry-platform/apps/admin/src/lib/menus-api.ts)、纯逻辑 [menu-form.ts](/Users/bo.zhou/Documents/Codex/b2b-inquiry-platform/apps/admin/src/lib/menu-form.ts) 与 [menu-tree-state.ts](/Users/bo.zhou/Documents/Codex/b2b-inquiry-platform/apps/admin/src/lib/menu-tree-state.ts)（+19 项单测）、`menus.*` 中英文案 91 条、`permission.menu.create/delete`、`auditActions.menu_*`、`packages/ui` 的 `MenuIcon` 补 `folder` 映射、`components.css` 新增 `menu-cell`/`menu-sort`/`checkbox-stack` 等样式（全部使用设计 Token）。

### 11.5 端到端验收

**API 级（真实 API + 真实数据库，`PASS 92 / FAIL 0`）**：树读取与五类筛选、详情与权限目录 → 建一级菜单（双语标签回读一致）→ 重复 code 409 / 重复启用路由 409 → 非法权限码 400（字段级 details）、非法图标、未知 locale、空标签、`javascript:` 路由、外链配站内路由、父节点不存在（400 `MENU_PARENT_INVALID`）且均无部分写入 → 建子菜单并编辑（中英文名称、路由、图标、权限、排序全部回读一致，`code` 不变）→ 陈旧 `expectedUpdatedAt` 409 `MENU_MODIFIED` → 移到自身/子孙 409 `MENU_PARENT_CYCLE`、第 6 层 409 `MENU_DEPTH_EXCEEDED` → 完整同级排序 200 且顺序持久化，缺失/未知/重复 ID 400 → 有子节点删除 409 `MENU_HAS_CHILDREN`（含影响数量）、受保护菜单删除 409 `MENU_SYSTEM_PROTECTED` → 删除叶子菜单后权限字典与角色授权**完全不变**、无孤儿权限 → 审计含 `menu.create/update/reorder/delete` 与排序快照且无凭据字段 → 仅 `menu.read` 用户可读树与权限目录、创建/更新/排序/删除全部 403、匿名 401、侧栏只剩其可读菜单 → 回归：侧栏仍 6 个分组、`系统管理` 只剩 1 个、公开导航正常 → 清理后菜单数回到基线。

**浏览器级（真实浏览器 + 真实后台，按用户指定流程）**：

| 步骤 | 结果 |
|---|---|
| 新增一级菜单 | 填 `ui-e2e-reports` / 报表中心 / UI Reports / `/ui-e2e-reports` / chart / `analytics.read` → 创建成功，列表出现该行（页面、排序 70、启用/可见），提示「菜单已创建」 |
| 添加子菜单 | 先把该菜单类型改为「目录分组」（路由字段自动清空并禁用）→ 出现「添加子菜单」→ 新建 `ui-e2e-sales`（父级预选、排序预填 10、页面、`/ui-e2e-reports/sales`），父级子菜单数变 1，父级删除按钮立即变为禁用并提示「请先移动或删除子菜单」 |
| 编辑中英文名称和路由并绑定权限 | 编辑子菜单：中文改「销售月报」、英文改 UI Monthly Sales、路由改 `/ui-e2e-reports/monthly`、图标改 file、权限选择器搜索并绑定 `product.read` → 保存后行内即时显示新名称/路由/权限 |
| 刷新页面检查 | 硬刷新后全部保留（26→28 个菜单：报表中心含 1 个子菜单、销售月报页面带新路由与权限），且**侧栏出现新的分组与子菜单链接** |
| 尝试删除有子菜单的节点 | 父级「删除」按钮为禁用状态并给出原因（`该菜单仍有 1 个子菜单，请先移动或删除子菜单`）；同场景直接调用 API 返回 409 `MENU_HAS_CHILDREN`（含 `childrenCount`） |
| 清理 | 先删子菜单（确认弹窗显示名称/编码/父级）→ 父级删除按钮恢复可用 → 删除父级 → 回到 26 条、侧栏恢复 6 个分组 |

同时确认：`system` 重复节点已通过审计化 API 删除，`administration` 保持为唯一「系统管理」入口；种子导航菜单的删除按钮全部显示「该菜单属于后台导航骨架，受保护不可删除」。

质量门禁：`pnpm lint`、`pnpm -r typecheck`、`pnpm -r test`（132 项：contracts 6 / api 59 / admin 67）、`pnpm build`（含 storefront）全部通过。

### 11.6 已知风险与遗留

- 前端沿用 `DataTable` 的横向滚动容器处理窄屏（与其它后台列表一致），未实现 docs/19 §2.4 建议的「手机端摘要卡片 + 更多操作菜单」；360px 下页面本身不横向溢出，但表格需要横向滚动。
- `menuType` 字段未新增（docs/19 §5.2 允许首期沿用 `route`/`external` 约定），类型判断集中在表单与 `menu-assertRouteMatchesKind`，后续如需扩展为独立字段必须另附迁移。
- 排序采用「上移/下移 + 完整同级重排」，未实现拖拽；`sortOrder` 重排后按 10 递增写入。
- 删除菜单不会清理引用它的书签/外部链接（库内无该数据），也不会下线路由本身。
- 遗留的另两条停用孤儿菜单（`documents` 单据中心、`leads` WhatsApp 客户）未删除：它们同样可经页面顶部的删除按钮安全移除，但审核权留给业务方。

## 12. 字典两层结构与业务复用（`docs/20`）
 
> 说明：本节及以下为最近一次交付记录；第 13 节为全局设置改造（`docs/21`），其浏览器级验收与完整 E2E 矩阵尚未执行，详见第 13.5 节“未完成项”。

### 12.1 阶段 A：实施前数据核查（未改数据）

复用现有模型（`DictionaryType` → `DictionaryItem` → `DictionaryItemTranslation`）与 `apps/api/src/modules/dictionary/`，未新建表。只读盘点结果（脚本运行后已删除）：

| 检查项 | 结果 |
|---|---|
| 类型/条目 | 5 个类型 14 条 item：`product_lifecycle`(3，锁定)、`publish_status`(3，锁定)、`inquiry_source`(3，锁定)、`ad_placement`(3，锁定)、`payment_terms`(2，可编辑) |
| 数据库是否已经两层 | **是**。`typeId` 关联正确、`(typeId, code)` 无重复、每个 item 都有 zh-CN/en-US 标签；页面只是因为只渲染扁平 item 列表才看不出层级 → 不需要重建字典表 |
| `value` 字段语义 | 14 条 item **全部**把 code 复制进 `value`（历史种子写法）；只有 `payment_terms` 的两个 item 的 `value` 有真实业务含义（条款正文）。已在种子中精确清理 `value = code` 的冗余值（12 条），保留付款条款正文 |
| 商品状态与枚举 | `Product.lifecycleStatus`(AVAILABLE=2, PREORDER=1)、`publishStatus`(PUBLISHED=3)，与字典 item code **双向完全对应**（无多余 item、无无法映射的枚举值） |
| 状态的实际影响面 | 前台 `product-card.tsx`、商品详情页按 `lifecycleStatus === 'preorder'` 显示预订标记；发布状态参与前台过滤/精选/新品排序 → **属于流程状态，不能任意增删** |
| 其他引用 | `Ad.placement`（当前无数据）按 code 匹配 `ad_placement`；`InquiryActivity.source`（当前无数据）按 code 匹配 `inquiry_source`；`Product.packaging` 为自由文本（1 个去重值，3 条 demo 商品）；`PiDocument.termsSnapshot.paymentTerms` 为文本快照 |
| 权限 | 仅 `super_admin` 持有 `dictionary.read` / `dictionary.update`；业务角色（catalog_manager/sales/viewer）此前无法读取任何字典选项 |
| 缓存 | **无字典缓存**：改动下一个请求即生效；前端由新 hook 做请求去重与显式失效 |

`manual` / `website_click` / `whatsapp_webhook` 等历史数据的分组按现状保留：它们在数据库中本就挂在 `inquiry_source` 下，未做任何重分组或改码。

### 12.2 阶段 B：字典管理 UI/API

新增权限码 `dictionary.option.read`（业务表单读取选项，与维护字典的 `dictionary.read` 分离），种子授予 `catalog_manager` / `sales` / `viewer`，`super_admin` 自动全量（现 57 条权限）。新增错误码：`DICTIONARY_CODE_DUPLICATED`(409)、`DICTIONARY_ITEM_IN_USE`(409)、`DICTIONARY_TYPE_HAS_ITEMS`(409)、`DICTIONARY_TYPE_MISMATCH`(422)；锁定保护复用既有 `SYSTEM_LOCKED`(409)。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/dictionary/types` | `dictionary.read` | 分页 + `keyword`/`enabled`；返回 `itemCount`/`enabledItemCount`（不再返回扁平 item 列表） |
| GET/POST | `/admin/dictionary/types` · `/types/:id` | `dictionary.read` / `dictionary.update` | 类型详情（含全部 item 与翻译）/ 新建 |
| PATCH/DELETE | `/admin/dictionary/types/:id` | `dictionary.update` | 更新名称 key/描述/启用；删除需非锁定、无 item、无引用 |
| GET | `/admin/dictionary/types/:typeCode/items` | `dictionary.read` | 按 typeCode 取 item（`locale`/`enabled`/`keyword`/`includeUsageCount`），含业务引用计数 |
| POST | `/admin/dictionary/types/:typeCode/items` | `dictionary.update` | 新建 item（body `typeCode` 必须与路径一致，否则 400 `DICTIONARY_TYPE_MISMATCH`） |
| POST | `/admin/dictionary/types/:typeCode/reorder` | `dictionary.update` | 同类型完整排序 |
| GET/PATCH/DELETE | `/admin/dictionary/items/:id` | `dictionary.read` / `dictionary.update` | item 详情 / 更新（翻译、排序、启停、扩展值，带乐观并发）/ 删除 |
| GET | `/admin/dictionary/options/:typeCode` | `dictionary.option.read` | **业务统一选项接口**：默认仅启用项，`includeDisabled=true` 供历史编辑回显；标签按 `locale → en-US → zh-CN → code` 回退 |

移除旧的扁平 `GET /admin/dictionary/items`（仅被重写前的页面使用，避免两套重复契约）。写入规则（`dictionary-policy.ts`，纯函数 + 13 项单测）：类型/条目锁定保护、行为型类型禁止增删 item、被引用 item 不可物理删除、类型有 item 或有引用不可删除、`typeCode` 归属校验、排序必须覆盖全集、翻译 locale 合法且新建时至少一条、`systemLocked` 不由客户端设置。类型/条目/翻译/启停/删除均在同一 Serializable 事务内写审计（`dictionary.type.created/updated/deleted`、`dictionary.item.created/updated/enabled/disabled/deleted`），审计写失败整体回滚。业务引用计数：状态类按字典外键、来源/展示位按 code、包装方式与付款条款按文本精确匹配（宁可多计也不放过）。

前端 [dictionary/page.tsx](/Users/bo.zhou/Documents/Codex/b2b-inquiry-platform/apps/admin/src/app/[locale]/(admin)/dictionary/page.tsx) 由平铺表改为**主从布局**：左侧类型列表（搜索/启停筛选/条目数/锁定标记，选中项写入 `?type=` 供刷新恢复），右侧当前类型的字典项表格（编码、中英名称、扩展值、排序上下移动、状态、业务引用数、编辑/启停/删除）。桌面并排、<1024px 收窄为「列表 ⇄ 明细」单列导航并提供返回按钮。锁定类型/条目的删除、停用按钮为 disabled 且在 title 中说明原因（系统锁定 / 仍有字典项 / 已被引用）；新建与编辑分别复用 [dictionary-type-drawer.tsx](/Users/bo.zhou/Documents/Codex/b2b-inquiry-platform/apps/admin/src/components/dictionary-type-drawer.tsx) 与 [dictionary-item-drawer.tsx](/Users/bo.zhou/Documents/Codex/b2b-inquiry-platform/apps/admin/src/components/dictionary-item-drawer.tsx)（未保存关闭二次确认、字段级错误、翻译 key 解析预览）。

### 12.3 阶段 B/C：纯配置型字典接入业务表单

- 新增 `packaging_type` 类型（carton/pallet/wooden-case/custom，未锁定，业务可自行增删改）；商品表单的「包装方式」保持自由文本，候选来自该字典（`ResourcePage` 新增可选 `suggestions` → 原生 `datalist`），既不改历史数据也不丢失自定义输入。
- `apps/admin/src/lib/dictionary-options.ts` 提供共享 `useDictionaryOptions(typeCode, {locale, includeDisabled, fallback})`：统一 loading/error/empty/retry、30 秒请求去重缓存、`invalidateDictionaryOptions()` 在字典写入后失效；`fallback` 保证下拉在加载/失败时仍显示记录当前值。
- 商品表单的发布状态/生命周期状态改为按 `publish_status` / `product_lifecycle` 取选项，界面显示字典中英标签（草稿/已发布/已下架、可用/预售/已停产），失败时回退到枚举推导的选项。
- PI 新建弹窗新增「付款条款」字段，选项来自 `payment_terms`，选中后把该 item 的扩展值（条款正文）**快照**进 `terms.paymentTerms`，并提供「自定义条款」自由输入；已签发单据不会因字典改名而改变。

### 12.4 阶段 C：商品状态枚举 → 字典（分批迁移的第 1 步）

按 docs/20 §8 只执行 **Expand → Backfill → Verify**，不删除枚举、不切换读路径（contract 属于后续独立发布）：

- Migration `20261016120000_dictionary_product_status_expand`：新增可空 `lifecycleStatusItemId` / `publishStatusItemId`（`ON DELETE RESTRICT`，保证被商品引用的字典项删不掉）+ 索引；从枚举回填（`lower(enum::text)` 映射 item code）；迁移内置校验：任何商品回填后仍为 NULL、或引用了错误类型的 item，迁移直接失败（空表也安全，因此全新环境可正常 deploy）。回滚 SQL 写在迁移文件头部（drop 外键/索引/列）。
- 回填结果：3 条商品 `PREORDER→preorder`、`AVAILABLE→available`、`PUBLISHED→published`，未映射 0 条。
- 写入路径双写：商品创建/更新/上下架在写入枚举的同时校验并写入字典外键；提交的状态码必须在对应类型中存在且启用（否则 422 `DICTIONARY_TYPE_MISMATCH`），因此「把发布状态塞进生命周期字段」在服务端被拒绝。DTO 仍以枚举值约束输入，枚举继续是读路径的权威来源，前台/导出/PI 行为不变。
- 后台商品详情新增 `lifecycleStatusItemId` / `publishStatusItemId`（仅后台 DTO，additive），便于核对 parity 与调试。

### 12.5 端到端验收

**API 级（真实 API + 真实数据库，`PASS 98 / FAIL 0`）**：类型两级清单与筛选、旧扁平接口 404 → 选项接口中英标签/稳定 code/条款正文/未知类型 404/未知 locale 参数 400 → 新建类型（重复 code 409 `DICTIONARY_CODE_DUPLICATED` + 字段级 details）→ 新建 item（重复 code 409、body typeCode 与路径不一致 400 `DICTIONARY_TYPE_MISMATCH`、未知 locale 400、单语 item 可建）→ 行为型类型禁止增删 item（409 `SYSTEM_LOCKED`）、锁定 item 不可停用/删除、标签与排序仍可编辑 → 更新翻译/排序、code 不可改、停用后从业务选项消失但管理列表与 `includeDisabled` 仍可见 → 完整同级排序 201、缺项/未知 id 400 → 商品状态 parity（枚举 ↔ item id 一致、改状态后同步、非法枚举值 400）→ 被商品引用的字典项删除 409 `DICTIONARY_ITEM_IN_USE`（含 usageCount），删除引用后 usage 归零 → 有 item 的类型删除 409 `DICTIONARY_TYPE_HAS_ITEMS` → 权限：无字典权限的角色读类型/选项均 403、`viewer` 可读业务选项但不可读类型列表/不可写入、匿名 401 → 审计含 6 类动作与 typeCode/itemCode 且无凭据字段 → 清理后类型回到 6 个。

**浏览器级（真实浏览器 + 真实后台）**：字典页主从布局正常，6 个类型的名称由 `nameKey` 解析为中文（商品生命周期状态/商品发布状态/询盘来源/广告展示位置/付款条款/包装方式），锁定类型显示「系统锁定」徽标且删除/新增按钮禁用并给出原因；切换类型后 URL 同步 `?type=`，选中「付款条款」显示两条 item 的中英名称与条款正文、删除按钮可用（未被引用）；<1024px 收窄为单列并通过「返回类型列表」回到列表（修复了自动选中把返回动作顶掉的问题）；商品表单的发布状态/生命周期下拉显示字典标签，包装方式输入框的 datalist 提供 纸箱/托盘/木箱/定制包装；PI 新建弹窗的付款条款下拉列出字典选项，选中后显示将要写入单据快照的条款正文（验证后未提交，避免污染数据）。

质量门禁：`pnpm lint`、`pnpm -r typecheck`、`pnpm -r test`（156 项：contracts 6 / api 72 / admin 78）、`pnpm build` 全部通过；迁移经 `pnpm db:deploy` 应用，种子 6 个字典类型并精确清理 12 条冗余 `value`。

### 12.6 已知风险与遗留

- 枚举 → 字典的 **Switch / Contract 未执行**：枚举仍是读路径权威来源，字典外键为双写镜像；真正切换前需评估前台过滤、Excel 导出、PI 快照与 worker 的全部读取点，并单独发布（contract 需单独备份与回滚方案）。
- 商品状态的输入仍由 DTO 的枚举值约束，字典一致性校验是第二道防线；若未来允许后台新增状态 item，必须先设计状态转移、前台行为与迁移，否则新 item 无法通过商品接口写入。
- 包装方式/付款条款的「引用计数」基于文本精确匹配，属于保守估计（可能多计），不作为业务判断依据。
- 字典类型的显示名仍走 `nameKey` + 语言资源（未新增 `DictionaryTypeTranslation`）；新建类型若未同步添加语言 key，界面会显示原始 key，表单会给出提示但不阻断保存。
- 未提交的 data-cleanup：`DictionaryItem.value` 的语义已统一（仅付款条款等确有业务含义的保留），`docs/20 §3.2` 提到的「是否弃用 value」需在后续审查后再决定。

## 13. 全局设置管理与公共配置（`docs/21`）

### 13.1 现状盘点（未改数据）
- 复用 `GlobalSetting`（key / value Json / isPublic / isSecret / updatedById）+ `apps/api/src/modules/settings/`（`GET /admin/settings`、`PATCH /admin/settings` 批量 upsert、`GET /public/site-config`）。
- 代码侧已有 `settings.registry.ts` 注册表（19 个内置 key：site.* / admin.timezone / upload.maxBytes / analytics.rawRetentionDays / integrations.whatsappWebhookSecret），`upsertSettingsSchema` 允许客户端提交 `isPublic/isSecret`；旧页面为逐项大卡片、每项单独“保存”，新建/删除缺失。
- 引用点：`site.whatsappNumber`、`site.batchInquiryLimit`（inquiry service）、`upload.maxBytes`（files）、`site.logoFileAssetId`（public site controller）、其余 site.* 仅经 `/public/site-config` allowlist DTO 输出（`packages/contracts` 的 `PublicSiteConfig`）。
- 缓存：**服务端无设置缓存**，公共配置由 storefront 以 `revalidate: 120, tags: ['site-config']` 做 ISR；库中 17 行设置，无 Token/密钥明文行。
- 现有权限只有 `setting.read` / `setting.update`。

### 13.2 数据库（additive，未动任何 key/value）
- Migration `20261016180000_global_settings_metadata`：为 `global_settings` 增加 `groupCode / valueType / labelKey / descriptionKey / isSystem / isEditable / isDeletable / isRequired / sortOrder / validation / options / revision`（全部带默认值）+ 新建 `global_setting_translations`（自定义项的中英名称/说明，`@@unique([settingKey, locale])`），并把 17 个既有 key 回填为对应分类/类型/系统锁定；迁移内含校验（任何 `isPublic && isSecret` 的行会让迁移失败）。回滚 SQL 写在文件头。
- 内置 key 的显示名走 `labelKey` + 后台 i18n（`settings.definitions.<key>`，中英各 19 组名称与说明），自定义项走翻译表——不同时维护两份数据源。
- 注册表移到 `packages/contracts/src/settings.ts`，API 与 seed 共用同一份定义；`pnpm db:seed` 现在会同步 19 条注册表元数据（值不动）。

### 13.3 API
- 新增权限码 `setting.create` / `setting.delete`（与 read/update 分离）。
- `GET /admin/settings`（分页 + keyword/groupCode/valueType/visibility/source 过滤，返回 `label/description/valueType/valuePreview/hasValue/configured/isSystem/isEditable/isDeletable/revision/usingDefault`）、`GET /admin/settings/groups`（分类计数）、`GET /admin/settings/:key`、`POST /admin/settings`（仅自定义项，`isSystem` 服务端强制 false）、`PATCH /admin/settings/:key`（值/可见性/排序/翻译，`expectedRevision` 并发保护，系统项的 group/type/系统标记不可改，类型变更必须无损）、`DELETE /admin/settings/:key`（系统项/注册表 key/不可删除项一律 409）。
- 策略集中在 `setting-policy.ts`（纯函数）：`isPublic && isSecret` 互斥、密钥不可解锁、密钥写入后不可读（`value: undefined` 表示保持原值，`clearSecret` 才是显式清空）、按 `valueType` 做类型/格式校验（number/boolean/email/url/phone/select/stringList/objectList/json）、`valuePreview` 永不返回可逆掩码。
- 移除了旧的批量 `PATCH /admin/settings`（唯一消费者是本次重写的页面），避免绕过元数据与并发校验的写入口。
- 公共配置仍只经 `GET /public/site-config` 固定 allowlist DTO 输出，不提供任意 key 查询；密钥行在 DTO 读取时被跳过。
- 缓存失效：公共配置变更后调用 storefront 新增的 `POST /api/revalidate?tag=site-config`（`x-revalidate-secret` 共享密钥，白名单 tag）；未配置 `REVALIDATE_SECRET` 时跳过并记日志，回落 ISR 120s TTL。新增环境变量已写入 `.env.example`。

### 13.4 页面
`apps/admin/src/app/[locale]/(admin)/settings/page.tsx` 改为「分类导航 + 筛选工具栏 + 设置表格」：左侧分类（含计数）、关键词/类型/可见性/来源筛选与重置、表格列（名称+key、当前值或"已配置/使用默认值"、类型、可见性徽标、来源、更新时间）、行操作编辑与受保护删除（系统项 disabled 并说明原因）；新建/编辑复用 `setting-form-modal.tsx`（按 `valueType` 渲染输入控件、密钥只显示"替换密钥"、公开与密钥互斥、系统项的 key/分类/类型只读、并发冲突提示）；`settings-api.ts` 提供类型化封装；中英文案 `settings.*` 共 98 条（含 19 个内置项的名称与说明）与分类导航样式。

### 13.5 验收结果（①②③④ 已补齐）
**API 验收矩阵（`PASS 92 / FAIL 0`，真实 API + 真实数据库 + 真实 storefront）**
- GS-001/003/017：列表返回 19 条设置并带完整元数据；分类接口覆盖全部已填充分类（除 custom 外每类计数 > 0）且提供 `settings.groups.*` 的 i18n key；全部文案走 zh-CN/en-US 资源。
- GS-002：关键词（命中 key / i18n key / 内置英文说明）、分类、类型、可见性（公开/私有/密钥）、来源（系统/自定义）过滤与组合过滤、清空过滤均通过。**已知限制**：内置项的本地化显示名在客户端解析，服务端只按 key/i18n key/英文说明匹配，中文名搜索需后续把解析后的名称回传或改为服务端翻译。
- GS-004/005：新建自定义项成功（含中英名称与说明、`isSystem` 服务端强制 false）；重复 key → 409 `SETTING_KEY_CONFLICT`（字段级 details）；占用内置 key → 409；未知分类/类型 → 400；缺翻译 → 400；客户端提交 `isSystem` 被忽略。
- GS-006/007/008/009/016：文本更新成功且 revision 递增、时间戳更新；陈旧 revision → 409 `SETTING_REVISION_CONFLICT`；非法邮箱/非数字/非法 JSON → 400 且不落库；不兼容的类型变更 → 400（无损校验）。
- GS-010/015：系统项的 group/type 变更 → 409 `SETTING_SYSTEM_LOCKED`（此项由单测发现并修复：原判空条件写成了自我比较的恒假式），但值仍可编辑；显式"公开 + 密钥"→ 409 `SETTING_PUBLIC_SECRET_CONFLICT`。
- GS-013/014：密钥创建后列表/详情/审计/响应体均无明文（按响应文本断言）；空提交保持原密钥；替换不回显；`clearSecret` 才置空。
- GS-011/012：删除系统项 → 409 `SETTING_IN_USE`；删除自定义项成功，再读 404；未知 key 404。
- 权限：仅 `setting.read` 的角色可列表但创建/更新/删除 403；匿名 401；`/public/site-config` 只输出 allowlist DTO，无密钥、无私有 key、无按 key 直读端点（`/public/settings/:key` → 404）。
- 缓存一致性（③）：`REVALIDATE_SECRET` 配置后，`POST /api/revalidate` 的契约通过（无密钥 403、错密钥 403、非法 tag 400、合法 tag 200 `{revalidated:true}`）；端到端证明：更新 `site.companyName` 后**立即**抓取 storefront 首页即出现新值（ISR tag 已失效），API 日志无 `revalidate_skipped`/`revalidate_failed`，随后恢复原值。

**浏览器走查（真实后台）**：分类导航（8 类，中文名 + 计数）、筛选工具栏（关键词/类型/可见性/来源 + 重置/搜索）、表格（翻译后名称 + 等宽 key、值预览、密钥显示"已配置"、系统项删除禁用并给出原因）、搜索 `contactEmail` → 命中 1 条 + 筛选 chip、新建自定义项（`e2e.uiSetting` → 列表 20 条、自定义分类计数 1）、编辑值 → 行内与更新时间同步刷新、删除（确认弹窗展示 key）→ 回到 19 条、刷新页面后数据与侧栏保持；**360px 视口**：`document.scrollWidth === innerWidth === 360`，无横向溢出。

**单元测试（④）**：新增 `setting-policy.spec.ts` 21 项（分组/类型校验、公开与密钥互斥、系统项元数据保护、可编辑/可删除策略、revision 冲突、11 种值类型的归一化与拒绝、预览截断、类型变更无损校验），并因此修复 2 个真实缺陷：系统项 group/type 保护恒假、设置 key 正则拒绝项目自身的 camelCase 约定（`site.companyName`）。

**质量门禁**：`pnpm lint`、`pnpm -r typecheck`、`pnpm -r test`（177 项：contracts 6 / api 93 / admin 78）、`pnpm build` 全部通过。

### 13.6 仍未完成
- 迁移在**空库副本**上的演练与迁移前后 key/value 逐项比对（本机是在已有 17 行数据上执行并通过校验，空库路径由迁移内的空表分支覆盖但未单独演练）。
- `validation`/`options` 的实际业务规则与对应 UI 编辑入口（接口已支持声明式校验与选项，表单暂未暴露）。
- 生产环境 `REVALIDATE_SECRET` 的部署配置（`.env.example` 已说明；本机用 `apps/storefront/.env.local` 验证）。

## 14. 品类管理树形工作台（`docs/22`）

### 14.1 实施前盘点（复用现有模型，不新建品类表）

`Category`（`code`/`slug` 唯一、`parentId` 自关联 `Restrict`、`sortOrder`、`enabled`、`visible`、`coverFileAssetId`）+ `CategoryTranslation`（`[categoryId, locale]` 复合主键）+ `Product.categoryId`（`Restrict`）已满足需求，**未新增任何表或迁移**。缺口在 API 与页面：只有 `GET /admin/categories/tree`（且只返回直接商品数）、无详情/列表/排序接口、无乐观并发、`code` 冲突回落到通用 `CONFLICT`，页面是平铺表格 + 手填父级 UUID，前台 `?category=<slug>` 解析 slug 时不校验 `enabled`/`visible`。

### 14.2 后端（`apps/api/src/modules/categories`）

- 新增纯策略层 `category-policy.ts`（无 Prisma 依赖，可单测）：循环检测、最大层级 8（`MAX_CATEGORY_DEPTH` 单点定义）、同级排序重编号（步长 10）、`direct`/`total` 计数汇总、路径链、孤儿父节点诊断、删除拦截、公开可达性（整条祖先链 `enabled && visible`）、`updatedAt` 乐观并发比对。
- 服务：`listAdminTree(query)`（`q`/`status`/`visibility`/`hasProducts`/`rootOnly`，搜索保留匹配节点 + 整个子树 + 祖先链）、`getDetail`（`path` 面包屑、`parentName`、直接子品类）、`listCategories`（分页扁平列表，带 `path`/`depth`）、`create`/`update`/`move`/`reorder`/`remove`/`deleteImpact`。写操作在事务中完成，审计只记录发生变化的字段（`before/after`），不写长描述全文。
- 计数避免 N+1：管理端一次分组聚合全部商品数并在内存上卷；公开端另用「已发布且未停产」的分组聚合。
- 公开端：`listPublicTree`/`findPublicBySlug`/`resolvePublicCategoryScope` 统一按祖先链可达性过滤，且未知或不可达 slug 返回 **0 条**（不再静默忽略筛选、也不返回整目录）。
- 新错误码：`CATEGORY_CODE_CONFLICT`、`CATEGORY_PARENT_INVALID`、`CATEGORY_CONCURRENT_UPDATE`（含 HTTP 状态映射与中英文案）。
- 新端点：`GET /admin/categories`（分页列表）、`GET /admin/categories/:id`、`GET /admin/categories/:id/delete-impact`、`POST /admin/categories/reorder`；`GET /admin/categories/tree` 增加筛选与 `totalProductCount`/`updatedAt`。

### 14.3 前端（`apps/admin`）

- 页面 `categories/page.tsx` 重写为「左侧可搜索/展开折叠品类树 + 右侧详情/子品类表」；筛选与展开状态存入 URL（`?q&status&visibility&hasProducts&selected&view`）。
- 新增 `categories-api.ts`、`category-tree-state.ts`、`category-form.ts`（纯函数）、`category-form-drawer.tsx`（创建/编辑统一抽屉，父级改用 `TreeSelect` 树形选择器并屏蔽自身与后代）、`category-detail-panel.tsx`；复用 `@b2b/ui` 的 TreeSelect/Drawer/DataTable/Badge/ConfirmDialog 与既有 Design Token，新增 `.workbench`/`.tree-row`/`.meta-grid` 等样式（含 1023px 主从切换与 360px 触控 44px）。
- 异常与空状态：树加载骨架、树失败重试（保留 Admin Shell）、搜索无结果、无选中引导、子品类空状态、「无子品类/有商品」时删除按钮禁用并在 `title` 说明原因、保存失败保留表单并显示字段级错误、关闭脏表单二次确认。

### 14.4 前端联动与验收证据

**单元/静态测试（`pnpm -r test`）**：`category-policy.spec.ts` 20 项（后代/深度/子树高度/路径链/环容忍/孤儿诊断/父级校验/层级上限/计数口径/排序完整性/删除拦截/并发/公开可达性/树构建）+ `categories.wiring.spec.ts` 5 项（9 个管理端端点的方法与路径、每个端点都声明权限、`/tree` 先于 `/:id` 声明、公开端点 `@Public`、8 个错误码的 HTTP 状态映射）+ admin 端 `category-tree-state.spec.ts` 12 项、`category-form.spec.ts` 14 项。

**真实浏览器走查（真实 API + 真实数据库，`pnpm --filter @b2b/admin dev`）**：
- 树展示真实层级（五金工具 → 电动工具/手动工具 → 扳手/螺丝刀、玩具 → 模型玩具/电动玩具、汽车用品、运动户外、既有演示数据），节点右侧为含下级商品总数，停用/隐藏以文字徽标呈现。
- 选中玩具：路径「玩具」、code/slug、上级为 `—`、直接商品 3 / 含下级商品 5、最近更新时间；子品类表 2 行含 `直接 / 含下级`、状态徽标与 ↑↓。
- 新增子品类：抽屉父级自动选中「玩具」并显示「当前上级：玩具」（不是 UUID）→ 保存成功、树计数 12→13、新节点出现在玩具之下、详情面包屑为「玩具 / 模型汽车」。
- 重复 code：提交 `toys` → 抽屉保留已填内容并显示字段错误「该品类编码已被占用。」（409 `CATEGORY_CODE_CONFLICT`）。
- 编辑并隐藏汽车用品 → 详情徽标变「前台隐藏」、树行出现「前台隐藏」徽标；公开 API 树中 `auto` 立即消失、`toys` 仍在；随后恢复显示。
- 排序：手动工具/电动工具下移后顺序持久化，整页刷新后仍为「手动工具 → 电动工具」。
- 删除：有子品类的玩具删除按钮禁用并提示「存在子品类或关联商品时不能删除，可改为停用或前台隐藏。」；空品类确认弹窗显示完整路径「玩具 / 模型汽车」→ 删除成功、树回到 12 个品类（该节点为本次走查创建，已删除）。
- 关闭脏表单会弹出「放弃修改」二次确认。

**前台联动（真实 storefront，`:3000`）**：`/en-US/categories/toys` 返回 3 件商品——Model Kit（子类模型玩具）、Electric Car（子类电动玩具）、Direct Toy（玩具本身）；草稿、已停产、其他分支（扳手）均未出现；面包屑 Home / Products / Toys。公开品类树 JSON 中 `productCount` 只统计已发布且未停产商品（toys=3，而非含草稿的 5）。

**响应式（真实浏览器 + viewport 覆写）**：1440×900、768×1024、360×740 下 `document.scrollWidth === innerWidth`（无页面级横向溢出）；<1024px 转为单栏、360px 下选中节点进入详情并提供「返回品类树」，筛选控件与动作按钮在手机端堆叠为整行且触控高度 ≥44px。

### 14.5 已知限制与风险

- **数据库级验收脚本未在本机执行**：`pnpm --filter @b2b/api run acceptance:categories`（`apps/api/scripts/categories-acceptance.ts`）会用真实服务 + 真实数据库跑完整矩阵（建树/详情/重复/并发/环/层级/排序/删除拦截/审计/前台筛选/面包屑），但本机沙箱禁止进程访问 `localhost:5432`，因此该脚本的**执行结果待在有网络访问的终端中补跑**；本次以单测 + 静态接线断言 + 真实浏览器走查替代。
- 权限拒绝（403）与匿名 401 的具体用例在验收脚本中，本次仅由静态断言保证「每个端点都声明了权限」；未在本机跑真实权限矩阵。
- 封面图字段沿用 API 的 `coverFileAssetId`，但后台暂未提供封面选择器（编辑表单不含该字段）；既有后台也没有图片选择器模式可复用，作为后续增强项。
- 商品表单的「所属品类」仍是 UUID 文本框（`products` 页面既有实现），本次未改动以免扩大范围。
- 树接口一次读取全部节点（当前规模足够）；docs/22 §6.4 的惰性加载阈值（约 2000 节点）尚未实现。

## 15. 标签管理 CRUD、展示与数据安全（`docs/23`）

### 15.1 实施前盘点（复用现有模型，不新建标签表）

`Tag`（`code` 唯一、`colorToken`、`enabled`）+ `TagTranslation`（`[tagId, locale]` 复合主键）+ `ProductTag`（`[productId, tagId]` 复合主键）已满足需求，**未新增任何表**。真实缺口：`POST /admin/tags` 是「按 code upsert」（无法区分新建与冲突、无审计、无事务）、没有详情/更新/启停/筛选分页接口、删除保护返回通用 `CONFLICT`、`ProductTag.tagId` 是 **ON DELETE CASCADE**（删标签会静默清空商品关联）、停用标签仍在前台展示、前台英文页会回退到中文标签、`colorToken` 是可自由填写且无校验的文本、列表页是平铺 `ResourcePage`（缺少编辑、搜索、筛选、状态，且复用了「字典项 code」文案）。

### 15.2 数据库变更（版本化迁移 + 回滚）

- 迁移 `20261016200000_producttag_tag_restrict`：`product_tags_tagId_fkey` 由 `ON DELETE CASCADE` 改为 `ON DELETE RESTRICT`（docs/23 §6.5、§9 阶段 C）。该变更是**收紧型**：不会因存量数据失败，不重写任何行；迁移文件内附回滚 SQL。`TagTranslation` 保持 CASCADE（翻译随标签删除是正确语义）。
- 种子（幂等）：新增 `tag.create`、`tag.delete` 权限（`super_admin` 与 `catalog_manager` 同时获得；`viewer` 仍只有 `tag.read`），并为参考标签补上 `colorToken`（`featured→tag.brand`、`new-arrival→tag.info`、`preorder→tag.warning`、`oem→tag.success`），已存在且非空的 token 不会被覆盖。命令：`pnpm --filter @b2b/database run migrate:deploy`、`pnpm run db:seed`。

### 15.3 后端

- 新增纯策略层 `tag-policy.ts`：样式 Token 白名单校验（写入侧）与读侧降级（未知 token → 中性）、英文名必备（校验**合并后**的翻译集合，因此 PATCH 无法删除英文名）、`updatedAt` 乐观并发、被引用标签删除拦截（`TAG_IN_USE`）、后台/前台标签名回退规则（后台 locale → en-US → 空；**前台只回退到 code，绝不回退到中文**）、缺失语言诊断、翻译输入归一化。
- 服务：`list`（`q`/`status`/`usage` 服务端过滤 + 稳定排序 code asc + 分页上限）、`detail`、`options`（仅启用）、`create`/`update`/`setStatus`/`remove`；标签与翻译在同一事务写入；审计记录 `tag.create`/`tag.update`/`tag.status_changed`/`tag.delete`，翻译按 locale 记录 before/after；删除在事务内重新统计引用数；写操作后调用 storefront 的 `POST /api/revalidate?tag=products` 失效公开商品缓存（未配置 `REVALIDATE_SECRET` 时记录跳过，不阻断保存）。
- 新错误码：`TAG_CODE_CONFLICT`、`TAG_IN_USE`、`TAG_NOT_FOUND`、`TAG_COLOR_TOKEN_INVALID`、`TAG_TRANSLATION_MISSING`、`TAG_CONCURRENT_UPDATE`（含 HTTP 状态映射与中英文案）。
- 前台投影：`PUBLIC_PRODUCT_SELECT.tags` 增加 `where: { tag: { enabled: true } }`（停用标签不再出现在访客页面），`?tag=<code>` 筛选也只匹配启用标签；公开标签载荷只含 `code/label/colorToken`，且 `colorToken` 经过白名单过滤。
- 商品详情 DTO 使用更小的 `ProductTagRef`（不再复用 `TagSummary`），停用标签仍随商品返回并标记 `enabled:false`，保证商品编辑不会静默丢失历史关联。

### 15.4 前端

- 新增共享 `TagBadge`（packages/ui）：把白名单 token 映射为 badge tone，**不做字符串拼接**，未知/空 token 降级为中性；列表、表单预览使用同一组件，避免预览与前台样式漂移。
- 标签页重写为「筛选工具栏 + 表格 + 分页 + 统一新建/编辑 Drawer + 删除保护弹窗」：编码（等宽 + 复制）、主/次语言名称与缺失提示、样式 token、商品数、启用状态、更新时间；操作含编辑、启用/停用、删除（被引用时禁用并说明原因）。筛选项写入 URL。
- 新建/编辑共用一个 Drawer：`code` 仅新建时填写（编辑只读并说明原因）、中英文名称（**英文必填**）、样式 Token 下拉 + 实时预览、启用开关；保存 loading、脏表单离开确认、字段级错误与全局错误区分。
- 商品编辑页的标签字段由「逗号分隔文本框」改为多选选择器（`GET /admin/tags/options` 思路 + 全部标签列出），停用标签灰显不可新选但仍保留在已有关联中；`ResourcePage` 新增 `multi` 选择器能力（附加式改动，未影响其他页面）。

### 15.5 验收证据

**自动化**：`pnpm run lint`、`pnpm -r typecheck`、`pnpm run test`（API 131 项 / admin 117 项）、`pnpm build` 全部通过。新增 `tag-policy.spec.ts`（13 项：Token 白名单读写两侧、英文名必备、两种回退规则、缺失语言、删除拦截 409、并发、翻译归一化）、`tags.wiring.spec.ts`（4 项：7 个端点的方法与路径、每端点独立权限、`/options` 先于 `/:id`、6 个错误码的 HTTP 映射）、admin `tag-form.spec.ts`（14 项：校验、脏值、载荷、字段错误映射、样式选项、停用标签选项）。

**真实 HTTP + 真实数据库 + 真实前台（`pnpm --filter @b2b/api run acceptance:tags`，`PASS 70 / FAIL 0`）**：
- 列表：分页元数据、按英文名与中文名搜索、`usage=used/unused` 与 `status=disabled` 过滤、`label` 按 locale 解析、`productCount` 为服务端聚合、客户端注入的 `productCount`/`id` 被忽略。
- 创建：中英文名 + `tag.success` 成功；重复 code → 409 `TAG_CODE_CONFLICT`（含字段级 details）；缺英文名 → 400；未知颜色 token → 400。
- 编辑：只改中文不动英文；陈旧 `expectedUpdatedAt` → 409 `TAG_CONCURRENT_UPDATE` 且未落库；缺英文名的更新被拒。
- 商品关联：创建带标签的商品后，商品详情返回该标签；`/admin/tags/options` 只返回启用标签。
- 前台：`?tag=<code>` 命中该商品且标签名为英文；公开标签载荷仅 `code,label,colorToken`；**停用后**商品卡片不再含该标签、该标签也不能再作为筛选入口（0 条），但商品关联保留并在后台标记 `enabled:false`；`options` 中已消失。
- 删除保护：被引用标签删除 → 409 `TAG_IN_USE`，标签与 `ProductTag` 关联均保持不变；解除关联后删除成功、再删 404。
- 权限：匿名 401；仅 `tag.read` 的用户可列表但创建/编辑/启停/删除全部 403（逐端点 RBAC）。
- 数据库兜底：直接 `DELETE FROM tags WHERE code='featured'` 被 `product_tags_tagId_fkey` 拒绝（事务已回滚，无数据变化）；审计表含 `tag.create/update/status_changed/delete`，`tag.update` 的 metadata 为按 locale 的 before/after。

### 15.6 已知限制与风险

- 本轮**未做浏览器走查**（本次会话的 Computer Use 工具不可用）：UI 已由 lint/typecheck/单元测试与 API 契约保证，但「点击级」交互（Drawer 预览、状态切换按钮、360px 布局）建议按 docs/23 §12.3 人工复核一次。
- `colorToken` 白名单仅覆盖 6 个预置 token；如需新增样式需同时更新 `TAG_COLOR_TOKENS` 与 `TagBadge` 映射（两处都在代码内，不涉及数据库）。
- `featured` / `new-arrival` 与 `Product.isFeatured` / `Product.isNew` 的去重（docs/23 §8.3）**未做**：前台商品卡片当前用布尔字段渲染 Featured/New 徽标，并用 `filter` 排除 `featured`/`new-arrival`/`preorder` 三个 code 以避免双徽标；差异报表与合并需业务确认后再做。

## 16. 商品管理 CRUD、图片图库与永久物理删除（`docs/24`）

完整交付报告（实施前审查、迁移、验证证据、生产开放流程）见 `docs/25-product-management-implementation-report.md`。

### 16.1 实施前审查（先核查真实模型/迁移/存储）

- `Product.categoryId` 实际可空、尺寸为 `Int?`、价格为 `Decimal(18,4)`；`publishStatus`/`lifecycleStatus` **仍是 enum**（字典迁移只完成 expand+backfill），因此沿用枚举为读取权威、写入时同步字典镜像列。
- `ProductImage` 无删除状态字段；`ProductImage.product` 为 `onDelete: Cascade`；`ProductImage.storageKey` 与 `FileAsset.storageKey` 并存；`Category.cover`/`Ad`/`PdfConversionJob` 可能引用同一 `FileAsset`。
- 存储为 `local` 驱动，key 形如 `product-image/YYYY/MM/<uuid>.<ext>`，落在源码树外的 `.data/uploads`（实测存在 3 个历史商品图与 worker 生成的 `__wNNN.webp`）。
- `FileDeletionJob` 已存在且已被 `file-delete` worker 消费 → **复用扩展，不新建平行 outbox**。

### 16.2 修复的真实缺陷

1. `DELETE /admin/products/:id` 直接 `prisma.product.delete()`，依赖 cascade 先删掉图片行（含 `storageKey`）而永不删除对象存储文件 → 改为 outbox + 聚合清理任务。
2. 保存商品会把 `ProductImage` 整批 `deleteMany` + `createMany` → 图片改为独立端点，表单保存不再触碰图库。
3. `UPLOAD_MAX_PIXELS` 从未使用、上传不解析真实尺寸 → 新增 PNG/JPEG/WebP 头部解析、像素上限校验并回填宽高。
4. 列表无封面/缺图筛选；编辑为 450px 抽屉、尺寸字段三处同名、品类手填 UUID、标签用 code 数组 → 全部按 `docs/24` 重做。
5. 新错误码未映射 HTTP（重复 SKU 实测返回 400；公开接口对不存在商品返回 400 导致前台 `notFound()` 失效）→ 补入 `DEFAULT_STATUS` 并复测 409/404。
6. 内部价格可见性依赖 `product.update`/超管判断 → 新增 `product.cost.read|update` 与 `product.image.upload|update|delete` 五个独立权限码。

### 16.3 数据库变更

`20261017120000_product_image_delete_state_and_file_operations`（纯 additive）：`product_images.deleteState` 默认 `READY` + 索引；`file_deletion_jobs` 增加 `productId`/`requestedBy`/`idempotencyKey`(unique)/`completedAt`，`storageKey` 放宽为可空。迁移内含核对 SQL 与回滚步骤（有在途任务时禁止回滚）。

### 16.4 交付内容

- 后端：`/admin/products`（筛选 + 封面/图片数/品类路径）、完整 CRUD（双语、结构化 `tagIds`、必填且启用的品类、发布需至少一张可用图片）、`/admin/media/staging`、图库四端点（关联/排序/主图/altText）、图片与商品的永久删除（202 + `operationId`）、`/admin/file-operations/*`（状态 + 重试）；逐端点 RBAC、审计、`products` ISR 失效。
- Worker：`file-delete` 支持 `product_image` 与 `product` 两类任务；存储删除成功后才清库；失败保留 key/任务/状态并写失败审计；清理 `__wNNN.webp` 缩略图；商品任务在图片未清理完前延迟重入队，不消耗重试额度。
- 前台：公共图片投影按 `deleteState='READY'` 过滤；公共 DTO 不含价格与 `storageKey`。
- 后台：商品列表（缩略图/状态/缺图筛选/行内上下架与删除）、`/products/new` 与 `/products/[id]/edit` 完整编辑页（分组、单位、中英 Tab、品类树、标签多选、图库、sticky 操作条、未保存提示）。

### 16.5 验收证据（本机真实环境）

- `pnpm run lint`、`pnpm run typecheck`、`pnpm run test`（API 155 / admin 133）、`pnpm run build` 全部通过。
- `pnpm --filter @b2b/api run acceptance:products` → **62/62 PASS**：重复 SKU/slug 409、缺英文/非法尺寸 400、无图发布 422、发布/下架与幂等、上传伪签名拒绝、图库顺序/主图唯一/altText/跨商品图片 404/共享对象 409、公共 JSON 与 storefront HTML 无价格且图片可渲染、图片永久删除后**磁盘文件与缩略图确实不存在**且公共 URL 404、逐端点 RBAC（viewer 只读且 `priceCny=null`）、商品永久删除在已发布时 409 且下架后所有图片对象确实消失。
- `pnpm --filter @b2b/worker run acceptance:file-delete` → **20/20 PASS**：存储故障时任务 FAILED、key 与文件保留、无成功审计；人工重试成功后文件消失且幂等；商品清理任务在图片未清理前不删商品行，仅在全部对象确认清理后才删除商品。

### 16.6 遗留与风险

- **真实 S3/MinIO 未验证**：按用户要求，生产开放永久删除权限前必须在测试环境用真实对象存储确认对象确实不存在（步骤见 `docs/25` §5）。
- 浏览器点击级走查未做（图库交互与 360px 实机布局建议人工复核一次）。
- staging 孤儿文件 TTL 清理未实现（已知缺口）。

### 16.7 2026-10-17 业务澄清与首页预售勾选

- 确认：标签是前台**商品图片上的角标**；`isFeatured` / `isNew` 决定是否进入首页精选/新品区；二者不冲突、不做去重（`docs/14` 已记录）。
- 新增 `Product.isPreOrder`（迁移 `20261017180000_product_is_preorder_home_flag`，现有 PREORDER 商品回填为 true）：勾选后商品进入首页"可预售"区。
- 规则：仅当 `lifecycleStatus='preorder'` 才能勾选（否则 400、字段错误 `isPreOrder`）；生命周期离开预售时服务端自动清除该标记；`/public/products?isPreOrder=true` 与首页均按该标记取值，`lifecycle=preorder` 仍保留"全部预售商品"的目录筛选语义。
- 后台编辑页新增勾选框（非预售时禁用并解释原因），列表 flags 列显示 `home pre-order`；`docs/24 §3.3 B`、`docs/25 §9` 已同步。
- 验收：`acceptance:products` 68/68 通过（新增 6 项预售首页标记检查）；真实前台复核——演示商品取消勾选后立即退出公开预售集合，首页引用由 6 处降至 3 处（仍在新品区），重新勾选后恢复，证明三个首页分区相互独立。

## 17. English FAQ 前台页面（2026-10-20）

### 17.1 数据与 API

- 复用现有 `FaqItem` + `FaqTranslation`，不新建 CMS 表。版本化迁移
  `20261020170000_faq_categories_and_codes` 增加稳定 `code`、六类 `category`
  与组合索引；仓库原有 3 条 FAQ 按英文问题映射到新 code，其他历史数据保留并
  回填确定性 legacy code。
- 幂等种子写入规范中的 23 条英文问答，按 `products → wholesale → orders →
  shipping → quality → contact` 排序；未修改的管理员文案不会被种子覆盖。当前
  数据库为 23 条启用记录、23 条英文翻译、0 条中文翻译。
- 公开接口只返回 `enabled` 数据，字段为 `id/category/sortOrder/question/
  answerHtml`，不包含价格、内部备注或审计字段。请求语言没有翻译时不回退到
  英文；`/zh-CN/faq` 当前显示中文空状态。
- FAQ 管理写操作复用现有权限校验与富文本白名单；保存/删除后通过受保护的
  `POST /api/revalidate?tag=faq` 失效前台缓存（未配置密钥时保留 ISR TTL）。

### 17.2 前台

- `/en-US/faq` 使用与产品目录/工厂页一致的 breadcrumb、hero、panel、CTA 和
  storefront design token，新增六个分类锚点、23 项多开手风琴、首尾 WhatsApp
  CTA、加载态、错误态和空状态。
- 手风琴问题为原生 button，包含 `aria-expanded` / `aria-controls`，关闭面板
  使用 `hidden` 保留关联目标；支持 Space/Enter，焦点样式、44px 触控目标与
  reduced-motion。
- 顶部导航与页脚加入 FAQ 入口；metadata 使用配置品牌名、canonical 和
  Open Graph；FAQ JSON-LD 由同一批可见问答生成。
- WhatsApp 号码继续读取站点设置；号码缺失时复用 `/inquiry` 回退，不硬编码
  电话。配置有效号码后，FAQ CTA 使用规范中的预填咨询消息。

### 17.3 验证

- `pnpm run lint`、`pnpm run typecheck`、`pnpm run test` 全部通过；测试总计
  contracts 15 / worker 6 / API 178 / admin 148 / storefront 9。
- API 与 storefront build 通过；真实 HTTP 冒烟 `/en-US/faq` 与 `/zh-CN/faq`
  均为 200，英文公开 API 返回 23 条。
- 无头 Chrome 在 1440、1024、768、390、360 宽度验证：23 题、6 分类、无页面级
  横向溢出，问题按钮高 64px、分类入口高 44px；Space 展开成功，多项可同时
  打开；控制台异常、失败请求均为 0。FAQ schema 为 23 题且无 price 字段。

### 17.4 待业务确认

- 23 条中文问答尚未由业务审核，因此不写入数据库、不回退展示英文。后续补充
  `zh-CN` 翻译后无需改前台代码。
- MOQ、样品费用、交期、付款、运费、证书和售后承诺仍需按具体产品/订单确认；
  当前文案保持规范中的非承诺措辞。

### 17.5 前台语言切换控件移除

- 按最新业务要求，storefront Header 桌面操作区和移动菜单均不再显示 EN/中文
  切换控件；对应 `LocaleSwitch` 组件、样式和未使用翻译 key 已删除。
- `/en-US`、`/zh-CN` 路由及后台语言切换保持不变，访客仍可通过明确 URL 访问
  对应语言页面。
- storefront 测试新增 Header 接线回归，禁止 `LocaleSwitch` 重新进入前台导航。
  真实浏览器在 1440px 与 390px（移动菜单展开）验证语言控件数量为 0、无页面级
  横向溢出、控制台无异常。

## 18. 产品图片布局与卡片按钮完整显示（2026-10-20）

### 18.1 根因

真实 `/en-US/products?page=4` 的四列布局中，卡片宽约 240px，操作区内宽约
208px；两个按钮使用 `flex: 1 1 auto`，固有内容宽度合计约 239px，
`Add to inquiry` 超出卡片约 23px。卡片整体 `overflow: hidden` 将该按钮右侧
直接裁切。产品媒体虽然为 1:1，但默认 `object-fit: cover`，会裁切产品图。

### 18.2 修改

- 产品卡改为图片区、信息区、操作区三个独立区域；信息区 `flex: 1`，操作区
  独立位于卡片底部。
- 图片统一 `aspect-ratio: 1 / 1` + `object-fit: contain`；加载、缺图和失败
  仍由现有 `MediaFrame` 固定尺寸占位，避免卡片跳动。
- 操作区改为 `grid-template-columns: repeat(2, minmax(0, 1fr))`；按钮
  `min-width: 0`、`width: 100%`、`min-height: 44px`，允许文本换行。
- 卡片外层改为 `overflow: visible`，媒体容器单独裁切圆角，焦点轮廓不再被
  卡片裁掉；SKU、品类和标题增加可收缩/换行规则。
- 767px 以下按钮改为单列堆叠；桌面和平板保持双列。

### 18.3 验收

- `pnpm --filter @b2b/storefront test`：13 项通过（新增 3 项卡片布局契约）。
- `pnpm run lint`、storefront typecheck、storefront build：通过。
- 无头 Chrome 在 1440、1280、1024、768、430、375、320 宽度验证：
  所有按钮完整位于卡片与屏幕内，文字无裁切，页面无横向溢出；图片比例均为
  1:1 且 `object-fit=contain`，最小按钮高度桌面 50.5px、手机 44px。
- 加入询价后按钮变为 `In inquiry`、`aria-pressed=true` 且仍完整显示；再次
  点击可移除。长标题、长 SKU 和 2px 焦点轮廓不会挤出或裁切操作按钮。

## 19. 商品详情图片同页预览（2026-10-20）

- 根因：共享 `ImageGallery` 主图被包装成 `<a href={图片URL} target="_blank">`，
  点击会打开图片 URL 或新标签页。
- 主图触发元素改为原生 button，点击后在当前页面复用共享 `Modal` 打开大图；
  URL、浏览器 history 和当前页面均不变。
- 单图直接预览；多图在 Modal 底部提供上一张、下一张和当前序号，切换时复用
  同一个已加载的图库状态。Modal 支持关闭按钮、遮罩、Escape、焦点圈定与关闭后
  焦点返回。
- 桌面 `modal-lg` 展示大图；390px 下图片、标题和翻页控制完整位于视口内。
- storefront 新增主图预览接线测试；storefront 14 项测试、storefront/UI
  typecheck、lint 和 storefront build 均通过。
- 真实浏览器验证 `7cm-rose`：3 张图，点击主图后 URL 不变，未出现图片 URL
  标签页；切换后显示 `2 / 3`，Escape 关闭并恢复触发按钮焦点，遮罩关闭正常。

## 20. 手机端产品、工厂与证书双列布局（2026-10-20）

### 20.1 响应式规则

- 产品目录、分类商品页、工厂图库、工厂生产流程和证书卡片统一使用：
  `360–767px` 双列，`359px` 及以下单列，间距使用现有 `--space-3`。
- 768px 平板产品网格保持 3 列，1280/1440px 桌面保持 4 列；桌面与平板布局
  未改为移动端规则。
- 首页产品网格共享 `.product-grid`，因此同样获得手机双列；首页独立的流程
  网格不受工厂页面专用规则影响。

### 20.2 卡片防溢出

- 产品图保持 1:1 + `contain`；标题视觉最多两行，并通过 `title` 与完整 DOM
  文本保留完整名称；SKU 可省略但保留完整 `title`，复制按钮固定 44px。
- 徽标最多直接显示 2 个，其余以 `+N` 显示；徽标允许换行并限制在媒体边界内。
- 手机卡片操作按钮纵向堆叠、宽度 100%、最小高度 44px，文字可换行。
- 工厂卡片标题、描述和元信息允许任意长词换行；生产流程卡片在手机上缩小
  内边距后两列展示。
- 证书卡片增加移动端紧凑内边距、可换行标题/链接和徽标换行，避免双列内容
  撑破卡片。

### 20.3 验收

- storefront 17 项测试、typecheck、lint、storefront build 与 Prettier 均通过。
- 产品页实测列数：320=1、360=2、375=2、430=2、768=3、1280/1440=4；
  中英文 375 均为双列、320 均为单列。
- 所有产品图片为 1:1 `contain`，按钮完整位于卡片和屏幕内、无文字裁切；
  最小按钮高度 44px、SKU 复制目标 44px，3 个徽标的数据显示为 2 个徽标 +
  `+1`。
- 分类页 320 单列、375/430 双列；工厂图库与生产流程 320 单列、375/430 双列；
  证书页 320 单列、375/430 双列，均无页面级横向溢出或卡片内容溢出。
- 询盘测试：加入后按钮为 `In inquiry`、`aria-pressed=true` 且询价栏出现；
  移除后状态与询价栏恢复。分页从第 1 页点击到第 2 页后仍保持双列。
- 冷加载产品、分类、工厂、证书页面均无 Console hydration 异常；超长英文标题
  与不间断长 SKU 不撑破双列卡片，详情和询盘按钮仍完整可点。

## 21. 询盘 WhatsApp 同源代理修复（2026-10-20）

- 根因：前台 POST 发送 `x-session-id`，浏览器预检要求该头；API 的
  `Access-Control-Allow-Headers` 未包含它，Chrome 报
  `HeaderDisallowedByPreflightResponse: x-session-id` 并中止为
  `net::ERR_FAILED`，业务接口没有执行。
- 前台 `createInquiryIntent` 改为请求同源
  `/api/v1/public/inquiry-intents`；Storefront Next 仅将该路径服务端代理到
  `STOREFRONT_API_PROXY_TARGET`（默认 `http://localhost:3002`）。
- 管理员 API 继续使用其独立同源代理；其它前台公开 API 调用未改。客户端不再
  需要知道或直连内部 API 主机。
- 生产构建真实浏览器验证：只发送同源 POST，无 OPTIONS 预检，返回 201，无
  `ERR_FAILED` / Console 异常；询盘预览和 WhatsApp URL 均正常生成。通过局域网
  地址访问前台同源路径也返回 201。
- storefront 19 项测试、typecheck、lint、Prettier 和生产构建通过。
- 部署时须设置 `STOREFRONT_API_PROXY_TARGET`，并验证 Storefront 服务端可访问
  API；若依赖真实 IP 的国家统计/限流，还需确认代理覆盖并转发可信
  `X-Forwarded-For`。本次无数据库迁移。

## 22. 移除 Excel 转 PDF、保留商品报价与 PI Excel（2026-10-21）

### 22.1 功能边界与共享链路

- 完整移除 Excel 转 PDF 的后台页面、API module/controller/service、DTO、
  `pdf-convert` 队列契约、Worker 注册与 LibreOffice 专属环境变量；功能不再只靠
  隐藏菜单或按钮下线。
- 保留 `quote-export` 队列、`JobsService`、BullMQ、Redis、对象存储与
  `apps/worker/src/jobs/quote-export.ts`。商品报价和 PI 的 `.xlsx` 均通过该
  Worker 使用 ExcelJS 生成。
- 保留图片派生、物理文件删除、删除任务 sweeper 和访问聚合 Worker；未清理或
  重建任何共享基础设施。
- 保留 `PdfConversionJob` Prisma 模型、初始建表迁移、历史审计筛选标签，以及
  文件删除/内容资产检查中对历史 `pdf_conversion_job` 的保护分支。本次不删除
  历史 PDF 记录或对象存储文件。

### 22.2 菜单与数据库迁移

- 菜单 seed 不再声明 `pdf-conversions`，seed 自身的 orphan 规则会停用既有菜单
  记录；新增非破坏性迁移
  `20261021100000_disable_excel_to_pdf_menu` 仅将既有菜单设为
  `enabled=false, visible=false`。
- 迁移不删除 `Menu`、`MenuTranslation`、`Permission`、`RolePermission`、
  `PdfConversionJob`、审计或文件。回滚 SQL 已附在迁移文件注释中，只在应用版本
  回滚时恢复菜单可见性。

### 22.3 自动化验证

- API：21 个测试文件、181 项通过，包含 PDF module/route/schema/queue contract
  负向接线检查及报价 Excel 接线保护。
- Worker：4 个测试文件、10 项通过；真实生成并重新读取商品报价与 PI 工作簿，
  覆盖 SKU 前导零、公式注入转义、内部报价列和 PI 总额。
- Admin：14 个测试文件、148 项通过。
- Storefront：6 个测试文件、19 项通过；Contracts 15 项通过。`pnpm run lint`、
  `pnpm run typecheck` 与 `pnpm run build` 通过。
- 本次变更文件通过 Prettier；全仓 `pnpm run format:check` 仍报告 124 个既有
  未格式化文件，均不在本次功能改动范围，未做无关批量格式化。
- 全仓库负向扫描确认业务代码、菜单、API、任务注册、配置和部署文件中不再存在
  可执行的 Excel 转 PDF 实现；剩余 PDF 命中均为历史数据保护、历史审计和证书/
  通用文档上传等有意保留能力。
- 本地非破坏性迁移实测成功；只读核对显示 `pdf-conversions` 菜单为
  `enabled=false, visible=false`，`pdf_conversion_jobs` 历史表仍存在。

### 22.4 发布与回滚

- 发布前暂停创建新的 PDF 转换任务并确认在途任务处理策略，保留并观察共享 Redis；
  不得清空队列或生产数据。
- 新版本 API 不再暴露 `/admin/pdf-conversions`，Worker 不再消费
  `pdf-convert` 队列；旧版本遗留任务不会被识别为 `quote-export` 任务。
- 回滚应用镜像时同步恢复旧 Worker；历史 PDF 表、文件和审计始终保留。若恢复旧
  后台菜单，按迁移注释重新启用 `pdf-conversions` 菜单。

## 23. 轻量部署图片优化 Phase 1（2026-10-21）

- 复用现有 Sharp Worker，不新增图片服务或重复资产表；上传后先处于
  `processing`，只有真实解码并生成、复核 WebP variants 后才进入 `ready`。
- 默认生成 320/640/1280 WebP，不放大原图；AVIF 因缺少目标服务器 CPU/内存实测
  暂不启用。开发机 2400×1600 合成图缩至 1280 宽的对照中，WebP q82 约 98–99 ms、
  565,716 bytes；AVIF q55 约 1,316–1,328 ms、404,201 bytes，进程 RSS 约
  160 MB，因此当前不把 AVIF 放入默认上传链路。
- 公共商品图使用 `assetId + SHA-256 内容版本` 不可变 URL，前台卡片、详情图库与
  询价缩略图通过 `srcset/sizes` 加载；商品未发布、图片删除中或版本不匹配时返回
  404。
- 商品源图改为后台鉴权预览；通用 public file 路由不再暴露 `product-image`。
  报价模板 `isPublic=false`，PI/报价导出继续使用鉴权或短时签名下载。
- 物理删除会清理源文件和全部 WebP variants；任一派生对象删除失败都会保留任务、
  失败状态和重试能力，不再吞掉失败后假报成功。
- 新增 Worker 配置：`IMAGE_PROCESSING_TIMEOUT_SECONDS=20`、
  `IMAGE_PROCESSING_CONCURRENCY=1`、`IMAGE_WEBP_QUALITY=82`。本轮无数据库迁移。
- 本轮未切换 SQLite、未移除 Redis/BullMQ、未删除历史图片或队列数据。
- 自动化结果：Contracts 17、Worker 14、API 187、Admin 148、Storefront 21，
  共 387 项通过；文件删除真实数据库/本地存储验收 20/20 通过。

## 24. Cloudflare + Neon + R2 + PostgreSQL Task Runner（2026-10-23）

### 24.1 已落地代码

- API/Worker 移除 BullMQ/ioredis；任务真相继续复用 `FileDeletionJob`、`QuoteExportJob`
  和 `OutboxEvent`，未新建重复队列表。
- Additive migration `20261023120000_durable_task_leases` 增加 `runAfter`、
  `lockedBy`、`lockedUntil`、`heartbeatAt`、`completedAt` 和 Outbox 幂等键。
- 单并发 PostgreSQL task runner 使用 `FOR UPDATE SKIP LOCKED` 原子 claim，执行期间
  heartbeat，失败按指数退避重试，崩溃后过期租约可恢复；图片/分析事件写入 Outbox。
- API 任务的创建与业务状态写入同库事务；图片上传任务只有在 Outbox 持久化成功后才
  视为受理，避免只存在于进程内或外部队列。
- R2 StorageAdapter 支持 public/private 双 bucket、未知前缀 fail-closed、S3 presigned
  PUT/GET、HEAD 元数据和 API/Worker 一致路由。
- Admin 图片上传优先 R2 presigned PUT + HEAD confirm；非 S3 环境返回
  `UPLOAD_DIRECT_UNAVAILABLE` 并由前端回退到 multipart。
- Neon/迁移连接分离：runtime 使用 `DATABASE_URL`，`prisma migrate` 在存在
  `DIRECT_DATABASE_URL` 时自动切换 direct 连接。
- Excel 导出增加 `QUOTE_EXPORT_MAX_PRODUCTS`（默认 5000）硬上限，API 创建与 Worker
  执行都只读取 `max + 1` 行并明确拒绝超限，避免无界内存加载。

### 24.2 Cloudflare Worker POC

- 固定版本：Next.js 15.5.28、`@opennextjs/cloudflare@1.20.13`、`wrangler@4.152.0`。
- Storefront 本地 OpenNext Worker bundle 通过；Wrangler preview 验证：
  `/` → 308 `/en-US`，首页/产品列表/动态产品详情均 200，标题、JSON-LD 与无价格扫描通过。
- Admin 本地 OpenNext Worker bundle 通过；登录页 200，Admin 同源
  `/api/v1/health/ready` rewrite 200，错误登录 POST 经代理返回 401。
- 尚未使用真实 Cloudflare 账号做 preview deployment、完整登录 Cookie/CRUD、R2 上传、
  Excel 下载和多版本回滚，因此 Phase 1 生产切换仍为 No-Go。

### 24.3 数据库任务验收

- 本地迁移 validated + deployed；未删除历史任务或业务数据。
- `acceptance:task-runner` 20/20：4 个 runner 并发领取无重复、attempt/lease 正确、
  过期租约可恢复、runner 真实删除 QA 私有对象并清除锁；存储失败会重新排队并保留
  error/runAfter，恢复后排空任务并删除对象。
- `acceptance:file-delete` 20/20：存储失败保持 key/FAILED、人工重试、幂等、商品清理
  等待图片对象和审计均通过。
- `pnpm run lint`、`pnpm run typecheck`、`pnpm run build` 通过；全仓测试
  Contracts 19 / Worker 13 / API 194 / Admin 149 / Storefront 21，共 396 项通过。
- Cloudflare Storefront/Admin 的 OpenNext Worker 本地 build 均通过；Wrangler preview
  实测 Storefront 根路径 308、首页/列表/动态详情 200，Admin 登录页 200、同源
  health rewrite 200、错误登录代理 401。

### 24.4 剩余 No-Go / 外部验收

- 未创建真实 Neon project、R2 buckets、Cloudflare preview deployment；无外部凭据，
  不能宣称生产 Go。
- 未完成 Neon PITR 恢复演练、R2 CORS/私有匿名访问实测、Cloudflare 完整 Session/CRUD
  与 Excel 下载验收。
- 未完成 2C/1G + Sharp/Excel/Runner 的 RSS、P95、OOM 和 swap 压测。
