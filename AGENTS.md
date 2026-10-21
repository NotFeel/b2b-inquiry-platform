# AI 开发助手强制规则（必须遵循）

本文件优先级高于一般代码生成习惯。开始任务时先读取本文件，再读取对应 `.agents/skills/` 技能。

## A. 需求与变更
1. 实现前先定位相关需求文档、数据模型和已有代码，禁止凭空新建重复模块。
2. 如需求有歧义，先采用 `docs/14-open-decisions.md` 中的默认值；涉及金额、权限、数据删除、隐私或外部 API 时，必须在交付说明中列出假设。
3. 每次实现应说明：改动范围、关键业务规则、数据库迁移、测试命令、风险和回滚方式。
4. 不做无关重构；不擅自改技术栈、依赖主版本、公共 API 结构或设计 Token。

## B. 绝对禁止的安全与业务错误
1. **前台绝不泄漏价格**：公开 DTO、查询投影、SSR props、页面 HTML、搜索索引、OG/JSON-LD、缓存、日志和导出均不得包含产品内部价格。禁止只靠 CSS 隐藏价格。
2. 未登录用户不得访问后台 API。前端菜单隐藏不等于权限控制；后端必须逐接口执行权限验证。
3. 不允许公开注册后台账号。初始管理员通过受控 bootstrap 命令创建，生产环境不得写死默认密码。
4. 不提交 `.env`、Token、密码、真实客户电话、生产数据或私钥；只更新 `.env.example`。
5. 不信任上传文件名、MIME、扩展名、压缩包内容、Excel 单元格或富文本 HTML；先校验、限额、隔离处理。
6. 删除导出记录时必须完成数据库记录与物理文件的协同删除；失败时记录可重试任务，不允许静默遗留文件。
7. 业务数据删除、权限调整、PI 文件生成、导出/下载等敏感操作必须验证权限并留必要审计记录。
8. 禁止将管理员密码、Session ID、访问 Token、完整 IP 或客户个人信息写入普通日志。

## C. 代码质量
1. TypeScript 开启严格模式；避免 `any`，确需使用时说明理由并收窄范围。
2. 输入 DTO 必须服务端校验；服务层不直接依赖 HTTP Request/Response 对象。
3. 数据访问必须参数化；多步写操作使用事务；金额使用 Decimal/定点数，不用二进制浮点累加金额。
4. 所有分页接口有最大 pageSize；列表默认排序稳定；过滤、排序字段采用白名单。
5. 统一异常响应、日志字段、日期时区、分页格式、国际化 key 和 API 命名。
6. 新功能必须包含适当的单元测试；影响业务流程的功能补集成测试；关键用户流程补端到端测试。
7. 修改数据库结构必须提交版本化迁移，不得只修改 ORM 模型。
8. 新增外部依赖前评估维护状态、许可证、安全、包体积及部署成本。

## D. 前端质量
1. 所有页面必须适配 360px 手机、平板和桌面；禁止依赖固定宽度造成横向溢出。
2. 颜色、间距、字体、边框、阴影、断点和 Z-index 使用统一设计 Token。
3. 后台所有界面文案通过 `zh-CN` / `en-US` 翻译资源管理；禁止散落硬编码文字。
4. 前台面向客户的默认内容和 UI 文案为英文。商品描述数据使用英文内容；未来多语言内容按 locale 数据模型扩展。
5. 所有按钮必须有真实功能、禁用/加载/错误状态和可访问名称；禁止占位按钮与虚构数据冒充完成。
6. 可访问性：语义化 HTML、键盘操作、焦点可见、表单关联 Label、图片 alt、对比度满足 WCAG 2.2 AA 目标。

## E. 完成定义（Definition of Done）
- 对应需求可追踪；正常、异常和边界流程已考虑。
- lint、typecheck、相关 tests、build 全部通过；不能运行的检查须说明原因。
- 数据库迁移与回滚策略清晰；新增环境变量同步更新 `.env.example` 与部署文档。
- 文档、API 类型、测试和界面同步更新。
- 没有已知的价格泄漏、权限绕过、未校验上传、明显响应式缺陷或秘密信息。

## F. 后台布局与导航规则
1. 所有受保护后台路由必须复用唯一 Admin Shell；Dashboard 页面只负责自身业务内容。
2. Header 的菜单开关必须在侧栏隐藏时仍然可见；Dashboard API 的 loading/error/empty 不得卸载 Shell。
3. 修改登录跳转、Sidebar、Header、路由布局前必须阅读 `docs/16-dashboard-layout-sidebar-fix.md` 并补齐桌面/平板/手机验证。
4. 任何导航折叠或抽屉行为都不能替代服务端权限校验；菜单隐藏不等于授权。

## G. 用户管理与角色分配规则
1. 改造用户管理页面前必须阅读 `docs/17-user-management-edit-role-selector.md` 和 `.agents/skills/user-management/SKILL.md`。
2. 用户新建/编辑表单中的角色必须来自角色 API，使用结构化 `roleIds` 数组；禁止使用逗号分隔自由文本或仅靠客户端角色名称映射。
3. 角色分配必须由后端重新校验操作者授权、目标角色存在性和可分配策略，并原子更新用户角色关联。
4. 用户普通编辑不允许修改登录账号、密码或状态；账号/状态/密码操作遵循各自独立的安全流程与权限。
5. 保护最后一名有效超级管理员；角色变更应记录审计并使相关权限缓存及时失效。


## H. 角色管理与权限配置规则
1. 改造角色权限模块前必须阅读 `docs/18-role-permission-crud-and-menu-permissions.md` 和 `.agents/skills/role-permission-management/SKILL.md`。
2. 授权事实来源为 `Permission` + `RolePermission`；不得平行创建一套与后端 API 授权不一致的角色菜单授权表。
3. 角色列表应提供搜索、创建、查看权限、编辑与受保护删除；权限树必须读取真实菜单/权限 API，不能使用前端硬编码权限数据。
4. `isSystem=true` 的系统角色不可由普通管理流程编辑、修改授权或删除；仍关联用户的角色不可删除，后端必须二次校验。
5. 权限更新端点必须服务端校验操作者、目标角色、所有 permission code 和可授予范围，并在事务中更新、记录审计、失效权限缓存。
6. 菜单隐藏和按钮隐藏均不构成安全控制；每个后台 API 必须使用服务端权限验证。
7. 修改 `Role.nameKey` 或国际化结构前，必须先确认名称 key 与实际显示文案的边界；数据库变化必须附迁移、回填和回滚计划。


## I. 菜单管理与子菜单配置规则
1. 改造菜单管理模块前必须阅读 `docs/19-menu-management-crud-and-submenu-design.md` 和 `.agents/skills/menu-management/SKILL.md`。
2. 菜单管理默认使用可展开的树形表格，必须支持查询、新增一级菜单、新增子菜单、编辑、同级排序、启停/可见和受保护删除；不能只渲染只读平铺表格。
3. `Menu` 是导航配置；`Permission` + `RolePermission` 是后端授权事实来源。菜单可见性不得替代 API 权限校验，绑定菜单 permissionCode 不得自动授予角色权限。
4. 菜单名称必须通过 `MenuTranslation` 和 locale 资源管理；至少支持 `zh-CN`、`en-US`，禁止将翻译做成固定中文/英文列。
5. permissionCode 必须从现有权限目录中查询并由后端重新校验，禁止前端硬编码列表或接受未经验证的自由文本权限码。
6. 后端必须校验父节点存在、不可形成树循环、路由/编码冲突、locale 和权限码合法性；树与翻译更新需要事务一致、审计记录及缓存失效。
7. 删除有子菜单或受保护的系统菜单必须被拒绝；删除菜单不得级联删除 Permission / RolePermission。不得仅凭名称重复就删除 `administration` / `system` 节点，必须追踪 ID、子节点和所有引用。
8. 修改 Prisma schema 必须提供版本化 migration、数据回填与回滚说明；先审查当前模型，避免不必要地新增菜单授权表或重复字段。


## J. 字典两层结构与业务复用规则
1. 改造字典模块前必须阅读 `docs/20-dictionary-management-two-level-model.md` 和 `.agents/skills/dictionary-management/SKILL.md`。
2. 首先审计并复用 `DictionaryType` → `DictionaryItem` → `DictionaryItemTranslation`；禁止未检查现有数据/API 前新建重复字典表。
3. `DictionaryType.code` 是一级 typeCode，`DictionaryItem.code` 是稳定二级业务键，翻译 label 只负责展示；禁止把 label 或模糊的 `DictionaryItem.value` 用作业务主键。
4. 通用业务表单通过一级 typeCode 调用统一字典接口获取二级 items；默认只返回启用项，历史记录编辑必须能展示已停用的当前值。
5. 服务端必须校验 item 属于期望的 type、唯一约束、系统锁定、业务引用与操作者权限；被引用 item 不可物理删除，类型有字典项时不可删除。
6. 状态字典（例如商品发布状态、生命周期状态）可能影响查询、发布与前台可见性；新增字典项不能等同于新增业务流程。未经设计状态转移与全链路兼容，不允许任意新增/删除系统状态 code。
7. 字典项/翻译/状态变更后失效对应 typeCode 与 locale 的缓存；后台锁定项不能展示可正常执行的删除/停用按钮。
8. 如果将 Product enum 迁移到 DictionaryItem 外键，必须分步 expand/backfill/verify/switch/contract，提供迁移计数校验、回滚计划及全链路测试。


## K. 全局设置管理规则
1. 改造全局设置模块前必须阅读 `docs/21-global-settings-management.md` 和 `.agents/skills/global-settings-management/SKILL.md`。
2. 必须先盘点现有 `GlobalSetting`、迁移、seed、配置 key 引用、公共配置 DTO 与缓存；禁止覆盖/重建现有表或丢失现存 JSON 值。
3. 后台设置应支持分类、搜索、筛选、新建、编辑和受保护删除；新增/编辑使用统一表单，字段控件必须匹配 `valueType` 并由后端再次校验。
4. 系统内置项、被引用配置和基础设施配置密钥不得通过普通 CRUD 删除或修改；无法确认使用情况时，采用废弃标记而不是物理删除。
5. `isPublic` 与 `isSecret` 必须互斥；秘密值不允许从 list/detail API 返回，不得进入日志、审计 diff、错误响应、缓存公开副本或前台 HTML。
6. 公共设置必须通过服务端 allowlist DTO 暴露；禁止开放任意 key 的公共读取接口。所有公共返回和页面输出继续遵守前台不得泄漏商品价格的规则。
7. 对每个管理端 API 实施独立的 `settings.read/create/update/delete` 授权；前端按钮隐藏不能代替后端鉴权。
8. 设置值和翻译更新应使用事务，记录脱敏审计，并失效服务端、公共配置、ISR/CDN 和必要客户端缓存；并发更新必须检测冲突。
9. 数据库改动必须使用版本化 additive migration，保留旧 key/value；必须提供回填校验、测试、发布和回滚说明。

## L. 品类树管理规范
1. 改造品类管理模块前必须阅读 `docs/22-category-management-tree-workbench.md` 和 `.agents/skills/category-management/SKILL.md`。
2. 默认复用现有 `Category.parentId` 自关联和 `CategoryTranslation` 多语言结构；先查实际 schema、迁移与 API，禁止未经审查新建重复品类表或将中英文名称硬编码到主表。
3. 后台品类管理必须提供可搜索的树形视图、展开/折叠、路径、选中详情、子品类列表；新增一级、添加子类和编辑通过统一表单完成。父级必须由树形选择器选择，不允许手填 UUID。
4. 服务端必须校验 code/slug 唯一、父节点存在、禁止选择自身/后代、最大深度、排序、并发更新与操作者权限。前端校验仅用于改善体验，不能替代后端验证。
5. 必须区分 `enabled` 与 `visible` 并统一定义父节点状态对整个后代分支的公共可见性影响；公共品类树和公共商品查询不得直接复用后台 DTO。
6. 删除有子节点或商品引用的品类必须由服务端阻止，不得级联删除商品；默认使用停用/隐藏或经过确认的商品迁移流程。已发布 slug 修改必须考虑旧链接/SEO 重定向。
7. 统计时明确区分直接商品数与含后代的总商品数，避免 N+1 查询；树/翻译/计数应批量读取。写操作之后必须失效管理端树、公共目录和相关产品列表缓存。
8. 品类管理必须支持 `zh-CN` / `en-US` 翻译；所有状态、空状态、错误提示和表单文案走统一国际化资源。
9. 数据库变更必须有版本化 migration、回填校验和回滚步骤；不需要 schema 变化时不要创建空迁移。至少测试树循环、最大深度、重复 code/slug、删除保护、API 权限、前台后代商品筛选和移动端布局。


## M. 标签管理规范
1. 改造标签管理前必须阅读 `docs/23-tag-management-crud-and-ui-optimization.md` 和 `.agents/skills/tag-management/SKILL.md`。
2. 当前模型已存在 `Tag`、`TagTranslation`、`ProductTag`；必须先审查真实 schema、migration、接口和数据，再决定变更，禁止重复建表。
3. 标签编码 `code` 是稳定业务键，标签名按 locale 存储在 `TagTranslation`；公开前台默认使用英文翻译，后台至少支持 `zh-CN` / `en-US`。
4. 当前 `Tag` 模型没有 `type` 字段；未经业务定义与 schema/API 设计不得提供无法持久化的自由文本“类型”输入。`colorToken` 必须映射到设计系统白名单，禁止任意 CSS 注入。
5. 标签列表必须支持搜索、状态/使用情况筛选、商品关联数、编辑、启用/停用和受保护删除；新建/编辑复用统一表单。`productCount` 是服务端聚合字段，客户端不可写入。
6. 若标签仍被 `ProductTag` 引用，删除 API 必须返回明确的冲突响应（例如 HTTP 409），不得删除关联或静默级联。停用应保留历史关联，公共页面不再展示该标签。审查 `ProductTag.tag` 现有 cascade 外键风险，并在评审迁移后加固为 Restrict/等效约束。
7. 所有管理 API 必须逐端点执行服务端权限校验、DTO 校验、审计和缓存失效；按钮隐藏不是权限控制。多语言更新与标签主表写入必须事务一致。
8. 检查 `featured` / `new-arrival` 标签与 `Product.isFeatured` / `Product.isNew` 是否重复；未经差异报表、迁移方案和回归测试，不得自动删除或合并。
9. 测试必须覆盖重复 code、缺少翻译、在用标签删除保护、并发新增引用、权限越权、停用后的公共端缓存刷新和 360px 响应式布局。任何 schema 改动必须包含版本化 migration、校验和回滚方案。

## N. 商品管理、图片图库与物理删除规则
1. 改造商品模块前必须阅读 `docs/24-product-management-crud-and-image-storage.md` 和 `.agents/skills/product-management/SKILL.md`，并先检查真实 schema、migrations、API、文件存储和缓存实现。
2. 商品表单字段必须分组；商品长宽高和箱规长宽高要分别标注；品类使用真实树选择器；标签使用结构化 ID 数组；商品状态选项必须与数据库真实可持久化状态一致。
3. 图片管理必须支持上传、预览、封面、排序、altText、进度和失败重试。新上传文件使用服务端生成的不可预测 storageKey；校验文件签名、格式、大小、像素和数量限制，禁止依赖浏览器 MIME 或原始文件名。
4. 用户要求商品图片删除必须真实物理删除。只删除 `ProductImage` 关联、仅隐藏 URL 或仅删除 DB 元数据不算完成。删除前须检查图片归属、key 管理范围与是否被其他产品/广告/品类引用；共享对象必须返回冲突，禁止静默损坏其他业务。
5. 因数据库与对象存储无共享事务，必须持久化删除任务/outbox，然后由 worker 幂等删除物理对象；对象已不存在可视为成功，存储故障必须保留 key、状态、审计和重试能力，不能假报成功。成功后清理图片/专属资产元数据、缩略图和 CDN 缓存。
6. 物理删除商品前必须先持久化每张图片的删除任务并完成对象删除，之后才能删除 Product/Image 数据；禁止先利用 Prisma `onDelete: Cascade` 删除图片行再尝试寻找文件 key。
7. 商品内部价格永不进入公共 DTO、HTML、SSR props、JSON-LD、搜索索引或前台缓存。每个后台 API 仍需独立 RBAC 校验，前端隐藏按钮不是安全措施。
8. 任何模型变化必须提交版本化 migration、数据对账、回滚说明和真实存储验证。至少测试上传失败、物理删除失败/重试、共享 Asset 冲突、重复请求幂等、封面重选、商品删除以及 360px 响应式。


## O. 商品品类选择器可选择性与 UI 规则
1. 修复商品品类选择器前必须阅读 `docs/25-product-category-picker-selectability.md`、`docs/24-product-management-crud-and-image-storage.md`、`docs/22-category-management-tree-workbench.md` 和 `.agents/skills/product-category-picker/SKILL.md`。
2. 必须先复现并确认真实根因，检查树接口 response、节点点击/展开事件、表单状态、编辑回填、保存 payload 与后端错误；不得只改 CSS 或把视觉高亮当作功能修复。
3. 所有层级的已启用品类（包括带子节点的父品类）都可被商品选择。展开/折叠按钮和选择节点名称/行必须是独立交互，不得把父节点设为不可选或只允许选叶子。
4. 商品表单只将 Category UUID 写入 `categoryId`；不得提交品类显示名称、`code` 或 `slug` 作为关联 ID。新建、编辑、列表筛选应共享同一底层组件，但表单模式必填、筛选模式可清空。
5. 品类树应在 Popover/Drawer 中按需打开；列表筛选不得常驻展开整棵树。选择器必须支持搜索、路径显示、明确选中标志、键盘操作、加载/错误/空状态和 `zh-CN` / `en-US`。
6. 异步加载品类树不得清空或覆盖编辑页已有 `categoryId`；语言切换只改变 label，不改变 ID。服务端必须再次校验所选类别存在、用户权限和启用状态；前端状态不能代替后端验证。
7. 优先复用现有 Category API、schema、表单库和 UI 组件；无必要不得新建重复分类表、接口或组件库依赖。至少测试父级选择、展开/折叠、深层节点、编辑回显、实际 payload、过滤后代、接口失败、键盘操作和移动端布局。

## O. Product slug and admin navigation internationalization
1. Before changing product slug behavior or admin menu language, read `docs/26-product-slug-and-admin-navigation-i18n.md` and `.agents/skills/product-slug-and-admin-navigation-i18n/SKILL.md`.
2. Product slug generation must support explicit manual input and `name` / `name-random` strategies. New product slug suggestions default to a six-digit random suffix, but users can opt out. Use server-side cryptographic random numbers and preserve `Product.slug` unique constraint; resolve uniqueness races as field errors/retries as appropriate.
3. Never silently overwrite an existing slug when product name changes, on edit-page load, or on locale tab switching. Existing product slug is preserved unless the user explicitly generates a replacement. Published slug changes must follow the redirect/block policy in the design doc.
4. For admin routes, URL locale (`/en-US/...`, `/zh-CN/...`) is the single source of truth. Sidebar, group labels, breadcrumbs and page static text must consistently follow this locale.
5. Reuse existing `MenuTranslation` records as the source of menu labels. Do not hardcode menu labels in Sidebar or introduce a duplicate translation table. Backfill missing `en-US` / `zh-CN` translations against existing menu IDs/code using an idempotent seed/migration strategy; do not create duplicate menu records.
6. English navigation must not silently display Chinese when translation is missing. Add translation coverage verification for all enabled/visible menus and route-less group nodes. Missing translations must be reported and fail tests/CI.
7. Locale must be included in client and server navigation cache keys; include user/authorization version as appropriate so translations cannot cross locales and menus cannot leak across permission scopes. Locale switching must update the URL prefix, preserve valid path/query, and refresh localized navigation resources.
8. Do not skip server-side menu/API authorization. Navigation visibility remains presentation only and never replaces RBAC.
