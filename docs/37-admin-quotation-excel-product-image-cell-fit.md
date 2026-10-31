# Admin 报价单 Excel 商品图片单元格适配 — 可执行落地方案

> 项目：`NotFeel/b2b-inquiry-platform`  
> 目标分支：`main`  
> 文档类型：开发实施/修复规范  
> 范围：在“读取已启用 Excel 模板并填充数据”现有流程上，修复商品行图片嵌入、尺寸适配和定位；不重做报价业务流程。

## 1. 本次需求与输入文件核验

本方案以用户上传的 `Quotation_USD_20261031_011335.xlsx` 为当前页面导出样本。经实际解析：

- 工作表：`Quotation`，共 11 行、7 列（A–G）。
- 第 1–5 行为公司信息/报价标题，第 6 行为币种、汇率、加价率说明，第 7 行为表头。
- **第 8 行开始是商品行**。样本第 8、9 行为商品数据，第 10 行为空行，第 11 行是底部说明。
- B 列为商品图片列，当前模板 B 列宽约 13；第 8、9 行行高各 84pt。
- 当前工作簿有 3 张图片：两张商品图片分别锚定 B8、B9；另一张 Logo 使用跨单元格 `TwoCellAnchor`，起点为 B1、终点落在第 4 行区域。

因此图片处理必须基于 `itemStartRow = 8`，仅识别和替换商品数据区域的图片；**不得清除整个 Worksheet 的 images/drawings，不得修改第 1–6 行 Logo 锚点或尺寸**。第 7 行不是商品数据行。

## 2. 目标行为（验收定义）

1. 读取当前激活的 `product_quote` 模板二进制文件，保留原有工作表、样式、合并、页眉/页脚、打印设置、冻结窗格和第 1–6 行 Logo。
2. 商品数据从第 8 行写入；每件商品的原图对应唯一 SKU/productId，不允许按图片文件返回顺序猜测归属。
3. 每张商品原图嵌入 XLSX 的 drawing/media 中，Excel 中可离线查看。不得写 URL、`IMAGE()` 公式、WPS `DISPIMG()` 公式或外链图片。
4. 图片在 B 列对应商品行的单元格可用区域内等比缩放、居中显示；不拉伸、不裁切、不超出单元格、不遮挡相邻商品行。
5. 图片尺寸适配要尊重模板的 B 列宽度和对应行高。若模板行高/列宽变化，图片自动重新适配；不应固定写入 120×120 px 一类不随模板变化的尺寸。
6. 第 1–6 行的 Logo/品牌图片保持模板原样，不参与商品图清理、重锚定或尺寸适配。
7. 对应商品原图读取/解码/嵌入失败时整份导出失败，不允许输出缺图的“半成品”。

## 3. 首先定位当前实现，不盲目另写一套

编码前按仓库 `AGENTS.md` 执行，阅读：

- `docs/36-admin-quotation-excel-export-implementation.md`
- `docs/24-product-management-crud-and-image-storage.md`
- `.agents/skills/product-management/SKILL.md`
- `docs/18-role-permission-crud-and-menu-permissions.md`
- `docs/19-menu-management-crud-and-submenu-design.md`

定位现有 `QuotationExportModule/Service`、模板读取服务、ExcelJS workbook builder、Storage adapter、FileAsset/ProductImage 原图关系、模板 `sheetName/headerRow/itemStartRow/fieldMapping`、导出单元测试。复用既有模块和 API，不重复建立接口、存储表或模板管理功能。现有技术栈为 NestJS + TypeScript，模板操作优先复用项目锁定的 ExcelJS；若项目当前 ExcelJS 图片 anchor 行为与目标不兼容，可用 JSZip 直接修补 OOXML，见第 8 节。

## 4. 模板解析规则

模板信息必须来自服务端已登记的 QuoteTemplate 版本，不接受浏览器传递的文件路径、storageKey、URL 或工作簿内容。

读取模板后先做结构检查：

- sheetName 必须存在且等于登记值（当前样本为 `Quotation`）。
- `headerRow = 7`、`itemStartRow = 8`；字段映射必须包含 SKU、图片、英文品名、报价、装箱数、箱规尺寸和毛重。
- 图片列映射为 B 列（zero-based col=1）；商品行起始为 worksheet row 8（OOXML/ExcelJS 坐标统一转换时明确 1-based/0-based）。
- 数据区底部说明行/模板 footer 应从模板元数据或现有结构识别，不能简单 `deleteRows(8, ...)` 后把 Logo 或底部说明删掉。
- 模板中可能存在商品示例图。先根据锚点所在行识别 `row >= itemStartRow` 的商品区域，再清理旧商品图；不得删除 row < 7 的 Logo 或其它固定品牌图。对于 row 7 的图不作为商品图处理，需在模板结构校验时报告人工确认。

若当前模板没有商品样例行，填充器应从第 8 行创建商品行并复制模板定义的商品样式；若样例行存在，复制样例样式到新增行。商品行行高优先沿用样例行行高（当前导出样本 84pt）；禁止把 row 1–6 行高重置为商品行高度。

## 5. 图片处理策略：单元格内等比适配

### 5.1 原图来源

沿用当前 Product 主图原始 FileAsset/Storage adapter：

- 按数据库关系获取主图 original asset；不要从 `thumbnailUrl`、CDN URL、前台地址或请求参数读取。
- 通过服务端 Storage adapter 读取原始字节。禁止 `fetch(userSuppliedUrl)`，防止 SSRF。
- 校验文件 magic bytes 与真实格式，首期允许 JPEG、PNG；校验宽高、像素数、文件大小；拒绝损坏图片和主动内容 SVG。
- 同一导出按 productId/SKU 构建映射：`Map<productId, { buffer, extension, width, height }>`。不依赖数据库返回顺序、文件名或 storage key 命名。
- 可采用 `sharp`（须先检查项目依赖及部署环境）解析 EXIF orientation、读取真实宽高并输出规范化 JPEG/PNG Buffer。若不新增图像依赖，则使用已存在的安全图像元数据读取器；不能仅依赖文件扩展名。

### 5.2 单元格可用区域计算

定义模板图片列为 `imageColumnIndex = 1`（B 列），商品行 `r >= itemStartRow`。由工作表实际列宽、行高计算目标单元格区域，并保留内边距：

- Excel 列宽不是像素。应使用 ExcelJS 的列宽换算规则（近似 `px = floor(width * 7 + 5)`，同时考虑默认字体/ExcelJS 版本），不要把列宽数值直接当 px。
- 行高以 point 存储，换算 `px = points * 96 / 72`。
- 可用区域：`availableWidth = cellWidthPx - 2 * paddingPx`；`availableHeight = rowHeightPx - 2 * paddingPx`。
- 默认 `paddingPx = 4`，作为图片与边框之间留白；如果项目设计已有模板 imagePadding 配置，则优先用该配置。
- 图片原始尺寸为 `sourceWidth × sourceHeight`，等比缩放系数：
  `scale = min(availableWidth / sourceWidth, availableHeight / sourceHeight)`。
- 目标图片尺寸：`renderWidth = sourceWidth * scale`；`renderHeight = sourceHeight * scale`。
- 居中偏移：`offsetX = (cellWidthPx - renderWidth) / 2`；`offsetY = (cellHeightPx - renderHeight) / 2`。
- 如果目标可用宽或高小于合理最小值（例如 16px），视为模板结构不合理并拒绝导出，不要让图片越界。

注意：若图片包含 EXIF 旋转信息，必须先按 orientation 归一化后再算宽高；否则部分手机拍摄图片会错误旋转或 fit 结果颠倒。

### 5.3 Excel 图片锚点策略

推荐首选 ExcelJS 的 `worksheet.addImage` 加 `tl` + `ext`（像素尺寸）进行绝对尺寸锚定，并以目标单元格左上角为基础叠加居中偏移。每张图对应一行，计算完成后将坐标转换成 ExcelJS 图片 anchor 所需的浮点列/行偏移，注意 ExcelJS 坐标 0-based。

**不得直接把图片宽高设置成整个单元格宽高**，否则宽高比不同会产生拉伸；必须使用上述等比结果。

对于 ExcelJS 版本支持且在 Excel/WPS/LibreOffice 实测稳定的单元格内 anchor，可使用 `tl` + `br` 范围；但请确认 `br` 计算基于实际列宽/行高，不得把边界落到下一行。无论采用 `ext` 还是 `tl/br`，导出前都必须断言每个商品图的起点与终点均落在本商品行 B 列范围内。

示意代码（像素锚点转换函数应由项目实现并测试，以下不视为可直接复制的完整实现）：

```ts
const imageId = workbook.addImage({
  buffer: image.buffer,
  extension: image.extension, // jpeg | png
});
const fit = fitImageIntoCell({
  sourceWidth: image.width,
  sourceHeight: image.height,
  cellWidthPx,
  cellHeightPx,
  paddingPx: 4,
});
const origin = getCellPixelOrigin(worksheet, imageColumnIndex, excelRowIndex0);
worksheet.addImage(imageId, {
  tl: {
    col: imageColumnIndex + origin.columnOffset(fit.offsetX),
    row: excelRowIndex0 + origin.rowOffset(fit.offsetY),
  },
  ext: { width: fit.width, height: fit.height },
  editAs: 'oneCell',
});
```

不要在 `tl`/`br` 中混用 Excel 1-based 行号和 ExcelJS 0-based 行号。实现 `getCellPixelOrigin` 时，必须累计前序列宽/行高并处理隐藏列/隐藏行；商品图所在行/列不允许 hidden。

### 5.4 商品行行高与列宽

- 保留用户模板对 B 列宽、商品数据行高的样式设计；不能为适配图片强制扩大整列或覆盖模板全局样式。
- 默认图片以单元格已有尺寸为边界，缩放进格，不反向扩大行高/列宽。
- 如商品行来自模板示例行，复制该行 row height；如无示例行，使用模板配置的默认商品行高。当前导出样本 84pt 仅为样本观测值，不作为所有模板的硬编码。
- 同一模板可为不同商品行设置不同高度，图片须按所在行单独计算。
- 模板若存在合并单元格，商品图片列 B 对应商品行必须为未合并、独立可定位的单元格；否则拒绝启用模板并返回可读错误。

## 6. 保护第 1–6 行 Logo 与其它图片

这是本需求的高风险点，必须通过回归测试确保不误删：

1. 禁止执行 `worksheet.getImages().forEach(image => worksheet.removeImage(image.imageId))` 这类全删操作。
2. 通过 anchor 起点、终点判定图片是否完全属于商品数据区域。商品图候选必须满足：起始行 `>= itemStartRow - 1`（ExcelJS 0-based），列为图片字段列，且不跨出对应商品行范围。
3. 所有 row < 6 的图片都视为模板固定图片，原封不动保留，包括 Logo 跨行/跨列浮动图片。若固定图片锚点覆盖至第 6 行末端，仍不可误判成商品图。
4. 清理商品区域旧图前先把所有非商品图片读取为原始锚点和关系映射快照；处理后验证其数量、图片媒体哈希、anchor 坐标与处理前一致。
5. 对商品区域图片的清理，只删明确识别的商品图片；若模板图片锚点不能可靠分类，则不要猜测清理，改用模板不含商品图的正式模板，或由模板结构登记商品图片区范围。
6. 不得重写整个 drawing XML 导致 Logo 变形、丢失、层级错乱。若使用 JSZip，应保留未涉及的 DrawingML 节点与关系文件。

## 7. 模板样式及数据行处理

- 先备份并加载模板 workbook，严禁新建空 workbook 替换样式模板。
- 保留第 1–7 行的值/公式/样式/行高/列宽/合并和原图锚点；仅替换约定占位符和第 8 行起数据字段。
- 清除旧商品样例值时保留样式，不用 `spliceRows` 盲目删行；模板底部说明、打印区域、自动筛选、重复标题行要按新商品数更新。
- 第 8 行起商品列映射：A SKU、B 图片、C 英文品名、D Unit Price、E Packing Quantity (PCS / carton)、F Case Dimensions、G Gross Weight (KG)。
- 图片列 B 不写公式或 URL；商品数据行的 B 单元格可以保持空值，图片作为 drawing object 锚定在 B 列单元格区域。
- 价格仍按既有 Decimal 规则计算，模板布局变更不应碰价格公式；成本价不得进入 workbook、前台 DTO 或普通日志。
- 商品图片用 original asset；最终嵌入图片数应等于导出商品数，每个商品行恰有一张主图。

## 8. 技术实现备选与推荐

### 方案 A：ExcelJS anchor（首选）

若项目锁定的 ExcelJS 版本能够表达精确像素尺寸、支持透明/非透明背景的 JPEG/PNG，并能稳定读写模板已有浮动图片，则采用 `addImage({ tl, ext })`；只操作商品区域商品图。优势是实现简洁、与现有报价导出一致。

### 方案 B：ExcelJS + JSZip/OOXML 后处理（必要时采用）

如果 ExcelJS 重新序列化模板会改变既有 Logo anchor 或无法准确控制图片在单元格中的位置，则：

1. 仍用 ExcelJS 填入文字、单元格值与样式，并先生成临时 XLSX。
2. 使用 JSZip 读取原模板/生成文件包。
3. 仅更新目标商品图片对应的 `xl/drawings/drawing*.xml`、关系和 `xl/media/*`，通过 DrawingML `xdr:oneCellAnchor` 或 `xdr:twoCellAnchor` 设置 B 列商品行 anchor。
4. 图片 `a:blip r:embed` 指向新增 image relationship；新增媒体必须使用唯一文件名并写入 `[Content_Types].xml` 相应 MIME override/default。
5. 不能改动 Logo 所在 drawing 中未涉及的 XML 节点、rId 和媒体文件。生成后用 JSZip 重开，校验 rels、drawing、图片数量和 anchor 范围。

DrawingML 中像素转换为 EMU：`1 px = 9525 EMU`（96 DPI）；point 到 EMU：`1 pt = 12700 EMU`。Excel 单元格行列边界使用 marker（col/colOff/row/rowOff）；offset 使用 EMU。`oneCellAnchor` + ext 表示从指定单元格内偏移并按给定大小显示，`twoCellAnchor` 用起止 marker 表示区域。应优先采用 `oneCellAnchor`，避免跨商品行。

方案 B 的实现必须有 OOXML 结构测试，不允许用正则字符串粗暴替换 XML；使用 XML parser 或经过审查的结构化生成器，保留命名空间及其它元素。

## 9. 建议代码结构

按现有项目组织形式适配，不要求逐字照搬：

```text
apps/api/src/modules/quotation-export/
  quotation-export.service.ts           # 组装商品、价格、模板和原图
  excel/
    quotation-template-reader.ts        # 模板结构检查与占位符定位
    quotation-workbook-builder.ts       # 填充值、复制行样式、写入 footer
    quotation-image-fitter.ts           # 行列尺寸换算、等比缩放、居中偏移
    quotation-image-embedder.ts         # 商品图嵌入与 anchor
    quotation-drawing-preserver.ts      # 非商品图片快照与保护
    quotation-ooxml-patcher.ts          # 仅方案 B 使用
  __tests__/
    quotation-image-fitter.spec.ts
    quotation-image-embedder.spec.ts
    quotation-drawing-preserver.spec.ts
    quotation-workbook-builder.spec.ts
```

推荐纯函数：

```ts
type ImageFitInput = {
  sourceWidth: number;
  sourceHeight: number;
  cellWidthPx: number;
  cellHeightPx: number;
  paddingPx: number;
};
type ImageFitResult = {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  scale: number;
};
function fitImageIntoCell(input: ImageFitInput): ImageFitResult;
```

必须验证：输入尺寸为有限正数；padding 非负；可用宽高大于 0；输出有限正数；图片宽高比保持；四边均在单元格边界内（允许 0.5px 浮点容差）。

## 10. API / 前端变更边界

本需求属于现有导出文件生成器的输出修复，原则上不新增 Admin 页面/API/权限/数据库字段。沿用当前：选择模板、选择品类、勾选商品、填写报价信息、preview、export 的接口及 RBAC。

如需增加模板图片布局配置，只能在当前 QuoteTemplate 的结构化 layout/fieldMapping 配置机制中扩展并向后兼容；先确认 schema 与现有 JSON 约定，确需数据库 schema 变化才创建版本化 migration。不得另建 image-template 表。

前端不负责缩放或嵌入图片；浏览器只触发下载 Blob。所有图片读取与 workbook 构建发生在服务端。商品成本仍只在导出服务内部读取，普通商品列表不返回金额。

## 11. 测试清单

### 11.1 图片 fit 单元测试

- 正方形图片放入宽单元格：高度限制生效、水平居中。
- 横图放入窄/高单元格：宽度限制生效、垂直居中。
- 竖图放入宽/矮单元格：高度限制生效、水平居中。
- 100×100、4000×3000、3000×4000 等尺寸保持宽高比。
- 不同 B 列宽度、不同商品行高（例如 40pt/84pt/120pt）分别得到对应图片大小。
- 负尺寸、0 尺寸、NaN/Infinity、padding 超过单元格尺寸必须抛出结构化错误。
- 输出边缘 `x/y >= cell origin` 且 `x + width <= cell right`、`y + height <= cell bottom`。

### 11.2 Workbook 集成测试

- 使用用户导出的样本文件或正式模板进行回归：第 8、9 行两张图正确落在 B8、B9。
- 商品数量为 1、2、3、200 时，数据行与图像行一一对应，图片对象数量等于商品数。
- 输出 XLSX 解压后每张图片均有媒体文件、drawing relationship 可追溯到实际媒体。
- 第 1–6 行 Logo 原始媒体 SHA-256 与导出文件相同；其 anchor marker（起止列行与 offset）不变。
- 第 7 行表头不变，商品从第 8 行开始，footer 位于所有商品之后。
- 非商品图片的数量、锚点及 media hash 均不变。
- 所有图片无外链，B 单元格无 DISPIMG/IMAGE 公式。
- 任何一张图读取失败、格式非法或嵌入失败都返回统一业务错误，不返回 XLSX。

### 11.3 软件兼容人工验收

至少在 Microsoft Excel、LibreOffice Calc、WPS 各打开一份 1 件、2 件、较多商品的导出文件：

- 商品图都完整显示在 B 列对应格内，比例正确、没有裁切、重叠或漂移。
- 图片行高/列宽变化后仍留在单元格内；排序/筛选行时图片跟随对应商品行（若产品要求支持筛选，必须执行筛选后逐行检查）。
- Logo 外观、位置、大小与模板源文件一致。
- 横向打印/分页时商品图片不重叠；缩放/打印设置仍符合模板。

## 12. 性能与安全

- 并发加载原图数量建议限制为 4；采用总字节上限和导出超时。禁止一次性无上限 `Promise.all`。
- 图片原图读取、临时 Buffer 和 ZIP 构建全程有最大字节限制；响应关闭/异常时释放 Buffer。
- 图片文件格式按魔数识别；限制像素数及最大文件尺寸；禁止 SVG 和不受支持格式。
- 不接受用户传入 URL、绝对路径、storageKey、图片 Buffer、商品名称/SKU 或成本价作为事实来源。
- 日志仅记录 requestId、actorId、templateId、productCount、图片失败数量和错误码；不记录 Buffer、storageKey、客户联系方式和逐行成本。

## 13. 交付实施顺序

1. **复现**：在本地用用户上传样本与正式模板分别跑现有导出，保存原始/导出两份文件，记录商品图 anchor、Logo anchor、媒体 hash。
2. **代码定位**：检查当前 builder 图片增加/删除逻辑，重点搜索全量 removeImage、固定尺寸、错误的行列坐标转换、错误复用第 8 行 anchor 等。
3. **实现 fit util**：实现行列尺寸转换、单元格可用区域、等比缩放、居中计算并完成单测。
4. **实现商品图 embedder**：按 productId 与数据行映射，逐行图片嵌入；只管理商品区域图片。
5. **Logo 防护**：增加非商品图片快照和 hash/anchor 回归断言。
6. **集成模板 builder**：在保留第 1–7 行和 footer 的前提下填充商品行，图片适配使用实际模板尺寸。
7. **验证兼容性**：生成 1/2/200 件测试文件，ExcelJS 解析、OOXML 检查、人工打开 Excel/WPS/LibreOffice。
8. **完成定义**：相关 API 单测/集成测试通过，`pnpm lint`、`pnpm typecheck`、相关 package tests、API build 均通过；不能运行的项明确列为未验证，不得写成通过。

## 14. 回滚

本次优先只改导出构建逻辑和测试，不改数据库 schema。若生产导出异常：

1. 回滚本次导出 builder/图片适配提交到上一个已验证版本。
2. 保留模板管理、模板文件、商品图片与数据库数据不变。
3. 如需紧急关闭导出入口，隐藏菜单并撤销 `quotation.export.create` 权限，同时服务端禁用 export API；不能只隐藏按钮。
4. 不删除原图、不修改历史商品数据、不批量重写模板文件。

## 15. 验收签字项

- [x] 商品图片从原图字节嵌入，脱离网络可查看。
- [x] 第 8 行起每件商品图片一行一图，对应 SKU 正确。
- [x] 图片自动适配 B 列对应单元格，等比、居中、不裁切、不溢出。
- [x] 商品行高/图片列宽调整后可动态适配。
- [x] 第 1–6 行 Logo 的媒体内容、尺寸和 anchor 不变。
- [x] 第 7 行表头、footer、模板样式保留。
- [ ] Excel、WPS、LibreOffice 打开无修复提示，图片显示正常。
- [x] 原图缺失、损坏或超限时整份导出失败并有明确错误。
- [x] 价格、权限、审计与现有报价导出流程无回归。
- [x] lint、typecheck、tests、build 结果如实记录。

## 16. 实施记录（2026-10-30）

### 16.1 已实现文件

- `apps/api/src/modules/quotation-export/quotation-image-fitter.ts`
  - 按实际列宽、行高和 padding 计算可用区域；使用 96 DPI、`1 px = 9525 EMU`。
  - 等比缩放且允许小图放大，不裁切；水平、垂直居中；隐藏行列、合并图片格、非法尺寸和过小区域安全失败。
- `apps/api/src/modules/quotation-export/quotation-image-embedder.ts`
  - 只使用 `productId` 绑定商品与图片，不使用图片数组顺序或文件名。
  - 每张商品图固定写入对应商品行的图片列，采用 `oneCellAnchor` 和显式 EMU offset；写入后复核数量、行、尺寸和 `editAs`。
- `apps/api/src/modules/quotation-export/quotation-drawing-preserver.ts`
  - 在改行和样式前快照所有模板图片的媒体 SHA-256、关系与 anchor。
  - 只清理明确位于商品区域图片列且不跨行的旧商品占位图；Logo、表头图和无法可靠分类的跨区域图片分别按保留或安全失败处理。
  - 最终重新打开 XLSX 校验固定图片的媒体哈希和 anchor 未变化。
- `apps/api/src/modules/quotation-export/quotation-ooxml-package.ts`
  - 默认继续使用 ExcelJS 写入路径；生成后通过 JSZip/OOXML 校验 worksheet → drawing → relationship → media。
  - 只有媒体哈希仍匹配、且商品图仍是 `oneCellAnchor` 时，才允许修复商品图起点和 `ext` 尺寸。缺失媒体、外链、图片关系缺失、`IMAGE()`/`DISPIMG()` 公式或固定图片变化均拒绝发布。
- `apps/api/src/modules/quotation-export/quotation-template-workbook.ts`
  - 接入图片快照、旧商品图清理、逐商品图片嵌入和最终 OOXML 校验；任一图片或包结构失败统一转换为模板业务错误，不返回半成品。
  - footer 优先按币种占位符定位，其次按明确的 footer 文案定位；只把 footer 上方连续的商品样板区作为可调整数据行。

### 16.2 真实模板核验值

`assets/templates/B2B_Quotation_Template.xlsx` 的实际结构为：

- 工作表 `Quotation`，7 列；A/B/C 列宽分别为 18、20.5625、42。
- 第 1–6 行高 23pt，第 7 行高 34pt，第 8–10 行商品样板行高 84pt。
- 第 11 行为空分隔行，第 12 行为 footer 起始行，行高 22pt，包含 `[CURRENCY]`。
- Logo 是 `twoCellAnchor`，起点为 ExcelJS 0-based `col=1,row=1,colOff=368935,rowOff=43180`，终点为 `col=1,row=4,colOff=1426210,rowOff=95885`；媒体为 `xl/media/image1.jpeg`。

导出 1/2/3/200 件商品时，商品行从第 8 行开始，图片按每行实际行高分别计算；footer 始终位于所有商品行及其保留的空分隔行之后。

### 16.3 自动化验证

已执行并通过：

```bash
pnpm --filter @b2b/api exec vitest run src/modules/quotation-export
pnpm --filter @b2b/api exec tsc --noEmit --pretty false
pnpm --filter @b2b/api exec eslint src/modules/quotation-export
pnpm --filter @b2b/api build
pnpm test
pnpm typecheck
pnpm lint
ADMIN_API_PROXY_TARGET=http://localhost:3002 pnpm build
```

结果：quotation-export 共 10 个测试文件、101 个测试全部通过；仓库级 tests、typecheck、lint 和四个应用/包的构建通过。直接执行 `pnpm build` 时 admin 会按现有安全策略要求显式提供 `ADMIN_API_PROXY_TARGET` 或 `API_BASE_URL`，因此本次使用本地 API 地址作为构建时临时变量重跑。测试覆盖：

- 正方形、横图、竖图、小图放大、不同 B 列宽/行高、非法尺寸和隐藏/合并单元格。
- 乱序图片输入按 `productId` 绑定、不同媒体字节逐行对应、缺失/额外/重复图片拒绝。
- 真实模板 Logo 媒体和 anchor 保留、商品占位图局部清理、跨区域图片安全失败。
- ExcelJS 默认输出、OOXML 本地 relationship/media 校验、商品 anchor 有限修复、缺媒体拒绝、图片公式拒绝。
- 1、2、200 件商品；真实模板第 8/9 行图片、表头、footer、合并单元格、筛选和打印区域。

### 16.4 尚未验证与已知边界

- 尚未在本机使用 Microsoft Excel、WPS、LibreOffice Calc 逐个人工打开 1 件、2 件和较多商品文件；因此兼容性签字项保持未勾选。
- 不同操作系统/Office 客户端对默认字体、UI 缩放和小数像素可能有细微渲染差异；当前算法以模板列宽/行高和 96 DPI 为确定值，并提供 4px 内边距。
- 本次未新增数据库 schema、API、权限或迁移。原图读取、格式/大小校验和后台 RBAC 继续复用现有报价导出链路。

### 16.5 回滚

回滚本次 `quotation-template-workbook`、图片 fit/embed/preserve/OOXML 校验模块及对应测试即可；不涉及数据库迁移、模板文件改写、商品原图或历史导出数据，因此无需数据回滚。生产如需紧急止损，应同时由服务端禁用导出接口并撤销 `quotation.export.create` 权限，不能只隐藏菜单按钮。
