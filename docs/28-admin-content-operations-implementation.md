# 后台菜单、字段、布局与数据配置实施记录

- 日期：2026-10-20
- 依据：`docs/B2BInquiryPlatform:后台菜单、字段、布局与数据配置可执行规范.md`
- 范围：`apps/admin`、`apps/api`、`apps/storefront`、Prisma schema/migrations、菜单/权限/字典 reference data

## 1. 仓库核验结论

已有且复用：

- 菜单/翻译：`Menu`、`MenuTranslation`，菜单树 CRUD、排序、启停、受保护删除和审计已完成。
- 授权：`Permission` + `RolePermission`，菜单可见性不作为 API 授权。
- 文件：`FileAsset`、`FilesService`、对象存储适配器、`FileDeletionJob`、worker 重试机制。
- 内容：`ContentPage` / `ContentPageTranslation` 继续承载 About、Contact、Factory、Quality 等介绍型富文本。
- 字典：`DictionaryType` → `DictionaryItem` → `DictionaryItemTranslation`。
- 审计：`AuditLog` 与 `AuditService`。

核验后确认缺失并新增：

- 缺少工厂媒体、生产流程、证书荣誉、首页区块的结构化模型。
- 缺少对应菜单、细分权限和 `credential_type` 字典。
- 文件上传只支持图片与 xlsx，不能接收视频/PDF。
- 后台只有通用内容页只读列表，没有四个结构化内容页面。
- 前台只有通用内容页，没有结构化工厂/品质页面与首页区块数据。

## 2. 数据模型与迁移

### 2.1 Schema

新增：

- `FactoryMedia` / `FactoryMediaTranslation`
- `FactoryProcessStep` / `FactoryProcessStepTranslation`
- `Credential` / `CredentialTranslation`
- `HomeSection` / `HomeSectionTranslation`

所有文件关联使用现有 `FileAsset.id`；没有新建重复文件表。所有翻译复用 `[业务ID, locale]` 子表模式。`Credential.credentialTypeCode` 保存稳定字典 code，不保存翻译 label。

### 2.2 Migration

- `20261020155509_content_operations_structured_models`：新增表、索引与外键。
- `20261020160000_content_operations_reference_data`：幂等补齐权限、菜单、`credential_type` 字典和两个首页区块记录。

迁移均为 additive；未删除或改写现有业务字段。回滚可先停用四个菜单，再回滚应用；删除新增表会丢失结构化内容，生产回滚应保留表并做前向修复。

## 3. 菜单、权限与字典

新增菜单（父级为现有 `content-management`）：

| code | en-US | zh-CN | route |
|---|---|---|---|
| `content.factory-media` | Factory media | 工厂媒体 | `/content/factory-media` |
| `content.factory-process` | Factory process | 生产流程 | `/content/factory-process` |
| `content.credentials` | Certificates & awards | 证书与荣誉 | `/content/credentials` |
| `content.home-sections` | Homepage sections | 首页区块 | `/content/home-sections` |

新增 20 个细分权限：每个领域 `read/create/update/publish/delete`。`super_admin` 全量；`catalog_manager` 获得 read/create/update/publish；`viewer` 获得 read。菜单 code 已加入 `PROTECTED_MENU_CODES`，避免普通删除破坏导航骨架。

新增字典 `credential_type`：`certificate`、`test_report`、`award`、`exhibition`、`other`，含中英文 label。

## 4. API

管理端：

- `GET/POST /admin/content/factory-media`
- `GET/PATCH/DELETE /admin/content/factory-media/:id`
- `POST /admin/content/factory-media/:id/status`
- `GET/POST /admin/content/factory-process`
- `GET/PATCH/DELETE /admin/content/factory-process/:id`
- `POST /admin/content/factory-process/:id/status`
- `GET/POST /admin/content/credentials`
- `GET/PATCH/DELETE /admin/content/credentials/:id`
- `POST /admin/content/credentials/:id/status`
- `GET /admin/content/home-sections`
- `PATCH /admin/content/home-sections/:code`

公开端：

- `GET /public/content/factory`
- `GET /public/content/quality`
- `GET /public/content/home-sections`

公开 DTO 不包含 `storageKey`、后台备注、内部编号、草稿内容或商品价格。公开查询强制过滤 `PUBLISHED` / `enabled`。

## 5. 文件处理

扩展上传 purpose：

- `factory-media-image`
- `factory-media-video`
- `factory-process-image`
- `credential-document`

新增 MP4/WebM/PDF 签名检测；图片继续做真实像素限制。内容记录删除时：

- 先检查首页区块引用，有引用返回 409。
- 只有操作者同时拥有 `file.delete` 时才尝试物理删除未被其他业务引用的资产。
- 物理删除复用 `FilesService.remove`、`FileDeletionJob` 和 worker 重试，不把数据库删除当作文件已删除。

## 6. 后台 UI

新增四个页面，全部复用 Admin Shell：

- 工厂媒体：搜索、类型/展示位置/状态筛选、列表、图片/视频上传、视频封面、双语标题/说明/alt、展示位置、排序、发布/下线、删除。
- 生产流程：双语步骤名称/说明、配图、排序、发布/下线、删除。
- 证书与荣誉：字典类型、颁发机构、编号、日期、有效期类型、附件、验证链接、展示位置、排序、发布/下线、删除。
- 首页区块：启用、标题/说明/CTA 双语、展示数量、关联已发布内容、排序、CTA 链接。

所有页面复用 `PageHeader`、`DataTable`、`Pagination`、`Drawer`、`Field`、`Toast`、`ConfirmDialog`。

## 7. 前台联动

- 新增 `/:locale/factory` 和 `/:locale/quality` 结构化页面。
- 首页新增数据驱动的工厂/品质预览区块；区块关闭或无有效内容时不渲染。
- Header/Footer 增加工厂与品质入口。
- 前台已移除 About / Contact 页面入口和可访问路由；对应数据库内容页保留但不再由 storefront 导航、首页回退或 sitemap 暴露。
- 内容变更通过 `content` revalidate tag 失效 ISR。
- 视频使用封面 + 用户点击播放，不自动加载。

## 8. 真实测试结果

- `pnpm run typecheck`：通过（10 个 workspace 项目）。
- `pnpm run lint`：通过。
- `pnpm run test`：通过；API 175 项、Admin 145 项、Contracts 15 项、Storefront 6 项、Worker 6 项。
- API build：通过。
- Admin build：通过，包含四个新路由。
- Storefront build：通过，包含 `/factory`、`/quality`。
- Prisma validate：通过。
- 真实 API 验收：
  - 上传 WebP → 创建工厂媒体 → 发布 → 公开工厂 API 返回 1 条媒体。
  - 创建生产步骤 → 发布 → 公开工厂 API 返回流程。
  - 反向有效期保存返回 `VALIDATION_FAILED`。
  - 创建并发布证书 → 公开品质 API 返回字典类型 label。
  - 首页区块关联已发布媒体 → 公开首页区块返回解析后的 item。
  - 清理测试记录后：结构化内容表 0 条、首页区块全部 disabled、临时文件对象与 `FileAsset` 行已删除。
- HTTP smoke：`/en-US/factory`、`/zh-CN/factory`、`/en-US/quality`、`/zh-CN/quality` 均 200；页面 HTML 未发现 `priceCny`、`unitPrice` 或内部价格。

## 9. 风险与未覆盖

- 媒体选择目前使用“上传 + 当前预览”，没有独立文件库浏览器；后续可在不改变数据模型的前提下补充。
- 首页区块 itemIds 为多态 ID 数组，服务端按 section code 校验类型；未使用数据库多态外键。
- 证书过期不会自动下线；公开页仅显示过期标记，符合“过期不等于删除”。
- 视频上传已做签名/扩展名/大小校验，但生产仍需按实际 CDN、转码和播放策略验证。
- 四个内容页的批量排序、拖拽上传和预览页尚未实现；当前提供稳定排序值编辑。
- 真实工厂照片、视频、证书、奖项仍必须由运营上传并确认公开授权，代码未填充虚构内容。
