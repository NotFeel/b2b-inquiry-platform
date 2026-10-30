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

Admin 新增商品管理子菜单“报价单导出 / Quotation Export”：选择一个品类（可包含子品类）→ 获取商品 → 默认全选所有查询结果 → 手动取消/恢复商品 → 填写公司名称、联系人、邮箱、电话、报价表名称、加价率、币种、汇率 → 服务端预览 → 生成 XLSX 下载。

MVP 建议单次最多 200 件（必须压测后确认）。默认只允许 published 且 lifecycle != discontinued 商品；未发布商品需要独立权限。商品必须有有效 CNY 成本价、英文名称和有效主图。任一商品验证失败则整份导出失败，不下载部分文件。本期不保存客户联系方式或报价文件、不自动获取汇率、不发邮件。

## 2. 范本 Excel 结构与报价模板

已读取上传的《凡士林-导出报价.xlsx》：工作表 Price List；A1:H1 公司名、A2:H2 联系人、A3:H3 邮箱、A4:H4 电话、A5:H5 报价名称合并；第 6 行是表头，7–8 行有两条样例。字段包括 SKU、Product Image、Product Name、重复两列 Price per Unit (CNY)、Packing Quantity (PCS)、Case Dimensions (L×W×H cm)、Gross Weight (KG)。重复价格列一列为空/隐藏，另一列有值；新模板只保留一列价格。图片单元格含 WPS DISPIMG("ID_...",1)，同时工作簿有 Drawing 浮动图片和媒体文件。DISPIMG 不能作为 URL 或原图；导出端必须从项目 Storage adapter 读取商品主图原始字节，再用 ExcelJS 嵌入。

新版固定 7 列：

|列|表头|来源及要求|
|---|---|---|
|A|Product SKU|Product.sku，文本|
|B|Product Image|商品主图 original asset，嵌入|
|C|Product Name (English)|ProductTranslation en-US，必填|
|D|Unit Price (所选币种)|后端计算，动态币种，0.00|
|E|Packing Quantity (PCS / carton)|每箱数量，正整数|
|F|Case Dimensions (L × W × H cm)|如 40 × 30 × 30 cm|
|G|Gross Weight (KG)|箱规毛重，不能误用单件重量|

Excel 顶部 A1:G1 公司名合并、16pt bold 居中；A2 联系人；A3 邮箱；A4 电话；A5 报价名称、14pt bold；A6 显示目标币种、汇率口径、markup，不显示成本；第 7 行深灰底白字表头；第 8 行开始每商品一行。图片列居中，行高建议 80–100pt，等比缩放不裁切。冻结 A8、打印重复行 1–7、A4 横向 fit-to-width、奇偶行浅底色、边框和垂直居中。价格写数值单元格，格式 0.00。可加简短英文说明，不添加用户未提供的地址、Logo 或付款承诺。

英文名称必须来自 en-US。即使用户范本的产品名样例为中文，面向海外客户的报价也不应输出内部中文名称。

## 3. Admin 页面 UI

使用现有 Admin Shell 和 locale/dashboard 路由；页面标题“报价单导出 / Quotation Export”。建议分四张卡片：

### 3.1 选择品类
- 必填品类树选择器，支持搜索和路径显示。
- “包含子品类商品”开关默认开启；如现有 API 定义不同，遵循现有业务规则并清晰提示。
- 品类切换重置已选商品，然后对新查询结果默认全选。

### 3.2 商品选择
- 搜索 SKU/英文名称，显示商品总数、已选数、全选当前结果、清空。
- 列：checkbox、后台缩略图、SKU、英文名、品类、箱规摘要、成本可用状态（可报价/缺成本，不显示成本金额）。
- 默认全选必须覆盖整个查询集，不能仅勾选当前页。建议服务端返回最多 200 个完整 product ID 清单，前端持有 selectedProductIds；超过上限提示先缩小范围。
- 搜索变化保留已选项，提供“全选当前结果”；选择数为 0 禁用导出。

### 3.3 报价抬头

|字段|校验|
|---|---|
|Company Name|必填，trim，1–120 字符|
|Contact Person|必填，1–80 字符|
|Email|必填，格式合法，≤254 字符|
|Phone|必填，3–40 字符，允许 +、空格、括号、短横线|
|Quotation Title|必填，1–160 字符|

### 3.4 价格配置

|字段|规则|
|---|---|
|Markup (%)|默认 15；0–500；最多 2 位小数|
|Output Currency|必填，服务端币种白名单|
|Exchange Rate|必填，大于 0，最多 10 位小数，拒绝科学计数法|

汇率方向固定为 **1 CNY = X 目标货币**。例如 USD 0.1385 表示 1 CNY = 0.1385 USD。UI label 动态显示 `Exchange rate (1 CNY = ? USD)`，不允许只写 Exchange Rate。CNY 自动填 1 并锁定，服务端再次校验为 1。推荐币种 USD/EUR/GBP/CAD/AUD/JPY/CNY，但选项必须来自服务端白名单。汇率由用户手动填写，本期不拉取实时汇率。

### 3.5 价格预览和状态
- 显示商品数、markup、目标币种、汇率方向；价格预览 3–5 件商品，由 preview API 返回。
- preview 和 export 共用同一后端价格函数。
- 缺成本、汇率错误或商品不合格时禁止导出并显示原因。
- 导出按钮需 loading、防重复提交、失败提示和 requestId，导出前确认商品数/币种/markup/rate。
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

审计事件 `QUOTATION_EXCEL_EXPORTED` 记录 actorId、categoryId、selectedProductCount、currencyCode、markupPercent、exchangeRate、generatedAt、outputFileSize、requestId、outcome。禁止记录成本逐行明细、完整邮箱/电话、XLSX/Base64、图片 Buffer、storageKey、Cookie/session/token。本期不保存报价文件。

## 8. API 契约（按项目约定适配）

`GET /api/v1/admin/quotation-export/config`：返回服务端币种白名单、defaultMarkupPercent="15"、maxProducts=200、exchangeRateBase=CNY、rounding=CEIL_2。可复用 GlobalSetting/Dictionary，但服务端必须验证币种 code 合法且启用。

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

响应 HTTP 200，Content-Type `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，Content-Disposition 安全 filename* UTF-8，附 X-Request-Id。文件名如 `Quotation_USD_20261030_103000.xlsx`。清理用户标题以防 CRLF/header injection。Admin 认证 fetch Blob 下载并 revokeObjectURL。DTO 使用项目统一 validation；productIds UUID 数组去重、非空、限量；币种服务端白名单；decimal string 禁止科学计数法；不接受成本价、最终价、图片 URL、storageKey 等字段。

## 9. 后端模块边界

可新增 QuotationExportModule，但复用 Product、Category、Storage、RBAC、Audit。Controller 负责权限/DTO/响应；Service 查询商品、品类、成本、英文翻译、主图、箱规并聚合校验；Calculator 只做 Decimal；WorkbookBuilder 仅接收已验证的数据，不访问 DB；Storage adapter 根据 asset reference 读原始字节。批量读取避免 N+1。图片读取失败整单失败。若审计写入失败，不向用户交付生成文件，销毁 Buffer 并返回 5xx。

## 10. Admin 前端

组件建议：QuotationExportPage、CategoryTreeSelect、QuotationProductSelector、QuotationHeaderForm、QuotationPricingForm、QuotationPricePreview、QuotationExportActions，实际命名按项目约定。

```ts
type QuotationExportForm = {
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