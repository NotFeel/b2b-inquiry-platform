# Admin Excel 转 PDF — 可执行落地实施规范

> 项目：`NotFeel/b2b-inquiry-platform`  
> 文档编号：ADM-EXCEL-PDF-01  
> 目标分支：`main`  
> 范围：Admin 上传报价单 Excel 或 PI Excel，服务端转换成 PDF 并授权下载。  
> 状态：本分支已按本规范完成实现和自动化验证；生产启用前仍需完成 staging 金样本与 200 MiB 压测。

## 0. 重要历史决策与本次重新引入

仓库历史文档 `docs/30-remove-excel-to-pdf-keep-quote-excel.md`、`docs/08-excel-pdf-pi.md` 和 README 曾明确要求移除 Excel→PDF。本需求是业务方提出的**重新引入**，不是恢复旧实现。编码前必须：

1. 审计当前 main 的代码和数据库，确认旧 PDF 页面、API、任务、表和依赖是否仍残留；不得用文档推断代码现状。
2. 仅新增独立 Excel→PDF 模块，不改现有报价 Excel 生成、模板管理、PI 业务数据/计算/Excel 导出。
3. 当前架构以 `docs/02-architecture.md`、`docs/33-lightweight-cloudflare-neon-r2-implementation.md` 为准：PostgreSQL durable task/outbox + Worker；不恢复 Redis、BullMQ、ioredis。
4. 实施本需求时同步更新 README 和 `docs/08` 中“Excel 转 PDF 已下线/不属于目标功能”的当前状态文字，并增加本文件导航。`docs/30` 保留为历史决策记录，不伪造或删除其历史内容；可在顶部新增“后续重新引入见 docs/38”提示。
5. 原始 XLSX 与 PDF 均为私有业务文件，禁止放入公开 R2/CDN 或第三方在线转换 API。

## 1. 目标和范围

### 1.1 用户流程

`Admin 登录 → 工具/文件中心 → Excel 转 PDF → 选择 .xlsx → 上传 → 服务端验证 → 创建持久化任务 → Worker 转换 → PDF 校验 → 私有存储 → 完成 → 下载/预览/删除`。

上传成功只代表任务已创建，不代表转换完成。UI 展示 queued、processing、succeeded、failed、cancelled、expired；真实状态以项目任务模型为准。

### 1.2 首期范围

- 仅支持 `.xlsx`；拒绝 `.xls`、`.xlsm`、`.ods`、`.csv`、`.xlsb`。
- 主要用于本系统生成的商品报价单 XLSX 和 PI XLSX；有权限的管理员可上传其他合法 XLSX，但执行相同安全校验。
- 默认按工作簿顺序转换所有可见工作表；隐藏工作表跳过。禁止执行宏、更新外部链接或联网刷新公式/数据连接。
- 一个 XLSX 产生一个 PDF；每个工作表遵循其打印区域、页面设置和分页设置。
- 支持上传、任务状态、下载/预览、重试、删除；不修改 XLSX 或原报价/PI 数据。

不做 PDF 编辑、合并拆分、OCR、签名、邮件发送、密码加密 PDF、多格式文档转换或浏览器端打印。

### 1.3 实现限制（生产启用前需压测）

| 项目 | 当前实现值 |
|---|---:|
| 上传 XLSX | 200 MiB |
| 单次上传分块 | 8 MiB |
| 上传会话有效期 | 1 小时 |
| ZIP entries | 4,000 |
| 单个 ZIP entry 展开大小 | 256 MiB |
| ZIP 展开总大小 | 1 GiB |
| ZIP 最大压缩比 | 250 |
| PDF 页数 | 200 |
| PDF 输出 | 50 MiB |
| 单任务转换超时 | 300 秒 |
| Worker 并发 | 1 |
| 自动重试 | 最多 2 次，仅临时基础设施错误 |
| 文件保留期 | 7 天，可配置 |

上限必须同时由 Admin、API、反向代理、Worker 和存储层执行。当前实现不限制工作表数或非空单元格数；安全边界由上传大小、ZIP 展开限制、PDF 页数和输出大小共同约束。具体值仍应按真实报价单/PI 模板、目标主机和 LibreOffice 版本做 staging 压测。

### 1.4 大文件分块上传协议

Excel 转 PDF 不使用单次整文件请求，流程如下：

1. `POST /api/v1/admin/excel-pdf/uploads` 提交文件名、总字节数、业务类型和 `Idempotency-Key`，服务端返回 `uploadId`、`chunkSize`、`chunkCount` 和过期时间。
2. 客户端按 8 MiB 顺序上传 `PUT /uploads/:uploadId/chunks/:index`；每个代理请求都低于 Next.js 默认 10 MiB 请求体限制，单个分块失败可独立重试。
3. `POST /uploads/:uploadId/complete` 仅在所有分块大小与 SHA-256 校验通过后创建 `excel-pdf-convert` 任务并返回 HTTP 202。
4. Worker 按索引流式合并分块，复核完整文件 SHA-256、大小和 OOXML/ZIP 安全约束；归档、输入对象和输出对象全部保持私有。
5. Worker 使用 `attemptId + leaseOwner` 条件更新任务，租约至少为 `max(600 秒, 2 × EXCEL_PDF_TIMEOUT_MS + 120 秒)`；过期租约可恢复，旧 Worker 不得覆盖新 attempt 的最终状态。

---

## 2. Admin UI 设计

### 2.1 菜单与路由

菜单建议放入现有“工具/文件中心”分组；没有该分组时复用合适的现有父菜单，禁止重复创建同名分组。

- zh-CN：Excel 转 PDF
- en-US：Excel to PDF
- 建议路由：`/[locale]/tools/excel-to-pdf`
- 复用唯一 Admin Shell，不创建新的侧栏或认证布局。
- 菜单隐藏不代表授权，API 每条路由必须独立 RBAC。

### 2.2 页面线框

```text
Excel 转 PDF / Excel to PDF                      [转换记录]
将报价单或 PI 的 .xlsx 文件转换为 PDF，便于预览和发送。

┌───────────────────────────────────────────────────────┐
│ 选择 Excel 文件                                        │
│ ┌───────────────────────────────────────────────────┐ │
│ │          拖拽 XLSX 文件到这里                       │ │
│ │                或 [选择文件]                        │ │
│ │           仅支持 .xlsx · 最大 200 MB                │ │
│ └───────────────────────────────────────────────────┘ │
│ 文件名 | 文件大小 | [移除]                              │
├───────────────────────────────────────────────────────┤
│ 转换选项                                                │
│ 页面方向 [自动] 纸张 [自动] 缩放 [保留模板设置]         │
│ 工作表 [全部可见工作表]  □ 黑白输出                     │
│                                  [转换为 PDF]           │
├───────────────────────────────────────────────────────┤
│ 最近转换记录                                            │
│ 文件名 | 类型 | 创建时间 | 状态 | 页数 | 大小 | 操作   │
└───────────────────────────────────────────────────────┘
```

### 2.3 页面控件与交互

上传区支持拖拽和文件选择，前端扩展名/MIME 仅用于友好提示，后端是最终校验边界。上传后展示文件名、大小、移除操作。上传状态至少包括 idle、selected、uploading、validating、queued、uploadFailed、invalidFile、tooLarge。

转换选项仅提供经 LibreOffice 金样本验证支持的参数：
- 方向：自动/纵向/横向，默认自动，优先保留工作簿 Page Setup。
- 纸张：自动/A4/Letter/Legal，默认自动。
- 缩放：保留模板设置/宽度适配一页/每张工作表适配一页宽；默认保留模板设置。禁止“所有内容强制压到一页”。
- 工作表：所有可见工作表；不得通过客户端参数指定隐藏工作表绕过规则。
- 黑白输出：默认关闭。

可先只做默认转换；未实现的选项不得显示为可交互控件。不得承诺与 Microsoft Excel 像素级一致；LibreOffice 与 Excel 的字体、分页、图表和条件格式可能有差异。上传工作簿需要有可用公式缓存值，转换过程不联网刷新。

### 2.4 转换记录

字段：文件名、类型（quotation/pi/other）、创建人、上传时间、状态、页数、PDF 大小、到期日、操作。服务端分页，pageSize 最大 50；支持状态过滤、文件名搜索和日期筛选。

操作：
- 下载/预览：仅 succeeded 且有 download 权限。
- 重试：仅 failed 且有 retry 权限；重新验证输入文件存在且 hash 未变化。
- 删除：二次确认，先撤销下载，再建立物理删除任务。
- 详情：展示安全错误码、面向用户的信息和 requestId；不显示堆栈、文件 key 或内部路径。

PDF 预览和下载均必须走受保护 API，不返回永久公开 R2 URL。浏览器 Blob 下载后释放 object URL。页面在 360px 手机、平板与桌面适配；小屏记录列表变卡片或局部横向滚动，页面本身不得横向溢出。

### 2.5 状态与国际化

状态需覆盖初始、上传、验证、排队、处理中、成功、失败、重试、删除中、过期。轮询复用项目现有任务轮询策略，指数退避；页面隐藏时降频。

所有文案进入 zh-CN/en-US 资源。上传区域可键盘访问；错误显示稳定 messageKey、errorCode 和 requestId。不得将 File 内容、客户信息或长效授权 URL 写入 localStorage/sessionStorage。

---

## 3. 菜单、权限和审计

### 3.1 权限码建议

先查现有 Permission catalog，避免重复 code：
- `excel_pdf.read`：页面、列表、详情。
- `excel_pdf.create`：上传并创建转换任务。
- `excel_pdf.download`：下载与预览。
- `excel_pdf.retry`：重试失败任务。
- `excel_pdf.delete`：删除记录与文件。

如项目权限粒度更粗，可合并为 read/create/manage，但必须最小授权。MenuTranslation 必须有 zh-CN/en-US。Menu 只决定导航；Permission + RolePermission 才是 API 授权事实来源。不得因为新增菜单自动扩大普通角色权限。

建议仅管理员有 retry/delete；业务操作员按业务需求获得 read/create/download。若只允许查看本人任务，必须在服务端落实 owner/data-scope 过滤，不能只在前端过滤。

### 3.2 审计事件

建议事件：`EXCEL_PDF_UPLOAD_ACCEPTED`、`EXCEL_PDF_CONVERSION_SUCCEEDED`、`EXCEL_PDF_CONVERSION_FAILED`、`EXCEL_PDF_DOWNLOAD`、`EXCEL_PDF_RETRY`、`EXCEL_PDF_DELETE_REQUESTED`、`EXCEL_PDF_DELETE_SUCCEEDED`、`EXCEL_PDF_DELETE_FAILED`。

记录 actorId、jobId、输入 SHA-256、文件大小、页数、耗时、状态、错误码、requestId。不得记录文件内容、storageKey、报价逐行金额、完整客户资料、Cookie/session/token、命令参数或临时目录。

---

## 4. 转换架构与引擎

### 4.1 推荐方案：自托管 LibreOffice headless

在现有独立 Worker runtime 内部运行 LibreOffice headless；NestJS API 负责认证、上传校验、私有存储与建任务，不在 HTTP request 中直接执行 soffice。输入文件与 PDF 均保存在私有存储。

```mermaid
flowchart TD
  A[Admin 上传 XLSX] --> B[API Auth + RBAC + DTO]
  B --> C[流式大小限制 / 暂存]
  C --> D[OOXML ZIP 安全检查]
  D --> E[私有 Storage 保存输入]
  E --> F[DB transaction: job + outbox]
  F --> G[PostgreSQL task runner]
  G --> H[隔离 LibreOffice 子进程]
  H --> I[PDF 签名/页数/大小校验]
  I --> J[私有 Storage 保存 PDF]
  J --> K[job succeeded + audit]
  K --> L[授权下载]
  H -->|失败/超时| M[清理进程和临时目录]
  M --> N[记录失败/可重试]
```

### 4.2 选型理由与限制

LibreOffice 可本地运行，无需向外部 SaaS 传输报价或 PI 内容，且有成熟的 Calc→PDF 转换能力。缺点是安装体积、CPU/RAM 占用与 Excel 渲染差异。目标架构文档的 API 主机规格为 2C/1G，必须进行真实峰值 RSS、CPU、磁盘和 P95 测试；若资源不足，拆出独立 Worker 节点或增加内存，不得直接提高并发。

不选第三方在线转换服务，避免客户报价、PI、联系人信息外传。不用 Puppeteer 截取 HTML 表格代替工作簿渲染。ExcelJS/JSZip 不是完整 Excel PDF 渲染引擎。

### 4.3 子进程安全

示意命令：

```bash
soffice \
  -env:UserInstallation=file:///tmp/lo-profile-<random> \
  --headless --nologo --nodefault --nofirststartwizard \
  --convert-to pdf:calc_pdf_Export \
  --outdir /tmp/excel-pdf/<job-id>/out \
  /tmp/excel-pdf/<job-id>/input.xlsx
```

必须 Node `spawn`，参数数组，`shell:false`；禁止 shell 字符串拼接和用户传入 CLI 参数。可执行文件路径由服务端配置固定。

每任务创建随机隔离目录（0700）、文件权限 0600、独立 LibreOffice profile；使用非 root 用户，限制 CPU/RAM/PID/文件描述符/临时磁盘；转换 sandbox 禁止网络出站；禁止宏、外链、外部数据刷新。超时后 kill 整个进程组，finally 清理临时文件和 profile。stdout/stderr 仅脱敏记录，不得写单元格内容。

PDF 输出必须验证 `%PDF-` 文件签名、可解析页数、非空页面、最大页数与最大输出字节。转换失败不得保留半成品下载入口。

---

## 5. XLSX 上传与安全验证

### 5.1 上传约束

大文件采用 8 MiB 分块上传，整份 XLSX 上限 200 MiB，上传会话 1 小时过期。每个分块请求小于 Next.js 默认 10 MiB 限制；API 将匿名分块键与服务端生成的 `uploadId`/索引绑定，并记录每块长度和 SHA-256，避免把客户端对象键直接交给 Worker。只有 complete 阶段的块数、总长度和完整文件 SHA-256 全部校验通过后才创建任务。

校验步骤：
1. 扩展名必须为 .xlsx（不区分大小写）；MIME 不可信，只作辅助提示。
2. 验证 ZIP 容器签名、CRC/可读性、entry 数、展开大小和压缩比，拒绝 zip bomb。
3. 必须包含 `[Content_Types].xml`、`xl/workbook.xml` 等 OOXML 结构。
4. 拒绝 vbaProject.bin、macro-enabled content type、`xl/externalLinks/`、外部 TargetMode=External 关系、OLE/ActiveX、外部数据连接。
5. 校验 ZIP entry 数不超过 4,000、单 entry 不超过 256 MiB、展开总量不超过 1 GiB、压缩比不超过 250；当前实现不额外限制 sheet 数或非空 cell 数。
6. 拒绝加密/密码保护无法解析的工作簿，错误码 `XLSX_PASSWORD_PROTECTED_UNSUPPORTED`。
7. 原文件名仅作脱敏展示元数据；存储名由服务端随机生成，不含客户名称、报价编号或 PI 编号。
8. 不刷新公式/外部连接、不执行宏、不联网；只使用工作簿已有缓存值。发现外部引用时拒绝。

### 5.2 安全边界

禁止任意 URL fetch（SSRF）、任意路径、任意 soffice 参数、任意字体路径、shell=true。ZIP 检查不应只看扩展名；设置 entry count、展开大小、单 entry 大小、压缩比和解析超时。对不支持的 OOXML feature 应明确返回限制错误，不要假装成功。

### 5.3 存储

输入/输出 FileAsset 均 `isPublic=false`。优先复用 FileAsset、Storage adapter、R2 私有 bucket 和现有删除任务。下载 API 强制 Auth + permission + job owner/data scope。R2 key 随机，API 不返回 key 或公开 URL。保留期默认 7 天；过期清理由持久化删除任务实际删除对象，失败需重试。

---

## 6. API 契约

路径统一 `/api/v1/admin`，具体 controller 路由依照现有 NestJS conventions。每个接口分别认证、授权和校验。

| 方法 | 路径 | 权限 | 作用 |
|---|---|---|---|
| GET | `/excel-pdf/config` | excel_pdf.read | 返回功能开关、200 MiB 上限、8 MiB 分块和输出限制 |
| POST | `/excel-pdf/uploads` | excel_pdf.create | 初始化分块上传；要求 `Idempotency-Key` |
| PUT | `/excel-pdf/uploads/:uploadId/chunks/:index` | excel_pdf.create | 上传单个 8 MiB 分块 |
| GET | `/excel-pdf/uploads/:uploadId` | excel_pdf.create | 查询已上传分块与上传状态 |
| POST | `/excel-pdf/uploads/:uploadId/complete` | excel_pdf.create | 校验完整文件并创建转换任务，HTTP 202 |
| POST | `/excel-pdf/uploads/:uploadId/cancel` | excel_pdf.create | 取消上传并安排物理清理 |
| GET | `/excel-pdf/jobs` | excel_pdf.read | 分页列表 |
| GET | `/excel-pdf/jobs/:id` | excel_pdf.read | 详情/状态 |
| GET | `/excel-pdf/jobs/:id/download` | excel_pdf.download | 下载 PDF |
| GET | `/excel-pdf/jobs/:id/preview` | excel_pdf.download | inline 预览 |
| POST | `/excel-pdf/jobs/:id/retry` | excel_pdf.retry | 重试失败任务 |
| DELETE | `/excel-pdf/jobs/:id` | excel_pdf.delete | 请求删除输入/输出文件 |

初始化上传返回的 `uploadId`、`chunkSize`、`chunkCount`、`expiresAt` 只用于本次上传。完成上传并创建任务后返回 HTTP 202：

```json
{
  "id": "uuid",
  "status": "queued",
  "fileName": "Quotation_USD_20261031.xlsx",
  "fileSize": 185240,
  "createdAt": "2026-10-31T01:13:35.000Z",
  "requestId": "..."
}
```

不返回 storageKey、私有 URL、Buffer、工作簿单元格内容或客户信息。初始化上传使用 `Idempotency-Key`；同一管理员以相同 key 重试时返回已有上传会话，避免重复创建对象。

列表字段：id、fileName、businessType（quotation/pi/other）、fileSize、status、pageCount、outputSize、errorCode、createdAt、completedAt、expiresAt、createdBy。businessType 是用户选择的分类标签，不作为权限判断依据。分页最大 50。

下载只允许 succeeded 且 PDF asset 完整存在的任务；返回 `application/pdf`、安全 Content-Disposition、`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`。下载流由服务端鉴权后读取 Storage，不返回长期 presigned URL。

重试时重新验证输入 asset 存在、hash 一致、权限有效；failed→queued 条件更新，设置新 attemptId；禁止重试 queued/processing/succeeded。删除先撤销下载能力，再建持久化对象删除任务。

---

## 7. 数据模型与 PostgreSQL durable task

先审计 `database/prisma/schema.prisma`、migration 和代码：FileAsset 是否支持私有 XLSX/PDF、purpose、hash、size、状态和过期时间；OutboxEvent / PG task runner 是否允许新增 task type 和 payload schema version；QuoteExportJob 是否专属于 Excel 生成；AuditLog 是否有事件类型和 JSON metadata；删除任务是否支持两个 asset。

优先扩展已有通用任务/outbox 为 `excel-pdf-convert` type；若无合适通用任务模型，则添加独立 `ExcelPdfConversionJob` 表。禁止创建竞争的第二套任务状态系统，也不要为本功能增加 Redis/BullMQ。

参考状态机：queued→processing→succeeded|failed|cancelled|expired。failed 可手动 retry→queued。Worker 通过现有原子 claim/lease/heartbeat 机制领取任务；过期 lease 可恢复。PDF 上传私有存储且完整校验后，才能将 job 更新 succeeded。R2/DB 非原子：使用待确认状态、幂等 key 和补偿删除任务处理孤儿对象。

如新增表，建议字段：id、creatorId、inputAssetId、outputAssetId、inputSha256、outputSha256、inputBytes、outputBytes、pageCount、businessType、status、attemptCount、attemptId、errorCode、errorMessageKey、idempotencyKey、leaseUntil、createdAt、startedAt、completedAt、expiresAt。字段命名与索引必须适配实际 schema conventions。新增 migration 必须 additive，并提供数据验证和回滚说明；不应无必要新增字段或表。

---

## 8. Admin 前端实现

当前功能边界：

```text
apps/admin/src/
  app/[locale]/(admin)/tools/excel-to-pdf/page.tsx
  lib/excel-pdf-api.ts
  messages/zh-CN.json
  messages/en-US.json
```

页面复用唯一 Admin Shell、Session、现有错误处理和 locale 路由。客户端把文件按 8 MiB 切片，逐块使用 FormData 上传且不手动设置 multipart Content-Type；单块网络/5xx 错误有限重试并显示当前分块。初始化请求带 Idempotency-Key，complete 后使用退避轮询任务状态。下载按 Blob 处理，安全解析 Content-Disposition 文件名并释放 object URL。所有文案进入 zh-CN/en-US 资源。不要把文件内容/PI 数据持久化到浏览器存储。

---

## 9. API / Worker 代码实现边界

当前模块路径：

```text
apps/api/src/modules/excel-pdf/
  excel-pdf.module.ts
  excel-pdf.controller.ts
  excel-pdf.service.ts

apps/worker/src/tasks/excel-pdf/
  excel-pdf-task.handler.ts
  excel-pdf-cleanup.ts
  excel-pdf-errors.ts
  xlsx-zip-validator.ts
  libreoffice.runner.ts
  pdf-output-validator.ts
  temp-workspace.ts
```

Controller 仅处理认证、RBAC、multipart 和响应；Service 负责分块幂等、complete 校验、job/outbox、FileAsset、Storage、审计；Worker runner 使用固定可执行路径和参数数组启动 LibreOffice；Validator 负责输入 ZIP/OOXML 与输出 PDF 安全约束。转换绝不能运行在 API 请求生命周期内。Worker shutdown 时停止领取新任务并正确处理中断；失败状态不可被旧 attempt 覆盖。

---

## 10. 菜单/权限 Seed 与国际化

- 使用项目现有 `--reference-only` 幂等 reference seed 新增 Menu 与 zh-CN/en-US
  MenuTranslation；API 每次启动都会在监听端口前自动同步，SQL 文件仅作为受控恢复兜底。
- 新增 Permission code 时先检查现有目录；创建权限定义不等于给角色授权。
- `excel_pdf.read/create/download/retry/delete` 默认只授予 `super_admin`；其他角色必须经过
  受控角色授权流程，retry/delete 默认保持管理员专用。
- 菜单父级不存在时不自行新建平行菜单树；先选择现有合适父级。
- 更新菜单翻译覆盖检查，新增 menu 必须通过 `pnpm check:menu-translations`。

---

## 11. Worker 部署与资源管理

- 仅在 Worker 镜像安装 LibreOffice headless 和所需字体；API 镜像不要安装。
- 固定基础镜像与包版本/tag/digest，不使用 latest；非 root 运行。
- 生产 Compose 的 Worker 安装 `libreoffice-calc`、`poppler-utils`、Fontconfig、DejaVu 和 Noto CJK 字体；`WORKER_TMP_DIR=/data/tmp` 使用持久卷，避免容器重启中断任务时留下不可追踪状态。建议预留至少 2 GiB 临时空间。
- 当前生产 Compose 为 Worker 设置 2 CPU、4 GiB 内存、256 PIDs、1 GiB shared memory、文件描述符限制、6 分钟停止宽限期、`no-new-privileges` 和 drop all capabilities；这些限制保护宿主机，但不能保证任意 200 MiB 工作簿都能在超时和内存限制内完成。
- 禁止转换容器网络出站；存储读写由 Worker 主进程的 Storage adapter 执行，必要时按最小权限提供网络。
- Cloudflare Workers 只负责 Admin UI/BFF 请求转发；不在 Cloudflare Worker request CPU 生命周期中执行 soffice。
- 若 API 与 Worker 同机，先做压测；转换导致 API readiness/P95 恶化时必须把 Worker 分离部署或提升规格。
- 监控 queued age、转换时长、失败率、retry、RSS、临时磁盘、PDF 页数/大小。

配置默认值：`EXCEL_PDF_ENABLED=false`、`EXCEL_PDF_MAX_UPLOAD_BYTES=209715200`（200 MiB）、`EXCEL_PDF_CHUNK_BYTES=8388608`（8 MiB）、`EXCEL_PDF_MAX_OUTPUT_BYTES=52428800`（50 MiB）、`EXCEL_PDF_MAX_PAGES=200`、`EXCEL_PDF_TIMEOUT_MS=300000`、`EXCEL_PDF_RETENTION_DAYS=7`。Worker 并发保持 1。只将运维确实需要调节的项目放入 `.env.example`；不暴露任意 soffice CLI 参数。

`STORAGE_DRIVER=local` 时 API 与 Worker 必须共享同一 `STORAGE_LOCAL_ROOT`，当前 Compose 通过 `/data/uploads` 共享卷实现。部署多个 Worker/API 副本时必须改用共享 S3/R2 兼容私有存储；不能把本地卷分别挂载到不同副本后假设对象可见。

---

## 12. 测试与验收

### 12.1 单元测试

- OOXML：合法 xlsx；伪装扩展名；损坏 ZIP；缺少 workbook.xml；entry/展开大小/压缩比超限；宏、外链、OLE、ActiveX、加密工作簿拒绝。
- LibreOffice runner：固定 spawn 参数、shell=false、超时 kill process group、异常 exit、空 PDF、输出大小超限、临时文件清理。
- PDF validator：签名、页数、可解析性、空页/损坏输出/超页拒绝。
- 状态机：queued→processing→succeeded/failed；lease 恢复；重试次数；幂等；双 Worker 竞争同一任务。
- 权限：未登录 401，无权限 403，跨用户 job 下载按项目防枚举策略拒绝，已删除/未成功 job 下载拒绝。
- 审计脱敏：不含 storageKey、文件内容、客户资料、PI 明细、token 或完整命令参数。

### 12.2 API 集成测试

1. 未登录上传/list/detail/download/retry/delete 均 401。
2. 缺 create/read/download/retry/delete 对应权限时分别 403。
3. 合法报价 XLSX 上传返回 202，任务 queued；Worker 完成后 PDF 可解析。
4. 合法 PI XLSX 可转换；PI 原始业务数据和 XLSX 不变。
5. 格式伪装、超大文件、zip bomb、宏/外链/加密文件拒绝。
6. 转换失败不产生可下载 output asset。
7. R2/DB 失败的补偿与孤儿清理可观察、可重试。
8. retry 并发、删除、到期清理物理对象与数据范围测试。
9. PDF 不会进入公开 API、公开 CDN 或无需授权的 URL。
10. 恰好 200 MiB 的初始化可接受，200 MiB + 1 字节被拒绝；分块大小不超过 8 MiB，complete 对缺块、长度/SHA 不匹配和并发幂等请求给出一致结果。
11. download 只解析服务端记录的对象键；对象缺失、记录大小不一致、Storage 读失败时不返回损坏文件，并记录不含对象键的失败审计。

### 12.3 Admin E2E

`登录 → Excel 转 PDF → 上传 quotation.xlsx → queued → processing → succeeded → 下载 PDF → 校验页数/非空 → 删除 → 验证物理对象删除完成`。PI 文件再执行一轮。测试 360px、768px、1280px，以及键盘上传、拖拽、错误格式、网络中断、重复点击、分块重试、轮询失败、下载失败和权限拒绝。

### 12.4 金样本视觉回归

以当前正式报价模板生成含 Logo、商品图片、长英文名称、价格和 footer 的 XLSX；另准备 PI XLSX。检查页数、方向、打印区域、重复表头、商品图片、边框、字体、合并、页眉页脚、币种与金额。与 Microsoft Excel 参考 PDF 逐页比较；允许已记录的引擎差异，关键字段/图片不可丢失。测试记录转换器版本、OS 镜像 digest 和日期；不提交真实客户数据样本。

### 12.5 200 MiB 容量验收

在 staging 使用脱敏、合法的接近 200 MiB XLSX 执行完整分块上传和 LibreOffice 转换，记录上传吞吐、Worker 峰值 RSS、CPU、临时磁盘、转换耗时、队列等待、PDF 页数/大小和失败码。该压测验证的是当前部署规格，不代表任意 200 MiB 工作簿都能在 300 秒内完成；超过页数、输出大小或超时限制必须明确失败并向用户显示可操作错误。

---

## 13. 执行拆分（AI Coding Agent）

### Phase 0：仓库审计（先做）

阅读 `AGENTS.md`、`docs/02-architecture.md`、`docs/08-excel-pdf-pi.md`、`docs/30-remove-excel-to-pdf-keep-quote-excel.md`、`docs/33-lightweight-cloudflare-neon-r2-implementation.md`、RBAC/菜单/文件存储文档。检查 schema/migrations、FileAsset、QuoteExportJob、OutboxEvent、PG task runner、Storage adapter、权限 seeds、菜单 seeds、Admin routes、Worker Dockerfile。输出旧 PDF 代码/表/依赖残留审计表。记录 main SHA、工作区状态，创建功能分支；不要直接在 main 修改业务代码。

### Phase 1：DB/API/Worker

审计后确定通用 task type 是否可扩展；确有需要才加 additive migration。实现上传验证、job/outbox、RBAC、审计、LibreOffice converter、PDF validator、私有存储、授权下载、重试、删除和过期清理。

### Phase 2：Admin

新增菜单、翻译和 permission seeds；构建上传页面、转换选项、记录、状态、下载/预览/重试/删除；加入双语和响应式测试。角色授权必须经审查，不得 seed 时静默授予普通角色。

### Phase 3：部署与安全

Worker 镜像增加 LibreOffice/字体；API 镜像不装。加入资源限制、无网络隔离、健康指标与配置。功能开关默认关闭，先 preview 环境验收。

### Phase 4：测试与文档

执行 workspace 测试、lint、typecheck、build；记录未运行项目及原因。更新 README、docs/08、部署文档和 docs/30 历史说明。自动化检查通过不等于生产容量验收通过，200 MiB 压测和金样本视觉回归仍需在 staging 记录结果。

---

## 14. 发布与回滚

发布顺序：备份 PostgreSQL 元数据；部署 additive migration（如有）；部署 API/Worker 镜像且关闭功能；API 启动自动同步 reference data（生产发布脚本还会在切换前预检）；验证 soffice、字体和临时盘；执行报价单与 PI 金样本 smoke test；preview 验收后启用；监控队列延迟、RSS、失败率、临时磁盘与 API P95。

回滚：

1. 设置 `EXCEL_PDF_ENABLED=false`。API 的上传、任务查询、下载、重试和删除入口会返回 disabled；Worker 的服务端 claim 查询也不会再领取 `excel-pdf-convert` 事件，而不是把旧事件领取后消费失败。
2. 转换事件和对应 job 保持 `QUEUED`，已完成下载记录与审计保持不变；功能重新启用后可继续处理旧事件。清理任务不受该门禁影响，仍可执行已授权的物理删除和到期清理。
3. 如需立即停止全部后台任务，再暂停 Worker image 或实例；只隐藏 Admin 菜单或只回滚前端不构成回滚。
4. 视故障范围回滚 API/Worker 镜像。两个 additive migration 默认不反向删除；保留 job、审计、FileAsset 与对象，除非已按数据保留策略确认可清理。
5. 不删除报价单 Excel、PI Excel、报价模板或 PI 业务数据。若必须关闭菜单授权，仅撤销 `excel_pdf.*` 权限并保留历史，不删除权限审计事实。

---

## 15. Definition of Done

- [ ] zh-CN/en-US 菜单及页面正常，复用 Admin Shell。
- [ ] 每个接口服务端认证与 RBAC 正常。
- [ ] 仅合法安全 XLSX 可上传；宏、外链、zip bomb 等拒绝。
- [ ] API 只负责验证/建任务，Worker 隔离执行 LibreOffice。
- [ ] 使用 PostgreSQL durable task/outbox；不引入 Redis/BullMQ。
- [ ] 输入/输出均私有存储，下载强制授权，不存在公开 URL。
- [ ] 报价单 Excel、PI Excel 的原有导出链路无回归。
- [ ] PDF 经签名、页数、大小和可解析性检查。
- [ ] 重试、超时、Worker 崩溃恢复、删除与过期清理有自动化测试。
- [ ] Excel/LibreOffice/WPS 与 PDF 查看器人工验收完成。
- [ ] lint、typecheck、tests、build 的真实结果记录完整。
- [ ] README、docs/08、docs/30 历史记录和部署文档已同步更新。
