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
- `GET/POST/PATCH/DELETE /admin/commercial-documents...`：列表、详情、预览、渲染、签发、revision、取消、DRAFT 删除、下载。
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

需要 Worker 镜像中存在 `EXCEL_PDF_CONVERTER_PATH`（默认命令名 `soffice`）和 `EXCEL_PDF_PDFINFO_PATH`（默认命令名 `pdfinfo`）。配置可为绝对路径或 PATH 中的命令名；Docker 生产镜像使用 `/usr/bin` 下的系统安装，本地开发则直接解析开发环境提供的 LibreOffice/Poppler 命令。`infra/production/Dockerfile` 已补充 `libreoffice-writer`（HTML→PDF 使用 Writer/Web 导出过滤器），并保留 `libreoffice-calc` 供 Excel→PDF 使用。

## 5. 权限与审计

新增权限码：

- `order.customer_snapshot.update`、`order.customer_profile.sync`、`customer.update`
- `commercial_document.{read,create,update,preview,issue,revision.create,cancel,delete,download}`
- `document_template.{read,create,update,delete,publish}`
- `company_profile.manage`、`bank_account.manage`

审计事件：订单客户快照修正/客户主档同步、单据创建/修改/预览渲染请求/签发/revision/取消/删除/下载、模板创建/修改/发布/删除、公司资料/银行账户变更。审计 metadata 只保存单据号、类型、版本、金额汇总、删除文件数和字段名；不保存银行账号、SWIFT、税号、电话、邮箱或地址原文。

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
5. 新增 `document_template.delete` 权限和 `DELETE /admin/document-templates/:id`。删除仅允许非默认的 `DRAFT`/`DISABLED` 模板，且不得被 PI/CI 单据或 PDF 渲染任务引用；无引用的历史版本在同一事务中删除，记录脱敏审计 `document_template.deleted`，由 Restrict 外键兜底。
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

## 10. DOC-46 订单创建模板与必填校验一致性记录

实施状态：已完成，日期 2026-11-08。

本次按 `docs/46-order-template-validation-alignment.md` 完成：

1. `GET /admin/orders/:id/document-prefill` 新增可选 `templateVersionId` 与 `locale`。指定版本时使用该不可变版本 config 计算报告，并校验版本存在、PUBLISHED、PI/CI 类型、模板 ACTIVE 以及 locale 与模板语言一致；不接收客户端 config。
2. prefill 响应新增 `resolvedTemplate` 和结构化 `missingReport`，同时保留旧 `template`、`missingFields`、`missingFieldLabels`、`missingItemLines` 兼容字段。详情、preview 和 issue 错误详情也返回同一结构化报告。
3. `findMissingDocumentFields()` 将结果拆分为系统业务必填、模板额外必填、商品行规则和模板隐藏冲突。模板 required 只增加额外校验，不能关闭系统业务规则；隐藏字段不再产生模板必填项，但业务必填被隐藏时会报告 `REQUIRED_BUT_HIDDEN`。
4. Admin 创建弹窗在模板切换时携带新版本与语言重新 prefill；旧结果立即标记失效，使用请求序号丢弃迟到的旧响应，创建按钮只在当前 prefill 与可见模板版本、locale 完全一致时启用。
5. 单据语言自动跟随模板版本并锁定，无法形成模板语言与单据 locale 的错配组合。银行账户选择在新 prefill 返回后仅在仍可选时保留。
6. 创建弹窗和单据编辑页共用分组校验组件，区分系统业务规则、模板额外必填、商品行缺失与模板显示冲突；字段同时命中多个来源时合并展示来源标签。
7. 编辑页切换模板版本后隐藏旧报告并提示保存后刷新；保存时服务端再次校验模板 ACTIVE、类型和 locale。签发端继续从已保存的不可变模板版本重新执行硬校验。

数据库：无 Prisma schema migration，无历史模板或单据数据改写。新增错误码：

- `DOCUMENT_TEMPLATE_NOT_ACTIVE`：HTTP 409。
- `DOCUMENT_TEMPLATE_LOCALE_MISMATCH`：HTTP 409。

权限和事务边界不变：prefill 继续使用 `commercial_document.read`，创建草稿继续使用 `commercial_document.create`；浏览器提交的报告不作为签发依据。

验证结果：

- `pnpm lint`：通过。
- `pnpm typecheck`：全仓通过。
- `ADMIN_API_PROXY_TARGET=http://127.0.0.1:3000 pnpm build`：全仓通过。
- `@b2b/commercial-documents`：19 项测试通过，覆盖业务必填、模板额外必填、CI 行项目、隐藏冲突和报告兼容字段。
- 商业单据 API/模板/权限定向测试：61 项通过。
- `@b2b/admin`：204 项测试通过，新增 prefill 当前性、竞态保护和银行账户保留 helper 测试。
- 模板 prefill query schema：11 项测试通过。
- 全量 API 测试 464/467 通过；仍有此前已记录的 3 项真实报价 Excel 夹具解析预期失败，与 DOC-46 无关。

未覆盖风险：

- 本轮补充的真实浏览器回归已覆盖 CBM 保存、V1 → V2 预览、字段修复后的校验刷新和 360px/768px/桌面宽度；快速 A→B 创建弹窗切换、签发失败状态仍建议在 staging 继续验收。

### 10.1 商业单据 CBM 保存精度修复

回归发现，切换到已发布的 V2 CI 模板后点击“预览”会先保存草稿，但 PATCH 返回 `VALIDATION_FAILED`。实际请求中订单汇总 CBM `0.1122885` 和商品行 CBM `0.0725985` 有 7 位小数，而共享 `decimalStringSchema()` 只允许 6 位；数据库订单/单据模型允许 15 位。由于保存失败，用户补全的买方、运输等字段也不会进入已保存快照，后续缺失字段校验无法同步。

修复内容：

1. `decimalStringSchema()` 增加受控 `scale` 选项，默认仍为 6 位，金额、单价、重量等既有精度不下沉。
2. 单据运输 CBM 与商品行 CBM 显式使用 `scale: 15`，与 `Order.totalCbm`、`CommercialDocumentItem.cbm` 的数据库精度一致。
3. 新增 Validation 层和 API 边界测试，覆盖 7 位 CBM 可通过、金额 7 位仍被拒绝、超过 15 位仍被拒绝。

浏览器回归：

- 美国 CI 模板 V1 单据切换到 V2 并预览成功，PATCH 返回 200，预览使用 V2 配置。
- 补全买方公司与运输方式后保存，系统业务必填立即刷新；清空后再次保存，缺失项重新出现。
- 360px、768px、桌面宽度下 `documentElement.scrollWidth === clientWidth`，无页面级横向溢出。

数据库：无 schema migration、无历史快照改写。

### 10.2 商业单据页面按模板显示字段

商业单据编辑页原先固定渲染全部买卖双方、运输、商品列、费用和声明字段，与当前模板的 `visible` 配置不一致。现调整为：

1. 活动模板选项同时返回该已发布版本的配置；用户切换模板时，编辑页立即按新模板的 `sections`、`fields` 和 `itemColumns` 重绘，不需要等到保存后才改变字段。
2. 区域隐藏或区域内字段全部隐藏时不渲染该区域；买卖双方地址、运输、付款摘要、商品列、费用和声明字段均按模板可见性过滤。
3. 模板选择器、语言、商品行新增/删除等系统操作保留，不因模板字段隐藏而失去操作入口。
4. 文档级校验统一为“模板可见且勾选必填才校验”：未勾选显示、未勾选必填或区域已隐藏的字段不产生缺失提示；系统业务规则只在对应模板字段满足 `visible + required` 时参与校验。
5. 商品列配置新增 `required`。编辑器立即显示该开关，隐藏列时必填开关自动禁用并取消；商品行只校验当前模板中可见且勾选必填的列。
6. 历史模板缺少 `itemColumns[].required` 时按 `false` 解析，不改写已发布 JSON；需要启用新规则时保存草稿并发布新版本。
7. 模板编辑页、模板列表、订单创建弹窗和商业单据编辑页会标识“有未发布修改”。商业单据继续使用各自绑定的不可变已发布版本；仅点击“保存草稿”不会改变已有版本或商业单据字段/校验。发布新版本后，新单据可使用新版；已有单据如需应用新版，必须在单据编辑页显式切换到新版本并保存。

浏览器回归：美国 CI 模板 V2 仅显示其勾选字段和商品列；未显示/未勾选必填的字段不再生成缺失校验面板。商品列页面已显示“必填”复选框，隐藏列的必填开关不可用。切换到默认 CI 模板后字段立即增加，切回 V2 后立即收起；360px、768px 与桌面宽度均无页面级横向溢出。

数据库：无 schema migration；不需要改写历史模板配置或已发布版本。

### 10.3 商品列配置与单据商品表格 UI 优化

实施状态：已完成，日期 2026-11-10。

1. 单据模板编辑器的商品列配置改为标准表格，列为“显示、商品列、必填、表头标签、宽度、排序”；表头使用 `scope="col"`，勾选项保留可访问名称和 44px 触控区域。窄屏仅表格容器内部横向滚动，避免整页溢出。
2. 预览与正式 PDF 共用的 `renderCommercialDocumentHtml()` 为商品表增加完整单元格边框，表头、数据行与分页重复表头使用同一套线框。
3. `Unit price`、`Amount` 表头与对应金额数据统一右对齐，其余文本列保持左对齐；模板自定义表头标签和列宽继续生效。
4. 隐藏商品列逻辑保持不变：只渲染模板中 `visible=true` 的列，隐藏列不生成表头或数据单元格。

数据库：无 schema migration；不重写已发布模板版本或历史单据。

### 10.4 卖方印章浮层修复

实施状态：已完成，日期 2026-11-10。

1. 卖方印章原先处于文档流中，位于签名标题与卖方姓名之间，会推动文字而不会覆盖签名内容。
2. 预览和正式 PDF 共用的 `renderCommercialDocumentHtml()` 现将签名标题、卖方姓名和印章合成受控 SVG：先绘制签名文字和签名线，再绘制印章图片，确保印章稳定覆盖文字。该方式避免 LibreOffice 将绝对定位或负边距图片错误锚定到页首。
3. 印章仍由模板的“卖方签字 / 盖章”字段可见性和 `header.showStamp` 共同控制；未显示卖方签章区域或未上传印章时不输出图片。

数据库：无 schema migration；不重写已发布模板版本或历史单据。

### 10.5 商业单据 PDF 转换器与临时目录修复

实施状态：已完成，日期 2026-11-10。

1. `EXCEL_PDF_CONVERTER_PATH` 与 `EXCEL_PDF_PDFINFO_PATH` 同时支持绝对路径和 `PATH` 中的命令名。HTML→PDF、Excel→PDF、PDF 校验共用同一可执行文件解析逻辑；显式绝对路径不存在时仍立即失败，不会回退到 PATH 中的同名程序。
2. 转换器子进程以私有输出目录作为 cwd。Runner 在启动进程前将输入 HTML/XLSX、输出目录和 LibreOffice profile 统一解析为绝对路径，修复相对 `WORKER_TMP_DIR` 下 LibreOffice 报 `source file could not be loaded` 的问题。
3. HTML 转换失败时仅在内部错误对象保留受控的退出码、信号和最多 4 KiB stderr，用于诊断转换器差异；Worker 业务日志仍只记录稳定错误码，不输出文档内容。
4. 正式下载状态收敛到 `@b2b/contracts` 的共享规则：仅 `ISSUED`、`SUPERSEDED`、`CANCELLED` 可下载。草稿即使已生成 PDF，编辑页和列表页的下载按钮也保持禁用，避免通过 UI 发起后端必然拒绝的请求。

验证结果：

- 定向 Runner 测试 6/6、Worker 全量测试 75/75、Contracts 测试 20/20 通过。
- 原失败渲染路径使用真实 LibreOffice 重跑成功：3 页 A4 PDF、122,186 bytes，可通过 `pdfinfo` 读取并确认 PDF 1.7、未加密。
- 浏览器实际加载草稿单据后 PDF 状态为“已生成”，`下载 PDF` 按正式单据状态规则正确禁用。

数据库：无 schema migration；不重写已发布模板、渲染快照或历史 PDF。回滚为回退 API/Admin/Worker 镜像及环境变量配置，已生成 PDF 和任务记录无需删除。

### 10.6 商业单据 PDF 失败诊断与状态刷新

实施状态：已完成，日期 2026-11-10。

1. Worker 不再把退出码拼进持久化错误码，HTML→PDF 转换失败统一记录 `COMMERCIAL_DOCUMENT_CONVERSION_FAILED`；退出码、信号和受限 stderr 只保留在内部错误对象，避免 UI 出现不可翻译的动态错误码。
2. 商业单据页面在 `QUEUED` / `PROCESSING` 时自动轮询渲染状态，但不使用详情响应覆盖正在编辑的表单；失败后显示可操作原因、稳定错误码和渲染任务 ID，供管理员定位 Worker 配置或转换问题。
3. 补充转换器不可用、转换失败、超时、`pdfinfo` 不可用、输出无效、输出超限和页数超限的中英文提示；重试按钮在最近任务失败后显示“重试 PDF”。
4. 点击“生成 PDF”时若存在未保存的草稿修改，先保存再排队渲染，保证生成文件与页面字段一致。

数据库：无 schema migration；历史 `DocumentRenderJob.errorCode` 保持原值，后续任务使用稳定错误码。回滚为回退 API/Admin/Worker 镜像，不影响已生成 PDF 和任务审计记录。

### 10.7 模板与商业单据堆积数据清理

实施状态：已完成，日期 2026-11-10。

1. 商业单据列表和编辑页增加“删除草稿”按钮，服务端新增 `DELETE /admin/commercial-documents/:id` 与独立权限 `commercial_document.delete`。仅 `DRAFT` 可删除；`REVIEW`、`ISSUED`、`SUPERSEDED`、`CANCELLED` 一律拒绝。
2. 存在修订链、`QUEUED`/`PROCESSING` PDF 渲染任务的草稿不可删除。单据已有 PDF 和已完成渲染任务的文件 key 会去重后写入 `FileDeletionJob`，由 Worker 幂等物理删除；数据库删除和任务创建在同一事务中完成。
3. `commercial_document.deleted` 审计只记录单据号、类型、修订号、模板版本和待删除文件数，不记录买卖双方联系方式或其他敏感原文。
4. 模板删除规则扩展为：非默认 `DRAFT` 或 `DISABLED`，且 PI/CI 单据引用数为 0、关联模板版本的渲染任务引用数为 0。满足条件时可连同无引用的历史版本删除；`ACTIVE` 模板必须先停用，默认模板必须先取消默认标记。
5. 模板列表/详情的 `canDelete` 由服务端根据真实引用计算，前端只在权限和 `canDelete` 同时满足时显示删除按钮；服务端仍在事务内二次校验，Restrict 外键作为最后保护。
6. 两处删除均使用二次确认、加载状态、成功/失败反馈；删除当前页最后一条记录时回到上一页。中文和英文文案同步。

数据库：无 schema migration。`commercial_document.delete` 属于 reference data，需通过幂等 seed 同步。已有正式单据、PDF 和模板版本不自动清理；删除前的草稿/模板数据只能通过数据库备份恢复。
