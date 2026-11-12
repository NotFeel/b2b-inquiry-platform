# 首页产品展示与可配置品类管理 — AI 开发实施规范

> 文档编号：DOC-45 / STOREFRONT-HOMEPAGE-COLLECTIONS-01  
> 仓库：`NotFeel/b2b-inquiry-platform`  
> 目标分支：`main`  
> 文档状态：可执行开发规范；不代表功能已实现  
> 本次审查基线：以写入本文件前读取的 main 分支文件为准  
> 关联页面：`apps/storefront/src/app/[locale]/page.tsx`  
> 关联数据模型：`Category`、`Product`、`ProductTranslation`、`ProductImage`  
> 核心原则：增量改造现有首页，复用商品、分类、询盘、图片、国际化和权限体系；禁止重建商品目录系统。

---

## 0. 本次已确认的业务需求（不可由 AI 擅自更改）

### 0.1 首页区域顺序

首页从上到下严格按以下顺序组织：

1. **固定顶部导航栏**：滚动页面时保持可见。
2. **Hero 首屏大图区域**：品牌/产品主视觉图片 + 极简文字 + 必要行动入口。首屏要让访客直接知道这是 Squishy Toys 产品目录，不堆砌工厂介绍和长段文字。
3. **固定新品展示区域（New Arrivals）**：紧接 Hero，下方第一个商品区域。它是首页固定区域，不属于管理员可新增/删除的品类区。
4. **自定义品类精选展示区**：按 Admin 配置顺序，逐个展示所有已启用的首页品类；每个品类是独立区域。
5. **工厂能力 / OEM / ODM 内容区**：保留现有有效内容，但压缩文案，避免抢占产品展示的视觉重点。
6. **底部询盘 CTA / Footer**：保留现有 WhatsApp 和全站 Footer 能力。

**明确禁止：** 首页不得出现独立的总品类入口区，例如 `EXPLORE OUR COLLECTIONS`、全品类卡片总览或重复的 Category Directory。品类名称只作为各自商品展示区的标题；导航栏是否保留 Products 快捷入口不受此限制。

### 0.2 新品展示规则

- 新品使用现有商品的 `isNew` 标记及现有商品发布状态规则。
- 首页新品区域标题固定为 New Arrivals（通过现有翻译体系本地化）。
- 桌面端每行 6 个商品。
- 新品展示数量由 Admin 配置。
- 合法值仅为 6 的倍数：6、12、18、24、30、36。
- 默认值：12（如现有后台已有合理默认配置，可在迁移设计阶段说明后调整；不得超过 36）。
- 最大值：36。
- 当可展示新品不足配置数量时，展示实际可用数量，不填充其他商品，不显示空卡片。
- 商品排序沿用现有新品排序规则（核实现有查询的排序字段）；如需增加后台手动新品排序，必须另行评估，不在本期擅自改变商品主数据排序语义。
- 新品区与下方自定义品类区去重：同一商品如果已经出现在新品区，默认不再在首页品类精选区重复展示。建议在服务端按商品 ID 做跨区域去重，且保留后台配置顺序；被去重的商品不自动补位，除非后续产品确认改为自动补位规则。
- 新品区不得读取或显示内部价格字段。

### 0.3 自定义品类展示规则

- Admin 管理员手动选择商品，并手动排序。
- 每个首页品类必须关联现有一个商品分类（Prisma 模型 `Category`）。
- 一个启用品类对应首页一个独立展示区。
- 品类显示顺序由 Admin 拖动排序或排序值控制。
- 每个品类的精选商品数量独立配置，只能为 6 的倍数；默认 6。允许值建议 6、12、18、24、30、36；单个品类最大 36。
- 每个品类的商品仅能从其关联 Category 下选择。
- 商品显示顺序由管理员手动排序，不跟随商品目录排序自动变化。
- 每个品类标题、副标题居中显示。
- 商品桌面端每行 6 个。
- 品类商品网格底部放置一个居中的“View all … products”按钮。
- 按钮跳转到该品类对应的现有 Products 分类筛选页面，必须保留当前 locale。
- 品类隐藏时，整个品类区域不出现在前台；隐藏不删除 Category 或 Product。
- 删除首页品类配置不得删除分类、商品、图片、询盘、订单或其他业务数据。
- 不足配置数量时显示实际有效商品数量，不从其他分类自动补商品，不显示空白占位商品。
- 不允许同一个商品在同一个首页品类配置中重复关联。
- 建议同一个 Category 在首页只能有一条启用配置；是否允许同一 Category 多个不同标题的展示块，当前需求未要求，本期禁止重复配置。

### 0.4 响应式网格

| 屏幕 | 商品列数 |
|---|---:|
| 大屏桌面 | 6 |
| 普通笔记本 / 桌面 | 6 |
| 平板横屏 | 4 |
| 平板竖屏 | 3 |
| 手机 | 2 |

桌面端 6 列是验收硬要求。不得为沿用旧的 4 列样式而降低为 4 列。若容器宽度不足，应优化容器最大宽度、卡片内边距和列间距；仅在真正的平板/窄屏断点切换列数。禁止出现横向溢出。

---

## 1. main 分支真实代码审查基线

本节区分已核实事实与开发阶段仍需核实事项。AI 不得把待核实事项当作已经存在的功能。

### 1.1 已核实的首页文件

文件：`apps/storefront/src/app/[locale]/page.tsx`

当前首页已经：
- 使用 Next.js Server Component 页面结构。
- 通过 `storefrontApi` 并行获取站点配置、Hero 广告、Featured 商品、新品、Pre-order 商品、内容页面和 Home Sections。
- Hero 读取首页广告，使用 Featured + New Arrivals 的最多 3 个真实商品图片作为视觉素材。
- 使用现有 `ProductCard` 展示商品。
- 当前商品区域为 Featured、New Arrivals、Pre-order 三个 rail。
- 通过 `getHomeSections(locale)` 渲染结构化内容区；当前首页还可能渲染 Factory 内容、步骤区和最终 CTA。
- 使用 `localeHref` 生成带 locale 的 Products 页面链接。
- 使用 `WhatsAppCta`、`MediaFrame`、图片 srcSet 工具和现有翻译函数。

**本期改造要求：** 在这个页面上做增量重构，不另建一套平行首页。保留 SEO metadata、Hero 广告数据、国际化、WhatsApp、真实图片、现有商品详情/询盘能力。重新编排首页 section 顺序并替换旧的商品 rail 组织方式。

### 1.2 已核实的现有商品卡片

首页导入：
`apps/storefront/src/components/product-card.tsx`

复用原则：
- 新品网格与品类精选网格优先共用该 ProductCard。
- 不得重新实现 Add to Inquiry、SKU 复制、产品详情跳转、产品图片回退等已有行为。
- 若当前 ProductCard 的样式适合旧 rail 而不适合 6 列网格，采用新增布局 class / wrapper / 可选 variant 的方式适配；不要复制一份逻辑相同的卡片组件。
- 修改 ProductCard 时必须回归产品目录页、搜索结果页、其他使用该卡片的页面。

### 1.3 已核实的 Prisma 数据模型

文件：`database/prisma/schema.prisma`

**现有分类模型名称是 `Category`，不是 ProductCategory。**

Category 当前字段包括：
- `id`
- `code`
- `slug`
- `parentId`
- `coverFileAssetId`
- `sortOrder`
- `enabled`
- `visible`
- `translations`
- `products`

Category 通过 `CategoryTranslation` 按 locale 保存名称/描述；分类 URL 应使用现有 slug/Products 路由规则。

Product 当前字段包括：
- `id`
- `sku`
- `slug`
- `categoryId`
- `publishStatus`
- `lifecycleStatus`
- `isNew`
- `isFeatured`
- `isPreOrder`
- `sortOrder`
- `translations`
- `images`

Product 已有索引：
- `[categoryId, publishStatus, lifecycleStatus]`
- `[publishStatus, isFeatured, sortOrder]`
- `[publishStatus, isNew, sortOrder]`
- `[publishStatus, isPreOrder, sortOrder]`

Product 与 Category 的关系通过 `Product.categoryId` 建立；商品名称来自 `ProductTranslation`，图片来自现有 ProductImage/FileAsset/图片 URL 投影，不得在首页配置表复制商品名称、SKU、图片 URL。

### 1.4 当前首页请求数量

当前首页新品查询在 page.tsx 中使用：
`storefrontApi.getProducts({ locale, isNew: true, pageSize: 12 })`

本期改为读取 Admin 配置的新品数量（默认 12、最大 36、6 的倍数），不再硬编码 12。必须确认 API 分页最大值是否允许 36；若不允许，安全调整对应查询 DTO/校验上限，不得通过发起 6 次并行请求来拼凑 36 个商品。

### 1.5 仍需在阶段 A 核实的文件与约定

代码搜索索引当前不可用，开发前必须读取下列文件并确认实际结构，禁止凭空创建平行服务：
- `apps/storefront/src/lib/api.ts` 或实际定义 `storefrontApi` 的文件：新增公开首页数据读取方法。
- API 中 Products、Categories、Site Config、Home Sections 对应 module/controller/service/DTO。
- `apps/storefront/src/components/product-card.tsx`：确认 props 和询盘交互依赖。
- Storefront 全局布局、导航组件、header 样式和全局 CSS：确认固定导航的真实入口。
- 现有 Admin 商品管理、分类管理、广告/站点设置、Home Sections 管理页面：复用其表格、表单、图片预览、排序和权限模式。
- API RBAC permission seed、Admin 菜单注册、模块注册、DTO 验证和审计日志模式。
- 现有 Prisma migration 目录与 migration 命名格式。
- 当前 Products 页面分类筛选 URL 的真实参数/路径；底部按钮必须链接到实际可工作的 URL，不能猜测 `?category=` 参数。

---

## 2. 页面最终布局与 UI 规范

### 2.1 固定顶部导航

沿用现有全站 Header/Nav 组件；若当前导航由 layout 输出，应在 layout 级修改，不要只在首页复制一个 header。

要求：
- 使用 sticky 或 fixed 实现；优先 sticky，避免额外内容遮挡。
- 顶部层级高于页面内容，设置明确 z-index。
- 滚动时背景保持不透明，避免商品图片透过导航文字。
- 奶油白/白色背景、轻边框或柔和阴影。
- 桌面导航保留现有 Logo、Products、必要页面入口、搜索、Inquiry List、语言切换及 WhatsApp 入口（以现有实际能力为准）。
- 移动端折叠为 Logo、搜索、Inquiry 和菜单入口。
- 锚点滚动需设置 scroll-margin-top，避免标题被导航遮住。
- 回归所有页面，确认导航固定不会覆盖商品详情、Admin 外链或移动端菜单。
- 不要在导航中增加首页全品类卡片列表。

### 2.2 Hero 首屏

现有 Hero 保留数据来源和广告管理能力，但视觉重新聚焦产品：
- 使用当前 Home Hero 广告内容和真实产品图。
- 标题简短，推荐 1～2 行；突出 Squishy Toys / Cute Squishy Toys。
- 描述建议最多 1～2 行，不放大段公司介绍。
- CTA 保留 Browse Products 和 WhatsApp Inquiry 的现有行为。
- 产品图是主要视觉焦点；优先使用真实商品图片，继续使用 MediaFrame 与图片 srcSet。
- 不新增静态写死的产品 SKU 或虚构商品。
- Hero 视觉布局适配桌面、平板、手机；手机端先标题/CTA 后图片或按当前品牌视觉测试确定。
- Hero 图片必须有合理 alt、尺寸和 loading 策略；首屏主图可 eager，其余 lazy。
- 不得因改版破坏 SEO metadata、canonical、Open Graph。

### 2.3 New Arrivals 固定商品区

位置：Hero 紧接下方，为首页第一个商品区域。

UI：
- 区域标题居中：NEW ARRIVALS。
- 可选一行简短副标题，居中；无内容时不占高度。
- 商品网格桌面 6 列，卡片图像 1:1，统一间距和卡片结构。
- 商品卡片使用现有 ProductCard。
- 数量来自 Admin 设置，合法 6 的倍数且不超过 36。
- 无商品时不渲染空网格；是否显示空状态应采用简洁文案，不产生大面积空白。
- 是否显示“View all new arrivals”按钮沿用现有 Products filter 路由；不新增全品类入口。

### 2.4 首页自定义品类区域

每个 enabled HomepageCollection 独立输出一个 section，按 sortOrder 升序。

单个 section 结构：
1. 居中标题（collection title 的当前 locale 翻译）。
2. 居中副标题（可选）。
3. 标题下方轻量装饰线/星星/泡泡；装饰不可影响可访问性。
4. 6 列商品网格（桌面端），使用现有 ProductCard。
5. 居中分类按钮，按钮文字来自 locale 文案或配置；点击跳转该 Category 的 Products 分类筛选页面。

视觉风格：
- Kawaii + Modern Toy Brand：可爱、酷炫、简约。
- 奶油白为基础，局部使用糖果粉、薄荷绿、柠檬黄、淡紫色。
- 每个品类 section 可使用不同柔和主题色，但不做大面积强饱和色背景。
- 商品图片优先级最高，卡片标题、SKU 简洁清晰。
- 不要每个区块都堆叠复杂插画、长文案和多个 CTA。
- 不重复出现 Buyer Favourites 等冗余 kicker。
- 不使用商品价格，除非现有公开商品卡片已经按既定业务规则展示价格；不得泄露内部价格字段。

### 2.5 后续内容区

- 原 Home Sections 中的工厂介绍、Factory Preview、步骤介绍和 CTA 先盘点。
- 保留有价值的 Factory/OEM/ODM/包装定制内容，压缩为简洁内容块。
- 不得把 Home Sections 的工厂内容误当作产品 Category。
- 若当前结构化 Home Section 包含非工厂内容，按 code/type 精确筛选；不得一刀切删除所有内容。
- 最终顺序必须保持“Hero → New Arrivals → 自定义品类区 → 工厂能力/步骤/CTA”。
- 首页不渲染独立 Explore Our Collections 区域。

---

## 3. 数据模型设计

新增模型只存首页展示配置，不复制商品主数据。

### 3.1 HomepageDisplayConfig（新品展示设置）

建议新增单例配置模型（命名可按仓库现有配置模型命名习惯微调，但必须保留单例语义）：

字段建议：
- `id` UUID 主键
- `newArrivalsLimit` Int，默认 12
- `createdAt`
- `updatedAt`

规则：
- 数据库 CHECK 约束：值在 6、12、18、24、30、36 范围内（PostgreSQL CHECK 可以用范围 + MOD 表达）。
- 后端 DTO 必须再次校验，不能只依赖前端 select。
- 通过 service 的 get-or-create 或 seed 保证只有一条有效设置记录；若采用固定主键/固定 code，应写清楚并保证幂等。
- 不将新品商品列表复制到配置表；商品仍按 Product.isNew 查询。

### 3.2 HomepageCollection

建议字段：
- `id` UUID 主键
- `categoryId` UUID，关联现有 Category
- `enabled` Boolean，默认 true
- `sortOrder` Int，默认 0
- `productLimit` Int，默认 6；仅允许 6 的倍数且最大 36
- `createdAt` / `updatedAt`

多语言字段建议独立翻译表，遵循当前项目 `*_translations` 模式：

`HomepageCollectionTranslation`：
- `collectionId`
- `locale`
- `title`
- `subtitle` nullable
- 主键 `[collectionId, locale]`

关系：
- HomepageCollection.category → Category，建议 onDelete Restrict；分类被商品使用/首页配置引用时按现有删除策略处理。
- HomepageCollection.translations → HomepageCollectionTranslation[]。
- HomepageCollection.products → HomepageCollectionProduct[]。

唯一性：
- 建议 `categoryId` 唯一，避免同一个分类重复建立首页区域。
- `sortOrder` 建索引。
- enabled + sortOrder 建组合索引。

### 3.3 HomepageCollectionProduct

字段建议：
- `id` UUID 主键，或按仓库惯例使用复合主键。
- `collectionId` UUID
- `productId` UUID
- `sortOrder` Int，默认 0
- `createdAt`

约束：
- `@@unique([collectionId, productId])`
- `@@index([collectionId, sortOrder])`
- collection 删除时可 Cascade 删除关联行（仅删除展示关系）。
- product 删除时可 Cascade 删除关联行，或按仓库商品软删除规则处理；必须保证不会删除 Product 本身。
- Product 与 HomepageCollection 的 categoryId 必须一致，由 Service 校验；若需要 DB 层强约束，可评估复合唯一键/FK，但不能破坏现有 Product 主键结构。

### 3.4 商品有效性规则

公开首页只返回同时满足下列条件的商品：
- Product.publishStatus 为项目现有公开发布状态（核对实际枚举值）。
- Product.lifecycleStatus 满足现有公开目录可见规则。
- Product.categoryId 与 HomepageCollection.categoryId 一致。
- 图片投影使用现有 ProductImage/FileAsset 过滤规则（例如只使用可用 READY 图片；以现有 Product 查询 Service 为准）。
- 商品未被删除/禁用。
- 所属 Category enabled 且 visible。
- 当前 locale 有翻译时优先使用；无翻译时使用现有 locale fallback 机制。

**不能在新模块里重新实现一套与现有产品目录不同的公开商品过滤规则。** 抽取/复用现有 product projection/query helper。

---

## 4. API 与服务端实施规范

### 4.1 新模块位置建议

遵循当前 API 模块组织方式，新增：

`apps/api/src/modules/homepage-management/`

建议职责：
- `homepage-management.module.ts`
- `homepage-management.controller.ts`
- `homepage-management.service.ts`
- `dto/`
  - `create-homepage-collection.dto.ts`
  - `update-homepage-collection.dto.ts`
  - `update-homepage-collection-products.dto.ts`
  - `sort-homepage-collections.dto.ts`
  - `update-homepage-display-config.dto.ts`

如果仓库按 storefront/public 与 admin controller 分离，可在同一模块内分 Controller，或将 public read 接入现有 storefront/catalog module；不要重复建立两个业务 Service。必须沿用现有 Nest module 注册、权限装饰器、DTO validation、错误码和审计模式。

### 4.2 Admin API（建议路由）

| Method | Path | 说明 |
|---|---|---|
| GET | `/admin/homepage-management/config` | 获取新品展示数量配置 |
| PATCH | `/admin/homepage-management/config` | 修改新品展示数量 |
| GET | `/admin/homepage-management/collections` | 获取首页品类配置列表 |
| POST | `/admin/homepage-management/collections` | 新建首页品类配置 |
| GET | `/admin/homepage-management/collections/:id` | 获取品类配置详情及已选商品 |
| PATCH | `/admin/homepage-management/collections/:id` | 修改标题、状态、数量、关联分类等 |
| DELETE | `/admin/homepage-management/collections/:id` | 删除首页展示配置，不删除分类/商品 |
| PUT | `/admin/homepage-management/collections/sort` | 批量保存品类排序 |
| PUT | `/admin/homepage-management/collections/:id/products` | 保存商品选择与排序 |

若仓库现有路由规范要求不同前缀，按现有规范调整路径，但功能边界必须一致。

### 4.3 Public Storefront API

建议向现有 Storefront API 增加一个聚合读取能力，例如：
- `GET /storefront/homepage`
或在现有公开首页数据服务中扩展新品配置与品类精选结果。

响应建议包含：
- `newArrivals.limit`
- `newArrivals.products[]`
- `collections[])：按 sortOrder 排序
  - id
  - categoryId
  - categorySlug
  - title
  - subtitle
  - productLimit
  - products[]（按 HomepageCollectionProduct.sortOrder）

要求：
- 只返回 enabled 品类。
- 只返回公开有效商品。
- 商品字段使用现有 storefront Product DTO/projection，不暴露内部价格、采购成本、库存敏感信息或 Admin 字段。
- 一次聚合查询/合理批量查询，避免每个品类一次独立 HTTP 请求。
- 使用稳定排序：sortOrder ASC，再以 id 作为稳定次序。
- 商品数量按后台设置限制。
- 对缓存使用项目现有策略；Admin 更新后必须正确失效或重新验证首页缓存，避免前台长时间展示旧配置。
- public API 不接受管理员传入 product IDs 来直接返回未发布商品；发布过滤必须在服务端执行。

### 4.4 验证与错误处理

- `newArrivalsLimit` 和 `productLimit` 只接受 6 的倍数，范围 6～36。
- 分类必须存在且 enabled/visible；若允许先配置隐藏分类，前台仍不展示，后台应提示状态。
- 一个品类配置的精选商品必须全部属于该 Category。
- 不允许重复 productId。
- 不允许相同 categoryId 创建重复 HomepageCollection。
- sortOrder 批量更新必须校验提交 ID 集合，拒绝未知 ID、重复 ID 或漏项（若 API 定义为全量排序）。
- 保存品类和精选商品时使用 Prisma transaction。
- 删除仅删除首页配置和关联表，不删除主数据。
- 使用现有审计机制记录 Admin 对首页展示配置的创建、修改、排序、启用/隐藏和删除。
- 任何失败返回明确业务错误，不允许静默忽略越权或非法商品。

---

## 5. Admin 页面实施规范

### 5.1 页面位置建议

先检查 Admin 现有导航和路由约定。建议新增菜单：
`Storefront Management → Homepage`

候选页面：
`apps/admin/src/app/[locale]/(admin)/storefront/homepage/page.tsx`

若现有目录命名或菜单分组不同，遵循现有结构，不要为新功能复制整个 Admin layout。

### 5.2 管理页功能

页面分为两个清晰区块：

**A. New Arrivals Settings**
- 展示当前新品展示数量。
- 下拉选项：6 / 12 / 18 / 24 / 30 / 36。
- 保存后显示成功反馈。
- 当前有效新品数可作为辅助信息展示，但不要将内部库存或成本暴露给无权限用户。

**B. Homepage Collections**
- 列表展示：拖动排序手柄、品类标题、关联 Category、精选商品数量、启用状态、编辑、删除。
- 新增按钮：Add Collection。
- 支持 drag-and-drop；必须有键盘/按钮调整顺序的可访问替代操作。
- 启用/隐藏状态明确。
- 删除必须二次确认，并说明只删除首页展示配置，不删除分类或商品。
- 保存排序后显示结果；失败时恢复旧排序或提示重试，不要让 UI 假装保存成功。

### 5.3 新增/编辑品类表单

字段：
1. Category：从现有分类列表选择。
2. Display title：按 locale 编辑标题。
3. Subtitle：可选，按 locale 编辑。
4. Enabled：启用/隐藏。
5. Product limit：6 / 12 / 18 / 24 / 30 / 36。
6. Selected products：打开商品选择器。
7. Section sort order：可由拖动排序管理，必要时提供数字值。

### 5.4 商品选择器

- 从当前 Category 的现有商品中检索。
- 支持名称、SKU 搜索。
- 展示商品主图、名称、SKU、发布状态。
- 只能选择该分类下商品。
- 支持多选、取消选择、拖动排序。
- 显示已选数量。
- 不允许超过 productLimit；若需要先增加数量，先保存数量再添加。
- 选择商品顺序即前台显示顺序。
- 下架商品应提示并从前台隐藏；管理员可在后台替换无效商品。
- 保存前后端均校验 categoryId 一致性和 publishStatus。
- 不复制商品数据；仅提交 productId 和 sortOrder。

### 5.5 权限与审计

- 沿用现有 Admin RBAC，不得仅靠隐藏菜单做权限控制。
- 新增 permissions 按项目现有 permission code 命名规范定义。
- 补充 seed、角色默认授权策略、API decorator 和 Admin route guard。
- 读权限和写权限可分离（如现有项目采用该模式）。
- 记录操作者、操作时间、配置 ID、变更字段；避免把不必要的敏感数据写入日志。

---

## 6. Storefront 组件与文件修改清单

### 6.1 必须修改

| 文件/位置 | 改动 |
|---|---|
| `apps/storefront/src/app/[locale]/page.tsx` | 重新组织 Hero、新品、品类精选、工厂内容、步骤与 CTA 顺序；移除首页 Featured/Pre-order 独立重复商品 rail（如业务确认无需保留） |
| `apps/storefront/src/components/product-card.tsx` | 优先复用；仅在 6 列布局需要时增加 variant/class 或调整响应式细节；保证所有现有调用兼容 |
| Storefront `storefrontApi` 定义文件（当前首页通过 `../../lib/api` 导入，实际文件待阶段 A 确认） | 增加首页展示配置的聚合读取方法/类型 |
| 全站 Header/Nav 实际组件和样式文件（待阶段 A 确认） | 实现固定导航及移动端适配 |
| 首页相关 CSS 文件（待阶段 A 确认） | 新增 Hero、新品网格、品类区标题居中、6 列网格、响应式断点和轻量动效样式 |
| API 公开首页数据模块 | 返回新品配置及品类精选数据 |
| API Admin 首页配置模块 | 提供 CRUD、排序、新品数量设置、商品选择与保存 |
| `database/prisma/schema.prisma` | 增加首页展示配置模型和关系 |
| Admin 菜单/路由/权限 seed 文件（实际路径待阶段 A 确认） | 注册 Homepage 管理入口和权限 |

### 6.2 建议新增 Storefront 组件

按项目组件命名风格实现；避免组件过度拆分：

`apps/storefront/src/components/home/`
- `home-new-arrivals.tsx`：新品区标题、商品网格。
- `home-collection-section.tsx`：单个品类标题、商品网格和底部分类按钮。
- `home-product-grid.tsx`：可复用的响应式商品网格（如项目现有 grid 可复用则不新增）。
- `home-hero.tsx`：仅当现有 page.tsx Hero 逻辑拆分确有收益时新增。
- `home-factory-promo.tsx`：仅当现有工厂内容需要拆分时新增。

### 6.3 建议新增 Admin 页面组件

候选目录：
`apps/admin/src/app/[locale]/(admin)/storefront/homepage/`
- `page.tsx`：首页配置列表和新品设置。
- `components/homepage-collection-form.tsx`
- `components/homepage-product-picker.tsx`
- `components/homepage-collection-sortable-list.tsx`

必须先查看现有 Admin 分类管理、商品选择器、表格、Modal、Form、toast 和权限组件，优先复用，不要引入第二套 UI 组件库或未经批准的新拖拽库。

---

## 7. 实施阶段与逐阶段验收

每一阶段完成后先运行测试并审查 diff，再开始下一阶段。AI 不得一次性大规模改写所有目录。

### 阶段 A：代码复核与实施计划（不改业务代码）

任务：
1. 阅读首页 page.tsx 全文。
2. 阅读 ProductCard、storefrontApi、Products 分类筛选路由、Header/Nav、首页 CSS。
3. 阅读 API Product/Category 查询、SiteConfig/HomeSections、模块注册和权限模式。
4. 阅读 Admin 分类管理、商品管理、菜单、权限 seed。
5. 阅读 Prisma schema 和 migration 约定。
6. 输出文件清单：修改、新增、复用、无需修改。
7. 明确首页当前 Featured/New/Preorder/HomeSections 的显示数据与来源。

验收：
- 所有新增/修改路径均能在仓库结构中找到对应模式。
- 找到实际分类 Products URL 构造方式。
- 找到真实 API Product DTO 和公开过滤规则。
- 不创建任何代码文件、不执行迁移。

### 阶段 B：数据模型与迁移

任务：
1. 新增 HomepageDisplayConfig、HomepageCollection、HomepageCollectionTranslation、HomepageCollectionProduct。
2. 关联现有 Category/Product。
3. 添加唯一约束、索引、CHECK 约束。
4. 生成 Prisma migration；禁止手工伪造 migration timestamp。
5. 为单例配置提供幂等初始化策略；默认新品数量 12。
6. 不修改现有 Product 的 isNew/isFeatured/isPreOrder 语义。

验收：
- Prisma validate 通过。
- Prisma generate 通过。
- migration 在空数据库和当前开发数据库均可执行。
- 重复初始化不会产生多条配置。
- 删除 HomepageCollection 不删除 Category/Product。
- 迁移前后现有商品、分类数量和关键记录不变。

### 阶段 C：Admin 配置 API 与权限

任务：
1. 新品数量读取/更新。
2. 首页品类 CRUD。
3. 品类排序。
4. 精选商品批量保存与排序。
5. 分类/商品合法性校验。
6. 权限和审计日志。

验收：
- 未授权 Admin 不能读写受保护接口（按权限设计验证）。
- 非 6 倍数、0、负数、超过 36 被拒绝。
- 商品跨分类关联被拒绝。
- 重复商品关联被拒绝。
- 排序 transaction 原子性正确。
- 删除配置不影响商品与分类。
- 审计日志能识别操作者和动作。

### 阶段 D：Public 首页聚合 API

任务：
1. 返回新品 limit 和商品数据。
2. 返回 enabled 品类，按 sortOrder 排序。
3. 每个品类返回 translations 和精选商品。
4. 复用现有公开 Product projection。
5. 加入缓存失效/revalidation 机制。

验收：
- API 不泄露价格/成本/Admin 私有字段。
- 不返回未发布、不可见、错误分类的商品。
- 商品和品类顺序稳定。
- 空配置返回空数组，不报 500。
- 一个首页请求不会产生 N+1 HTTP 请求。
- Admin 更新配置后，前台在项目定义的缓存窗口内更新；建议写入后立即 revalidate。

### 阶段 E：Storefront 首页 UI

任务：
1. 固定导航。
2. Hero 极简化、产品图主导。
3. New Arrivals 放在 Hero 后，读取可配置数量。
4. 每个启用品类独立展示。
5. 标题/副标题居中。
6. 每个品类底部居中按钮，跳转该 Category Products 页面。
7. 工厂能力和 CTA 放在所有产品区之后。
8. 移除首页 Explore Our Collections 总入口。
9. 桌面端 6 列，平板 4/3 列，手机 2 列。

验收：
- 首页顺序完全符合第 0.1 节。
- 桌面 1440px 视口新品和品类均为每行 6 个。
- 首页没有 Explore Our Collections 总入口。
- 每个品类标题居中，底部按钮居中。
- 分类按钮跳转正确且保留 locale。
- 商品详情、SKU 复制、Add to Inquiry、WhatsApp 原功能正常。
- Hero 图片真实、无明显布局偏移。
- 不出现水平滚动条。

### 阶段 F：视觉与回归

至少覆盖：
- 1920×1080、1440×900、1280×800 桌面。
- 1024×768 平板横屏。
- 768×1024 平板竖屏。
- 390×844、375×812 手机。
- en-US 和项目支持的其他 locale。
- 0 个新品、少于 6 个新品、36 个新品。
- 0 个启用品类、1 个、5 个及更多品类。
- 商品图片缺失、翻译缺失、分类隐藏、商品下架。
- 首页刷新、浏览器返回、分类跳转、语言切换。
- Inquiry List 添加/删除、SKU 复制、产品详情打开、WhatsApp 询盘。

### 阶段 G：部署验收

1. 先在本地/测试环境执行 migration。
2. 构建 API、Admin、Storefront。
3. 执行自动化测试和浏览器验收。
4. 备份生产数据库。
5. 生产 migration 使用 expand-only 原则，不删除现有字段/表。
6. 部署新镜像后检查健康状态和首页接口。
7. 验证 Admin 配置更新能反映到公网 Storefront。
8. 观察 API 错误、首页渲染、图片加载和询盘事件。
9. 未通过验收不得继续发布下一批功能。

---

## 8. 测试清单（必须落地）

### 8.1 单元测试

- limit 校验：6、12、18、24、30、36 合法。
- limit 校验：0、1、5、7、37、负数非法。
- 分类重复配置校验。
- 精选商品重复校验。
- product.categoryId 不匹配校验。
- disabled collection 不出现在 public DTO。
- unpublished product 不出现在 public DTO。
- 同一商品在新品区和品类区去重。
- collection sortOrder 和 product sortOrder 稳定排序。

### 8.2 API 集成测试

- Admin 创建、读取、更新、隐藏、删除品类。
- Admin 设置新品数量。
- Admin 保存精选商品顺序。
- 未授权用户访问 Admin API。
- 非法分类商品关联。
- 并发保存排序，确保不会部分写入。
- public API 不泄露敏感字段。
- 删除展示配置后 Category/Product 仍存在。

### 8.3 Storefront E2E

- Hero → New Arrivals → Collection 1 → Collection 2 → Factory/CTA 的页面顺序。
- 桌面端 6 列。
- 配置 12/18/24/30/36 后显示数量正确。
- 分类按钮到正确 Products 过滤页。
- 固定导航滚动状态。
- Add to Inquiry 和详情链接正常。
- 页面刷新配置仍正确。
- 手机端 2 列，无横向溢出。

---

## 9. 回滚策略

### 9.1 应用回滚

- 保留上一个可用 GHCR image SHA。
- 若新首页 API 或 UI 出错，优先回滚 Storefront/API 镜像到上一个 SHA。
- 本次 migration 采用新增表/索引，不修改或删除旧商品字段；旧版应用应能忽略新增表。
- 如果旧 API 镜像无法识别新 migration，应先在测试环境验证兼容性，再决定发布顺序。

### 9.2 数据库回滚

- 不执行 DROP TABLE 作为常规回滚。
- 若新版本出现问题，先回滚应用镜像，保留新增首页配置表。
- 如需清理新表，必须单独评估数据是否已被 Admin 使用，并经人工批准；禁止 AI 自动删除生产配置数据。
- 不回滚/重写 Product、Category 的既有数据。
- 生产迁移前必须备份数据库并记录 migration 状态。

### 9.3 功能开关

建议为 public homepage collections 增加可关闭开关（可复用 HomepageDisplayConfig 的 enabled 字段/配置），发生问题时可暂时关闭品类展示，恢复原有稳定商品展示或简洁 fallback；不得因首页配置 API 故障导致整个首页 500。

---

## 10. 性能、缓存和可访问性要求

- 首页聚合 API 使用批量查询，不允许每个 collection 单独请求。
- 只查询配置数量需要的商品，不加载无关商品字段。
- 商品图片继续使用现有 image URL、srcSet、CDN/缓存机制。
- 首屏关键图优先加载，首屏以下图片 lazy loading。
- 避免图片尺寸未定义造成 CLS。
- 不新增未经评估的第三方拖拽或动画依赖。
- 动效以轻量 hover/transition 为主，尊重 prefers-reduced-motion。
- 拖拽排序必须提供键盘替代方式。
- 图片有有意义的 alt；纯装饰图使用空 alt/aria-hidden。
- 标题层级正确，每个品类区域使用 h2。
- CTA 有明确可访问名称和焦点样式。
- 首页不能因某一个品类数据异常而整体崩溃；可记录错误并跳过异常 section。

---

## 11. 明确禁止事项

1. 禁止新建 Product、Category、ProductImage 的重复主数据模型。
2. 禁止新建 ProductCategory 模型；当前真实模型为 Category。
3. 禁止把商品名称、SKU、图片 URL 复制进 HomepageCollection。
4. 禁止将首页精选商品选择逻辑放到前端硬编码数组。
5. 禁止静态写死凡士林、麦芽糖、冰沙、积木、盲盒五个品类；它们是管理员初始配置数据，不是代码枚举。
6. 禁止创建 Explore Our Collections 总品类入口。
7. 禁止将品类精选商品区做成横向 carousel；本需求是网格，每行桌面端 6 个。
8. 禁止将新品数量写死为 12。
9. 禁止将新品区与品类区都使用同一批商品而不做去重。
10. 禁止破坏 ProductCard 的 Add to Inquiry、SKU 复制、详情跳转。
11. 禁止把内部价格、采购成本或 Admin-only 字段暴露给公开 API。
12. 禁止删除或重命名现有 Category、Product、HomeSections、SiteConfig。
13. 禁止未经测试直接修改生产数据库或部署。
14. 禁止一次性重写整个 Storefront 首页和全站 Header。
15. 未经用户另行确认，不得提交业务代码、执行生产部署或清理历史数据。

---

## 12. Admin 初始配置建议

首次启用功能时，可由管理员在后台创建以下初始品类配置（不是硬编码）：

| 初始顺序 | Category 示例名称 | 前台英文标题建议 | 默认商品数 | 状态 |
|---:|---|---|---:|---|
| 1 | 凡士林 | VASELINE COLLECTION | 6 | 启用 |
| 2 | 麦芽糖 | MALTOSE COLLECTION | 6 | 启用 |
| 3 | 冰沙 | SLUSH COLLECTION | 6 | 启用 |
| 4 | 积木 | BLOCK COLLECTION | 6 | 启用 |
| 5 | 盲盒 | BLIND BOX COLLECTION | 6 | 启用 |

执行前必须核对真实 Category 记录、slug 和 translations；不得凭中文名称猜测 Category ID。若某分类尚不存在或未发布，先由管理员在现有分类/商品模块处理，再配置首页展示。

新品默认展示数量建议 12。管理员可在 Admin 修改为 6、18、24、30 或 36。

---

## 13. 提供给 VS Code AI 的分阶段执行提示词

将以下提示词交给 VS Code AI。每次只执行一个阶段：

### 总约束

“请严格按照 `docs/45-homepage-product-display-and-collections.md` 实施。先读取当前仓库代码，复用现有 Category、Product、ProductCard、Storefront API、Admin RBAC、i18n 和图片服务。不要重建商品系统。每阶段先列出将修改/新增文件，再实施；完成后运行相关测试并报告文件、命令、结果和未解决问题。未经我明确要求，不要提交 Git、推送 main 或部署生产。”

### 阶段 A 提示词

“只执行 DOC-45 阶段 A。阅读全部指定文件，输出真实文件路径、现有组件/API/DTO/权限/迁移模式和拟修改清单。不得修改任何文件。”

### 阶段 B 提示词

“执行 DOC-45 阶段 B。只新增首页配置 Prisma 模型和 migration。不要实现 API 或 UI。验证 Prisma schema、migration 和现有数据兼容性。”

### 阶段 C 提示词

“执行 DOC-45 阶段 C。实现 Admin 首页配置 API、DTO、RBAC 和审计。只做服务端，不做 Admin UI 和 Storefront UI。补齐单元/集成测试。”

### 阶段 D 提示词

“执行 DOC-45 阶段 D。实现公开首页聚合 API，复用现有商品公开查询投影，完成缓存失效、排序、去重和数据安全测试。”

### 阶段 E 提示词

“执行 DOC-45 阶段 E。实现 Admin Homepage 管理页面和精选商品选择器，复用现有 Admin UI 模式。完成排序、CRUD、新品数量配置和权限体验。”

### 阶段 F 提示词

“执行 DOC-45 阶段 F。改造 Storefront 首页：固定导航、Hero、New Arrivals、每个启用品类独立 6 列网格、居中分类按钮、工厂内容后置。禁止 Explore Our Collections 总入口。复用 ProductCard 和询盘功能，完成桌面/平板/手机 E2E。”

### 阶段 G 提示词

“执行 DOC-45 阶段 G。只做部署前验收计划、备份检查、migration 兼容性、镜像回滚准备和验收记录。没有明确批准不得部署生产。”

---

## 14. 完成定义（Definition of Done）

只有全部满足以下条件，才算 DOC-45 功能完成：

- [ ] 首页顺序为 Hero → New Arrivals → 自定义品类区 → 工厂能力/CTA。
- [ ] 首页不存在 Explore Our Collections 总品类入口。
- [ ] 顶部导航固定且移动端正常。
- [ ] 新品数量后台可配置，范围 6～36 且为 6 的倍数。
- [ ] 每个首页品类可 CRUD、启用/隐藏、排序。
- [ ] 每个品类可手动选择商品并排序。
- [ ] 每个品类商品数量独立可配置，范围 6～36 且为 6 的倍数。
- [ ] 商品只能从关联 Category 选择。
- [ ] 桌面端新品和品类商品每行 6 个。
- [ ] 每个品类标题/副标题居中。
- [ ] 每个品类底部有居中按钮，进入正确 Products 分类页。
- [ ] 手机端每行 2 个，无横向溢出。
- [ ] ProductCard 的详情、SKU 复制、Add to Inquiry 正常。
- [ ] locale、SEO、图片、WhatsApp、搜索和 Inquiry List 回归通过。
- [ ] migration 可安全部署，应用可回滚。
- [ ] 自动化测试、浏览器验收和部署验收记录完整。

**本文件是开发实施规范，不代表上述功能已开发、测试或部署。**
