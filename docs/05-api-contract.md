# 05. API 设计约定

## 1. 通用规范

- Base path：`/api/v1`。
- 时间为 ISO 8601 UTC；金额为字符串或结构化 Decimal 字符串，不使用浮点数 JSON 计算；公开商品接口不输出价格字段。
- 分页请求：`page` 从 1 开始，`pageSize` 默认 20，最大 100；排序只允许白名单字段。
- 列表响应：`{ data, pagination: { page, pageSize, total, totalPages } }`。
- 错误响应统一为 `{ error: { code, message, details?, requestId } }`；`details` 不包含 SQL、堆栈或秘密。
- 创建/更新接口执行 DTO schema 校验；未知字段默认拒绝或剥离，特别是 roleId、价格、状态等必须验证当前用户是否有权修改。
- 公共接口限流，管理接口按用户/IP 双重限流；耗时任务返回 `202 Accepted + jobId`。

## 2. 公共接口建议

| Method | Path | 用途 | 约束 |
|---|---|---|---|
| GET | `/public/site-config` | 获取公开设置、联系方式和品牌信息 | 只返回标记为 public 的设置；不含秘密 |
| GET | `/public/menus?locale=en-US` | 前台导航 | 返回已启用且可见菜单 |
| GET | `/public/categories?locale=en-US` | 品类树 | 只返回整条祖先链都 `enabled` 且 `visible` 的品类；`productCount` 只统计已发布且未停产商品 |
| GET | `/public/categories/:slug/products` | 按品类筛选 | 支持后代品类、分页、排序；不返回价格 |
| GET | `/public/products` | 搜索产品 | `q/category/featured/isNew/lifecycle/tag/page/pageSize`；`category` 取该品类及其公开可达后代，未知或已隐藏的 slug 返回 0 条而不是忽略筛选；不返回价格 |
| GET | `/public/products/:slug` | 产品详情 | 仅 published 且允许公开的产品；不返回价格 |
| GET | `/public/homepage?locale=en-US` | 首页首屏聚合数据 | 返回 New Arrivals 首批和每个启用品类首批；每批最多 24 条；不返回价格 |
| GET | `/public/homepage/new-arrivals?locale=en-US&cursor=...` | 首页新品后续批次 | 使用独立 cursor；每批最多 24 条，直到配置总数或数据耗尽 |
| GET | `/public/homepage/collections/:id/products?locale=en-US&cursor=...` | 首页品类后续批次 | 使用该品类独立 cursor；已隐藏/停用配置返回 404；不返回价格 |
| GET | `/public/ads?placement=home-hero` | 生效广告 | 服务端判断时间范围与启用状态 |
| POST | `/public/analytics/events` | 页面访问/会话心跳 | 限频、字段白名单、不接收任意 PII |
| POST | `/public/inquiry-intents` | 可选：记录询盘意向 | 不伪称 WhatsApp 已发送；返回 intentId |

### 2.1 首页聚合接口

- `GET /public/homepage` 返回 `{ data: { enabled, newArrivals, collections } }`；
  `newArrivals` 包含 `limit/products/nextCursor/hasMore`，每个 collection 包含
  `id/categoryId/categorySlug/title/subtitle/productLimit/products/nextCursor/hasMore`。
- `newArrivalsLimit` 和 `productLimit` 是最终展示总数，不是单次查询上限。`48`、
  `120`、`600` 等正整数且为 6 的倍数均可配置；每次响应最多 24 条，由服务端控制。
  接口不接受调用方传入 `pageSize`/`batchSize`。
- `cursor` 是不透明字符串，按 New Arrivals 和每个品类分别发放，不能跨区域复用。
  配置总数、collection 配置或商品选择顺序变化后，旧 cursor 返回 400
  `VALIDATION_FAILED`；格式错误或跨类型 cursor 同样在数据库读取前拒绝。
- New Arrivals 使用 `Product.isNew = true`，并复用公开商品规则
  `publishStatus = PUBLISHED`、`lifecycleStatus != DISCONTINUED`。排序为
  `Product.sortOrder ASC, Product.sku ASC`。
- Collection 只返回 `enabled = true` 且关联 Category 整条祖先链公开可达的配置；
  商品必须精确属于该 `categoryId`、满足同一公开商品规则，并按
  `HomepageCollectionProduct.sortOrder ASC, id ASC` 分页。全局首页配置关闭、
  collection 停用或分类不可公开访问时，单品后续批次接口返回 404
  `HOMEPAGE_COLLECTION_NOT_FOUND`；聚合接口省略该区域。
- 跨区域去重以 New Arrivals 实际可展示集合为服务端边界：按公开新品规则和
  `newArrivalsLimit` 取排序后的前 N 个商品 ID，Collection 只排除这些 ID，而不是
  排除所有 `isNew = true` 商品。遇到重复项时继续扫描该 Collection 已配置的后续
  候选并尽量补足每批 24 条；候选耗尽后返回真实数量且 `hasMore = false`，不从
  其他分类或其他未配置商品自动补位。
- 所有商品字段复用 `PUBLIC_PRODUCT_SELECT` / `PublicProductCard`，响应、SSR
  props、缓存和 HTML 均不得出现 `priceCny`、采购成本、发布状态或 Admin 字段。
- Storefront 读取首页时应同时挂 Next cache tags `homepage`、`products`、`categories`：
  Admin 首页配置写入成功后会向 `/api/revalidate?tag=homepage` 发送 revalidation
  请求；商品上下架/排序、图片、分类关系与批量导入继续通过既有 `products` 失效
  链路刷新首页；分类创建、更新、移动、排序和删除成功后通过 `categories` 标签
  （已加入 revalidation allowlist）刷新。webhook 失败只记录告警，已提交的数据
  不回滚，ISR TTL 作为兜底。

## 3. 管理接口建议

| 模块 | 端点组举例 |
|---|---|
| Auth | `POST /admin/auth/login`、`POST /admin/auth/logout`、`GET /admin/auth/me`、`POST /admin/auth/change-password` |
| Users/RBAC | `/admin/users`、`/admin/roles`、`/admin/permissions`、`/admin/menus` |
| Dictionary/Settings | `/admin/dictionary-types`、`/admin/dictionary-items`、`/admin/settings` |
| Categories | `GET /admin/categories/tree?locale&q&status&visibility&hasProducts&rootOnly`（管理端树，含 `productCount` 直接数 / `totalProductCount` 含后代数 / `updatedAt`）、`GET /admin/categories`（分页列表，`sortBy=path\|updatedAt\|sortOrder`）、`GET /admin/categories/:id`（详情：`path` 面包屑、`parentName`、直接子品类）、`GET /admin/categories/:id/delete-impact`、`POST /admin/categories`、`PATCH /admin/categories/:id`（支持 `expectedUpdatedAt` 乐观并发）、`POST /admin/categories/:id/move`、`POST /admin/categories/reorder`、`DELETE /admin/categories/:id` |
| Products | `GET /admin/products`（`q/categoryId/includeDescendants/publishStatus/lifecycleStatus/isFeatured/isNew/tagId/hasImages`，返回封面缩略图、可用图片数、待删除图片数、品类路径、`tagIds`）、`GET /admin/products/:id`（价格仅对 `product.cost.read` 返回）、`POST /admin/products`、`PATCH /admin/products/:id`（`categoryId` 必填且需存在且启用，英文翻译必填，标签为结构化 `tagIds`）、`POST /admin/products/:id/publish`（要求至少一张可用图片）、`POST /admin/products/:id/unpublish`、`DELETE /admin/products/:id`（仅已下架商品；202 + `operationId`，先为每张图片排队物理删除再删除商品行） |
| Product media | `POST /admin/media/staging`（固定 purpose，签名/大小/像素校验，返回 `fileAssetId` 与真实宽高）、`POST /admin/products/:id/images`、`PATCH /admin/products/:id/images/order`、`PUT /admin/products/:id/images/:imageId/cover`、`PATCH /admin/products/:id/images/:imageId`、`DELETE /admin/products/:id/images/:imageId`（202 + `operationId`，共享对象返回 409 `ASSET_IN_USE`） |
| File operations | `GET /admin/file-operations/:operationId`（物理删除任务状态，以数据库为准）、`POST /admin/file-operations/:operationId/retry`（仅 FAILED 或已过期未执行的 QUEUED 可重试） |
| Tags | `GET /admin/tags?q&status&usage&locale&page&pageSize`（分页列表，服务端搜索 code 与全部 locale 名称，返回 `label`/`labels`/`productCount`/`missingLocales`）、`GET /admin/tags/options`（仅启用标签，供商品表单选择）、`GET /admin/tags/:id`、`POST /admin/tags`（`tag.create`）、`PATCH /admin/tags/:id`（`tag.update`，支持 `expectedUpdatedAt` 乐观并发，`code` 不可改）、`PATCH /admin/tags/:id/status`（启停）、`DELETE /admin/tags/:id`（`tag.delete`，被商品引用时 409 `TAG_IN_USE`） |
| Homepage | `GET /admin/homepage-management/config`、`PATCH /admin/homepage-management/config`、`GET /admin/homepage-management/collections?locale`、`POST /admin/homepage-management/collections`、`GET /admin/homepage-management/collections/:id?locale`、`PATCH /admin/homepage-management/collections/:id`、`DELETE /admin/homepage-management/collections/:id`、`PUT /admin/homepage-management/collections/sort`、`PUT /admin/homepage-management/collections/:id/products` |
| Media | `/admin/files/upload`、`POST /admin/files/presign-upload`、`POST /admin/files/:id/confirm-upload`、`GET /admin/files/:id/status` |
| Product media | `POST /admin/media/staging`、`POST /admin/media/staging/presign`、`POST /admin/media/staging/:id/confirm`、`GET /admin/media/staging/:id` |
| Quote | `/admin/quote-templates`、`POST /admin/quote-exports`、`GET /admin/jobs/:jobId`、`GET /admin/jobs/summary`、`GET /admin/quote-exports`、`DELETE /admin/quote-exports/:id` |
| PI | `/admin/pi-documents`、`POST /admin/pi-documents/:id/export`、`POST /admin/pi-documents/:id/revisions` |
| Leads | `GET /admin/customers?phone=...`、`POST /admin/customers/lookup`、`POST /admin/inquiry-activities`、`GET /admin/inquiry-activities` |
| Analytics | `GET /admin/analytics/overview`、`GET /admin/analytics/timeseries`、`GET /admin/analytics/countries`、`GET /admin/analytics/realtime` |

### 3.1 Admin Homepage 管理接口

该组接口只维护首页展示配置和 Collection 关系，不创建或删除
`Category` / `Product` 主数据。所有写操作在服务层校验权限、业务规则和
`expectedUpdatedAt`，在事务中提交并记录审计；成功后失效 `homepage` 缓存，
不要求 Admin 前端直接调用 `/api/revalidate`。

| Method | Path | 权限 | 行为 |
|---|---|---|---|
| GET | `/admin/homepage-management/config` | `homepage.read` | 读取单例配置 `{ newArrivalsLimit, enabled, updatedAt }` |
| PATCH | `/admin/homepage-management/config` | `homepage.config.update` | 更新 `newArrivalsLimit`、可选 `enabled` 和 `expectedUpdatedAt` |
| GET | `/admin/homepage-management/collections?locale=en-US` | `homepage.read` | 按 `sortOrder ASC, id ASC` 返回配置列表；标题按请求 locale 解析 |
| POST | `/admin/homepage-management/collections` | `homepage.collection.create` | 创建配置；`categoryId` 必须是现有 Category ID |
| GET | `/admin/homepage-management/collections/:id?locale=en-US` | `homepage.read` | 返回配置、双语翻译和已选商品详情 |
| PATCH | `/admin/homepage-management/collections/:id` | `homepage.collection.update` | 修改分类、启停、展示总数、标题/副标题或排序值，支持 `expectedUpdatedAt` |
| DELETE | `/admin/homepage-management/collections/:id` | `homepage.collection.delete` | 仅删除展示配置和商品选择关系；响应 `{ deleted: true }`，不删除 Category/Product |
| PUT | `/admin/homepage-management/collections/sort` | `homepage.collection.update` | 完整提交 `orderedIds`；当前全部 Collection ID 必须各出现一次，事务内重排 |
| PUT | `/admin/homepage-management/collections/:id/products` | `homepage.product.update` | 完整替换已选商品及顺序；不接受增量追加 |

#### 3.1.1 配置与翻译

- `newArrivalsLimit` 和 Collection 的 `productLimit` 都是“最终展示总数”，不是单次
  查询或响应条数。允许任意正整数且为 6 的倍数；`48`、`120`、`600` 均合法。
  业务校验只接受 PostgreSQL `INTEGER` 范围内的值，不存在 36、120 或其他固定
  业务封顶。Storefront 每次请求最多返回 24 条由公开 API 单独控制。
- `POST` 创建 Collection 的 `translations` 是 locale 数组，至少包含独立且非空的
  `en-US` 标题；`zh-CN` 可省略。每个 locale 最多出现一次；`subtitle` 为空字符串
  时服务端按 `null` 持久化。标题最长 240 字符，副标题最长 500 字符。
- `productLimit` 创建时默认 `6`；已有已选商品数量大于新 `productLimit` 时拒绝
  更新，不得自动删除商品。已有已选商品时不得修改 `categoryId`，必须先通过
  `PUT .../products` 清空完整商品列表。
- `Category` 必须来自现有分类树且存在；同一 `categoryId` 只能有一条
  HomepageCollection。Collection 的 `enabled` 只控制首页展示，不改变 Category
  或 Product 的启用、发布和可见状态。

#### 3.1.2 商品选择与排序

- Homepage 商品搜索复用 `GET /admin/products`，Base path 下实际请求形如：
  `GET /admin/products?categoryId=<uuid>&includeDescendants=false&q=<query>&page=2&pageSize=20&sortBy=sku&sortOrder=asc`。
  不得新增 Homepage 专用商品查询接口，不得把子孙分类商品加入当前 Collection。
- `PUT .../products` 的 body 为 `{ products: [{ productId, sortOrder }], expectedUpdatedAt? }`。
  服务端要求每个商品精确属于 Collection 的 `categoryId`、ID 不重复、数量不超过
  `productLimit`，并在事务内完整替换关系。UI 消费商品搜索结果时必须立即投影为
  不含 `priceCny` 等内部价格的展示对象。
- `GET /admin/homepage-management/collections/:id` 返回的已选商品摘要
  （`HomepageCollectionProductSummary`）包含 `coverImageUrl` / `coverImageAlt`：
  服务端选取 `deleteState=READY` 的图片，优先 `isCover`、否则取最小 `sortOrder`，
  经 `StorageService` 生成 admin 安全 URL。响应中不得出现 `storageKey`、图片原始
  文件路径或任何内部价格字段；无可用图片时两个字段均为 `null`。
- Collection 排序和商品排序都必须稳定；保存后重新读取应得到相同顺序。并发修改
  通过 `expectedUpdatedAt` 检测，过期值返回
  `HOMEPAGE_CONFIG_CONCURRENT_UPDATE` 或
  `HOMEPAGE_COLLECTION_CONCURRENT_UPDATE`，不得静默覆盖。

#### 3.1.3 权限、菜单与依赖读取

- 读取：`homepage.read`；配置修改：`homepage.config.update`；Collection 创建/编辑/
  排序：`homepage.collection.create` / `homepage.collection.update`；删除：
  `homepage.collection.delete`；商品选择和排序：`homepage.product.update`。
- 商品搜索与 Category 树分别继续要求上游的 `product.read`、`category.read`；页面
  隐藏按钮不构成授权，服务端仍逐端点执行 RBAC。
- 菜单 `/storefront/homepage` 使用 `homepage.read`，并作为受保护菜单 seed；菜单
  可见性不替代 API 权限校验。

## 4. 身份验证与权限

- 推荐后台使用服务端 Session + Secure/HttpOnly/SameSite Cookie；如使用 JWT，必须处理 refresh、撤销、轮换与 CSRF 风险，不得只把 Token 存 localStorage。
- NestJS Guard 负责认证与权限；权限代码可放 `@RequirePermissions('product.update')` 元数据，由 Guard 与当前用户权限集合校验。
- 默认拒绝（deny by default）；没有明确授权的路由不得开放。
- 文件下载接口必须重新校验记录权限并生成短时签名 URL，签名 URL 设置较短有效期。

## 5. 幂等与任务状态

- 导出/图片处理任务接受 `Idempotency-Key` 或服务端防重复机制；重复提交不应
  生成多份重复任务。
- Job 状态标准化：`queued`、`processing`、`succeeded`、`failed`、`cancel_requested`、`cancelled`。
- 每种失败返回稳定 `error.code`，UI 根据 code 显示中英文消息；详细异常留在内部日志并脱敏。

## 6. WhatsApp URL

- 号码格式为国际号码数字字符串，不包括加号、空格、括号、破折号。
- 文本必须 URL encode。示例逻辑：`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`。
- 预填文本不能声明已发送，也不能包含网站未显示给客户的价格、内部备注或客户数据库信息。
