
# Admin 商品批量导入（Excel）— 可执行落地规范

> 项目：NotFeel/b2b-inquiry-platform  
> 目标分支：main  
> 状态：待实现规范，不代表功能已开发或测试通过。  
> 检查对象：用户上传的 凡士林.xlsx（工作表 Price List）。

## 0. AI 开发助手执行要求

1. 先阅读根目录 AGENTS.md 和相关技能：product-management、category-management、dictionary-management、tag-management、frontend-ui、backend-api、database-migration。再阅读 docs/14-open-decisions.md、docs/20-dictionary-management-two-level-model.md、docs/24-product-management-crud-and-image-storage.md，以及商品 API、页面、Zod DTO、权限、菜单 seed 和测试。
2. 复用现有 Product、ProductTranslation、ProductTag、Category、DictionaryItem、Tag、ProductImage。禁止创建平行商品表或重复状态/标签体系。
3. 实现完整流程：页面选择固定字段 → 上传 Excel → 服务端预检 → 展示错误 → 全部通过后确认 → 一个事务提交。
4. 任意一行有错误，整批零条入库；写入阶段任何步骤失败，整个数据库事务回滚。禁止跳过错误行导入其他行。
5. 每个 API 必须在服务端做权限验证。隐藏菜单和按钮不算权限控制。
6. 完成后真实运行 lint、typecheck、单测、集成测试和 build；未执行的命令必须标记为未执行，不能宣称通过。

## 1. 业务目标与确定规则

Admin 新增商品批量导入页面。操作员先选择整份 Excel 共用的固定字段，再上传 .xlsx。固定字段应用到每一行，Excel 保存每个产品独有的数据。

### 1.1 MVP 决策

- 仅支持新增，不支持覆盖更新；SKU 已存在或文件内重复则整批失败。
- 必填任务级字段：Category、Publish Status、Lifecycle Status；Default Tags 可多选。
- 行级必填字段：SKU、Product Name (English)。其余描述、尺寸、重量、箱规、包装、价格、图片均按模板契约可选。
- SKU 依现有 Product.sku 约束（schema 为 64 字符），trim 后校验，同文件和数据库唯一；不擅自转换大小写。
- 英文名称写入 ProductTranslation 的 en-US 翻译；中文字段填写时写入 zh-CN 翻译。
- 发布状态和生命周期是独立概念：
  - Publish Status：draft / published / unpublished，对应 PublishStatus。
  - Lifecycle Status：available / preorder / discontinued，对应 ProductLifecycleStatus。
- Category、Status、Lifecycle、Tags 必须从真实 API 选择并提交 ID/code；服务端重新确认存在、启用和可用。禁止自动创建分类、字典项或标签。
- 标签沿用 Tag / ProductTag，不得重复造标签关联表。标签不自动从 Excel 文字中猜测。
- 内部价格是可选字段。业务已确认原始 Price per Unit (CNY) 公式需要作为内部单价保存。只有具备 product.cost.update 权限的操作者可导入非空价格；无权限且价格列有值时整批失败。金额按 Decimal 处理，不使用浮点运算。价格列仅允许安全算术表达式子集（数字、括号、+ - * /），禁止函数、单元格引用、外部链接、名称引用和其他公式语法；例如 =4.7*1.15 计算为 5.405，=3.8*1.15 计算为 4.37。必须用专用 tokenizer/parser 计算，禁止使用 eval、Function 或启动 Excel/WPS 执行任意公式；结果以 Decimal 计算并按业务确认的货币精度策略校验。表达式不符合白名单或发生除零，整批失败。
- 价格只能留在内部 Product.priceCny。公开 DTO、SSR/SEO、页面源代码、缓存、公开 API、普通日志和错误报告不得泄漏价格。
- 图片导入应支持 WPS DISPIMG 单元格图片与标准 Excel 浮动图片。解析图片 ID/绘图锚点后提取实际媒体字节，并严格映射回对应商品行；不能可靠匹配的图片必须报错，不得按图片文件名或出现顺序猜测。图片须复用现有 FileAsset/产品图库服务，执行 MIME/魔数、大小、像素尺寸、恶意文件和用途校验。媒体存储不支持事务时，使用私有 staging + 失败清理/重试机制，数据库写入仍保持整批原子性。
- 目标发布状态为 published 时，必须复用现有发布准备检查（实际需要的封面图、翻译等以当前 service/policy 为准）；任何产品不满足，整批失败。
- slug 为空时调用现有 buildProductSlugCandidate / slug helper。检查同文件和数据库唯一性，数据库唯一约束仍是最终防线。
- 当前 Product schema 有 enum 状态与 DictionaryItem 外键并行的迁移兼容字段；必须依据现有 ProductsService / DictionaryService / migration 规则保持同步，不得只写其中一个。
- Lifecycle=preorder 不应被错误地当成首页策划标志。遵循 docs/14-open-decisions.md 中生命周期、营销标签与首页分区相互独立的规则。

### 1.2 原子性事务

XLSX 解析和字段校验在事务外完成。commit 阶段重新检查关键约束，之后在一个数据库事务中创建全部 Product、ProductTranslation、ProductTag 和必需的状态字典关联。任一写入失败即回滚。禁止逐行单独提交事务或在服务端循环调用 HTTP endpoint。

数据库事务无法自动撤销对象存储操作，因此 MVP 不建议在批量导入中直接上传图片；优先导入商品后通过现有图片管理器添加图片。若支持 Asset ID，只能关联已存在且经权限/用途/状态验证的文件。

## 2. 凡士林.xlsx 模板实际检查

工作表 Price List 有 8 列标题和 2 条非空产品数据。

| 原字段 | 样例 | 发现的问题 | 建议 |
|---|---|---|---|
| Product Code | WX-MYT-1、WX-MYT-2 | 可作为产品编码 | 映射到必填 SKU* |
| Product Image | =_xlfn.DISPIMG("ID_...",1) | 这是 WPS 单元格图片引用，不是 URL；普通 ExcelJS/openpyxl 单元格 API 不一定直接读取图像，但本工作簿内部有 xl/cellimages.xml、xl/_rels/cellimages.xml.rels 和 xl/media/image1.jpeg、image2.jpeg | 通过 DISPIMG ID → cellimages.xml → relationship → media 文件提取图片，并按公式所在行关联 SKU；禁止把 ID 当 URL |
| Product Name | Rose、Strawberry | 可作英文名称 | 映射到 Product Name (English)* |
| Price per Unit (CNY)，D 列 | 空 | 与 E 列重复表头 | 合并为唯一内部价格列 |
| Price per Unit (CNY)，E 列 | =4.7*1.15、=3.8*1.15 | 公式不可直接信任缓存结果；通用公式执行不安全 | 业务已确认是需要保存的内部单价；只允许安全算术白名单解析，得到 5.405、4.37，再按 Decimal 与货币精度规则校验 |
| Packing Quantity (PCS) | 168、144 | 业务含义需确认 | 暂映射为 Carton Quantity (pcs)，导入前确认其确为每箱数量 |
| Case Dimensions (L×W×H cm) | 42*28*51、60*30*35 | 三个值混在一个文本列，难以逐字段校验 | 拆为 Carton Length、Carton Width、Carton Height 三列 |
| Gross Weight (KG) | 20、21 | 可用于箱规毛重 | 映射到 Carton Gross Weight (kg) |

原表缺失或不明确：英文描述、可选中文名称/描述、slug、单件长宽高、单件重量、包装类型、拆分的箱规尺寸、可选排序字段、标准图片资源标识，以及任务级 Category/发布状态/生命周期/标签选择。任务级字段应该在页面选择，不重复放进 Excel，避免同一属性出现两个数据来源。

### 2.1 已确认业务规则与剩余配置

1. Packing Quantity (PCS) 确实表示每箱数量，映射到 Carton Quantity (pcs)。
2. E 列价格公式是需要保存的内部单价；安全计算 =4.7*1.15 得 5.405，=3.8*1.15 得 4.37。禁止执行任意 Excel 公式，只解析白名单算术表达式。
3. 每次导入的品类、发布状态、生命周期和默认标签由 Admin 页面统一选择。
4. 原始 WPS DISPIMG 图片必须从工作簿 XML 资源中提取，并通过单元格所在行映射到 SKU；图片提取或映射失败则整批失败。

## 3. 优化 Excel 模板契约

配套文件：B2B产品批量导入模板_优化版.xlsx。

包含三个工作表：
- Products：不可更改的英文表头，一行一个商品。
- Read Me：任务级字段、单位、安全与原子性说明。
- Original Field Mapping：原模板映射及问题记录。

### 3.1 行级字段定义

| 列 | 表头 | 必填 | 规则/数据库映射 |
|---|---|---:|---|
| A | SKU* | 是 | 文本、最长 64、文件内及数据库唯一 → Product.sku |
| B | Slug (optional) | 否 | 空时调用现有 slug helper；文件内/数据库唯一 → Product.slug |
| C | Product Name (English)* | 是 | trim 后非空，最长以现有 DTO/schema 为准 → ProductTranslation(en-US).name |
| D | Product Description (English) | 否 | 纯文本；拒绝公式/危险 HTML → 英文翻译 description |
| E | Product Name (Chinese) | 否 | 填写时非空 → ProductTranslation(zh-CN).name |
| F | Product Description (Chinese) | 否 | 纯文本 → 中文翻译 description |
| G | Unit Length (cm) | 否 | 非负数，转为整数 mm → Product.lengthMm |
| H | Unit Width (cm) | 否 | 同上 → Product.widthMm |
| I | Unit Height (cm) | 否 | 同上 → Product.heightMm |
| J | Unit Weight (g) | 否 | 非负整数 → Product.weightGrams |
| K | Packaging Type | 否 | 只接受现有启用包装字典 code；当前 Product.packaging 是字符串，必须检查现有表单/服务映射，不能凭空解释 code |
| L | Carton Length (cm) | 否 | 非负数 → Product.cartonLengthCm |
| M | Carton Width (cm) | 否 | 非负数 → Product.cartonWidthCm |
| N | Carton Height (cm) | 否 | 非负数 → Product.cartonHeightCm |
| O | Carton Gross Weight (kg) | 否 | 非负 Decimal → Product.cartonWeightKg |
| P | Carton Quantity (pcs) | 推荐 | 正整数；空值 null → Product.cartonQuantity |
| Q | Unit Price (CNY) [internal] | 否 | 纯数值、禁止公式、需要 product.cost.update → Product.priceCny |
| R | Image URL(s) or Asset ID(s) | 否 | 第一版优先可信 FileAsset UUID；如果当前服务不支持安全关联，非空时报错并引导走图库 |
| S | Sort Order | 否 | 非负整数，默认 0 → Product.sortOrder |

单位约定：单品尺寸 cm 转 mm，乘以 10；不能无损转换成整数 mm 的输入必须报错。单件重量为整数 g。箱规重量用 Decimal。空值与 0 必须区分，不得用 value || default 消除合法的零值。

### 3.2 图片提取与关联规则（必须实现）

本项目需要支持两类 XLSX 图片：

1. **WPS 单元格内嵌图片**：单元格内容形如 =DISPIMG("ID_...",1)。读取 worksheet XML 得到 cellRef → DISPIMG ID；读取 xl/cellimages.xml 得到 ID → relationship ID；读取 xl/_rels/cellimages.xml.rels 得到 relationship ID → media target；从 ZIP 中提取实际媒体字节。不要只依赖 ExcelJS 的 cell.value 或 worksheet.getImages()，因为 WPS cellImages 不是标准 drawing 图片。
2. **标准浮动图片**：读取 xl/drawings/drawing*.xml 和对应 .rels，解析 anchor 的起始行/列与媒体目标。图片必须能唯一映射到配置的图片列/商品行；无法唯一映射就返回明确错误。

对当前 凡士林.xlsx 的结构检查已确认存在 xl/cellimages.xml、xl/_rels/cellimages.xml.rels、xl/media/image1.jpeg、xl/media/image2.jpeg；B2、B3 分别引用 DISPIMG ID。实现时应以运行时解析结果为准，不把图片 ID 或文件名硬编码进代码。

图片处理顺序：提取 → 校验文件签名/MIME/尺寸/像素数 → 可选恶意文件扫描 → 私有 staging → 业务媒体服务登记 FileAsset → 事务内关联 ProductImage → 成功后确认 staging，失败时排队清理。必须限制图片总数、单图大小、总解压大小、像素数，防止 ZIP bomb 和超大图片攻击。拒绝 SVG 或其他活动内容，除非现有安全图片服务明确允许并净化。

如果源工作簿的图片行与商品数据行能按同一行唯一匹配，可自动关联；如果存在图片覆盖多行、多个候选图片、缺失商品行或重复关联，不得按图片顺序猜测，整批预检失败并列出 Excel 行号。
### 3.3 Excel 安全限制

- 仅支持 .xlsx；建议初始上限 10 MB、1,000 条非空数据行，限制应集中为可配置项并经压测确认。
- 校验真实工作簿结构，不仅信任扩展名或浏览器 MIME。
- 只读取 Products sheet；表头依模板版本严格匹配。缺列、重复表头、未允许的多余列必须报错。
- 明确检测 ExcelJS 公式/sharedFormula 类型：默认所有公式单元格拒绝；仅 Unit Price (CNY) [internal] 允许专用安全算术解析器处理白名单表达式。禁止信任缓存结果，禁止执行任意公式。
- 拒绝宏、加密工作簿、外部链接、合并单元格、异常 XML；限制解析耗时、内存与临时文件空间。
- 过滤全空行；只有标题、没有数据行时拒绝；错误必须保留真实 Excel 行号。
- 类型、长度、控制字符、数值范围和精度均在服务端验证。价格、描述等敏感值不能写入普通日志或错误报表。
- 解析结束后按策略清理临时文件。

## 4. Admin UI/UX 设计

### 4.1 路由和导航

建议路由：/[locale]/(admin)/products/bulk-import，实际访问 URL 为 /zh-CN/products/bulk-import 和 /en-US/products/bulk-import。位于现有 Catalog/Products 菜单附近，使用唯一 Admin Shell。复用项目已有 PageHeader、Card、Field、Button、Select、Toast、DataTable、CategoryPicker 和设计 Token。

所有后台文案必须通过 zh-CN 与 en-US 翻译资源，禁止散落硬编码文本。

### 4.2 桌面结构线框

    Breadcrumb: Catalog / Products / Bulk Import
    Title: Bulk Import Products
    Subtitle: Validate the complete workbook before creating any products.

    [1. Import Settings]
      Category*         [Searchable category tree]
      Publish Status*   [Draft / Published / Unpublished]
      Lifecycle*        [Available / Pre-order / Discontinued]
      Default Tags      [Multi-select existing enabled tags]
      Internal Price    [Permission-dependent notice]

    [2. Excel File]
      [Download template] [Drop .xlsx here / Browse]
      Selected file name / size / Replace / Remove

    [3. Validation]
      [Validate file]
      Total rows | Valid rows | Invalid rows | Warnings
      Row | SKU | Field | Error code | How to fix
      [Download full error report]

    [Cancel]                                    [Import N products]

### 4.3 UI 交互规则

- CategoryPicker 使用真实分类树，提交 categoryId UUID，不提交 label；必须有加载、错误、重试和空状态。
- Publish Status、Lifecycle 从当前字典/contracts 数据加载；展示本地化 label，提交稳定 code。
- Tags 从现有 tags API 加载，以 tagIds 多选，仅允许启用标签。
- 只有具备 product.cost.update 的用户可看到价格权限说明；服务端仍必须校验权限，不得只依赖隐藏字段。
- 文件更换或 Category/Status/Lifecycle/Tags 发生改变时，已有验证结果失效，必须重新校验。
- 验证中按钮有真实 loading；预检未通过或未完成时，Commit 按钮禁用。
- 错误列表默认显示前 50 条，展示总数、行号、字段和修复提示；提供完整错误报告下载。
- 错误报告仅含必要诊断信息，不含原始价格、session/token、内部存储 key 或完整单元格秘密。
- 导入前二次确认，明确只新建不覆盖，并显示将要应用的共同字段与产品数量。
- 成功状态显示实际创建数、完成时间和 batchId（若实现持久批次）；失败不能显示虚假成功。
- 适配 1440、1280、1024、768、390、360px；手机错误表应在容器内滚动或变为卡片，避免全页横向溢出。
- 按钮必须可访问、可键盘操作，并提供 loading/disabled/error 状态。

### 4.4 状态机与验证 token

状态机：EMPTY → FILE_SELECTED → VALIDATING → VALIDATION_FAILED 或 VALIDATION_PASSED → IMPORTING → IMPORT_SUCCEEDED 或 IMPORT_FAILED。

服务端创建短期、一次性 validationId，绑定当前用户、文件 SHA-256、模板版本、Category/Status/Lifecycle/Tags 和规范化结果摘要；建议 10 分钟过期。仅全量校验通过才生成可 commit 的 token。提交前核对 token 归属、时效和配置摘要。生产多实例不得只靠内存 Map；应使用数据库/可靠共享存储。任何配置变更须重新预检。

## 5. API 契约

遵循现有 NestJS API、Zod validation、统一响应和错误码约定；endpoint 可按项目命名规则微调，但职责不能改变。

### 5.1 模板

GET /admin/products/bulk-import/template
- 返回当前版本 XLSX、正确 MIME 和 Content-Disposition。
- 模板版本纳入预检；旧表头或缺列应明确报错。

### 5.2 选项

复用现有分类树、字典和标签接口，不新建重复选项 API。所有 ID/code 在服务端再次确认存在、启用及操作者权限。

### 5.3 预检

POST /admin/products/bulk-import/validate，multipart/form-data 包含 file、categoryId、publishStatus、lifecycleStatus、tagIds 和 templateVersion。

成功响应建议：

    {
      "data": {
        "validationId": "opaque-single-use-token",
        "templateVersion": "1",
        "summary": {
          "totalRows": 2,
          "validRows": 2,
          "invalidRows": 0,
          "warningCount": 0
        },
        "errors": [],
        "warnings": []
      }
    }

预检只校验，不写产品。任意错误时不得生成可 commit 的 token。错误对象至少含 rowNumber、sku（如可读）、field、code、messageKey、severity，不返回价格原值。错误多时应分页并提供完整报告下载。

### 5.4 提交

POST /admin/products/bulk-import/commit，请求只包含 validationId，不接受前端任意产品 JSON 数组。

- 权限：product.import + product.create；目标发布状态为 published 时再需 product.publish；含非空价格时再需 product.cost.update。
- 重新检查用户、token、过期时间、一次性消费、文件摘要和固定字段配置。
- Commit 前再次验证 SKU/slug 唯一、Category、Status、Lifecycle、Tags 与发布 readiness。
- 一个数据库事务写入所有产品、翻译、标签和需要同步的状态外键；任何失败全回滚。
- 重复提交不得重复插入；返回第一次结果或 409 IMPORT_ALREADY_CONSUMED。
- 返回 batchId（若有）、createdCount、completedAt。

### 5.5 错误报告

建议 GET /admin/products/bulk-import/validation/:validationId/errors.csv。必须验证操作者归属/权限和报告过期时间。CSV 做正确转义并防公式注入。只导出行号、SKU（按权限策略）、字段、错误码、修复提示等必要内容。

### 5.6 错误码建议

IMPORT_FILE_REQUIRED、IMPORT_FILE_TYPE_INVALID、IMPORT_FILE_TOO_LARGE、IMPORT_ROW_LIMIT_EXCEEDED、IMPORT_WORKSHEET_MISSING、IMPORT_HEADER_INVALID、IMPORT_DUPLICATE_HEADER、IMPORT_FORMULA_NOT_ALLOWED、IMPORT_NO_DATA_ROWS、IMPORT_REQUIRED_FIELD_MISSING、IMPORT_FIELD_INVALID、IMPORT_DUPLICATE_SKU_IN_FILE、IMPORT_SKU_ALREADY_EXISTS、IMPORT_SLUG_DUPLICATE、IMPORT_CATEGORY_INVALID、IMPORT_STATUS_INVALID、IMPORT_LIFECYCLE_INVALID、IMPORT_TAG_INVALID、IMPORT_PRICE_PERMISSION_DENIED、IMPORT_PUBLISH_READINESS_FAILED、IMPORT_VALIDATION_EXPIRED、IMPORT_VALIDATION_CONFIG_MISMATCH、IMPORT_ALREADY_CONSUMED、IMPORT_ATOMIC_COMMIT_FAILED。

所有错误码应加入项目统一 ERROR_CODES 与 Admin 中英文翻译，不应散落硬编码提示。

## 6. 服务端处理流程

### 6.1 解析与安全

- 使用 lockfile 当前的 ExcelJS 版本，不随意升级。
- 校验文件大小、真实工作簿结构、SHA-256；上传文件存放于受限临时路径或私有对象并设置处理超时。
- 只解析 Products 工作表，严格匹配模板版本的表头；拒绝缺列、重复列和未知列。
- 显式检测 formula/sharedFormula：除内部价格列的白名单算术表达式外，公式均拒绝；不信任缓存值，不执行任意公式。
- 禁止把 DISPIMG 当 URL 或信任公式缓存。允许按 WPS OOXML 结构解析 xl/cellimages.xml 与对应 .rels，仅提取其引用的嵌入媒体文件；拒绝宏、外部链接及其他活动内容。
- 只统计非空产品行，保留真实 Excel 行号；空表或只有标题拒绝。
- 限制字段长度、解析耗时、内存、行数和临时存储量；扩展名/MIME 不能作为唯一判断。

### 6.2 业务校验

1. 校验身份、权限、限额、文件结构。
2. 校验固定字段是否齐全。
3. 查询分类存在/启用；验证 status/lifecycle 字典 code 和类型；查询标签存在/启用。
4. 对所有行验证 SKU、名称、描述、规格、包装、价格与图片字段。
5. 检查同文件 SKU/slug 重复和数据库已有值。
6. 检查价格权限。
7. 检查目标 published 的现有产品发布准备规则。
8. 聚合所有可定位错误；errorCount > 0 即不允许 commit。
9. 全部通过才生成一次性验证 token。
10. commit 时再次验证关键约束后，用单个事务插入全部相关记录。
11. 成功/失败都写脱敏审计并清理临时文件。

### 6.3 字段转换要点

- 所有文本 trim；SKU 不做大小写变换。
- slug 走现有 helper，同批维护 Set，候选生成重试必须设上限。
- 状态字段复用 ProductsService/DictionaryService 规则，并保持 enum 与 dictionary FK 同步。
- Category 只提交 UUID；Tags 使用 tagIds。不得根据 label 或用户输入的名字模糊映射 ID。
- 规格转换要无损；箱规重量和价格使用 Decimal 字符串路径，禁止浮点换算。
- Product.packaging 是字符串。只有确认与包装字典值兼容后才映射；不兼容则明确拒绝或按经过确认的映射转换。
- 图片导入必须按行映射：WPS DISPIMG 以公式所在单元格行作为商品行；标准浮动图片使用 drawing anchor 的起始行/列，并要求图片锚点落在配置的图片列或可确认的商品行。若图片覆盖多行、重复映射、图片列缺失或映射不唯一，报错而非按顺序猜图。提取后校验图片魔数/MIME/大小/像素尺寸，使用现有媒体服务创建 FileAsset，再通过现有产品图片服务关联 ProductImage。由于对象存储不可由 DB 事务自动回滚，先上传私有 staging，DB 事务失败时排入可重试清理任务；成功后再完成正式关联。

### 6.4 并发和幂等

- Product.sku 和 Product.slug 已有数据库唯一约束；它们是最终并发保护。
- 预检到提交之间可能有其他管理员创建同 SKU；commit 唯一冲突时整个事务回滚。
- validationId 的消费必须跨 API 多实例原子化，不能只用进程内存。
- 如需导入历史，先检查当前任务/审计模式；确有需要才增加 ProductImportBatch / 行错误模型，并提交 migration、索引、保留策略。不要为了实现预检而无理由新建数据库表。

## 7. 权限、菜单、审计与目录建议

### 7.1 权限

在现有 Permission + RolePermission 中新增 product.import：
- 下载模板、预检、读错误报告要求 product.import。
- commit 还要求 product.create。
- 目标状态为 published 时要求 product.publish。
- 导入非空内部价格还要求 product.cost.update。
- super_admin 权限通过现有 seed 的 all 机制继承；catalog_manager 是否拥有导入权限须在 seed 中显式决定。
- 使用当前 RequirePermissions/授权约定逐接口实施。

### 7.2 菜单

在 database/prisma/menu-seed.ts 的 Catalog/商品目录分组，Products 附近新增：
- code：products.bulk-import
- route：/products/bulk-import
- labels：zh-CN=批量导入，en-US=Bulk Import
- permissionCode：product.import
- sortOrder：与现有 Catalog 子菜单顺序一致，避免冲突。
确保 seed 幂等并通过现有菜单翻译检查。

### 7.3 审计

记录操作者 ID、requestId、batchId（如有）、文件 SHA-256、模板版本、行数、成功/失败、错误码汇总、耗时和固定字段 ID/code。禁止记载 Excel 正文、内部价格值、token/session、文件存储密钥或敏感单元格值。

## 8. 建议代码职责

先检查是否有同类实现，再按现有项目结构放置：

Admin:
- apps/admin/src/app/[locale]/(admin)/products/bulk-import/page.tsx
- apps/admin/src/components/product-bulk-import-form.tsx
- apps/admin/src/lib/product-bulk-import-api.ts
- 相应 i18n 资源，覆盖 zh-CN/en-US

API:
- apps/api/src/modules/products/product-bulk-import.controller.ts（或扩展现有 ProductsController）
- apps/api/src/modules/products/product-bulk-import.service.ts
- 相应单元/集成测试
- packages/validation 中 Zod DTO/schema
- packages/contracts 中响应类型、错误码和权限常量

数据库仅在确需持久化 validation token / 导入历史时修改 database/prisma/schema.prisma，并带版本化迁移；若无 schema 变化，不创建无意义迁移。

## 9. 测试与验收

### 9.1 单元测试

覆盖：缺文件、错误扩展名/伪装文件、超大小、缺 worksheet、空文件、只有标题、错误/重复/未知表头、公式单元格、宏/外链/合并单元格；SKU 空/超长/重复/已存在；英文名缺失；尺寸、重量、Decimal、精度/范围错误；0 与空值；DISPIMG；不合法 Asset ID；公式价格；价格权限；slug 碰撞；分类/状态/标签不存在或禁用；published readiness 失败。

### 9.2 原子事务集成测试（必需）

1. 两行有效：创建两产品、翻译、标签关联正常。
2. 第 2 行无效：数据库产品新增数为 0，且不存在孤立翻译/标签关系。
3. 第二行发生 SKU/slug 冲突：事务整体回滚，新增数为 0。
4. 产品写入后翻译/标签关联失败：整批回滚。
5. 同一 validationId 提交两次：不重复创建。
6. 校验后分类/标签/权限发生变化：提交时重新检查并失败。
7. 失败的 validationId 被直接提交：服务端拒绝且数据库不变。
8. 用户无价格权限却有价格数据：整批失败。
9. 无 product.import/create/publish 权限调用端点：401/403，无数据变化。
10. 写入成功和失败都有脱敏审计。
11. 公开商品 API、SSR、SEO、缓存不包含 priceCny/price_cny 或原始价格值。

### 9.3 UI/E2E

视口 1440、1280、1024、768、390、360px；选项加载/失败重试；更换文件后验证状态失效；错误时 commit 禁用；报告可下载；成功提示数正确；双击不能重复提交；中英文文案、键盘操作和焦点可访问性通过。

### 9.4 实际运行的质量门禁

至少运行：

    pnpm run db:generate
    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build

同时运行新功能定向测试、数据库集成测试及必要的 E2E。数据库或 CI 环境不可用时注明未执行原因和风险，不能声称通过。

## 10. 部署和回滚

- 只新增 UI/API 与 seed 且不增数据库模型时，可能不需要 Prisma migration；仍需确认 seed、API、UI 发布顺序。
- 若新增导入批次/验证 token 模型，则必须修改 schema、提交 migration、测试迁移并定义回滚方案。
- 发布建议：兼容迁移（若需要）→ API → Admin → seed 权限/菜单 → smoke test。
- 回滚时不要自动删除批量导入后已被编辑或引用的真实产品；如需补偿，按 batch/audit 记录由业务确认后操作。
- 临时文件、验证 token 和报告需有保留期限，清理失败应可重试并留审计。

## 11. 分期任务

P0 代码核查：
- [ ] 阅读技能、商品创建/编辑/发布/图片业务逻辑与测试。
- [ ] 检查 contracts、Zod schema、错误码、权限、菜单 seed 和翻译。
- [ ] 锁定模板版本与字段契约。
- [ ] 确认箱装数量与价格公式语义。

P1 后端：
- [ ] XLSX 模板下载/版本校验。
- [ ] 解析标准 Excel 图片与 WPS DISPIMG 图片；价格列安全算术解析；其他公式拒绝；实施文件/行数限制。
- [ ] 全量预检与错误报告。
- [ ] 类别/状态/标签/价格权限/发布 readiness 校验。
- [ ] 短时单次 validationId。
- [ ] 一个事务原子写入、并发冲突全回滚。
- [ ] 审计和临时文件清理。

P2 管理后台：
- [ ] 新增菜单、权限、双语翻译。
- [ ] 固定字段选择、模板下载、拖放上传、验证摘要、错误表和报告下载。
- [ ] Loading/error/empty/disabled、二次确认、防重复提交。
- [ ] 响应式和可访问性。

P3 回归：
- [ ] 权限/seed/审计检查。
- [ ] 价格防泄漏检查。
- [ ] 单元、集成、E2E。
- [ ] 实际运行 lint/typecheck/test/build 并记录结果。

## 12. Definition of Done

- 模板可下载，版本及表头严格校验。
- 固定字段来自真实 API 并由服务端重新校验。
- 任意行错误都使数据库新增数为 0。
- 复用现有商品模型和业务规则。
- SKU/slug 唯一、发布 readiness、价格权限有效。
- 不执行任意公式；内部价格仅通过安全算术白名单解析；正确提取 WPS DISPIMG/标准浮动图片并按商品行关联，绝不把 DISPIMG ID 当图片 URL。
- Menu/Permission/Seed/中英文翻译一致，逐 endpoint 授权。
- UI 在 360px、平板和桌面正常。
- 成败均有脱敏审计，日志不泄漏价格/秘密。
- 实际测试和质量门禁结果有记录。
- 既有商品创建、编辑、发布、图库、公开商品目录和报价导出回归通过。

## 13. 给 VS Code AI 的执行提示词

请按本文件直接实施，不要只输出建议。先遵守 AGENTS.md 与相关技能，检查现有商品模型、服务、图片、状态、标签、权限和菜单机制。复用已有逻辑，不新建平行商品表。实现固定字段选择、版本化 Excel 模板、服务端预检、错误报告与原子提交。任何字段/行/权限/发布校验失败都不能导入；commit 只能消费服务端生成的可信一次性 validationId，且所有写入必须在一个数据库事务中。已存在或重复 SKU 不允许覆盖。拒绝任意公式；内部价格列只允许专用 Decimal 算术白名单解析。支持标准浮动图片和 WPS DISPIMG，从 OOXML 图片资源映射提取图片并确定性关联商品行，复用现有 FileAsset/产品图片服务，处理 staging 与失败清理。内部价格必须受 product.cost.update 保护并确保公开不泄漏。补齐菜单、权限、zh-CN/en-US、审计、测试。最后运行真实 lint/typecheck/test/build 并汇报文件、迁移、测试结果、未执行项和风险。

## 14. 明确假设

1. 首版只新增；SKU 冲突整批失败。
2. Category/Publish Status/Lifecycle/Default Tags 是任务级字段，适用于全部行。
3. 图片支持 WPS DISPIMG 与标准浮动图片；如果无法确定图片对应商品行，整批失败。发布规则要求封面时，缺图产品不能发布。
4. 内部价格可导入；价格列公式仅允许安全算术白名单解析，且操作者必须有 product.cost.update 权限。
5. 10 MB、1,000 行为初始建议值，需基于部署环境压测调整。
6. Packing Quantity (PCS) 已确认映射为 Carton Quantity (pcs)。
