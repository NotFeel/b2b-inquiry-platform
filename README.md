# B2B 产品展示与 WhatsApp 询盘平台：开发基线文档包

> 版本：0.1.0（需求基线）  
> 语言：文档中文；前台产品界面英文；后台界面中英双语  
> 项目类型：B2B Catalog / Inquiry Website，而非在线支付商城

## 1. 项目目标

建设一个面向海外客户的响应式 B2B 产品展示网站。访客可以浏览、搜索、按多级品类筛选产品、查看产品和包装信息、批量选择产品，并通过 WhatsApp 发起询盘。**前台任何页面、接口、SEO 数据、结构化数据和前端资源都不得泄漏产品价格。** 后台负责品类、产品、广告、系统设置、商品报价单 Excel 导出、PI（Proforma Invoice，形式发票）、询盘客户记录与访问分析；Excel 转 PDF 不属于目标功能范围。

## 2. 推荐默认技术方案

- Monorepo：pnpm workspace + Turborepo（如团队不需要任务缓存，也可先用 pnpm workspace）。
- 前台：Next.js App Router + TypeScript，优先 SSR/ISR 与 SEO 友好路由。
- 后台：独立 Next.js 应用 + TypeScript；中英 UI 翻译字典。
- API：NestJS + TypeScript，REST API，统一 DTO、校验和异常响应。
- 数据库：PostgreSQL；ORM：Prisma（锁定稳定版本，并在开始开发时依据官方迁移指南固定主版本）。
- 异步任务：当前代码仍使用 Redis + BullMQ；目标轻量生产架构评估以 PostgreSQL 持久化任务表替代 Redis，需完成任务迁移、幂等/重试/租约与验收后才可移除。
- 文件：开发环境可本地存储；生产环境优先 S3 兼容对象存储，数据库只保存文件元数据和 object key。
- Excel：ExcelJS；商品报价单和 PI 的 `.xlsx` 由 Worker 异步生成。Excel 转
  PDF 不属于目标功能。
- 目标生产部署：Cloudflare Workers（前后台 UI，先做兼容性 POC）+ Neon PostgreSQL + Cloudflare R2 + 单台 2C/1G NestJS API；完整执行方案见 `docs/33-lightweight-cloudflare-neon-r2-implementation.md`。旧服务器全栈方案仅作为迁移期间/回滚路径。

具体版本必须在仓库 package.json / lockfile / Docker 镜像中固定；不得让 AI 根据“latest”临时升级核心依赖。

## 3. 文档导航

| 文件 | 用途 |
|---|---|
| `AGENTS.md` | 对 AI 编码助手的全局强制规则 |
| `docs/01-product-requirements.md` | 产品范围、页面和业务规则 |
| `docs/02-architecture.md` | 系统架构与模块边界 |
| `docs/03-project-structure.md` | 文件夹规划、文件存放规则 |
| `docs/04-data-model.md` | 核心实体、字段和状态设计 |
| `docs/05-api-contract.md` | API 约定与安全边界 |
| `docs/06-admin-public-ui-standard.md` | 前台/后台 UI 与响应式统一规范 |
| `docs/16-dashboard-layout-sidebar-fix.md` | Dashboard Shell 修复、可隐藏导航/抽屉、登录跳转、响应式与验收方案 |
| `docs/17-user-management-edit-role-selector.md` | 用户管理编辑入口、角色 API 多选、接口契约、RBAC、事务、测试与验收 |
| `docs/18-role-permission-crud-and-menu-permissions.md` | 角色 CRUD、菜单/操作权限树、授权 API、系统角色保护、删除规则、缓存与验收 |
| `docs/19-menu-management-crud-and-submenu-design.md` | 菜单管理 CRUD、树形菜单、多级子菜单、权限绑定、国际化、删除保护、重复系统菜单治理与验收 |
| `docs/20-dictionary-management-two-level-model.md` | 字典两层模型、类型/条目管理、按 typeCode 复用、国际化、系统锁定、业务引用保护与商品状态迁移 |
| `docs/21-global-settings-management.md` | 全局设置分类、搜索/过滤、配置 CRUD、双语元数据、密钥写入后不可读、公共配置 allowlist、迁移与验收 |
| `docs/22-category-management-tree-workbench.md` | 品类管理树形工作台、父子目录维护、双语表单、树查询与计数、排序/移动/删除保护、前台目录联动和验收 |
| `docs/23-tag-management-crud-and-ui-optimization.md` | 标签管理 CRUD、双语标签、样式 Token、启停与删除保护、商品关联及前台标签展示、测试与验收 |
| `docs/24-product-management-crud-and-image-storage.md` | 商品 CRUD、长表单 UI、品类与标签选择、图库上传/预览/主图/排序，以及真实存储文件永久删除、删除任务/重试、级联删除保护和价格隔离验收 |
| `docs/25-product-category-picker-selectability.md` | 商品品类选择器不可选故障排查、紧凑 Popover/树形选择器、受控 categoryId、编辑回填、列表筛选、国际化、响应式与端到端验收 |
| `docs/26-product-slug-and-admin-navigation-i18n.md` | 商品 URL slug 名称/随机数字生成、唯一性冲突处理、后台 en-US 菜单/分组/面包屑翻译、MenuTranslation 数据补齐、locale 缓存与语言切换修复 |
| `docs/07-backend-standard.md` | 后端开发规范 |
| `docs/08-excel-pdf-pi.md` | 商品报价单 Excel 与 PI 制作规则 |
| `docs/30-remove-excel-to-pdf-keep-quote-excel.md` | 移除 Excel 转 PDF、保留商品报价单 Excel 导出的 AI 可执行实施、测试、部署与回滚方案 |
| `docs/31-lightweight-deployment-sqlite-redis-image-optimization.md` | 轻量化部署、SQLite/Redis 取舍、数据库任务表、图片优化与旧架构评估（补充文档） |
| `docs/32-cloudflare-frontend-server-api-deployment.md` | Cloudflare 前后台、Next.js 兼容性、认证/缓存安全与迁移路线（专题文档） |
| `docs/33-lightweight-cloudflare-neon-r2-implementation.md` | **当前目标架构实施基线**：Cloudflare Workers + Neon PostgreSQL + R2 + 单台 2C/1G NestJS、PG 任务队列替代 Redis、部署、测试、验收和回滚 |
| `docs/09-whatsapp-leads-analytics.md` | WhatsApp 客户、去重和访问看板规则 |
| `docs/10-deployment-ops.md` | 部署、环境、备份、发布和故障处理 |
| `docs/29-production-server-deployment-runbook.md` | 生产服务器规格、首次部署、运行时、发布回滚与上线验收 |
| `docs/11-image-upload.md` | 图片上传、处理、存储和维护 |
| `docs/12-test-acceptance.md` | 测试策略与验收清单 |
| `docs/13-security-privacy.md` | 安全、隐私、价格隔离规则 |
| `docs/14-open-decisions.md` | 需要业务方确定的事项与默认值 |
| `.agents/skills/*/SKILL.md` | 可供 AI 代理按任务加载的技能规范，包含 `user-management`、`role-permission-management`、`menu-management`、`dictionary-management`、`global-settings-management`、`category-management`、`tag-management`、`product-management`、`product-category-picker` 与 `product-slug-and-admin-navigation-i18n` 专项技能 |
| `database/prisma/schema.prisma` | 初始数据模型草案；实施前需按所锁定的 Prisma 版本校验 |
| `database/sql/README.md` | SQL、迁移、种子和维护脚本存放规则 |
| `.env.example` | 环境变量名称示例，不包含任何真实密钥 |
| `infra/docker-compose.dev.yml` | 本地 PostgreSQL / Redis 开发依赖 |

## 当前目标生产架构（2026-10-23）\n\n正式架构实施前，AI/开发者必须优先阅读 `docs/33-lightweight-cloudflare-neon-r2-implementation.md`，以该文件确定目标拓扑与分阶段迁移顺序。`docs/31` 是轻量化/队列迁移的补充评估，`docs/32` 是 Cloudflare 兼容性与路由安全专题，`docs/29` 的原全栈服务器部署步骤不能视为最终目标部署拓扑。文档是计划，并不表示迁移已经实现或验收通过。\n\n## 4. 阅读与执行顺序

1. 先阅读 `AGENTS.md`、产品需求、架构和未决事项。
2. 项目初始化时锁定运行时、包管理器、主要依赖版本并提交 lockfile。
3. 按数据库模型创建正式迁移；所有迁移必须代码审查，禁止直接改线上表。
4. 先完成登录/RBAC、字典、全局设置和品类；再做产品、前台目录/详情和 WhatsApp 询盘。
5. 后续实现商品报价 Excel、PI、访问看板；每个功能同时交付测试与运维说明。
6. 发布前执行安全、响应式、SEO、价格泄漏和文件上传专项验收。

## 5. 核心产品原则

- 前台是“产品目录 + 询盘入口”，不是购物支付系统；不做购物车结算和在线支付。
- 前台不显示价格；隐藏 DOM、CSS 遮挡、只隐藏 API 响应字段其中任意一种都不算合格，必须从公共 API DTO 和缓存数据源层面移除价格字段。
- `产品生命周期状态`、`发布状态`、`新品/精选标记`彼此独立，不把所有含义塞进一个状态字段。
- 多级品类采用 parent-child 树；层级不硬编码为两级或三级。
- WhatsApp 普通点击链接无法自动读取业务员个人 WhatsApp 聊天历史。MVP 通过后台人工登记，并预留官方 WhatsApp Business Platform Webhook 集成点。
- IP 地址只能粗略推断国家/地区；地图展示聚合统计，不把 IP 地理定位表述为精确位置。


## UI 重设计方案

详见 `docs/15-ui-redesign-implementation-plan.md`。该文件规定了后台/前台统一设计系统、页面专项改造、响应式断点和验收标准。


## 标签管理专项规则

改造标签管理前阅读 `docs/23-tag-management-crud-and-ui-optimization.md` 与 `.agents/skills/tag-management/SKILL.md`。当前 schema 已有 `Tag`、`TagTranslation`、`ProductTag`，优先复用；在被商品引用时禁止物理删除标签，必须在后端二次校验并避免级联清空关联。当前模型没有标签 `type` 字段，未形成业务定义前不提供自由文本类型输入。


## 商品管理与图片物理删除专项规则

商品管理实施前阅读 `docs/24-product-management-crud-and-image-storage.md` 与 `.agents/skills/product-management/SKILL.md`。商品长表单应使用独立编辑页并按基本信息、状态、规格、箱规、内部报价、运营标记和图片图库分组。图片必须支持上传、预览、主图、排序、altText 和**真实物理删除**。删除图片不能只删除 ProductImage 行或隐藏 URL；必须检查共享引用，通过持久化任务和 worker 幂等删除真实对象，失败时保留 key 和可重试状态。永久删除商品前须先完成其图片对象清理，禁止先依赖数据库级联丢失 storageKey。公共接口与前台页面不得泄露内部价格。


## 商品品类选择器专项规则

商品创建、编辑和列表筛选中的品类字段改造前，必须阅读 `docs/25-product-category-picker-selectability.md` 和 `.agents/skills/product-category-picker/SKILL.md`。所有层级的已启用品类都可选择；展开箭头与选择操作必须分离；表单只保存 `categoryId` UUID；品类树异步加载不得覆盖编辑回填；列表筛选不得常驻展示整棵树。先定位点击事件、状态绑定、API payload 和后端拒绝原因，再修复，不得只修改 CSS。


## 商品 Slug 与后台导航国际化修复

详见 `docs/26-product-slug-and-admin-navigation-i18n.md` 和 `.agents/skills/product-slug-and-admin-navigation-i18n/SKILL.md`。商品 slug 提供英文名称、名称 + 六位随机数字两种生成策略，随机值由后端安全生成且仍保留数据库唯一约束。后台 locale 以 URL 为准；侧栏、分组、面包屑都使用 `MenuTranslation` 与统一 locale 资源，禁止在英文界面静默显示中文。
