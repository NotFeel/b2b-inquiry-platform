---
name: product-management-crud-and-media
description: 商品管理、商品翻译、产品图片上传维护和永久物理删除的强制开发规范。
---

# 商品管理和图片存储专项 Skill

开始前必须读取：根目录 `AGENTS.md`、`docs/01-product-requirements.md`、`docs/06-admin-public-ui-standard.md`、`docs/07-backend-standard.md`、`docs/24-product-management-crud-and-image-storage.md`，并检查现有图片上传/部署文档是否存在。

## 执行前核查
1. 检查 Product、ProductTranslation、ProductImage、FileAsset、Category、Tag、ProductTag、AuditLog 的实际 Prisma schema、migration 和线上兼容情况。
2. 查找所有图片上传、CDN URL 生成、文件存储、缩略图、缓存失效、Product 删除与 Image 删除代码。
3. 对账 storageKey、fileAssetId 和真实存储对象；检查共享对象，禁止推断 key 路径后批量删除。
4. 核对商品状态的真实来源。当前 schema 草案包含 `PublishStatus` 和 `ProductLifecycleStatus` enum；若字典迁移未完成，不能把任意字典 code 直接持久化到 enum。

## UI 强制规则
- 商品长表单优先使用完整编辑页，不要继续把所有字段塞进窄 Drawer。
- 基本信息、分类/状态、规格、箱规、内部报价、营销标签、图片图库、SEO 分组呈现。
- 商品长宽高必须分别命名和校验；箱规长宽高与产品尺寸分开，单位始终明确。
- 品类使用真实树形选择器，不允许手写 UUID；标签从真实标签 API 加载并提交结构化 ID 数组。
- 列表显示封面缩略图、无图状态、图片数量、品类路径、发布状态和生命周期；价格默认不在列表展示。
- 图片支持上传、预览、封面设置、顺序调整、altText 和明确的“永久删除”操作；上传/删除必须展示进行中、成功、失败和重试状态。

## 图片物理删除强制规则
- 点击永久删除必须删除真实 storage object；仅删除数据库关系或把图片隐藏不算完成。
- 删除前必须确认 image 属于 target product，key 是服务端生成的受管 key，且该资产没有被其他商品、广告或品类封面引用。
- 客户端永远不能传任意 filesystem path 或 storageKey 来指定删除对象。
- 数据库与对象存储不共享事务。先持久化 delete operation/outbox，再由 worker 幂等删除真实对象；对象不存在视为已删除。对象存储失败不得返回成功，必须保留 key、任务和可重试状态。
- 物理删除完成之前保留可追踪的数据库元数据/key；完成后清理 ProductImage 和专属 FileAsset 元数据、缩略图缓存与 CDN 缓存，并写审计。
- 如果对象被共享，返回明确冲突，不得删除共享文件，也不得假称已经物理删除。
- 永久删除商品前必须收集并逐个可靠清理其图片；严禁先执行 Prisma cascade 删除 Product/Image 行、再尝试查找文件 key。
- 文件 key 唯一且不可复用；本地存储目录在源码树之外；S3 版本控制/复制及备份保留按部署策略处理。

## 后端质量
- 管理 API 每个 endpoint 校验认证、精细权限、DTO、商品归属、状态转换和引用关系。
- 上传校验实际文件签名/格式、大小、像素限制、数量限制和真实解码结果；不要只信任 MIME/扩展名；拒绝 SVG/可执行内容。
- FileAsset.storageKey 是对象存储 key 的权威字段；若 ProductImage.storageKey 还要兼容保留，必须确保两者一致并写对账检查。
- 物理删除任务必须幂等、可重试、有最大重试/人工重试机制、attempts、requestId 和安全日志。
- `priceCny` 仅限管理端授权与内部报价使用；公共 DTO/HTML/SSR/搜索/缓存都不得包含价格或内部 storage key。
- 不使用 `any` 掩盖 DTO 问题；多步数据库更新使用事务；DB/storage 跨系统操作用 outbox/operation pattern。

## 测试与完成报告
至少覆盖：重复 SKU/slug、翻译保存、品类树选择、字段单位校验、上传伪造 MIME/超限、封面唯一性、排序并发、共享 asset 删除冲突、真实存储删除验证、对象不存在幂等、存储故障重试、商品删除不会先丢失 storageKey、越权直调 API、公共价格泄漏检查和 360px 响应式。

交付报告必须列明页面/接口/迁移改动、物理删除测试证据（对象在存储端确实不存在）、执行的测试命令与结果、部署影响、失败任务运维方式和未解决风险。
