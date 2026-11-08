# 商业单据中心（PI / CI）实施记录

> 对应需求：`docs/41-commercial-invoice-order-documents.md`  
> 状态：本分支已实现第一阶段可交付范围；生产启用前仍需在具备 LibreOffice 与 `pdfinfo` 的 Worker 镜像上完成 PDF 视觉回归。  
> 范围：订单客户资料修正、Commercial Document（PI/CI）生命周期、声明式模板与 HTML/CSS PDF 渲染、公司/银行资料、后台工作台、迁移、权限、审计与测试。

## 1. 交付范围

### 1.1 订单客户资料

- `Order` 新增 `version` 乐观锁，以及结构化查询列 `buyerCompanyName`、`buyerContactName`、`buyerEmail`、`buyerPhoneE164`、`buyerCountryCode`、`consigneeName`、`consigneeCountryCode`。
- 新增 `buyerSnapshot`、`consigneeSnapshot`、`notifyPartySnapshot`、`tradeSnapshot`；保留旧的 `customerSnapshot`、`billingAddressSnapshot`、`shippingAddressSnapshot` 兼容历史数据。
- `PATCH /admin/orders/:id/customer-snapshot` 仅修正客户/收货/贸易快照，使用 `version` 条件更新；版本冲突返回 `ORDER_CONCURRENT_UPDATE`（HTTP 409）。
- `POST /admin/orders/:id/sync-customer-profile` 为独立权限的显式同步操作；审计只保存字段名，不保存电话、邮箱、税号或地址原文。
- 已取消订单一律拒绝修正；已签发 PI/CI 不因订单修正而改变，界面提示通过 revision 更正。

### 1.2 商业单据

- 新统一实体 `CommercialDocument` + `CommercialDocumentItem`；`documentType` = `PI` / `CI`。
- 从订单创建草稿时自动带出买卖双方、收货人、卖方档案、银行账户、商品行、包装、费用、币种和汇率方向。
- 服务端使用 Decimal 重新计算行金额与总额；浏览器提交的金额不被信任。
- 状态：`DRAFT` → `REVIEW` → `ISSUED`；已签发只读，更正通过 `SUPERSEDED` + 新 revision。
- 签发前统一校验：模板必须已发布且类型匹配、币种一致、贸易术语/地点/付款条件、卖方与买方地址、银行账户、商品行和 CI 报关字段。
- 预览返回服务端渲染的完整 HTML；PDF 由 Worker 异步生成并写入私有存储。
- 已签发/已替代/已取消单据可通过受保护的下载端点获取 PDF；草稿 PDF 在保存修改时失效。
- 旧 `PiDocument` 表与页面保留，不删除历史 PI；侧栏入口切换为商业单据，旧 PI 菜单停用。

### 1.3 模板与渲染

- `DocumentTemplate` + `DocumentTemplateVersion`：草稿配置可编辑，发布生成不可变版本；单据保存 `templateId`、`templateVersionId`、`templateVersionNo`。
- 模板是声明式 JSON，不允许任意 HTML、JS、SQL 或 URL；字段 key 必须在共享 catalog 中，字段所属 section、重复列、纸张/方向/颜色/字体均服务端校验。
- HTML/CSS 渲染器与金额大写由 `packages/commercial-documents` 提供，API 预览与 Worker PDF 共用同一实现。
- 渲染值全部 HTML 转义；不输出内部成本、markup 或权限字段；不加载外部资源，Logo/印章仅以已授权私有素材的 data URI 嵌入。
- 内置默认 PI/CI 模板在首次使用时幂等创建，保证新环境可以立即创建草稿。

### 1.4 公司资料与银行账户

- `CompanyProfile` 保存卖方主体、地址、税号、Logo/印章素材；`BankAccountProfile` 支持多账户、币种、默认、启停和排序。
- 单据创建时复制为快照；之后修改公司资料不会回写历史单据。
- 银行账号、SWIFT、路由号、税号不进入普通日志或审计 diff。

### 1.5 商品出口属性

- `Product` 新增 `hsCode`、`originCountryCode`、`customsDescription`、`netWeightPerUnitKg`、`exportUnit`；Admin 商品表单新增“出口与报关”分组。
- 下单时复制到 `OrderItem` 快照，单据创建时再复制到单据行；商品主档后续修改不影响历史订单/单据。
- 单据行仍可逐行覆盖 HS Code、原产国、重量和 CBM；CI 签发会检查每行缺失项。

## 2. 数据库迁移

1. `20261106120000_commercial_documents_center`
   - 新增枚举：`CommercialDocumentType`、`CommercialDocumentStatus`、`DocumentTemplateStatus`、`DocumentTemplateVersionStatus`。
   - 新增表：`company_profiles`、`bank_account_profiles`、`document_templates`、`document_template_versions`、`commercial_documents`、`commercial_document_items`、`document_render_jobs`。
   - 扩展 `orders`、`order_items`、`customers`、`products`。
   - 全部为 additive migration；不删除旧 Customer/Order/PiDocument 字段。
2. `20261106121500_legacy_pi_menu_retired`
   - 仅停用 `pi-documents` 菜单；不删除菜单、权限、PI 数据或文件。
3. `20261106122000_commercial_document_role_grants`
   - 幂等补齐既有 `sales` 角色的 `commercial_document.update` 授权；管理员仍可在角色管理页撤销。
4. `20261106122500_quotation_item_export_snapshot`
   - 为 `quotation_items` 增加与 `order_items` 相同的 HS Code、原产国、报关品名、单件净重快照列，保证报价转订单时使用保存时的出口属性。

回滚：先回退 Admin/API/Worker 应用版本；保留 additive 表和已生成 PDF。不得自动 DROP 新表或删除已签发文件。需要回滚 schema 时必须单独审核，并确认没有新业务记录依赖。

## 3. API 摘要

- `GET /admin/orders`：关键词、状态、币种、国家、日期范围、是否有 PI/CI、分页与稳定排序。
- `GET /admin/orders/:id`：订单快照、商品、费用、关联单据、审计摘要。
- `PATCH /admin/orders/:id/customer-snapshot`。
- `POST /admin/orders/:id/sync-customer-profile`。
- `GET /admin/orders/:id/document-prefill?type=PI|CI`。
- `POST /admin/orders/:id/commercial-documents`。
- `GET/POST/PATCH /admin/commercial-documents...`：列表、详情、预览、渲染、签发、revision、取消、下载。
- `GET/POST/PATCH /admin/document-templates...`：列表、启用版本、草稿保存、校验、预览、发布、版本历史。
- `GET/POST/PATCH/DELETE /admin/company-profiles`、`/admin/bank-accounts`。

所有管理端点逐端点声明 `@RequirePermissions`；菜单/按钮可见性不构成授权。

## 4. 模板渲染与 PDF 流水线

1. API 创建 `DocumentRenderJob` + `OutboxEvent(eventType = commercial-document-render)`。
2. Worker 领取 outbox 事件，读取**单据快照**（不读实时订单），加载模板版本与私有 Logo/印章素材。
3. 用共享渲染器生成自包含 HTML；不包含 script/iframe/外部 URL/file 协议。
4. 通过现有 LibreOffice 镜像执行 `writer_web_pdf_Export` 转换。
5. 校验 PDF 签名、`%%EOF`、页数和大小；写入 `private/commercial-documents/...` 私有对象。
6. 更新 `DocumentRenderJob` 与单据的 `pdfFileKey`、`pdfSha256`、`pdfSizeBytes`、`generatedAt`。
7. 失败时任务为 `FAILED` 并保留稳定错误码，outbox 按现有重试/租约机制重试。

新增环境变量（已同步 `.env.example`）：

- `COMMERCIAL_DOCUMENT_PDF_MAX_BYTES`（默认 25 MiB）
- `COMMERCIAL_DOCUMENT_PDF_MAX_PAGES`（默认 50）
- `COMMERCIAL_DOCUMENT_RENDER_TIMEOUT_MS`（默认 120 秒）

需要 Worker 镜像中存在 `EXCEL_PDF_CONVERTER_PATH`（默认 `/usr/bin/soffice`）和 `EXCEL_PDF_PDFINFO_PATH`（默认 `/usr/bin/pdfinfo`）；`infra/production/Dockerfile` 已补充 `libreoffice-writer`（HTML→PDF 使用 Writer/Web 导出过滤器），并保留 `libreoffice-calc` 供 Excel→PDF 使用。

## 5. 权限与审计

新增权限码：

- `order.customer_snapshot.update`、`order.customer_profile.sync`、`customer.update`
- `commercial_document.{read,create,update,preview,issue,revision.create,cancel,download}`
- `document_template.{read,create,update,delete,publish}`
- `company_profile.manage`、`bank_account.manage`

审计事件：订单客户快照修正/客户主档同步、单据创建/修改/预览渲染请求/签发/revision/取消/下载、模板创建/修改/发布、公司资料/银行账户变更。审计 metadata 只保存单据号、类型、版本、金额汇总和字段名；不保存银行账号、SWIFT、税号、电话、邮箱或地址原文。

## 6. 假设与边界

1. **币种**：第一阶段单据币种必须等于订单币种；若要改变申报币种，应先通过独立订单变更流程形成新订单/新快照，避免在同一单据中混合换算口径。
2. **付款账户**：签发前要求账户名称、银行名称、账号；草稿允许暂缺。未覆盖信用证等特殊付款安排，后续可扩展为按付款条件条件必填。
3. **买方账单地址**：签发前要求买方账单地址；订单创建阶段仅要求收货地址，因此历史订单可能需要在订单/单据中补齐。
4. **PDF 引擎**：复用 LibreOffice 而非 Chromium/Playwright；HTML/CSS 支持度以 LibreOffice Writer/Web 为准，未实现 DOCX 模板或 PDF 坐标叠加。
5. **旧 PI**：保留旧表、旧页面与旧导出；新 PI/CI 统一走 `CommercialDocument`。未自动迁移历史 PI 到新表，避免一次性破坏历史文件/数据。
6. **模板安全**：模板只允许受控字段/列/样式配置，不接受管理员上传任意 HTML 或脚本。
7. **下载权限**：PDF 只能在 `ISSUED`/`SUPERSEDED`/`CANCELLED` 且有文件时下载；草稿不提供正式下载。
8. **数量/价格修改**：单据行可修正数量/单价并由服务端重算；本阶段未实现“申报口径变更原因/审批人”字段，后续如用于海关申报调整需补充审批模型。
9. **单据编号与无订单来源**：单据编号由服务端生成（`PI/CI-YYYYMMDD-随机后缀`），第一阶段不提供人工覆盖编号；也不提供完全脱离订单的空白单据入口。
10. **REVIEW 状态**：数据模型和列表支持 `REVIEW`，当前 UI 允许从草稿直接签发；如需强制复核流程，可后续增加独立的提交复核/退回动作和权限。

## 7. 验证记录

已执行：

- `pnpm run lint`：通过。
- `pnpm -r --filter "./packages/**" build`：通过。
- `pnpm --filter @b2b/api run typecheck`：通过。
- `pnpm --filter @b2b/api run build`：通过。
- `pnpm --filter @b2b/admin run typecheck`：通过。
- `pnpm --filter @b2b/admin run build`（带本地代理环境变量）：通过，新增路由 `/commercial-documents`、`/commercial-documents/[id]`、`/document-templates`、`/company-profile`。
- `pnpm --filter @b2b/worker run typecheck/build`：通过。
- `pnpm --filter @b2b/commercial-documents test`：11 项通过。
- `pnpm --filter @b2b/validation test`：25 项通过。
- `pnpm --filter @b2b/admin test`：184 项通过。
- `pnpm --filter @b2b/worker test`：69 项通过（含新增渲染任务单测，转换器使用 mock）。
- API 全量测试：420/423 通过；3 项既有失败与本次功能无关，均为真实 `B2B_Quotation_Template.xlsx` 夹具的表头/解析预期与当前资产不一致：
  - `quote-template-preview.spec.ts > loads the real configured B2B quotation workbook`
  - `quote.service.spec.ts` 2 项真实模板重新解析用例
- 手工 API 冒烟（本地 PostgreSQL + 运行中的 API）：
  - 订单客户快照 PATCH 成功，重复旧版本返回 `ORDER_CONCURRENT_UPDATE`。
  - 预填、创建 CI/PI 草稿成功；行金额由服务端计算；缺失 HS/原产国时签发返回 `COMMERCIAL_DOCUMENT_MISSING_FIELDS`（422）。
  - 补齐报关字段后预览返回转义 HTML；签发成功并排队渲染；重复签发幂等返回已签发单据。
  - 模板创建、校验、发布、预览成功；公司资料与银行账户创建成功。
  - 下载端点使用私有 `storageKey` 流式输出，并写入 `commercial_document.downloaded` 审计。
  - 报价草稿创建成功，验证 `quotation_items` 新出口快照列与报价转订单共用同一快照结构。

未执行 / 环境限制：

- 本机没有 `/usr/bin/soffice` 与 `/usr/bin/pdfinfo`，未执行真实 PDF 生成与不同商品行数/长地址的视觉回归；Worker 渲染单测通过 mock converter 验证了快照读取、私有 key、哈希/大小写入与任务状态更新。
- 未执行真实对象存储（R2/S3）下载、CDN 缓存失效和 PDF 金样本回归。
- 未执行浏览器端 360px 实机截图回归；页面使用统一 Admin Shell、`table-scroll`、单列断点，新增工作台在 1099px 以下改为单列。

## 8. 上线顺序

1. 部署 additive migrations。
2. 执行 `pnpm run db:seed:reference` 同步权限/菜单/角色授权；确认新菜单双语覆盖。
3. 部署 API/Worker；确认 Worker 镜像可执行 LibreOffice 与 pdfinfo。
4. 部署 Admin；先验证公司资料/模板，再验证订单修正和 CI/PI 草稿。
5. 在 staging 以多行商品、长地址、不同币种、中英文模板生成 PDF 并人工核对。
6. 生产开放签发前，抽查订单快照、单据快照、PDF 私有下载和审计记录。
7. 回滚只回退应用；不自动删除新表、历史快照或已签发 PDF。

## 9. DOC-45 单据模板页面与渲染配置修复记录

实施状态：已完成，日期 2026-11-07。

本次按 `docs/45-document-template-page-optimization.md` 完成以下变更：

1. 渲染器以模板配置为唯一显示来源。页眉的单据编号、Revision、Currency 改由 `document.number`、`document.revision`、`trade.currency` 控制，不再绕过字段开关；详情区不会重复输出这三项。
2. Notes、Payment/Shipment notice、Authenticity declaration、Seller/Buyer signature、Stamp、Footer text 和商品表均增加明确可见性判断。区域隐藏或区域内没有可输出字段时不生成空容器；签章单元格与印章分别控制。
3. 模板配置增加可选的 Notes、Stamp、Terms 和 Footer 显示开关。`parseTemplateConfig()` 会为历史模板补齐兼容默认值，不重写已发布版本 JSON。
4. `preview` 与 `validate` 使用编辑器当前临时配置，不再先保存草稿；只有“保存草稿”和“发布新版本”执行持久化。
5. 新增 `document_template.delete` 权限和 `DELETE /admin/document-templates/:id`。删除仅允许无版本、无 PI/CI 引用的 `DRAFT`，在事务中二次检查，记录脱敏审计 `document_template.deleted`，由 Restrict 外键兜底。
6. 模板列表接入关键词、PI/CI、状态、语言筛选和真实分页；编辑区按基本信息、样式、字段、商品列、条款、预览发布分组，支持未保存提示、离开确认、样例预览切换及 360px 响应式字段卡片。
7. 默认模板范围统一为“单据类型 + locale”；新建模板保持 DRAFT 且不能直接成为默认，发布为 ACTIVE 后通过编辑器设置。停用默认模板会在同一更新中取消默认标记。

数据库：无 Prisma schema migration。`document_template.delete` 属于 reference data，需要通过已有幂等 reference seed 同步；已发布版本、历史单据和 PDF 不改写。

验证结果：

- `pnpm lint`：通过。
- `pnpm typecheck`：全仓通过。
- `pnpm --filter @b2b/api build`：通过。
- `ADMIN_API_PROXY_TARGET=http://127.0.0.1:3000 pnpm --filter @b2b/admin build`：通过，`/[locale]/document-templates` 构建成功。
- `ADMIN_API_PROXY_TARGET=http://127.0.0.1:3000 pnpm build`：全仓通过。
- `pnpm --filter @b2b/commercial-documents test`：16 项通过。
- 模板 API/权限定向测试：46 项通过。
- `pnpm --filter @b2b/validation exec vitest run src/commercial-documents.spec.ts`：10 项通过。
- `pnpm --filter @b2b/admin test`：202 项通过。
- Worker typecheck：通过；Worker 与 API 预览继续共用 `renderCommercialDocumentHtml()`。
- 全量 API 测试 459/462 通过；仍保留 3 项既有失败：`quote-template-preview.spec.ts` 1 项与 `quote.service.spec.ts` 2 项，均由真实 `B2B_Quotation_Template.xlsx` 夹具表头/解析预期与当前资产不一致导致，与 DOC-45 变更无关。

未覆盖风险：

- 未在本机执行真实对象存储、LibreOffice PDF 金样本和浏览器 360/768/1024/1440 截图回归；需在 staging 使用同一模板配置完成 HTML/PDF/历史单据对照。
- 部署顺序仍应先同步 reference seed，再发布 API/Admin/Worker 兼容镜像；回滚应用版本不需要删除新增权限记录。
