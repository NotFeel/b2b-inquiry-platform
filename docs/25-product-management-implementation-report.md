# 商品管理、图片图库与永久物理删除：实施前审查与交付报告

> 关联文档：`docs/24-product-management-crud-and-image-storage.md`（设计基线）、`.agents/skills/product-management/SKILL.md`（强制规范）
> 交付范围：商品列表与完整编辑页、真实品类树/标签/双语字段/规格维护、图片上传-图库-主图-排序-altText、可重试的永久物理删除闭环、权限/审计/缓存/重试，以及商品发布/下架/永久删除与前台展示的端到端验证。
> 本文只记录**真实核查结果**与**真实执行证据**；未验证项在第 8 节明确列出。

---

## 1. 实施前的真实现状（第 1 项要求：先核查模型、迁移与存储位置）

### 1.1 Prisma 模型（实测，与文档草案存在差异）

| 模型 | 实测关键字段 | 与 `docs/24` 草案的差异 |
|---|---|---|
| `Product` | `sku`(unique)、`slug`(unique)、`categoryId` **可空**、`priceCny Decimal(18,4)`、`lifecycleStatus`/`publishStatus` 为 **enum**、`publishStatusItemId`/`lifecycleStatusItemId`（字典镜像，expand 阶段）、`lengthMm/widthMm/heightMm/weightGrams/cartonLengthCm/cartonWidthCm/cartonHeightCm/cartonQuantity` 为 `Int?`、`packaging String?`、`cartonWeightKg Decimal(12,3)`、`isNew/isFeatured/sortOrder` | 文档假设 `categoryId` 必填、价格 `Decimal(14,2)`、尺寸为 Decimal。**实际按现状兼容**：不改列类型，仅在 DTO/服务端校验层补足必填与精度规则 |
| `ProductTranslation` | `(productId, locale)` 复合主键、`name/description/seoTitle/seoDescription` | 一致 |
| `ProductImage` | `fileAssetId` 可空、`storageKey`、`altText`、`sortOrder`、`isCover`、`width/height/sizeBytes/sha256`，`product` 关系 **onDelete: Cascade**，**无删除状态字段** | 缺删除状态 → 见 §3.1 迁移 |
| `FileAsset` | `storageKey`(unique)、`status` 字符串默认 `processing`、`isPublic`、`derivatives Json`、`purpose`，被 `ProductImage`/`Category.cover`/`Ad.desktopAsset/mobileAsset`/`PdfConversionJob.sourceAsset` 引用 | 一致（`derivatives` 是缩略图线索来源） |
| `FileDeletionJob` | `storageKey`(NOT NULL)、`entityType`、`entityId`、`status JobStatus`、`attempts`、`runAfter`、`lastErrorCode` | **已存在可复用的删除 outbox**，因此按规范复用扩展，不新建平行表 |
| `Category` / `Tag` / `ProductTag` / `AuditLog` | `Category.parentId` 自关联 + `CategoryTranslation`；`Tag`+`TagTranslation`+`ProductTag`（`tagId` onDelete **Restrict**） | 一致 |

状态来源核对结论：`PublishStatus` 与 `ProductLifecycleStatus` **仍是 enum**，字典迁移只到 expand+backfill 阶段（`20261016120000_dictionary_product_status_expand`）。因此本实现**沿用枚举为读取权威**，只在写入时同步字典镜像列并校验字典项存在/启用，不把任意字典 code 直接持久化到 enum。

### 1.2 迁移

`database/prisma/migrations/` 原有 5 个迁移；本轮新增 `20261017120000_product_image_delete_state_and_file_operations`（纯 additive，见 §3.1）。已在本机 PostgreSQL 16（`infra/docker-compose.dev.yml`）上 `migrate deploy` 成功。

### 1.3 实际图片存储位置

- 驱动：`STORAGE_DRIVER=local` → `STORAGE_LOCAL_ROOT=./.data/uploads`，**位于源码树之外**（`.data/` 未进入 `public/`）。
- 真实目录内容（实施前实测）：`.data/uploads/product-image/2026/10/` 下 3 个 PNG（历史商品图）+ worker 生成的 `__wNNN.webp` 衍生图。
- key 规则：服务端 `StorageService.buildKey` 生成 `product-image/YYYY/MM/<uuid>.<ext>`，客户端无法指定路径；API 与 worker 都通过 `resolveFromRepoRoot` 解析相对根目录（历史上这里出过 cwd 不一致的缺陷）。
- 生产目标：私有 S3 兼容 Bucket + CDN 读策略（`S3_*` 已具备配置项；本轮未接真实 S3，见 §8）。

---

## 2. 核查发现的真实缺陷（实施前）

1. **商品硬删除会先丢 key**：`DELETE /admin/products/:id` 直接 `prisma.product.delete()`，依赖 `ProductImage.product` 的 cascade。数据库行（含 `storageKey`）先被删除，对象存储文件永远不会被清理，也没有任何线索可用于事后对账。
2. **图片只能在保存商品时整体替换**：`ProductsService.update` 对 `images` 做 `deleteMany` + `createMany`，一次表单保存就会重建全部图片行；在启用物理删除后，这等于把未删除文件的 key 线索一起丢掉，并可能让"删除"变成静默的数据丢失。
3. **上传未校验像素与真实尺寸**：`UPLOAD_MAX_PIXELS` 环境变量已存在但从未被使用；`FileAsset.width/height` 只能等 worker 的 `image-derivatives` 任务回填，`ProductImage` 因此长期为 `null`。伪造扩展名/声明 MIME 只靠签名与扩展名交叉校验，缺少"解码结果"这一层。
4. **列表不可用**：无封面缩略图、无缺图提示、无缺图筛选、品类只显示名称或为空，`imageCount` 无状态语义。
5. **编辑体验违反长表单规范**：450px 抽屉承载 20+ 字段；"商品尺寸 (mm)"与"箱规尺寸 (cm)"各重复 3 次；品类为手填 UUID；标签提交 `tagCodes` 字符串数组；图片无图库区域。
6. **错误码未映射 HTTP**：`PRODUCT_NOT_FOUND`、`PRODUCT_SKU_CONFLICT`、`PRODUCT_SLUG_CONFLICT` 等未加入 `ApiError.DEFAULT_STATUS`，实测重复 SKU 返回 **400** 而非 409，公开接口对草稿/不存在商品返回 400 而非 404（前台 `notFound()` 分支永远不生效）。
7. **缺少精细化权限**：没有 `product.image.*` 与 `product.cost.*`；内部价格可见性用 `roles.includes('super_admin') || permissions.has('product.update')` 判断，无法做到"能改商品但看不到成本"。
8. **共享对象无防护**：`ProductImage.storageKey` 与 `fileAssetId` 并存，`Category.cover`/`Ad`/`PdfConversionJob` 可能指向同一 `FileAsset`；`onDelete: SetNull` 让"只删关联"看起来安全，实际会留下仍被引用的对象或留下死 URL。

---

## 3. 实施内容

### 3.1 数据库（版本化迁移 + 回填 + 回滚）

`20261017120000_product_image_delete_state_and_file_operations`：

- `product_images.deleteState VARCHAR(32) NOT NULL DEFAULT 'READY'`（`READY`/`DELETE_PENDING`/`DELETE_FAILED`）+ `(productId, deleteState)` 索引；已有图片默认 READY，行为与迁移前一致。
- `file_deletion_jobs`：新增 `productId`、`requestedBy`、`idempotencyKey`(unique)、`completedAt`，并把 `storageKey` 放宽为可空（聚合型"商品清理"任务没有单一对象 key）。
- 回填：无需数据回填（新列均有默认值/nullable），迁移文件内附**核对 SQL**与**回滚步骤**。
- 回滚前提已写明：仍有在途删除任务时不得回滚（会丢 key 线索）。

### 3.2 后端 API

新增/改造端点（**每个端点独立权限校验**，无一依赖前端隐藏按钮）：

| Method | Endpoint | 权限 | 说明 |
|---|---|---|---|
| GET | `/admin/products` | `product.read` | 筛选：`q/categoryId(含后代)/publishStatus/lifecycleStatus/isFeatured/isNew/tagId/hasImages`；返回封面 URL、图片数（仅 READY）、待删除数、品类路径、tagIds |
| GET | `/admin/products/:id` | `product.read`（价格另需 `product.cost.read`） | 编辑详情：双语翻译、规格、图库（含 `state`、`deleteOperationId`）、`coverImageId` |
| POST/PATCH | `/admin/products`、`/admin/products/:id` | `product.create` / `product.update` | `categoryId` **必填且必须存在且 enabled**；英文（en-US）翻译必填且不允许重复 locale；标签改用结构化 `tagIds`（兼容 `tagCodes`）；`priceCny` 另需 `product.cost.update`，否则 403 |
| POST | `/admin/products/:id/publish` · `/unpublish` | `product.publish` | 发布前要求至少 1 张可用图片（`PRODUCT_PUBLISH_REQUIRES_IMAGE`），幂等重复调用不报错 |
| POST | `/admin/media/staging` | `product.image.upload` | 固定 purpose=`product-image`（不取自 query），签名/扩展名/MIME/大小/**像素**校验，回填真实宽高，返回 `fileAssetId`+预览 URL |
| POST | `/admin/products/:id/images` | `product.image.upload` | 关联暂存资产；拒绝重复提交、非 ready/非图片/非受管 key、以及**已被其他商品图库占用**的对象（409 `ASSET_IN_USE`） |
| PATCH | `/admin/products/:id/images/order` | `product.image.update` | 提交完整有序列表；重复 id / 未知 id / 不完整 → 409（防止并发编辑静默丢图） |
| PUT | `/admin/products/:id/images/:imageId/cover` | `product.image.update` | 单主图不变量；删除中的图片不可设主图 |
| PATCH | `/admin/products/:id/images/:imageId` | `product.image.update` | altText |
| DELETE | `/admin/products/:id/images/:imageId` | `product.image.delete` | **202** + `operationId`；写入 outbox、图片立即标记 `DELETE_PENDING` 并从公共投影排除 |
| DELETE | `/admin/products/:id` | `product.delete` | 仅允许已下架商品；为每张图片写删除任务，再写 1 个聚合任务，**不触碰商品行** |
| GET | `/admin/file-operations/:operationId` | `product.read` | 任务状态（以数据库为准，不依赖 Redis） |
| POST | `/admin/file-operations/:operationId/retry` | `product.image.delete` | 仅 FAILED 或"已过期未执行的 QUEUED"可重试 |

关键实现要点：

- `ProductImagesService` 中所有 key 均**从数据库行读取**，再复验是否属于受管前缀 `product-image/`（拒绝 `..`、绝对路径、非白名单字符），请求体无法指定路径或 storageKey。
- 删除前置校验：图片归属该商品 → key 受管 → `fileAssetId`/`storageKey` 未被其他 `ProductImage`、`Category.cover`、`Ad`、`PdfConversionJob` 引用（`ASSET_IN_USE` 409 并列出引用类型）。
- 事务内写 `FileDeletionJob`（`idempotencyKey = product-image:<imageId>` 唯一约束，双击/重放不会重复入队）并更新 `deleteState`；随后入队 worker；入队失败**不报成功**，任务保留 QUEUED 供重试。
- 公共投影 `PUBLIC_PRODUCT_SELECT.images` 增加 `where: { deleteState: 'READY' }`，删除中/失败图片在查询层就被排除（不是 CSS 隐藏），且公共 DTO 永不含 `storageKey`/价格。
- 商品变更与图片变更后按 `products` tag 触发 ISR 失效（`REVALIDATE_SECRET` 未配置时降级为 TTL 并记录日志）。

### 3.3 Worker（真正执行物理删除）

`apps/worker/src/jobs/file-delete.ts` 扩展为：

- `entityType='product_image'`：先 `storage.delete(storageKey)`（ENOENT 视为成功，保证幂等），再删除 `ProductImage` 行 + 其独占 `FileAsset` 元数据；同时删除 `FileAsset.derivatives` 记录的 `__wNNN.webp` 缩略图；被删封面自动提升下一张 READY 图片；写审计 `product.image.permanent_delete_succeeded`。
- 失败路径：任务置 `FAILED` + `lastErrorCode`（如 `STORAGE_ECONNRESET`）+ 退避 `runAfter`，图片置 `DELETE_FAILED`，**文件与 key 全部保留**，并写审计 `product.image.permanent_delete_failed`；绝不写入成功审计。
- `entityType='product'`（聚合清理）：仅当该商品无任何图片行、且无 QUEUED/PROCESSING 的图片任务时才删除商品行并写成功审计；否则把自身置 QUEUED 并**延迟 15s 重新入队**（`enqueue` 回调），不使用 BullMQ 重试额度——避免"等待中"被误报为 FAILED，把重试额度留给真实存储故障。
- 删除成功后向 storefront 发送 `products` tag 失效。

### 3.4 管理端 UI

- **商品列表**（`/zh-CN/products`）：关键词（SKU/中英文名）、品类树选择（含子级）、发布状态、生命周期、图片状态（有图/缺图）、标签、排序；封面缩略图（无图占位）、SKU 复制、英文名 + 中文次行、品类路径、两个独立状态 Badge、标记、图片数（含 pending 提示与"缺少图片"）、更新时间、行内编辑/上下架/永久删除；筛选写入 URL。
- **完整编辑页**（`/products/new`、`/products/[id]/edit`）：分组卡片（基本信息 / 状态与展示 / 商品规格 / 箱规规格 / 标签 / 内部报价 / 图片图库 / SEO）+ 中英 Tab + sticky 操作条（取消 / 保存并继续 / 保存并返回 / 发布-下架 / 删除），未保存离开提示。
- 尺寸字段**逐个命名并带单位**（商品长度/宽度/高度 mm、商品重量 g、箱规长度/宽度/高度 cm、箱规毛重 kg、每箱数量），空值保持为空而不是 0。
- 品类用真实 `GET /admin/categories/tree` 的 `TreeSelect`；标签用真实标签 API 的结构化 `tagIds` 多选（停用标签保留显示并标注，不可新选）。
- **图片图库**：多选上传（逐文件进度/成功/失败原因）、缩略图、主图标识、上移/下移、设为主图、altText 即时保存、永久删除二次确认、`DELETE_PENDING`/`DELETE_FAILED` 状态显示与"重试删除"。新建商品时先暂存（staged），保存后自动关联。
- 内部报价分区仅对 `product.cost.read` 可见，字段本身仅对 `product.cost.update` 可写；列表**不显示**内部价格。

### 3.5 权限、错误码与 i18n

- 新增权限码 `product.image.upload|update|delete`、`product.cost.read|update`（`packages/contracts`、seed、admin 中英文 permission 文案），`catalog_manager` 获得全部 5 项，`viewer` 仍只有 `product.read`。
- 新增错误码：`PRODUCT_SLUG_CONFLICT`、`PRODUCT_NOT_DELETABLE`、`PRODUCT_IMAGE_NOT_FOUND`、`PRODUCT_IMAGE_LIMIT_EXCEEDED`、`PRODUCT_IMAGE_DELETE_PENDING`、`PRODUCT_PUBLISH_REQUIRES_IMAGE`、`ASSET_IN_USE`、`FILE_OPERATION_NOT_FOUND`、`FILE_OPERATION_NOT_RETRYABLE`、`STORAGE_UNAVAILABLE`，并**全部补入 `ApiError.DEFAULT_STATUS`**（同时把 `PRODUCT_NOT_FOUND`/`FILE_NOT_FOUND` 修正为 404），中英文错误文案同步。
- 审计动作：`product.created/updated/published/unpublished/permanent_delete_requested/permanent_delete_succeeded/permanent_delete_blocked`、`product.image.uploaded/updated/cover_changed/reordered/permanent_delete_requested/succeeded/failed/retried`；审计 metadata 只记录字段名、对象 key 的 scope 与操作 id，**不含价格原值与文件内容**。

---

## 4. 测试与验证证据（真实执行）

### 4.1 静态检查

| 命令 | 结果 |
|---|---|
| `pnpm run lint` | 通过（0 error） |
| `pnpm run typecheck`（10 个包/应用） | 全部通过 |
| `pnpm run test` | API 155 项、admin 133 项全部通过（新增 `product-image-policy.spec.ts` 21 项、`file-validation.spec.ts` 8 项、`product-form.spec.ts` 16 项） |
| `pnpm run build` | 4 个应用构建成功（新增路由 `/products/new`、`/products/[id]/edit`） |

### 4.2 端到端验收（真实 API + 真实 PostgreSQL + 真实对象存储 + 真实 worker + 真实前台）

`pnpm --filter @b2b/api run acceptance:products` → **62/62 PASS**，覆盖：

- 重复 SKU / 重复 slug → 409；未知类别 → 400；缺英文翻译 → 400；负数尺寸 → 400。
- 无图发布 → `PRODUCT_PUBLISH_REQUIRES_IMAGE`；有图发布 → 201；重复发布幂等。
- 上传：3 张真实 PNG 成功；伪造 `image/png` 的 SVG → 400 `UPLOAD_SIGNATURE_MISMATCH`。
- 图库：关联 3 张自动产生唯一主图；提交逆序后顺序落库一致；切换主图后仅 1 个 `isCover`；altText 保存；跨商品的 imageId → 404；已被其他商品占用的共享对象 → 409 `ASSET_IN_USE`。
- 前台：`/public/products/:slug` 返回 3 张图片且第一张为封面；**深度键扫描无任何 `price`/`cost` 键、无 `storageKey`**；storefront HTML 不含 `123.45` 且确实渲染了图片 URL；下架后公开接口 404。
- **永久删除图片**（核心证据）：删除前对象存在于磁盘 → `DELETE` 返回 202 `PENDING` → 任务 `SUCCEEDED` → **磁盘文件确实不存在**、`__w320/__w640` 缩略图不存在、公共文件 URL 404、`ProductImage` 行已删除、重复删除 404、已完成任务不可重试（409 `FILE_OPERATION_NOT_RETRYABLE`）、匿名访问任务状态 401。
- 权限：仅 `product.read` 的用户可读列表/详情，但删除图片/上传/改商品全部 403，且 `priceCny=null`、`priceVisible=false`。
- **商品永久删除**：已发布商品 → 409 `PRODUCT_NOT_DELETABLE`；下架后删除 → 202 → 图片任务与聚合任务 `SUCCEEDED` → 商品行消失（404）且**所有图片对象在磁盘上确实不存在**（删除前逐一确认过存在）。

### 4.3 物理删除完整性与重试验收（worker 直连真实数据库/存储）

`pnpm --filter @b2b/worker run acceptance:file-delete` → **20/20 PASS**：

- **存储故障**：注入 `ECONNRESET` 的存储桩 → 任务 `FAILED` + `lastErrorCode=STORAGE_ECONNRESET`、key 保留、**文件仍在磁盘**、图片 `DELETE_FAILED`，且**没有任何成功审计**（拒绝假报成功）。
- **人工重试**：任务重置后以正常存储执行 → `SUCCEEDED`、文件消失、图片行与独占 asset 元数据清理、成功审计存在；再次执行同一任务幂等（不报错、不产生副作用）。
- **商品聚合清理顺序**：先跑商品任务 → 仅重新入队等待（`requeuedWhileWaiting`），**商品行保留**、待删图片的 `storageKey` 仍在库中；图片任务完成后商品任务才真正删除商品行并级联清理翻译。

### 4.4 实施过程中被验收捕获并修复的真实缺陷

1. 新错误码未加入 `DEFAULT_STATUS` → 重复 SKU 返回 400、公开接口对不存在商品返回 400（前台 404 分支失效）。已修复并复测 409/404。
2. 商品聚合清理任务在"等待图片"时抛错，消耗 BullMQ 重试额度并最终标记 `FAILED`（实测第 2 次尝试才成功）→ 改为延迟重入队、不消耗重试额度。
3. 删除图片时未清理 `__wNNN.webp` 缩略图 → 补充衍生对象删除（否则"已删除"的图仍可通过缩略图 URL 访问）。
4. 删除失败时若图片状态不是 `DELETE_PENDING`（例如重试路径）不会标记失败 → 改为无条件标记 `DELETE_FAILED`。

---

## 5. 生产开放永久删除权限的前置流程（按用户要求）

**在生产开放任何人的永久删除权限之前，必须在测试环境用真实对象存储完成以下验证：**

1. 以 `STORAGE_DRIVER=s3` 部署测试环境（私有 Bucket；版本控制/复制的处理按部署策略记录在部署文档）。
2. 上传 ≥3 张图片到某测试商品，记录每张的 `storageKey`。
3. 后台执行"永久删除图片"，确认 API 返回 202、任务转 `SUCCEEDED`。
4. **在对象存储侧（而不是通过本应用接口）确认对象不存在**：`aws s3api head-object --bucket <bucket> --key <storageKey>` 返回 404/NoSuchKey，缩略图 key 同样检查，并确认公共/CDN URL 返回 404。
5. 制造一次删除失败（例如临时撤销删除权限或断网），确认任务 `FAILED`、对象仍在、UI 不显示成功，恢复后"重试删除"成功。
6. 以上全部通过后，才给目标角色授予 `product.image.delete` / `product.delete`；建议先只给 1 个账号，观察 24h 监控后再扩大范围。

代码内置的安全网：共享对象一律 409 拒绝、非受管 key 一律拒绝、失败绝不报成功。

---

## 6. 运维影响

- **失败任务查询**：
  `SELECT id, entityType, entityId, storageKey, status, attempts, lastErrorCode, runAfter FROM file_deletion_jobs WHERE status <> 'SUCCEEDED' ORDER BY createdAt;`
  优先在后台"重试删除"；仍失败则排查存储凭据/桶策略。严禁用 `rm -rf` 或按前缀批量删除解决单张图片。
- **监控建议**：待处理/失败任务数、最长等待时长、重试次数、存储删除失败率、staging 孤儿文件数；`DELETE_FAILED` 超阈值告警。
- **孤儿对账**：沿用 `database/scripts/cleanup-orphan-assets.ts`（默认 dry-run，`--apply` 才执行并写审计）。
- **对账检查**（迁移文件内已给出）：`ProductImage.storageKey` 与 `FileAsset.storageKey` 是否一致、是否存在重复 key、是否存在无 `fileAssetId` 的历史图片。
- **环境变量**：未新增必填变量；worker 现在会读取 `JOB_RETENTION_DAYS`、`APP_BASE_URL`、`REVALIDATE_SECRET`（`REVALIDATE_SECRET` 为空时跳过主动失效，退回 ISR TTL）。`.env.example` 已包含这些键。

## 7. 风险与回滚

- 回滚代码时**不要**回滚数据库并丢弃 `FileDeletionJob` 中仍待执行的 key；先停止新删除任务或保留兼容消费者。
- 已完成的物理删除**不可通过普通回滚恢复**；UI 与确认框已写明不可逆。
- `ProductImage.deleteState` 为 additive 列，回滚仅需 drop 列（前提：无在途任务）。

## 8. 未完成 / 未验证（诚实清单）

1. **真实 S3/MinIO 未验证**：本轮在本地 `local` 驱动上完成了"文件确实不存在"的验证；S3 凭据、版本控制与复制的删除语义需按 §5 在测试环境验证后才能在生产开放永久删除权限。
2. **浏览器点击级走查未做**：本会话 Computer Use 不可用，列表/编辑页/图库交互由类型检查、单元测试（表单映射 16 项）与构建保证，但拖拽排序、360px 实机布局建议按 `docs/24 §11.3` 人工复核一次（当前提供键盘可用的上移/下移作为拖拽替代）。
3. **staging 孤儿文件 TTL 清理未实现**：新建商品先暂存、保存时关联；若放弃新建，暂存对象不会立即清理，需要按 TTL 扩展现有对账脚本（已知缺口）。
4. **`featured`/`new-arrival` 标签与 `isFeatured`/`isNew` 无需去重**：2026-10-17 业务确认二者是不同维度——标签是前台商品图片上的角标，`isFeatured`/`isNew`/`isPreOrder` 决定是否进入首页对应分区；因此保持独立，不做合并或自动同步（见 §9）。
5. **`priceCny` 精度**：数据库为 `Decimal(18,4)`，表单与 DTO 限制到 2 位小数；未做列类型收敛，以避免无关 schema 变更。

---

## 9. 2026-10-17 业务澄清：首页分区标记与预售勾选

### 9.1 确认后的规则

| 字段 | 作用 | 生效条件 |
|---|---|---|
| `isFeatured` | 进入前台首页"精选"区（同时用于首页 hero 商品） | 已发布 + 未停产 |
| `isNew` | 进入前台首页"新品"区 | 已发布 + 未停产 |
| `isPreOrder`（新增） | 进入前台首页"可预售"区 | **`lifecycleStatus='preorder'`** + 已发布 + 未停产 |
| `Tag` / `ProductTag` | 前台商品图片上的角标（`ProductCard` 的图片叠层） | 标签启用；停用标签不上前台 |

三者是独立的运营决策，标签与首页标记**不冲突、不去重、不互相同步**。生命周期仍是"商品是什么"的业务事实；`isPreOrder` 只是"是否上首页预售区"的展示决策。

### 9.2 实现

- 数据库：`20261017180000_product_is_preorder_home_flag` 新增 `products.isPreOrder BOOLEAN NOT NULL DEFAULT false` + `(publishStatus, isPreOrder, sortOrder)` 索引；**回填**所有 `lifecycleStatus='PREORDER'` 的现有商品为 `true`（部署后首页与当前一致），并附核对 SQL 与回滚。
- 规则（`product-lifecycle-policy.ts`，含单元测试）：
  - `isPreOrder=true` 但生命周期不是 `preorder` → **400**，字段错误 `isPreOrder`（不静默忽略，避免"看起来保存成功"）。
  - 生命周期从 `preorder` 改为其他值 → 服务端**强制 `isPreOrder=false`**，即使客户端没提交该字段。
  - 生命周期改为 `preorder` 不会自动勾选：是否上首页仍需运营明确决定。
- 公共接口：`GET /public/products?isPreOrder=true` 只返回被策展的预售商品（同时要求 lifecycle=PREORDER）；`lifecycle=preorder` 仍列出全部预售商品（目录筛选语义）；`PublicCatalogService.preorder()` 同步使用该标记。
- 前台：首页"可预售"区改为请求 `isPreOrder=true`；商品卡片的 Featured/New/Pre-order 与标签角标仍渲染在图片上（既有实现）。
- 后台：编辑页"状态与展示"新增"预售（前台首页）"勾选框，生命周期非预售时禁用并给出说明；列表 `flags` 列显示 `home pre-order` 徽标。
- 文档：`docs/14-open-decisions.md` 记录该业务决策；`docs/24 §3.3 B` 同步字段语义。

### 9.3 验证

- 单元测试：`product-lifecycle-policy.spec.ts`（6 项）覆盖合法组合、非法组合、生命周期变更清理；admin `product-form.spec.ts` 覆盖状态映射、载荷与 `applyLifecycleChange`。
- 端到端（`acceptance:products` 新增 6 项）：非预售生命周期勾选首页预售 → 400；设为预售并勾选后出现在 `/public/products?isPreOrder=true`；生命周期改回 available 后后台 `isPreOrder=false` 且从首页预售集合消失。
- 真实前台复核（storefront 运行中，ISR `products` tag 主动失效）：以演示商品 `DEMO-1003`（同时 `isNew=true`）验证——勾选时其出现在 `/public/products?isPreOrder=true` 且首页引用次数为 6；取消勾选后公开预售集合立即为空、首页引用降为 3（仍保留在新品区，符合"多个首页分区相互独立"的规则）；重新勾选后恢复为 6。首页 HTML 不含内部价格。

---

## 10. 2026-10-18 品类选择器可选性修复

### 10.1 根因

真实浏览器复现确认：原 `TreeSelect` 的节点按钮确实调用了 `onSelect(node.id)`，`categoryId` 也已更新（按钮变为 `aria-current="true"`），但选中样式 CSS 挂在父级 `.tree-node` 上，而 `aria-current` 写在子按钮上；同时表单字段不展示已选路径，整棵树常驻展开。视觉与状态反馈完全缺失，操作人员因此认为“节点无法选择”。保存链路本身未丢失 UUID，问题在共享选择器的交互模型与呈现。

### 10.2 修复

- 新增共享 `CategoryPicker`：商品列表筛选、新建页、编辑页复用同一底层组件；触发器只显示已选路径，树在 Popover/移动端底部 Drawer 中按需打开。
- 行点击选择任意启用节点（包括带子节点的父级）；展开/折叠按钮独立并阻止事件冒泡。选中项有单选标记、背景、勾选和完整路径。
- 搜索匹配当前语言名、其他语言名、`code`、`slug`，自动展开命中节点祖先路径；支持方向键、Home/End、Enter、Escape。
- 表单唯一提交值仍为 `categoryId` UUID；树异步加载期间用商品详情 `categoryPath` 作为只读回显，不使用名称覆盖 ID。
- 列表筛选项增加明确的“包含子品类商品”开关，默认开启；关闭时 URL 写入 `includeDescendants=false`，服务端按所选节点直属商品过滤。
- 通用 `TreeSelect` 同步修正选中态 DOM 层级，避免品类父级选择器继续出现同样视觉问题。

### 10.3 验证

- 真实浏览器：新建商品选择父级“玩具”→保存→进入编辑页→刷新，仍回显“玩具”；改选“模型玩具”→保存→刷新，仍回显“玩具 / 模型玩具”。API 详情返回 `categoryId=31cda727-7121-4c2d-94f8-1c62c520bdd2`、`categoryPath=Toys / Model Toys`，与页面一致。
- 列表筛选：关键词 `QA-PICKER` + 品类“玩具”默认含子品类返回 1 条；关闭“包含子品类”后返回 0 条，URL 为 `includeDescendants=false`；刷新后筛选条件与品类路径恢复。
- 响应式：360px、768px、1024px、1440px 页面 `scrollWidth` 与视口一致；手机端选择器为全宽底部抽屉，平板/桌面为视口内 Popover。
- 中英文：`zh-CN` / `en-US` 下标题、搜索、空状态、键盘提示、禁用/选中状态均使用翻译资源。
- 检查命令：`pnpm run lint`、`pnpm run typecheck`、`pnpm test`、`pnpm run build` 全部通过。

### 10.4 数据与回滚

本轮未新增或修改数据库 schema，无迁移。回滚仅需还原前端组件、文案与样式；`categoryId` 数据格式未变。

本地验收产生了一个临时商品 `QA-PICKER-20261018-1`（草稿，所属品类 Model Toys）和一个本地临时账号 `qa.picker`，均只存在于本地开发库，未写入仓库或生产环境。

---

## 11. 2026-10-18 商品尺寸 cm 与新建图片丢失修复

### 11.1 根因

- 新建商品的图片上传走 staging，接口返回 `fileAssetId` 与预览 URL；但保存流程只创建了 Product，没有调用 `POST /admin/products/:id/images`，随后清空暂存数量，导致图片对象存在却没有 `ProductImage` 关联，编辑页和前台都看不到图。
- 商品尺寸在后台和前台仍按 mm 展示，与本次要求的 cm 不一致。

### 11.2 修复

- 新建表单保存时保留完整暂存响应，Product 创建后立即用 `fileAssetId` 调用图库关联接口，再刷新权威图库；关联失败时保留暂存列表与商品 ID，允许在同一页面重试，不会再创建重复 SKU。
- 暂存图片在保存前直接显示缩略图、文件名、像素和“待保存关联”状态，并提供从表单移除操作。
- 商品长宽高在后台以 cm 输入（支持一位小数），保存时转换为现有整数 mm 列；详情回显与前台规格统一显示 cm。历史 mm 数据不变，避免误读。
- 同步更新 `docs/01`、`docs/14`、`docs/24` 的单位规则。

### 11.3 实际验证

- 真实浏览器完成：新增商品 `VERIFY-TOMATO-001`，品类选择“玩具 / 解压玩具”，上传 `docs/西红柿.jpg`，保存并继续编辑。
- 保存后进入编辑页，图片显示为主图；刷新编辑页后仍显示“玩具 / 解压玩具”、图片与 cm 尺寸。
- 数据库复核：`lengthMm=180/100/80`（页面 18/10/8 cm）、`category.code=stress-relief-toys`、`ProductImage.deleteState=READY` 且 `isCover=true`。
- 前台 `/zh-CN/products/tomato-petroleum-jelly-toy-20261018` 显示 `18 × 10 × 8 cm`，图片 `naturalWidth=1200`、`naturalHeight=1200`，无价格字段。
- 检查命令：admin 151 项测试、api 168 项测试、admin/storefront typecheck、ESLint、Prettier 均通过。

### 11.4 回滚

本轮无数据库 schema 变更。回滚需同时还原 `product-form` 的暂存关联逻辑、cm 表单映射、前台 cm 展示、文案与文档；已创建商品的 `ProductImage` 与尺寸数据无需迁移。仅回滚前端会导致新建暂存图片再次丢失关联，生产回滚前应先停止新建商品图片上传。

---

## 12. 2026-10-19 商品/图片删除卡住与物理文件残留修复

### 12.1 根因

本地商品 `VERIFY-TOMATO-001` 的图片删除任务和商品聚合删除任务都已在 `file_deletion_jobs` 中持久化为 `QUEUED`，但对应的 BullMQ 消息不存在，worker 没有可消费的任务。结果图片停留在 `DELETE_PENDING`（后台已从可用图库/前台投影排除，看起来像“只解除了关联”），磁盘上的 `product-image/2026/10/51421b58-afbb-4f58-91ec-a43f56f6b9e6.jpg` 仍然存在，商品行也无法进入最终的聚合删除。

同时确认了三个放大问题的缺陷：

- 删除 outbox 没有任何巡检/恢复机制；Redis 重启或入队失败后，任务只能靠人工发现。
- 商品删除计划跳过了 `DELETE_FAILED` 的图片，商品聚合任务会永久等待 `remainingImages > 0`。
- worker 的 `createStorage` 始终返回本地驱动；当 API 使用 `STORAGE_DRIVER=s3` 时，worker 会把不存在的本地文件视为删除成功并清理数据库行，真实 S3 对象会残留。

### 12.2 修复

- worker 新增 durable delete outbox 巡检：每 `FILE_DELETE_SWEEP_INTERVAL_SECONDS`（默认 30 秒）扫描超过 60 秒仍未处理的 `QUEUED` 任务，使用条件更新抢占后重新入队；队列消息丢失不再等于文件永久残留。
- API 每次入队使用独立 BullMQ job id，避免重试时因同 id 被 BullMQ 静默忽略；`FileDeletionJob.id` 仍是幂等事实来源。
- 商品永久删除现在会重新排队包括 `DELETE_FAILED` 在内的所有图片任务；重试商品聚合任务时也会同时重排其失败/待处理图片任务。
- 单张图片物理删除成功后，会自动恢复该商品已失败/待处理的聚合删除任务，避免“图片重试成功但商品仍留在库里”。
- worker 按 `STORAGE_DRIVER` 选择本地或 S3 驱动；S3 配置不完整时启动失败，不再退回本地磁盘并误报删除成功。
- worker 删除节点使用幂等 `deleteMany`，重复消息并发执行不会因 P2025 失败。

### 12.3 实际验证

- 修复后启动 worker，巡检恢复 6 个丢失任务；`VERIFY-TOMATO-001` 的图片任务与商品任务均转为 `SUCCEEDED`。
- 数据库复核：商品行 0 条、`product_images` 0 条、对应 `file_assets` 0 条；`product_images.deleteState <> 'READY'` 计数为 0。
- 存储复核：磁盘 `.data/uploads/product-image/2026/10/51421b58-afbb-4f58-91ec-a43f56f6b9e6.jpg` 已不存在。
- 审计复核：存在 `product.image.permanent_delete_succeeded` 与 `product.permanent_delete_succeeded`。
- 检查命令：`pnpm lint`、API 169 项测试、worker 6 项测试、API/worker typecheck 与 build 全部通过。

### 12.4 运维与回滚

- 新增 worker 环境变量 `FILE_DELETE_SWEEP_INTERVAL_SECONDS=30`（5–3600 秒，默认 30），已同步 `.env.example`。
- 本地 `.env` 的 `REDIS_URL` 已与当前 dev compose 的 6379 端口对齐；如本机改回 6380，必须同步修改容器端口映射。
- 本轮无数据库 schema 变更，无 migration。回滚代码时不要丢弃 `file_deletion_jobs` 中未完成的 key；应先停止新删除请求并保留巡检/消费者，待任务清空后再回滚。

---

## 13. 2026-10-20 商品列表价格列与运营属性统一到标签

### 13.1 变更

依据 `docs/后台商品管理页面优化与技术实施方案.md`：

- 后台商品列表新增「价格（CNY）」列，数据来自 `Product.priceCny`（`Decimal(18,4)`，内部报价价）。仅当调用者持有 `product.cost.read` 时返回 `priceCny` 与 `priceVisible`；无权限时为 `null`/`false`，无价格显示「未设置」。公开 DTO 继续不包含价格。
- 新建/编辑商品页删除「新品 / 精选 / 预售」三个复选框；这三个运营属性现在只通过「标签与运营」的多选标签维护（`featured` / `new-arrival` / `preorder`）。
- `Product.isNew / isFeatured / isPreOrder` 保留为标签关系的**派生只读镜像**：创建/更新时由服务端从标签推导并回写，不再作为独立可写数据源。
- 前台首页「Featured / New arrival / Pre-order」分区与列表 `featured / isNew / isPreOrder` 过滤改为按标签查询；`preorder` 分区仍要求生命周期为 `PREORDER`，保持业务边界。
- 后台列表「状态」徽标改为按 `tagCodes` 渲染，而不是读取旧布尔字段。

### 13.2 数据迁移

- 新增版本化数据迁移 `database/prisma/migrations/20261020120000_product_marketing_tags_single_source/migration.sql`（无 schema 变更）：
  1. 幂等补齐 `featured` / `new-arrival` / `preorder` 标签与中英文翻译；
  2. 把仍为 true 的旧布尔值回填为 `product_tags` 关联；
  3. 从标签关系反向重算三个布尔字段，消除历史漂移。
- 迁移后对账：`isFeatured` 与标签不一致数量为 0；featured 关联 10 条、new-arrival 11 条、preorder 5 条。

### 13.3 验证

- 真实 API：`admin`（`super_admin`）请求列表返回 `priceCny`、`priceVisible=true`；例如 `WX-202610051 → 13.8`。
- 检查命令：`pnpm lint`、API 169 项测试、admin 145 项测试、storefront 4 项测试、contracts/validation/API/admin/storefront typecheck 与 build 全部通过。
- storefront 生产构建在沙箱内出现 `fetch failed (EPERM)` 静态预渲染告警（环境网络限制），构建仍成功；实际部署时由真实网络访问 API。

### 13.4 回滚

- 迁移为纯数据回填且幂等；回滚代码即可，无需回滚该迁移（旧布尔字段仍保留，前后台旧逻辑可继续读取）。
- 若必须回到旧布尔值写入路径，需先停止新表单/服务端的标签推导写入，避免两个入口同时写。
