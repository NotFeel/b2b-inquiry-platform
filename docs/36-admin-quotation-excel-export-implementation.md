# Admin 商品报价单 Excel 导出 — 可执行落地规范

> 项目：NotFeel/b2b-inquiry-platform；目标分支：main；文档编号：ADM-QUOTATION-EXPORT-01。
>
> 性质：开发实施规格，不代表功能已完成。输入范本为用户上传的《凡士林-导出报价.xlsx》，配套模板为《B2B_Quotation_Template.xlsx》。

## 0. 执行前强制要求

编码前阅读 `AGENTS.md`、商品/品类/角色权限/菜单专项 skills、`docs/14-open-decisions.md`、`docs/18-role-permission-crud-and-menu-permissions.md`、`docs/19-menu-management-crud-and-submenu-design.md`、`docs/24-product-management-crud-and-image-storage.md`，先确认文件实际存在。

先检查实际 Prisma Product、ProductTranslation、Category、ProductImage、FileAsset、Permission、RolePermission、Menu、AuditLog schema/migrations；再定位商品 API、Category tree API、RBAC guard、菜单 seed、Admin locale 路由、图片存储 adapter、原图/缩略图逻辑、下载响应、测试约定。不得凭本文猜字段名或建重复模块。

当前 apps/api/package.json 已有 exceljs 4.4.0、decimal.js 10.6.0、jszip 3.10.2，优先复用。项目为 NestJS API、Next.js Admin。实际路径、权限码、路由、DTO 若不同，适配现有约定并记录差异。

完成标准：页面和 API 权限齐全；按品类查询商品并默认全选整个结果；支持取消/恢复；抬头、markup、币种和汇率可编辑且校验；后端 Decimal 计算；原图字节嵌入 XLSX；Excel 可在 Excel/LibreOffice/WPS 打开；前台不泄漏成本价；测试覆盖权限、汇率、图片、全选、异常；lint/typecheck/tests/build 真实运行，未运行项如实说明。

## 1. 功能范围和流程

Admin 新增商品管理子菜单“报价单导出 / Quotation Export”：从“报价模板”中选择一个已启用且结构校验通过的商品报价模板 → 选择一个品类（可包含子品类）→ 获取商品 → 默认全选所有查询结果 → 手动取消/恢复商品 → 填写公司名称、联系人、邮箱、电话、报价表名称、加价率、币种、汇率 → 服务端预览 → 读取所选模板并填充数据，生成 XLSX 下载。

MVP 建议单次最多 200 件（必须压测后确认）。默认只允许 published 且 lifecycle != discontinued 商品；未发布商品需要独立权限。商品必须有有效 CNY 成本价、英文名称和有效主图。任一商品验证失败则整份导出失败，不下载部分文件。本期不保存客户联系方式或报价文件、不自动获取汇率、不发邮件。

## 2. 读取报价模板的结构契约

正式模板为 `assets/templates/B2B_Quotation_Template.xlsx`。用户可在“报价模板”页面上传新版本，并可自由调整字体、颜色、边框、行高、列宽和合并单元格；但工作表名、固定占位符、第 7 行商品表头和第 8 行商品数据起点属于程序契约，不能删除或移动。确需调整时必须同步升级解析器和回归测试。

固定结构：

|区域|位置|程序占位符及用途|
|---|---|---|
|公司名称|第 1 行|`[COMPANY NAME]`|
|联系人|第 2 行|`[CONTACT PERSON]`|
|邮箱|第 3 行|`[EMAIL]`|
|电话|第 4 行|`[PHONE]`|
|报价表名称|第 5 行|`[QUOTATION TITLE]`|
|报价说明|第 6 行|`[CURRENCY]`、`[RATE]`、`[MARKUP]`|
|商品表头|第 7 行|固定字段标识，不得移动|
|商品数据及原始图片|第 8 行起|按字段映射逐行写入；图片读取项目 Storage 中商品主图原始字节后嵌入|

当前正式模板的工作表为 `Quotation`，固定 7 列：

|列|表头|来源及要求|
|---|---|---|
|A|Product SKU|Product.sku，文本|
|B|Product Image|商品主图 original asset，嵌入|
|C|Product Name|ProductTranslation en-US，必填|
|D|Unit Price (所选币种)|后端计算，动态币种，0.00|
|E|Packing Quantity (PCS / carton)|每箱数量，正整数|
|F|Case Dimensions (L × W × H cm)|如 40 × 30 × 30 cm|
|G|Gross Weight (KG)|箱规毛重，不能误用单件重量|

模板可以提供第 8 行起的示例商品行，也可以只保留第 7 行表头；没有示例商品行时，填充器从第 8 行创建安全的默认数据行。存在示例行时，填充器保留其单元格样式、行高、边框、底色和行内合并，并按商品数量动态增删商品行。导出时会更新筛选区、打印区域、重复标题行和冻结窗格。价格写数值单元格，格式 0.00；所有客户与商品文本均防止公式注入。图片等比缩放、不裁切，也不写入或泄露 `storageKey`；模板自带的 Logo 等非商品图片会保留。

英文名称必须来自 en-US。即使用户范本的产品名样例为中文，面向海外客户的报价也不应输出内部中文名称。

## 3. Admin 页面 UI

使用现有 Admin Shell 和 locale/dashboard 路由；页面标题“报价单导出 / Quotation Export”。页面按以下五张卡片组织：

### 3.1 选择报价模板
- 必填，选项来自 `GET /api/v1/admin/quotation-export/templates`，只返回 active、`product_quote`、结构校验通过且私有文件可用模板的摘要。
- 唯一模板自动选中；刷新后当前模板仍有效则保留，否则回退首项；无模板时引导用户前往“报价模板”上传、校验并启用。
- 选择器只接收 `templateId`，页面不接收或展示 `storageKey`、私有 URL 或文件内容。

### 3.2 选择品类
- 必填品类树选择器，支持搜索和路径显示。
- “包含子品类商品”开关默认开启；如现有 API 定义不同，遵循现有业务规则并清晰提示。
- 品类切换重置已选商品，然后对新查询结果默认全选。

### 3.3 商品选择
- 搜索 SKU/英文名称，显示商品总数、已选数、全选当前结果、清空。
- 列：checkbox、后台缩略图、SKU、英文名、品类、箱规摘要、成本可用状态（可报价/缺成本，不显示成本金额）。
- 默认全选必须覆盖整个查询集，不能仅勾选当前页。建议服务端返回最多 200 个完整 product ID 清单，前端持有 selectedProductIds；超过上限提示先缩小范围。
- 搜索变化保留已选项，提供“全选当前结果”；选择数为 0 禁用导出。

### 3.4 报价抬头

|字段|校验|
|---|---|
|Company Name|必填，trim，1–120 字符|
|Contact Person|必填，1–80 字符|
|Email|必填，格式合法，≤254 字符|
|Phone|必填，3–40 字符，允许 +、空格、括号、短横线|
|Quotation Title|必填，1–160 字符|

### 3.5 价格配置

|字段|规则|
|---|---|
|Markup (%)|默认 15；0–500；最多 2 位小数|
|Output Currency|必填，服务端币种白名单|
|Exchange Rate|必填，大于 0，最多 10 位小数，拒绝科学计数法|

汇率方向固定为 **1 CNY = X 目标货币**。例如 USD 0.1385 表示 1 CNY = 0.1385 USD。UI label 动态显示 `Exchange rate (1 CNY = ? USD)`，不允许只写 Exchange Rate。CNY 自动填 1 并锁定，服务端再次校验为 1。推荐币种 USD/EUR/GBP/CAD/AUD/JPY/CNY，但选项必须来自服务端白名单。汇率由用户手动填写，本期不拉取实时汇率。

### 3.6 价格预览和状态
- 显示商品数、markup、目标币种、汇率方向；价格预览 3–5 件商品，由 preview API 返回。
- preview 和 export 共用同一后端价格函数。
- 缺成本、汇率错误或商品不合格时禁止导出并显示原因。
- 导出按钮需 loading、防重复提交、失败提示和 requestId，导出前确认模板名称与版本、商品数/币种/markup/rate。
- 页面至少覆盖 Initial、Loading、Ready、PartiallySelected、NoProducts、MissingCost、MissingImages、MissingEnglishName、InvalidCartonData、InvalidRate、Exporting、ExportFailed、PermissionDenied。
- 360px 手机布局表格局部横向滚动，整个页面不横向溢出，表单改单列。

## 4. 价格计算（后端唯一实现）

内部成本为 CNY：

`目标币种单价 = CEILING_2(成本价 CNY × (1 + markup% / 100) × 汇率)`

markup=15 表示乘 1.15；rate 表示 1 CNY 可兑换多少目标币。先加价再换汇，最后仅对最终目标币金额向上取整两位。禁止先对 CNY 成本或中间结果进位。禁止 JS number 做金融运算，所有值以 decimal string 传输，由 decimal.js 计算。

```ts
import Decimal from 'decimal.js';
export function calculateQuotationUnitPrice(input: { costCny: string; markupPercent: string; exchangeRate: string }): string {
  const cost = new Decimal(input.costCny);
  const markup = new Decimal(input.markupPercent);
  const rate = new Decimal(input.exchangeRate);
  if (!cost.isFinite() || cost.lte(0)) throw new Error('INVALID_COST');
  if (!markup.isFinite() || markup.lt(0) || markup.gt(500)) throw new Error('INVALID_MARKUP');
  if (!rate.isFinite() || rate.lte(0)) throw new Error('INVALID_EXCHANGE_RATE');
  return cost.mul(new Decimal(1).plus(markup.div(100))).mul(rate)
    .toDecimalPlaces(2, Decimal.ROUND_CEIL).toFixed(2);
}
```

必测：最终未进位 4.25120405 → 4.26；4.35 → 4.35；0.051021 → 0.06；cost=100、markup=15、rate=0.1385 → 15.93；cost=100、markup=0、rate=0.1385 → 13.85；cost=100、markup=15、rate=1 → 115.00；0.000001 → 0.01。

需求给出的成本值 3.6966991739 与未进位值 4.25120405 应按公式重新核对，不能默认二者精确相等。测试应额外构造确实得出该中间值的成本输入。拒绝 markup 越界、rate≤0、NaN、Infinity、指数形式、成本≤0、超精度。CNY rate 必须等于 1。用户明确所有币种包括 JPY 都保留两位，不自行改币种精度。

## 5. 商品数据校验与防篡改

Export 请求仅接收 categoryId、includeDescendants、productIds、header、pricing。SKU、名称、成本、图片和箱规从数据库后端读取，绝不信任前端传值。

商品必须属于所选品类范围、存在且未删除；成本有效且 >0；有 en-US 名称；有有效主图；主图 FileAsset/对象未删除或 pending-delete。默认仅允许 published 且 lifecycle != discontinued，未发布商品需要独立权限。cartonQty 建议必填正整数。箱规 L/W/H 必须三项全有效或三项全空输出“-”，不能部分缺失；cartonGrossWeightKg 建议正数，可按历史数据决定是否允许空，但不得误用单件重量。尺寸格式如 `40 × 30 × 30 cm`；旧字符串 `40*30*30` 必须严格解析，优先独立字段。

一次聚合返回所有错误：PRODUCT_NOT_IN_CATEGORY、PRODUCT_NOT_EXPORTABLE、MISSING_COST、MISSING_ENGLISH_NAME、MISSING_PRIMARY_IMAGE、IMAGE_NOT_READY、INVALID_CARTON_QUANTITY、INVALID_CARTON_DIMENSIONS、INVALID_CARTON_WEIGHT、TOO_MANY_PRODUCTS。返回 422 QUOTATION_EXPORT_VALIDATION_FAILED，errors[] 至少含 productId、sku、field、code、messageKey。没有成本读取权限时错误不能泄漏成本金额。

后端重新按 productIds 查询，校验去重、存在、均属于品类树；服务端再次限制最大数量。不能接受前端 costCny、unitPrice、imageUrl、storageKey、sku/name 作为权威信息。导出采用请求时 DB 最新数据。

## 6. 原图读取与嵌入

商品图片必须是 Product 主图 original asset 的原始字节，而不是 CDN URL、缩略图、裁切/水印图、DISPIMG 公式或截图。用现有 Storage adapter 根据服务端受管 key 读取；禁止 fetch 任意用户 URL（SSRF）。首期 PNG/JPEG，按魔数确认，不只看 MIME/扩展名。建议单张≤8MB、≤20MP、总图≤40MB，压测后定值；拒绝损坏图、未知格式、SVG active content 和路径穿越 key。

ExcelJS 示意：

```ts
const imageId = workbook.addImage({ buffer: originalBuffer, extension: detectedExtension });
worksheet.addImage(imageId, {
  tl: { col: 1, row: rowIndex - 1 },
  br: { col: 2, row: rowIndex },
  editAs: 'oneCell',
});
```

实际 anchor 必须对应正确商品行。按 productId/SKU 绑定图与行，不按媒体文件顺序。图片等比、不裁切。任一原图读取失败整份导出失败，不可退化为缩略图/占位图；响应不回显 storageKey。图片读取并发建议≤4，设置 Buffer 总量、响应文件大小及导出超时。

## 7. 菜单、权限和审计

菜单为商品管理子菜单，名称 zh-CN“报价单导出”、en-US“Quotation Export”，路由按现有 Admin locale 规则，复用 Shell。图标复用现有 map。Menu 只负责导航，不构成授权。

建议权限码（需先查 Permission 目录）：
- `quotation.export.read`：加载页面、品类与商品列表。
- `quotation.export.create`：preview 和 export。
- 可选 `quotation.export.unpublished`：允许导出未发布商品，默认不授予。

每个接口服务端 guard 校验。商品列表只返 hasCost，不返实际成本。报价 service 由专门导出授权读取成本，不把成本放入通用 Product DTO，也不因此扩大普通商品编辑页的成本可见权限。

审计事件 `QUOTATION_EXCEL_EXPORTED` 记录 actorId、templateId、templateVersion、templateSheetName、categoryId、selectedProductCount、currencyCode、markupPercent、exchangeRate、generatedAt、outputFileSize、requestId、outcome。禁止记录成本逐行明细、完整邮箱/电话、XLSX/Base64、图片 Buffer、storageKey、模板内容、Cookie/session/token。本期不保存报价文件。

## 8. API 契约（按项目约定适配）

`GET /api/v1/admin/quotation-export/config`：返回服务端币种白名单、defaultMarkupPercent="15"、maxProducts=200、exchangeRateBase=CNY、rounding=CEIL_2。可复用 GlobalSetting/Dictionary，但服务端必须验证币种 code 合法且启用。

`GET /api/v1/admin/quotation-export/templates`：返回 active、结构校验通过且私有文件可用的 `product_quote` 模板摘要（id、name、version、fileName、sheetName、status）。不返回 `storageKey`、私有 URL 或模板内容。

`GET /api/v1/admin/quotation-export/products?categoryId=...&includeDescendants=true&search=...`：返回 id、sku、englishName、categoryPath、thumbnailUrl（仅后台展示）、hasCost、hasOriginalImage、cartonQty、箱规摘要、cartonGrossWeightKg、eligibilityCodes。默认全选需覆盖完整结果，超上限要求缩小范围。

`POST /api/v1/admin/quotation-export/preview` 示例：

```json
{
  "categoryId": "uuid",
  "includeDescendants": true,
  "productIds": ["uuid-1", "uuid-2"],
  "markupPercent": "15",
  "currencyCode": "USD",
  "exchangeRate": "0.1385"
}
```

返回 currencyCode、markupPercent、exchangeRate、itemCount、items(productId,sku,finalUnitPrice,currencyCode)、warnings/errors；不返回成本。

`POST /api/v1/admin/quotation-export/export` 示例：

```json
{
  "templateId": "uuid",
  "categoryId": "uuid",
  "includeDescendants": true,
  "productIds": ["uuid-1", "uuid-2"],
  "header": {
    "companyName": "Chongqing Wuxuan E-Commerce Co., Ltd.",
    "contactPerson": "Jerry",
    "email": "sales@example.com",
    "phone": "+86 190 7428 9250",
    "quotationTitle": "Squishy Stress-Relief Toys Price List"
  },
  "pricing": {
    "markupPercent": "15",
    "currencyCode": "USD",
    "exchangeRate": "0.1385"
  }
}
```

响应 HTTP 200，Content-Type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，Content-Disposition 安全 filename* UTF-8，附 X-Request-Id。文件名如 `Quotation_USD_20261030_103000.xlsx`。清理用户标题以防 CRLF/header injection。Admin 认证 fetch Blob 下载并 revokeObjectURL。DTO 使用项目统一 validation；`templateId` 必填 UUID；productIds UUID 数组去重、非空、限量；币种服务端白名单；decimal string 禁止科学计数法；不接受成本价、最终价、图片 URL、storageKey 等字段。服务端必须重新读取并校验模板，不能信任上传时的一次性检查结果。

## 9. 后端模块边界

可新增 QuotationExportModule，但复用 Product、Category、QuoteTemplate、FileAsset、Storage、RBAC、Audit。Controller 负责权限/DTO/响应；Service 查询商品、品类、成本、英文翻译、主图、箱规并聚合校验；Calculator 只做 Decimal；TemplateWorkbookBuilder 读取私有模板 Buffer 并仅接收已验证的数据，不访问 DB；Storage adapter 根据 asset reference 读原始字节。批量读取避免 N+1。模板/图片读取失败整单失败。若审计写入失败，不向用户交付生成文件，销毁 Buffer 并返回 5xx。

## 10. Admin 前端

组件建议：QuotationExportPage、CategoryTreeSelect、QuotationProductSelector、QuotationHeaderForm、QuotationPricingForm、QuotationPricePreview、QuotationExportActions，实际命名按项目约定。

```ts
type QuotationExportForm = {
  templateId: string | null;
  categoryId: string | null;
  includeDescendants: boolean;
  selectedProductIds: string[];
  header: { companyName: string; contactPerson: string; email: string; phone: string; quotationTitle: string };
  pricing: { markupPercent: string; currencyCode: string; exchangeRate: string };
};
```

decimal 输入始终是 string，不使用 parseFloat；商品/markup/币种/汇率变化清掉旧 preview，防止过期请求覆盖当前状态；preview debounce 300–500ms，最终 export 后端重算。不将客户邮箱和电话写 localStorage。所有按钮有真实行为、loading/disabled/error；所有文案进入 zh-CN/en-US 资源。

## 11. 测试和验收

价格算法测试：精确构造未进位 4.25120405→4.26、4.35→4.35、0.051021→0.06；100×1.15×0.1385→15.93；100×1×0.1385→13.85；100×1.15×1→115.00；极小值 0.000001→0.01。覆盖 rate=0/负数/NaN/Infinity/指数串、markup 越界、cost null/0/负数、CNY rate 非 1、超精度和极端大数。注意用户提供的 cost=3.6966991739 与中间值 4.25120405 需要按公式复核，不得硬编码不匹配的输入输出。preview 与 XLSX 同 SKU 价格必须一致。

API 集成：未登录 401；无 read 权限列表 403；无 create 权限 preview/export 403；跨品类 ID、重复 ID、空数组、数量超限 422；缺成本/英文名/主图聚合错误且无部分文件；下架/停产按策略拒绝；禁用币种/汇率错误 422；图片读取失败整单失败；成功文件 MIME/文件名正确、可解析、图片数等于商品数；审计不含成本/邮箱/电话；public API/SSR 不出现 priceCny。

Admin E2E：登录→选品类→默认全选整个结果→取消一项→预览更新→重新全选→填写抬头→选 USD、输入 0.1385 和 markup 15→显示 1 CNY = 0.1385 USD→导出→Excel/LibreOffice/WPS 打开检查→用缺数据品类验证整单失败→无权限角色验证菜单和 API 403。

XLSX 验收：Price List 工作表；抬头合并；七列且没有重复价格列；SKU/英文名正确；图片断网可显示且图片数等于商品数；图片比例正确；价格 2 位且 Ceiling；箱规字段单位正确；冻结、筛选、打印配置正确；不含成本价、内部 ID、storageKey 或系统 URL；在目标 Office/WPS 实测。

## 12. 部署、容量与回滚

初始建议商品≤200、单图≤8MB、图片总量≤40MB、读取并发≤4，必须压测后确认。配置优先复用 GlobalSetting；新增环境变量时更新 .env.example 与部署文档。监控成功率、耗时、文件大小、图片读取失败和校验错误，不记录成本或客户联系方式；设置用户/IP 频率限制。

发布前执行幂等权限/菜单 seed、lint、typecheck、API/Admin tests、build；生产冒烟导出 1/20/100 件并记录 CPU/RSS/耗时/文件大小。使用 feature flag 或隐藏菜单止损。预计无需 Product schema 变化，无必要不加 migration。本期不持久化客户报价文件。

## 13. AI 执行阶段任务

Phase 1 Discovery：检查 Product/ProductImage/FileAsset schema、migration、Storage adapter；定位 Admin 路由、菜单和权限 seed、i18n、Category API、商品 API、ExcelJS 和测试约定；先汇报现状差异。

Phase 2 Backend：实现 DTO/guard/module、品类范围校验、聚合校验、Decimal calculator 单测、preview/export 共用计算器、原图读取/魔数校验、ExcelJS workbook builder、下载响应、审计和 API tests。

Phase 3 RBAC/Menu/i18n：核对/创建 quotation.export.read/create；复用 RBAC seed；菜单挂商品管理子菜单；更新 MenuTranslation、zh-CN、en-US；验证无权限 403。

Phase 4 Admin UI：品类、商品列表、默认全选、跨页选择、抬头、markup、币种、汇率、服务器预览、Blob 下载、加载错误状态、360px/平板/桌面验收。

Phase 5 Validation：执行全部测试、Excel/WPS 实测、压测 1/20/100/最大值，更新实现差异和测试结果，提交 commit/PR；未执行检查必须明示。

## 附录 A：页面线框

```text
报价单导出 / Quotation Export
1. 选择商品品类 [品类树选择器] [✓ 包含子品类]
2. 选择商品（共 12 件） [全选] [清空]
[搜索 SKU / English name]
☑ 图片 | WX-001 | Fruit Squishy | 72 pcs | 40×30×30
☑ 图片 | WX-002 | Animal Squishy | 48 pcs | 35×25×20
已选择 12 / 12
3. 报价抬头：Company Name / Contact Person / Email / Phone / Quotation Title
4. 报价设置：Markup 15% | Currency USD | Exchange Rate (1 CNY = ? USD) 0.1385
价格预览：由服务端返回
                              [导出报价单 Excel]
```

## 附录 B：配套模板用途

`B2B_Quotation_Template.xlsx` 只用于列、布局与样式参考。生产导出动态生成实际商品行并嵌入真实主图，不能输出静态占位图或占位价格。

## 14. 实施与验收记录（2026-10-30）

### 14.1 Phase 1–5 状态

| 阶段 | 状态 | 实际结果 |
|---|---|---|
| Phase 1 Discovery | 已完成 | 已核对 Product、ProductTranslation、ProductImage、FileAsset、Category、Permission、RolePermission、Menu、AuditLog、Storage adapter、RBAC guard、Admin locale 路由与现有 ExcelJS 依赖；无需修改 Product schema。 |
| Phase 2 Backend | 已完成 | 新增独立 `QuotationExportModule`；实现 config/templates/products/preview/export 五个接口、统一 Decimal 计算、商品聚合校验、原图读取与 PNG/JPEG 魔数/像素校验、模板工作簿填充、严格审计和同步下载。报价模板登记会读取私有 XLSX 校验工作表、固定占位符、第 7 行表头、第 8 行商品起点和字段映射；真实 `B2B_Quotation_Template.xlsx` 已验证为 `Quotation!A7:G8`、7 列完整映射。 |
| Phase 3 RBAC / Menu / i18n | 已完成 | 新增 `quotation.export.read`、`quotation.export.create`、`quotation.export.unpublished`；商品管理下增加“报价单导出 / Quotation Export”菜单及双语翻译；`catalog_manager` 仅授予 read/create。 |
| Phase 4 Admin UI | 已完成 | 已实现报价模板选择、无模板引导、品类树、包含后代、默认全选、搜索保留选择、清空/恢复默认、抬头与价格配置、服务端预览、权限/加载/错误/成功状态、确认弹窗和 Blob 下载；确认弹窗显示模板名称与版本，页面按 360px 起单列/局部横向表格适配。 |
| Phase 5 Validation | 自动化已完成，人工验收未完成 | lint、typecheck、API/Admin/validation tests、菜单翻译检查和全仓生产 build 已通过；Office/WPS 人工打开和 1/20/100/200 件容量压测尚未执行。按本次用户要求未提交 commit/PR。 |

### 14.2 已落地接口与业务规则

- `GET /api/v1/admin/quotation-export/config`
- `GET /api/v1/admin/quotation-export/templates`
- `GET /api/v1/admin/quotation-export/products`
- `POST /api/v1/admin/quotation-export/preview`
- `POST /api/v1/admin/quotation-export/export`
- `GET /api/v1/admin/quote-templates`
- `GET /api/v1/admin/quote-templates/:id/file`
- `GET /api/v1/admin/quote-templates/:id/preview`
- `POST /api/v1/admin/quote-templates`
- `PATCH /api/v1/admin/quote-templates/:id/status`
- `DELETE /api/v1/admin/quote-templates/:id`
- 单次最多 200 件；品类结果超过 200 件时禁止部分选择并提示缩小品类范围。
- 无 `quotation.export.unpublished` 权限时，商品查询在数据库层只统计 `PUBLISHED` 且 lifecycle 非 `DISCONTINUED`；该权限也不能绕过停产限制。
- 价格只由后端按 `CEILING_2(costCny × (1 + markup/100) × exchangeRate)` 计算；所有币种（含 JPY）统一两位小数；CNY 汇率固定为 1。
- preview 与 export 共用同一价格计算和商品校验；export 重新读取数据库并重算，任一商品不合法时整单返回 422，不生成或返回部分 XLSX。
- 单图上限 8 MiB、图片总量上限 40 MiB、20 MP、读取并发 4；读取失败、格式伪造或超限均整单失败。
- 审计 `QUOTATION_EXCEL_EXPORTED` 成功后才返回文件；审计不记录成本、客户邮箱/电话、storageKey、图片字节或 XLSX 内容。
- 预览和导出均按登录用户限流：预览 120 次/分钟、导出 10 次/分钟。当前限流为单 API 进程内存窗口，多实例部署前需改为共享存储或边缘限流。
- “选择商品”的成本列仅在操作者具备 `product.cost.read`（或为超级管理员）时返回数据库中的精确 CNY 成本；无权限响应为 `costCny: null`，页面显示“成本已隐藏（无权限）”，不会通过其他字段序列化成本。
- 报价模板支持 `product_quote` / `pi` 两种类型；上传文件必须为不超过 10 MiB 的私有、无宏 `.xlsx`，且仍受 `file.upload` 权限保护。激活同类型模板时，事务内停用旧 active 模板，历史版本保留。
- 每个模板版本支持鉴权下载、只读预览和删除。下载接口重新校验 `QuoteTemplate`、私有 ready `FileAsset`（`purpose=quote-template`、`isPublic=false`）并从存储读取原始 XLSX；响应使用安全 UTF-8 文件名、`Cache-Control: private, no-store`、`nosniff` 和 requestId，不返回 `storageKey`。
- 预览由服务端将 XLSX 转为上限 200 行 × 40 列的只读 DTO，最多返回 200 个合并区域、6 张内嵌图片；单元格文本最多 2,000 字符，单图最多 1 MiB、图片总量最多 3 MiB。公式仅作为文本展示，不在服务端执行；仅允许 PNG/JPEG/GIF/WebP data URL。
- 删除接口需要 `quote.delete`，先停用版本并写入幂等 `FileDeletionJob`（`entityType=quote_template`），Worker 再调用对象存储物理删除文件。存储删除成功且再次确认没有历史导出或共享文件引用后，事务内删除 `QuoteTemplate`、独占 `FileAsset` 和删除任务；失败时保留文件元数据与任务，版本显示“重试删除”，且禁止重新启用。
- 若版本仍被历史 `QuoteExportJob` 引用，或文件 URL 被其他模板版本共享，删除返回 HTTP 409 `QUOTE_TEMPLATE_IN_USE`，不执行物理删除。QUEUED/PROCESSING 版本立即从列表隐藏；FAILED 版本保留以便操作员重试。
- 报价单导出请求必须携带 `templateId`；列表接口只返回 active、结构校验通过、私有 `FileAsset` ready 且 `purpose=quote-template` 的 `product_quote` 模板摘要。导出时再次从私有存储读取模板并解析，防止数据库报告与实际文件不一致。
- 固定模板契约为：第 1–5 行客户与报价名称占位符、第 6 行币种/汇率/加价率、第 7 行商品表头、第 8 行起商品数据与原始图片。样式、行高、列宽和合并可调整，但上述工作表、占位符、表头行和数据起始行不得删除或移动。
- 模板填充器按商品数量动态调整示例数据区，保留示例行样式和底部说明，更新筛选区、打印区域、重复标题行和冻结窗格；1 件、2 件和 200 件边界自动化测试已通过。

### 14.3 数据、权限与发布步骤

本需求没有数据库 schema 变更，不需要新增 migration，也不持久化客户报价文件或联系方式。发布时执行：

```bash
pnpm db:seed:reference
pnpm check:menu-translations
```

对已有数据库且暂时不能运行完整 reference seed 的环境，可执行幂等数据修复脚本：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/sql/seeds/20261030_quotation_export_menu_permissions.sql
```

该脚本会补齐菜单、双语翻译及 `super_admin` / `catalog_manager` 授权，并在父菜单或系统角色缺失、
最终记录不完整时整体回滚。它只处理引用数据，不改变数据库 schema。

随后在角色管理中按最小权限原则授予：

- 查看页面和商品选择：`quotation.export.read`
- 生成预览和 XLSX：`quotation.export.create`
- 查看报价模板：`quote.read`
- 上传、登记、启用或停用报价模板：`quote.export` + `file.upload`
- 删除模板版本并触发物理文件删除：`quote.delete`
- 仅在确有业务需要时单独授予：`quotation.export.unpublished`

不得默认向普通角色授予 `quotation.export.unpublished`。生产 Admin 构建必须设置 `ADMIN_API_PROXY_TARGET` 或 `API_BASE_URL` 指向 API origin；例如：

```bash
ADMIN_API_PROXY_TARGET=http://localhost:3002 pnpm build
```

### 14.4 自动化验证记录

| 检查 | 结果 |
|---|---|
| `pnpm --filter @b2b/api test` | 通过；40 个测试文件、311 个测试，包含真实模板解析、模板登记、下载/预览安全解析、删除保护及真实模板填充测试。 |
| `pnpm --filter @b2b/admin test` | 通过；17 个测试文件、175 个测试，包含模板选择、模板上传、下载、预览、删除请求、错误传播和状态更新测试。 |
| `pnpm --filter @b2b/worker test` | 通过；8 个测试文件、21 个测试，包含模板文件物理删除成功、失败重试、失效任务引用保护和本地存储文件实际删除。 |
| `pnpm --filter @b2b/validation test` | 通过；12 个测试。 |
| `pnpm --filter @b2b/api build` | 通过。 |
| `pnpm lint` | 通过。 |
| `pnpm typecheck` | 通过。 |
| `pnpm check:menu-translations` | 通过；29 个启用/可见菜单在 `zh-CN` / `en-US` 下翻译齐备。 |
| `ADMIN_API_PROXY_TARGET=http://localhost:3002 pnpm --filter @b2b/admin build` | 通过；构建产物包含 `/[locale]/products/quotation-export` 和 `/[locale]/quote-templates`。 |

### 14.5 真实模板上传验收要点

- 在报价模板页面选择“产品报价单”，上传 `assets/templates/B2B_Quotation_Template.xlsx`，模板名称保持不变时会创建下一个不可变 draft 版本。
- 登记后的 `QuoteTemplate` 应记录 `sheetName=Quotation`、`headerRow=7`、`itemStartRow=8`。
- 第 1–6 行必须分别保留 `[COMPANY NAME]`、`[CONTACT PERSON]`、`[EMAIL]`、`[PHONE]`、`[QUOTATION TITLE]`；第 6 行保留 `[CURRENCY]`、`[RATE]`、`[MARKUP]`。缺项或移到错误行时 `layoutValid=false`，禁止激活和导出。
- `fieldMapping` 应为：A `product.sku`、B `product.image`、C `product.name`、D `product.price_cny`、E `product.carton_qty`、F `product.carton_size_cm`、G `product.carton_weight_kg`。
- 文件以 `purpose=quote-template`、`isPublic=false` 保存在私有存储；列表只返回文件元数据，不返回公开 URL 或 `storageKey`。
- 每个版本应先验证下载文件名和内容，再打开预览检查工作表、样式、合并单元格与内嵌图片；预览超出 200 行或 40 列时页面必须明确提示截断，不能把截断预览误认为完整文件。
- 删除一个无历史导出、无共享文件引用的测试版本后，`QuoteTemplate` 与 `FileAsset` 元数据应删除，私有存储对象也应不存在；删除任务应最终为 `SUCCEEDED`，审计链包含请求成功/失败事件。
- 可用历史导出引用的版本验收 409 保护：接口返回 `QUOTE_TEMPLATE_IN_USE`，模板文件仍可下载，数据库和对象存储均不得被删除。
- 激活该模板后，同 `templateType` 的旧 active 模板会被停用；结构检查失败（缺少必需字段、关键列重复、占位符缺失/移动或固定行移动）的模板禁止激活。
- 当前正式模板只包含第 1–7 行，第 8 行起没有示例商品行；导出两件商品时应自动创建第 8、9 行并嵌入两张原图。模板已带的 Logo 图片必须保留，商品图片只能追加到对应商品行。导出响应和审计中均不得出现模板或图片 `storageKey`。

### 14.6 未执行的人工验收与风险

- 尚未在 Microsoft Excel、LibreOffice 和 WPS 中人工打开实际导出文件，未验证目标桌面软件的图片渲染、打印分页与公式/样式兼容性。
- 用户可修改模板样式和合并区域；若修改触及工作表名、占位符文本/行号、第 7 行表头或第 8 行商品起点，模板会被拒绝。这是有意的结构保护，不应通过放宽校验绕过。
- 尚未使用真实 1/20/100/200 件商品记录 CPU、RSS、耗时、输出体积和失败率；40 MiB 图片总量上限目前是保守保护值，需压测后再决定是否调整。
- 当前图片校验基于文件签名、尺寸和像素上限，没有对全部图片字节做完整解码沙箱；若后续允许不可信外部上传源，应增加成熟图像解码器/隔离进程。
- 回滚无需回退数据库 schema：先隐藏或停用 `quote-templates` / `products.quotation-export` 菜单，再撤销 `quote.delete` 及三个 quotation 权限即可停止新入口。已经提交的模板删除任务不能被回滚撤销，必须由 Worker 完成或人工按任务记录核对；已生成报价文件不保存在服务端，不涉及额外文件清理。
