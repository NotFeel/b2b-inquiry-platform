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
| GET | `/public/ads?placement=home-hero` | 生效广告 | 服务端判断时间范围与启用状态 |
| POST | `/public/analytics/events` | 页面访问/会话心跳 | 限频、字段白名单、不接收任意 PII |
| POST | `/public/inquiry-intents` | 可选：记录询盘意向 | 不伪称 WhatsApp 已发送；返回 intentId |

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
| Media | `/admin/files/upload`、`POST /admin/files/presign-upload`、`POST /admin/files/:id/confirm-upload`、`GET /admin/files/:id/status` |
| Product media | `POST /admin/media/staging`、`POST /admin/media/staging/presign`、`POST /admin/media/staging/:id/confirm`、`GET /admin/media/staging/:id` |
| Quote | `/admin/quote-templates`、`POST /admin/quote-exports`、`GET /admin/jobs/:jobId`、`GET /admin/jobs/summary`、`GET /admin/quote-exports`、`DELETE /admin/quote-exports/:id` |
| PI | `/admin/pi-documents`、`POST /admin/pi-documents/:id/export`、`POST /admin/pi-documents/:id/revisions` |
| Leads | `GET /admin/customers?phone=...`、`POST /admin/customers/lookup`、`POST /admin/inquiry-activities`、`GET /admin/inquiry-activities` |
| Analytics | `GET /admin/analytics/overview`、`GET /admin/analytics/timeseries`、`GET /admin/analytics/countries`、`GET /admin/analytics/realtime` |

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
