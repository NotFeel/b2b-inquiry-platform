# 客户报价计算与订单管理中心 — 第一阶段可执行落地规范

> 文档编号：DOC-39 / B2B-QUOTE-ORDER-CORE-01  
> 目标分支：`main`  
> 状态：开发实施基线（不是功能已完成声明）  
> 本期范围：报价计算页面、商品级核算、订单级费用、海运分摊、人民币/外币计算、报价草稿、订单创建、订单快照、字典、RBAC、测试和部署。  
> 明确不在本期：Excel/PDF 模板设计与填充、PI 页面/文件生成、物流商 API、Shipment 轨迹同步。数据库关系需为后续阶段预留。

---

## 0. 开发前强制审查结论

本文件基于当前 `main` 分支可读取的 `README.md`、`AGENTS.md`、`database/prisma/schema.prisma`、`docs/04-data-model.md`、`docs/05-api-contract.md`、`docs/18`、`docs/19`、`docs/20`、`docs/36-admin-quotation-excel-export-implementation.md` 进行设计。实现前仍须检查对应应用源码、迁移、seed、API、前端路由和实际测试命令。

### 0.1 当前已存在且必须复用的模型

| 现有模型 | 当前字段/关系 | 本功能处理 |
|---|---|---|
| `Product` | `sku`、`priceCny Decimal(18,4)?`、`cartonLengthCm/WidthCm/HeightCm`、`cartonWeightKg Decimal(12,3)?`、`cartonQuantity Int?`、生命周期/发布状态 | 复用成本和箱规来源；确认 `priceCny` 当前语义确为采购成本，不可凭字段名推断；若不是成本，先明确并做兼容迁移 |
| `ProductTranslation` | 商品多语言 | 报价商品名称取指定 locale 快照，默认 en-US |
| `DictionaryType/DictionaryItem/DictionaryItemTranslation` | 两层字典、item code、value、翻译、启停、锁定 | 复用，新增币种与体积重系数类型，不建第二套字典表 |
| `Customer` | `phoneE164 String @unique`、countryCode、displayName、note | 复用客户主档；现有模型没有 email、账单/收货地址，需 additive 扩展 |
| `PiDocument/PiItem` | 已有 PI 独立模型及商品快照，但没有 orderId | 本期不实现 PI；预留后续 `orderId` 关联，避免重建 PI 表 |
| `AuditLog` | actor/action/entity/requestId/metadata | 复用审计 |
| `Menu/MenuTranslation` | 菜单树和双语翻译 | 复用 |
| `Permission/RolePermission` | 权限事实来源 | 复用，不创建额外授权表 |
| `OutboxEvent` | 已有持久化 outbox | 需要异步文件导出时后续复用；本期核心计算和订单保存同步完成 |

当前 schema **没有** `Quotation`、`QuotationItem`、`Order`、`OrderItem`、`OrderFee`、`Shipment`、`ShipmentItem`、`TrackingEvent` 模型。不得假设这些表已经存在。当前 `PiDocument` 也没有订单外键。

### 0.2 先解决的字段语义问题

1. 盘点 `Product.priceCny` 在所有代码、表单、导入和现有报价导出中的读写语义。如果它是采购成本，代码与文档统一命名为“内部采购成本（CNY）”；如果它是其他价格，不能直接复用，需新增明确的 `costCny` 字段并制定回填/兼容计划。
2. 现有 Product 箱规长宽高为 Decimal(12,3) 厘米、单箱毛重 Decimal、每箱数量；箱规尺寸和毛重可按本次交易覆盖并保存快照，但每箱数量只读 Product 主档，由服务端用于计算商品总数，不能在报价中覆盖。
3. 当前 Customer 的 `phoneE164` 是必填唯一字段。正式客户资料允许电话可选的业务需求与当前模型冲突。实现前选择：正式订单要求电话必填（本文件默认）；或改成 nullable 并设计重复客户识别/合并规则。不得用空字符串或虚构号码填充。
4. Customer 现有 `displayName` 可作为客户名称，但 email、账单地址、收货地址应 additive 增加；历史订单必须保存客户快照，不能依赖客户主档当前值。
5. 现有 `PiDocument` 和 `PiItem` 保留；后续为 `PiDocument` 增加 `orderId`，而不是本期重建 PI。

### 0.3 本次代码审计结论（2026-11-02）

- `Product.priceCny` 的实际语义确认为**内部采购成本（CNY）**：商品表单字段由 `product.cost.update` 保护，批量导入映射为内部成本，商品详情仅由 `product.cost.read` 控制返回；现有动态报价 Excel 服务将其映射到 `costCny` 并用 Decimal 参与涨幅计算。
- 本次不新增 `Product.costCny`，避免双字段及历史值回填风险；后台中英文标签统一显示“内部采购成本（CNY）/Internal purchase cost (CNY)”。公共商品 DTO 继续不含该字段。
- Customer、PI、Dictionary、Permission、Menu 模型和服务均已存在，Quotation/Order 及其明细/费用表此前不存在。Customer 电话维持现有必填唯一策略；客户联系方式和地址新增 nullable 字段，报价/订单保存客户快照。
- 本期迁移新增报价/订单表、状态 enum、客户扩展字段和可空 `PiDocument.orderId` 预留外键；不改变既有 PI 计算/状态，不创建 Shipment 表。

### 0.4 本次实施记录（2026-11-02）

- 已部署 additive migrations：`20261102120000_quotation_order_core`（报价/订单及明细、费用、Customer 扩展、PI order 预留）与 `20261102130000_quotation_order_idempotency`（创建者范围的幂等 key/hash 唯一索引）。报价/订单号使用 UTC 日期 + cryptographic UUID 随机后缀，不依赖 `count(*)`。
- 已复用 `currency`、`volumetric_weight_divisor`、`quotation_fee_type` 字典；报价费用默认项由版本化数据迁移和参考数据 seed 幂等补齐，已存在的管理员启停状态和翻译会保留。报价/订单权限与双语菜单继续由参考数据 seed 维护；菜单新增在 `quotes-files` 组下，API 仍由逐端点 RBAC 授权。
- 已实现服务端商品成本读取、字典校验、Decimal 预览计算、箱规覆盖快照、订单级费用、海运分摊、汇率总额舍入、报价草稿保存/查询、报价转订单和计算器直接创建订单。创建写入为数据库事务；相同幂等 key + 相同 payload 重放返回同一记录，payload 不同返回冲突；报价转单以唯一 `sourceQuotationId` 处理并发重放。
- 已实现 `/[locale]/quotation-calculator`、`/[locale]/quotations`、`/[locale]/orders` Admin 页面。报价草稿支持保存、查询和转单；直接订单要求客户名称、E.164 电话、国家、完整收货地址及订单日期。创建新客户时按唯一电话原子复用/创建 Customer，但不覆盖已有主档信息。
- CNY 商品单价/金额、箱规重量及运费分摊按数据库 NUMERIC 精度归一后计算和保存，所有总额通过 Decimal；历史计算曾将外币总额一次 ROUND_UP 到两位，当前舍入规则见下方 1.1 记录。
- 成本、涨幅和商品级运费分摊需要成本读取权限；客户端不能提交成本或计算结果作为权威值。操作审计记录不含客户电话、邮箱、地址或成本明细。
- 验证：本地 PostgreSQL 两个 migration 均成功部署，`check:menu-translations` 通过（33 菜单 × 2 locale），`check:production-reference-data` 通过；计算引擎、输入 DTO、RBAC wiring 单测及 Admin 单测已通过。全量 API 测试的 4 项商品导入测试因仓库未提供 `docs/凡士林.xlsx` 夹具失败，其余 367 项通过。
- 回滚：先回退 API/Admin 发布，保留 additive schema 和已写业务数据；禁止自动 DROP 新表或订单/报价数据。若尚无业务记录且确需回滚 schema，须单独审核反向迁移；幂等列/索引可在确认没有并发写入后单独移除。

### 0.5 计算器体验与校验修复（2026-11-02）

- 预览接口 400 根因：预览与草稿/订单创建共用要求 `title` 非空的 schema，而页面允许不填标题直接计算。现拆分 `quotationPreviewSchema`，空标题预览默认转换为 `Temporary calculation`；保存报价和创建订单仍要求标题。
- 商品明细初始改为空表；通过“添加商品”打开选择弹窗，复用启用品类树，选择父品类时按整个后代范围筛选；SKU/名称使用服务端不区分大小写包含搜索。列表显示主图、SKU、名称、可授权查看的内部成本和发布状态，复选框支持多选。
- 已选商品以表格展示，整行可鼠标拖放排序，键盘聚焦行后可用方向键调整顺序；行操作位于最后一列。没有成本读取权限时搜索结果不返回成本值。
- 报价费用继续由 `quotation_fee_type` 字典驱动；活动默认项为包装费用、清关费用、其他费用。旧配送、保险、操作选项保留字典记录但 seed 停用，避免历史快照引用被删除。
- 新增预览空标题校验和商品搜索/成本脱敏测试。无 schema 变更，本次不新增数据库 migration；本地 reference seed 已同步。
- 验证：验证包相关测试 20 项、API 计算/商品搜索/RBAC wiring 测试 17 项、Admin 全量 184 项通过；lint、API/Admin typecheck 与 build 通过。

### 0.6 海运双报价与订单级体积系数修订（2026-11-03）

- 报价接口同时计算 CBM 与 KG 两种 CNY 海运报价，费率不随目标币种切换；页面选择 CBM 或 KG 后，只有选中报价计入 CNY 订单总额并按汇率换算为目标币种。两种报价、计费依据、汇率换算结果及商品分摊均写入报价/订单快照。
- 体积重系数改为订单级选择并应用于所有商品。复用现有 `volumetric_weight_divisor` 字典项 5000、6000、8000；服务端校验字典类型、启用状态和值为正整数。商品行保留旧系数列以读取历史记录，新计算不再写入该列。
- Decimal 引擎按实际尺寸计算 CBM，CBM 与 KG 重量分别使用正确公式；KG 计费重量不按整数或 0.5 kg 进位。海运分摊按用户选择的 CBM/重量依据计算，末行承接尾差，人民币内部成本分摊与报价币种分摊分开保存。
- 新增 additive migration `20261103100000_order_level_dual_freight_quotes`，保存双报价、系数 ID/code/value、汇总 CBM/重量、选择方式和分摊快照；CBM 精度扩展到 15 位，重量精度扩展到 12 位。既有单行系数历史值保留。
- 回滚：先回退 API/Admin；迁移中的新增快照列允许旧代码忽略。不要自动删除新列或枚举；确认没有任何报价/订单使用新快照后，才可单独审核反向 migration。重量/分摊列精度缩回前，先检查数据库中是否存在超过旧精度的值。新旧计算格式的报价不能混算，旧报价转换订单会被拒绝并提示重新计算保存。
- 验证记录：本次代码实现尚未执行 migration；本轮未运行测试套件。

### 0.7 报价计算器图片、排序和费用字典修复（2026-11-03）

- 商品搜索结果改用 FileAsset ID 生成登录态 Admin 图片预览 URL。原实现通过公开文件 URL 请求受保护的商品原图，公开文件接口会返回 404；缺少 FileAsset 关联的旧图片不再生成失效 URL。
- 商品明细表格整行支持鼠标拖动排序，移除可见的拖动柄和上下移动按钮；聚焦行后可用上/下方向键排序，移除商品按钮仍保留在最后一列。
- 新增 `20261103110000_quotation_fee_type_reference_data` 数据迁移，缺少时补齐 `quotation_fee_type` 及包装费用、清关费用、其他费用和中英文翻译；参考 seed 同步同样仅补缺失项，不覆盖已有管理员启停设置和翻译。无 schema 变化。
- 回滚：回退 API/Admin 后保留字典数据；字典项由管理员维护，迁移新增的默认项不自动删除，避免误删后续自定义或历史引用。无需缩回 schema。

### 0.8 计算器筛选与预览校验修复（2026-11-04）

- 商品筛选树保留停用品类作为禁用祖先节点，避免只筛启用品类时丢失其下仍启用、可关联的后代；节点选择仍只允许启用品类，后端商品搜索按所选节点包含全部后代。
- 预览调用前校验 CBM、KG 两种费率为正数且最多 8 位小数；缺失或格式错误时显示双语字段提示，不再发送必然触发 400 的费率请求。其他业务校验仍由服务端 DTO 执行，接口错误保留错误码。
- 商品表格把商品与包装回显字段（含单箱毛重）排在计算输出之前；销售单价和 CBM/体积重/总毛重计算值放到后半部分。无 schema 变更。

### 0.9 预览金额随目标币种展示（2026-11-04）

- 计算摘要和商品表格中的销售单价、商品金额、海运报价、选中海运费、商品运费分摊和订单总额统一展示为页面所选币种；金额标签同步显示该币种。目标币种金额由服务端 Decimal 计算。
- CBM/KG 海运费率、商品内部成本、配送费和其他费用仍以 CNY 输入；它们是核算基准或输入值，不跟随目标币种切换。无需数据库迁移。

### 1.0 商品行与选择弹窗优化（2026-11-04）

- 销售单价按目标币种单件向上进位到两位小数；目标币种商品金额按已进位单价 × 数量计算，页面显示与保存的明细金额一致。
- 2026-11-06 调整：商品明细显示 Product 主档的只读“每箱数量”，用户输入“箱数”，商品总数由后端相乘得出；旧报价/订单保留原历史数量快照，不回写历史数据。
- 添加商品弹窗从 `publish_status` 字典加载筛选值，服务端搜索始终排除草稿；弹窗分别从发布状态和商品生命周期字典显示对应 locale 标签。无数据库迁移。

### 1.1 目标币种商品金额及 CBM 运费精度（2026-11-04）

- 后端先用 CNY 成本和涨幅计算 CNY 单价，再按汇率换算目标币种，并将每件销售单价向上进位到两位；商品金额按该单价乘数量、再按币种金额精度四舍五入到两位，外币订单总额由商品行、运费和其他费用行汇总，避免将换汇尾差分配进商品单价。
- CBM 运费按订单总 CBM × CNY/CBM 单价计算，CNY 结果和换算后的目标币种金额均向上进位到两位；KG 运费舍入规则保持原样。
- 单箱 CBM、商品总 CBM 和订单总 CBM 在页面最多展示 8 位小数，超出部分四舍五入，尾部 0 不补齐。数据库和计算快照仍保存完整 Decimal 精度。无需数据库迁移。

### 1.2 报价草稿生命周期与可编辑性（2026-11-10）

- 报价草稿列表默认只查询 `DRAFT`。报价转为正式订单后仍保留 `Quotation` 行及其 `CONVERTED` 状态，用于 `Order.sourceQuotationId` 来源追踪、审计和历史关联，但不再作为可操作草稿显示。
- 草稿中心支持进入报价计算器重新编辑。`GET /admin/quotations/:id/edit-data` 仅在草稿状态下返回持久化计算快照和当前商品数据；保存通过 `PATCH /admin/quotations/:id` 原子替换明细与费用、重新由服务端计算、递增 `revision`，并更新原报价，不创建重复草稿。
- 计算器编辑模式只提供“更新报价草稿”，避免从旧草稿直接创建另一张正式订单后留下无法解释的草稿；更新后回到草稿中心执行 `convert-to-order`。
- 草稿中心支持受 `quotation.delete` 保护的删除。服务端只允许删除未关联正式订单的 `DRAFT`；`CONVERTED`、`EXPIRED`、`ARCHIVED` 或已有 `sourceQuotationId` 订单引用的报价必须拒绝删除。正式订单使用独立快照，后续更新或删除草稿不会改变订单。
- 草稿更新或删除时，旧报价商品图片快照由服务层清理；对象存储删除失败继续进入既有 `FileDeletionJob` 重试，不静默遗留文件。
- 权限：加载计算器编辑数据要求 `quotation.update + quotation.cost.read`；更新要求 `quotation.update`；删除要求 `quotation.delete`；转换订单仍要求 `quotation.convert_to_order`。按钮隐藏不能替代这些服务端校验。
- 数据库：复用现有 `Quotation.status`、`revision` 和 `sourceQuotationId` 关系，无 schema migration。
- 回滚：回退 Admin/API 后，`CONVERTED` 报价仍可由旧代码作为历史记录读取；已删除的无订单草稿无法自动恢复，应按数据库备份或审计记录处置。不得为回滚而批量删除或改回已转订单的来源报价。

---

## 1. 产品目标与业务术语

该模块是 B2B 交易系统核心入口，统一称为 **客户报价计算与订单管理中心 / Quotation & Order Center**。

业务实体严格区分：

- **临时计算**：浏览器可即时计算和预览，不要求保存，不创建报价编号或订单编号。
- **报价草稿 Quotation Draft**：用户主动选择“保存草稿”后入库，可恢复、编辑、复制、转订单。
- **正式订单 Order**：可由已保存报价转化，也可由计算器直接创建；订单一经创建即保存客户、商品、包装、费用、币种、汇率、计算结果快照。
- **PI / Shipment**：未来阶段独立实体，关联 Order；本期只预留关系设计。

本期不实现 Excel/PDF 导出。页面暂时提供计算结果展示、保存报价草稿、直接创建订单、报价转订单。不要将旧商品报价 Excel 导出页面 `docs/36` 混为本模块；两者业务用途不同，可在后续统一入口但不应破坏既有功能。

### 1.1 本期明确业务决定

| 决策 | 固定规则 |
|---|---|
| 基础核算币种 | CNY |
| 汇率方向 | 1 CNY = X 目标货币 |
| 汇率来源 | 人工录入；保存汇率值、日期、录入人 |
| 外币展示 | 固定两位小数，包括 JPY；按业务明确规则，不自动套 ISO minor unit |
| 外币舍入 | 目标币种单件销售价向上进位到两位；行金额为单价 × 数量后四舍五入到两位；CBM 运费向上进位到两位 |
| 明细与总额 | 目标币种订单总额由商品行、运费、配送费和其他费用汇总；费用行内分配尾差，商品行不承接订单汇率尾差 |
| 报价保存 | 可选择保存草稿，也可不保存直接计算；未保存计算不创建任何业务记录 |
| 订单创建 | 同时支持“已保存报价转订单”和“计算器直接创建订单” |
| 商品定价 | 商品级独立核算，采购成本按百分比加价 |
| 订单费用 | 海运费、配送费、其他附加费统一作为订单级费用输入/保存 |
| 海运分摊 | 仅为商品级成本分析展示分摊；订单财务费用仍只计入一次 |
| 物流计费重量 | 订单总体积重与订单总毛重取较大值 |
| 模板导出 | 延后下一版，不在本期范围 |
| 字典 | 币种、体积重系数由现有两层字典管理 |

---

## 2. 管理端菜单、页面与权限

### 2.1 菜单

在 Admin Shell 中新增一级菜单或业务菜单组下的子菜单，具体父节点需先检查现有菜单树，避免重复创建。建议：

- 中文：客户报价与订单
- 英文：Quotation & Orders
- 子菜单 1：报价计算器 / Quotation Calculator，route `/[locale]/quotation-calculator`
- 子菜单 2：报价记录 / Quotations，route `/[locale]/quotations`
- 子菜单 3：订单管理 / Orders，route `/[locale]/orders`

若当前菜单管理策略要求 route 不包含 locale，则按项目既有 Admin locale 规则使用实际路由；不得在代码中自行拼接第二套路由规则。

### 2.2 页面结构

报价计算器采用单页分区/步骤式工作台，桌面端可左右布局，手机端单列：

1. **客户与报价信息**：模式切换（临时计算/保存报价草稿/直接创建订单）、客户选择或新增、客户名称、联系人、电话、邮箱、国家、账单地址、收货地址、报价日期、有效期、订单日期（创建订单时）。
2. **商品明细**：商品搜索/选择、SKU、商品名称、每箱数量（读取 Product.cartonQuantity，只读）、箱数（用户输入）、采购成本 CNY、涨幅百分比、销售单价和商品金额。商品总数由服务端按每箱数量 × 箱数计算，客户端不提交可篡改的总数量。
3. **包装参数**：每个商品的箱数、单箱长宽高、单箱毛重；展示每行单箱 CBM、商品总 CBM、商品总体积重和总毛重。每箱数量读取 Product 主档并在历史快照中保存，不允许报价时覆盖。商品行不单独选择体积重系数。
4. **海运双报价与订单级费用**：同时配置 CNY/CBM 和 CNY/kg 单价；海运费率输入固定使用 CNY，不随报价目标币种切换。KG 报价区域统一选择一个体积重系数（来自字典），应用于整个订单。预览中的 CBM/KG 两种报价、选中海运费及分摊金额均展示为页面选择的目标币种；CNY 报价按汇率转换后展示。另录入仍以 CNY 为单位的配送费和其他费用行。
5. **货币与汇率**：报价币种（字典）、人工汇率；明确显示 `1 CNY = X USD`。
6. **实时计算摘要**：商品金额合计、订单总 CBM、总体积重、总毛重、KG 计费重量、CBM 海运报价、KG 海运报价、当前选中的海运费、配送费、其他费用和按目标币种展示的订单总额。
7. **操作区**：重新计算、保存报价草稿、从报价生成订单、直接创建订单；未选择保存/创建时只保留本地临时状态。

### 2.3 商品明细 UI

商品表格每行展示：

| 字段 | 输入/来源 | 规则 |
|---|---|---|
| 商品 | 产品选择器 | 读取后台可报价商品 |
| SKU/名称 | Product 快照 | 不可将客户端提交值作为权威数据 |
| 每箱数量（件） | Product.cartonQuantity | 只读；必须为正整数，缺失时提示先补全商品包装数据 |
| 箱数 | 人工输入 | 正整数，1–100000 |
| 商品总数（件） | 自动计算 | 每箱数量 × 箱数；服务端使用 Product.cartonQuantity 重新计算，不接受客户端提供的总数 |
| 采购成本 CNY | Product 默认值，可按报价覆盖 | 成本权限控制；仅内部可见 |
| 涨幅 % | 人工输入 | 0–500，最多 4 位小数；每商品独立 |
| 销售单价 | 自动计算 | CNY 成本 × (1 + 涨幅/100) 后按汇率换算；目标币种单价向上进位到两位 |
| 商品金额 | 自动计算 | 目标币种已进位销售单价 × 数量，按两位小数四舍五入；预览表格标签和金额跟随页面选择币种 |
| 单箱尺寸 | Product 默认/本次覆盖 | 长宽高完整填写或全部为空 |
| 单箱毛重 kg | Product 默认/本次覆盖 | 非负，正式物流报价要求有效正数 |
| 单箱 CBM | 自动计算 | 长 × 宽 × 高 ÷ 1,000,000，单位 CBM |
| 单箱体积重 | 自动计算 | 长 × 宽 × 高 ÷ 订单统一体积重系数，单位 KG；系数由 KG 报价配置提供 |
| 商品总 CBM/体积重/毛重 | 自动计算 | 分别按箱数汇总；同一订单所有商品使用同一个 KG 体积重系数 |

报价计算器商品表格和计算摘要中的数值（含数量、CBM、体积重和运费分摊）保留计算结果精度，仅去掉小数末尾无意义的 0；CBM 最多显示 8 位小数。销售单价按目标币种向上进位到两位，金额按其销售单价乘数量计算。数据库和 API 继续保存 Decimal 计算快照。

商品成本和利润率只允许有相应权限的后台用户查看/修改。任何公共 Storefront DTO、公开页面、SEO、缓存、产品接口都不得出现内部成本、涨幅、销售报价或订单数据。

### 2.4 权限码建议

新增权限前先查询 Permission seed 与权限目录，避免重复 code。建议：

| 权限码 | 用途 |
|---|---|
| `quotation.read` | 访问报价计算器、读取报价草稿/报价详情 |
| `quotation.calculate` | 调用后端计算预览 |
| `quotation.create` | 保存报价草稿 |
| `quotation.update` | 修改未锁定报价草稿 |
| `quotation.delete` | 删除/归档报价草稿（不得删除已转订单的来源记录） |
| `quotation.convert_to_order` | 从报价草稿创建订单 |
| `order.read` | 查看订单及订单明细 |
| `order.create` | 直接创建订单 |
| `order.update` | 修改允许编辑的订单字段 |
| `order.cancel` | 取消订单；须检查 PI/Shipment 关联状态 |
| `quotation.cost.read` | 查看商品采购成本与利润相关数据 |
| `quotation.cost.update` | 在报价中覆盖采购成本（可选，默认仅高权限角色） |
| `order.cost.read` | 查看订单成本快照及商品运费分摊 |

每个 API 独立执行服务端 RBAC。菜单可见和按钮隐藏不构成授权。角色授权事实只使用 Permission + RolePermission。权限 seed 必须幂等，并将权限按模块归类。初始授予策略由现有 super_admin/业务角色 seed 决定，不得自动给所有角色授权。

### 2.5 UI 状态与交互

必须实现并测试：Initial、LoadingProducts、NoProducts、Editing、Calculating、CalculationError、UnsavedChanges、SavingDraft、DraftSaved、CreatingOrder、OrderCreated、PermissionDenied、DictionaryUnavailable、InvalidExchangeRate、InvalidPackaging、FreightAllocationUnavailable。

- 临时计算模式不强制客户资料。
- 保存报价草稿时，至少要求报价标题/客户资料按业务策略填写；无客户时允许匿名草稿需由产品决定，本文件建议客户可空但需填写报价名称。
- 创建正式订单必须有客户名称、电话、国家/地区、完整收货地址和订单日期；邮箱按业务可选。
- 客户账单地址可以与收货地址不同。
- 客户选择已有 Customer 时只填充表单初值；提交时仍保存订单客户快照。
- 离开页面有未保存变更提示；草稿保存/订单创建后显示编号和详情链接。
- 计算器页面在 360px、768px、桌面断点适配，商品表格局部横向滚动，不允许整页横向溢出。
- 所有中英文文案进入现有 i18n 资源，不在组件硬编码。

---

## 3. 统一计算规则

### 3.1 商品销售价格

每个商品独立输入涨幅百分比：

`unitSalePriceCny = costCny × (1 + markupPercent / 100)`

`quantity = unitsPerCarton × cartonCount`

`itemAmountCny = unitSalePriceCny × quantity`

示例：采购成本 ¥5，涨幅 20%，销售单价 ¥6；每箱 50 件、输入 2 箱，服务端计算商品总数 100 件，商品金额 ¥600。

内部成本和 CNY 核算单价、金额使用 Decimal，保留原始精度；目标币种每件销售单价先向上进位到两位，再乘商品数量计算目标币种行金额，行金额按两位小数四舍五入。人民币核算金额仍保留完整精度。

### 3.2 包装数据与重量

对商品 i：

- `cartonCount_i`：本次报价箱数。
- `unitsPerCarton_i`：Product 主档的每箱数量，用户不可在报价中覆盖。
- `quantity_i = cartonCount_i × unitsPerCarton_i`：商品总件数，由服务端 Decimal 计算，用于金额和历史快照；不得接受客户端传入 quantity。
- `cartonLengthCm_i`、`cartonWidthCm_i`、`cartonHeightCm_i`：单箱外箱尺寸。
- `cartonGrossWeightKg_i`：单箱毛重。
- `volumetricDivisor`：KG 报价配置中的订单级统一体积重系数，来自启用的 `volumetric_weight_divisor` 字典项；整个订单所有商品共用一个系数，不按商品行分别选择，不得硬编码 6000。

单箱实际体积：

`cartonVolumeCbm_i = L × W × H / 1,000,000`

商品总 CBM：

`itemTotalCbm_i = cartonVolumeCbm_i × cartonCount_i`

单箱体积重：

`cartonVolumeWeightKg_i = L × W × H / volumetricDivisor`

商品总体积重：

`itemTotalVolumeWeightKg_i = cartonVolumeWeightKg_i × cartonCount_i`

商品总毛重：

`itemTotalGrossWeightKg_i = cartonGrossWeightKg_i × cartonCount_i`

订单汇总：

`orderTotalCbm = Σ itemTotalCbm_i`

`orderTotalVolumeWeightKg = Σ itemTotalVolumeWeightKg_i`

`orderTotalGrossWeightKg = Σ itemTotalGrossWeightKg_i`

**区分规则：** CBM 是实际体积，计算时除以 1,000,000；体积重是 KG 重量，计算时除以订单统一体积重系数。体积重系数绝不能用于 CBM 计算。KG 报价不进位，使用实际计算重量。

商品尺寸必须三项同时有效或全部为空。若启用任一海运报价，参与报价的商品必须具备有效尺寸；KG 报价还要求单箱毛重有效。缺失时阻止正式报价保存/订单创建并指出具体商品。

### 3.3 海运双报价、择一采用与商品级分摊

系统必须使用同一批商品和包装数据，同时计算两种独立的货代报价；不得让用户先选择一种方式才计算另一种。CBM 和 KG 两种海运单价及其计算结果固定为 CNY，独立于本次报价目标币种 `currencyCode`。只有商品报价、其他 CNY 费用合计换算为目标币种时才应用汇率。单价缺失或非正数时，不得将报价标记为有效，也不得用 0 代替未录入报价。

**A. CBM 体积计费**

`cbmFreightAmount = orderTotalCbm × cbmRatePerCbm`

CBM 计费只使用实际体积，不使用体积重系数、总体积重或总毛重。先用完整精度 CBM × CNY/CBM 费率计算，CNY 运费金额向上进位到两位；换算为目标币种后也向上进位到两位。

**B. KG 重量计费**

KG 报价配置包含一个订单级 `volumetricDivisor`，必须从启用的 `volumetric_weight_divisor` 字典项中选择。该系数应用于本订单所有商品：

`chargeableWeightKg = max(orderTotalVolumeWeightKg, orderTotalGrossWeightKg)`

- 总体积重大于总毛重：`kgChargeableBasis = VOLUME_WEIGHT`。
- 总毛重大于总体积重：`kgChargeableBasis = GROSS_WEIGHT`。
- 两者相等：记录 `VOLUME_WEIGHT`（两种分摊比例相同）。

`kgFreightAmount = chargeableWeightKg × kgRatePerKg`

KG 计费重量不进位，使用完整计算精度的实际重量计算费用；不得按整数或 0.5 KG 自动进位。页面展示精度可格式化，但计算不得先按展示位数截断。

**C. 同时展示并择一采用**

两种报价同时以 CNY 展示：CBM 总 CBM、CBM 单价、CBM 运费；KG 体积重系数、总体积重、总毛重、计费重量、计费依据、KG 单价、KG 运费。用户选择 `freightBillingMethod = CBM | KG` 其中一种作为最终采用方案。只有被选中的 CNY 海运费计入人民币订单总额；另一种报价仅作为比较数据保存，不参与订单费用求和。换算成目标币种时，选中的 CNY 海运费按报价汇率转换，并参与订单外币总额舍入与尾差分配。

**D. 商品级运费分摊**

- 最终选择 CBM：按 `itemTotalCbm_i / orderTotalCbm` 分摊。
- 最终选择 KG 且 `kgChargeableBasis = VOLUME_WEIGHT`：按 `itemTotalVolumeWeightKg_i / orderTotalVolumeWeightKg` 分摊。
- 最终选择 KG 且 `kgChargeableBasis = GROSS_WEIGHT`：按 `itemTotalGrossWeightKg_i / orderTotalGrossWeightKg` 分摊。
- KG 两种重量相等时按总体积重分摊。

`allocatedFreightCny_i = selectedFreightCny × itemBasis_i / Σ itemBasis`

按商品行顺序计算前 n-1 行，最后一行承接尾差，确保 CNY 商品分摊合计严格等于选中的海运费。需要目标币种分摊值时，将 CNY 分摊额按报价汇率转换并单独保存，不能覆盖客户报价金额。

如果所选依据合计为 0，不能除零；若选中海运费为 0，可将各行分摊设为 0，否则阻止计算并提示缺失包装数据。

**关键财务规则：** 海运费分摊仅用于商品 landed-cost / 内部成本分析。订单汇总时只将最终选中的海运费计入一次；未选中的报价永远不能加入订单总额，分摊行也不能再次加入订单总额。

### 3.4 订单级其他费用

所有运费及附加费在订单级统一录入和汇总，不强制拆成商品级收费：

- 海运费：由 CBM/KG 双报价模块按 CNY 单价分别计算，用户选择一种；最终只将选中 CNY 金额作为唯一海运费用行保存。两种报价的原始单价、CNY 币种、计算量、KG 系数及未选报价金额保存在报价/订单快照中。第一版不开放人工覆盖；目标币种金额按报价汇率换算。
- 配送费：订单级固定金额 CNY。
- 其他费用：可添加多行，字段包括费用类型、名称、金额 CNY、备注；费用类型可使用字典，非核心类型可配置。
- 保险费、报关费、文件费等如未来需要，作为其他费用行，不要为每一种费用重复新增金额列。
- 所有费用金额不得为负数；折扣如未来支持应单独建模，不允许伪装为负费用。

订单人民币总额：

`totalAmountCny = Σ itemAmountCny + orderFreightCny + deliveryFeeCny + Σ otherFeesCny`

若业务未来决定销售报价中不向客户收取部分费用，应增加“内部成本费用/客户报价费用”分类，而不是从合计中静默漏掉。

### 3.5 汇率、外币与舍入

统一定义：

`exchangeRate = targetCurrency units per 1 CNY`

例如 `1 CNY = 0.1380 USD`。

商品目标币种单价与行金额：

`unitSalePriceTarget = CEIL_TO_2_DECIMALS(unitSalePriceCny × exchangeRate)`

`lineAmountTarget = ROUND_HALF_UP(unitSalePriceTarget × quantity, 2)`

目标币种订单金额由商品目标币种行金额、已选海运费、配送费和其他费用行相加；费用之间的最小币种单位尾差仍按费用金额比例分配。CNY 核算总额继续单独保存，不再用它乘汇率反向推导商品目标币种金额。

使用 Decimal.js 或现有 Decimal 工具；禁止 JavaScript Number、parseFloat 参与金融运算。汇率必须为正数；CNY 汇率固定为 1 并锁定。拒绝科学计数法、NaN、Infinity、超出精度、零或负数。

本项目本功能明确所有币种展示两位小数（包括 JPY），不按币种默认小数位自动改变规则。商品销售单价对非负金额使用 Decimal CEIL 到两位，商品行金额按销售单价乘数量后四舍五入到两位；CBM 运费金额按本节规则向上进位。其他非负订单费用按汇率换算后向上进位到两位，再在费用行之间分配尾差。如金额可能出现负值，先拒绝/走单独退款业务规则。

商品目标币种行金额直接以已进位单价 × 数量计算，不能把订单级换汇尾差分配进商品行，否则商品行金额将不再等于其销售单价乘数量。

费用行金额应使用尾差分配确保：

`Σ foreign item lines + foreign order fees = foreignTotal`

汇率、汇率日期、录入人、基础币种、目标币种、舍入规则、计算引擎版本都应保存。报价/订单历史不随字典汇率、商品成本或字典配置后续变化。

### 3.6 计算服务唯一事实来源

前端可以做即时预览，但正式计算 API、保存报价、报价转订单、直接创建订单和后续文件导出必须调用同一个后端 Calculator。请求只传输入项；后端重新读取商品默认值和字典项、验证权限和范围、重算结果，不信任前端传来的最终单价、总金额、重量、汇率字典 label 或分摊结果。

建议计算模块边界：

```text
QuotationModule
  ├── QuotationController
  ├── QuotationService
  ├── QuotationCalculationService
  ├── FreightAllocationService
  ├── CurrencyConversionService
  ├── QuotationOrderConversionService
  ├── dto/
  └── calculators/
```

---

## 4. 数据库设计与 Prisma 迁移

### 4.1 设计原则

- 先复用现有 Product、Customer、Dictionary、PiDocument、AuditLog、Permission、Menu。
- 报价与订单是独立实体；订单创建时复制完整快照。
- 历史记录不依赖实时 Product、Customer、Dictionary 数据来还原当时金额。
- 金额和重量使用 PostgreSQL NUMERIC / Prisma Decimal。
- 不用 Float/Double 保存成本、价格、汇率、重量或分摊结果。
- 业务编码唯一，UUID 主键。
- 订单创建和报价转换使用事务与幂等保护。
- 数据库关系预留 PI、Shipment，但不提前实现完整物流业务。

### 4.2 新增模型建议

以下为逻辑模型，最终字段/关系须结合 Prisma 版本和现有命名风格实现并生成迁移；不得直接复制后跳过 schema validate。

#### Quotation

主字段建议：

- id UUID、quotationNo unique、version Int、status（DRAFT/CONVERTED/EXPIRED/ARCHIVED）。
- title、customerId nullable、createdById、validUntil、quotedAt。
- currencyCode、exchangeRate Decimal、exchangeRateBase（CNY）、exchangeRateDate、exchangeRateSource（MANUAL）、exchangeRateEnteredById。
- roundingMode（CEIL_2）、calculationVersion。
- 海运双报价快照：`freightBillingMethod`（CBM/KG）、`freightCurrencyCode`（固定为 CNY，与 `currencyCode` 无关）、`cbmRatePerCbm`、`orderTotalCbm`、`cbmFreightAmount`、`kgRatePerKg`、`volumetricDivisorItemId`、`volumetricDivisorCode/value` 快照、`orderTotalVolumeWeightKg`、`orderTotalGrossWeightKg`、`chargeableWeightKg`、`kgChargeableBasis`、`kgFreightAmount`、`selectedFreightAmount`（CNY）、`freightAllocationSnapshot`（CNY 分摊和单独记录的目标币种分摊）。未选择的报价结果也必须保存，便于还原比较过程。
- subtotalCny、freightCny、deliveryFeeCny、otherFeesCny、totalAmountCny、totalAmountForeignExact（目标币种商品行金额 + 未舍入订单费用换算额）、totalAmountForeign。
- customerSnapshot Json（保存客户名称、联系人、电话、邮箱、国家、账单/收货地址）。
- calculationSnapshot Json（输入与完整计算结果快照）。
- convertedOrderId nullable；convertedAt nullable。
- createdAt/updatedAt。
- 关系：items、fees、customer optional、createdBy、convertedOrder optional（唯一约束按产品决定）。

约束：`quotationNo` 唯一；`version >= 1`；状态转换由服务层控制；已转订单报价不可覆盖修改，修订需新版本。

#### QuotationItem

- id、quotationId、lineNo unique per quotation。
- productId nullable（产品删除/归档后保留快照，不依赖外键级联）；skuSnapshot、productNameSnapshot、descriptionSnapshot。
- quantity Decimal、unit。
- costCny、markupPercent、unitSalePriceCny、lineAmountCny。
- cartonCount、unitsPerCarton、cartonLengthCm、cartonWidthCm、cartonHeightCm、cartonGrossWeightKg。
- cartonVolumeCbm、totalCbm、totalVolumeWeightKg、totalGrossWeightKg、freightAllocationBasis、allocatedFreightCny、allocatedFreightForeign。体积重系数不存商品行，由报价/订单级 KG 报价快照统一保存。
- currencyCode、unitSalePriceForeign、lineAmountForeign（目标币种已舍入单价 × 数量后的行金额，不承接订单尾差）。
- productDataSnapshot Json、packagingSnapshot Json。
- createdAt/updatedAt。

#### QuotationFee

- id、quotationId、lineNo、feeTypeCode、nameSnapshot、amountCny、amountForeign、isFreight、notes。
- 海运费可以作为固定 fee row；避免同时在主表和费用表重复计入。若主表保留 freightCny 作为聚合缓存，必须保证它与唯一 freight row 一致并由同一事务维护。

#### Order

- id、orderNo unique、status（DRAFT/CONFIRMED/CANCELLED 等有限状态机）。
- sourceQuotationId nullable、sourceQuotationVersion nullable、createdById、customerId nullable。
- orderDate、requestedDeliveryDate nullable、confirmedAt nullable。
- currencyCode、exchangeRate、exchangeRateBase、exchangeRateDate、exchangeRateSource、roundingMode、calculationVersion。
- 与 Quotation 相同的 CBM/KG 双报价字段及完整快照；订单必须保存两种报价结果、订单级系数、所选方式和分摊快照。
- customerSnapshot Json、billingAddressSnapshot Json、shippingAddressSnapshot Json。
- subtotalCny、freightCny、deliveryFeeCny、otherFeesCny、totalAmountCny、totalAmountForeignExact、totalAmountForeign；目标币种订单金额由目标币种商品行及费用行汇总。
- calculationSnapshot Json。
- createdAt/updatedAt。
- 关系：items、fees、quotations (source/converted)、piDocuments（未来）、shipments（未来）。

#### OrderItem

字段与 QuotationItem 的商品/价格/包装/重量快照等价；额外 orderId、lineNo。订单商品快照不能只存 productId；productId 可 nullable 作为回溯关联，历史 SKU、名称、数量、价格、包装参数必须保留。

#### OrderFee

字段与 QuotationFee 等价，归属订单。海运费、配送费和其他费用只在此表作为订单级费用记录。订单主表金额字段为聚合快照，不得重复累加。

### 4.3 Customer additive 扩展

现有 Customer 仅有 phoneE164、countryCode、displayName、note。建议增加：

- email nullable（不建议唯一，多个客户可能共用采购邮箱）。
- contactName nullable。
- billingAddress Json nullable。
- defaultShippingAddress Json nullable。
- companyName 可复用 displayName 或新增字段，需统一语义。
- address snapshot 仍必须复制进 Quotation/Order，不依赖 Customer 地址后续变化。

电话唯一策略：当前 `phoneE164 @unique NOT NULL`。如果允许没有电话的客户，需迁移为 nullable，并为非空电话建立部分唯一索引（Prisma 表达能力不足时用 SQL migration）；同时不能用空字符串代替 null。默认第一版创建订单要求电话必填，减少 schema 改动。

### 4.4 PI / Shipment 预留关系

本期不创建 Shipment/TrackingEvent 表，不实现物流 API；但需在设计上明确下一阶段：

- 给现有 `PiDocument` 增加 nullable `orderId` UUID 外键，指向 Order；迁移可在 PI 阶段执行，当前不必为未用关系提前改动。
- 一个 Order 可关联多个 PiDocument revision；`PiDocument` 现有 `piNo + revisionNo` 唯一规则保留。
- Shipment、ShipmentItem、TrackingEvent 未来独立建表：Order 1:N Shipment；Shipment 1:N ShipmentItem；Shipment 1:N TrackingEvent。
- ShipmentItem 必须引用 OrderItem，并记录 shippedQuantity；后端校验累计发货量不超过订单数量（如允许超发需显式权限和审计）。
- 物流商 adapter、凭证、Webhook secret 不进入 Admin 前端或订单快照。

### 4.5 字典设计（复用两层模型）

新增并 seed 以下系统字典类型（先查现有 type code，不重复创建）：

| typeCode | itemCode 示例 | DictionaryItem.value | 用途 |
|---|---|---|---|
| `currency` | `CNY`, `USD`, `EUR`, `GBP`, `JPY`, `CAD`, `AUD` | 货币符号（如 ¥、$、€、£、¥、C$、A$） | 报价目标货币 |
| `volumetric_weight_divisor` | `6000`, `5000`, `8000` | 与 code 相同的正整数字符串 | 体积重计算除数 |
| `quotation_fee_type` | `delivery`, `customs`, `insurance`, `handling`, `other` | 可选 | 订单级费用分类 |

- 币种 code 使用 ISO 4217 大写 code；label 通过 DictionaryItemTranslation 多语言维护。
- 币种符号只用于展示；计算始终使用 code。
- 报价计算器商品金额按目标币种的已进位单价 × 数量计算；CBM 海运费向上进位到两位。摘要中 CBM 最多显示 8 位小数并省略尾 0，不能从字典 value 推断精度。
- 体积重 divisor 读取 item.value 或稳定 code；服务端校验为正整数，且 item 必须属于 `volumetric_weight_divisor`、enabled=true。
- 禁止把系数 6000 写死在前端/后端；如业务希望 6000/5000/8000 可由字典维护。
- 历史报价/订单保存 divisor 数值快照；禁用字典项不得改变历史结果。
- 字典类型/系统核心项按 docs/20 的 systemLocked、引用保护规则管理。

### 4.6 Prisma 迁移实施顺序

1. 先在分支中备份并核对当前 schema/migrations；确认 Product.priceCny 成本语义。
2. 添加 Customer 扩展字段（若采用电话必填则不改 phone nullable）。
3. 新增 Quotation、QuotationItem、QuotationFee、Order、OrderItem、OrderFee 模型及索引、外键。
4. 新增 dictionary seed（幂等 upsert），不重复创建已存在 type/item；核对中英文翻译。
5. 新增 Permission seed、Menu seed、i18n key。
6. 执行 `prisma format`、`prisma validate`、生成 client、migration diff 检查；生成版本化迁移。
7. 在临时 PostgreSQL 数据库执行 migrate deploy，再执行回填/seed 和完整测试。
8. 生产部署先执行迁移，再部署兼容代码；不要在 API 容器启动时自动执行破坏性 schema push。
9. 每步保留 SQL 对账结果和回滚方案。新表可先回滚应用代码，删除新表仅限确认无数据且经审批；已写入报价/订单后禁止自动 DROP 数据。

---

## 5. API 契约建议

所有路径遵循项目现有 `/api/v1/admin`、认证、错误结构和分页规范；先搜索已有等价接口，避免重复 endpoint。

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/admin/quotation-calculator/config` | 返回可用币种、体积重系数、默认值、舍入策略、单位 |
| GET | `/admin/quotation-calculator/products` | 商品搜索/选择，返回可报价商品摘要和箱规默认值；成本字段需成本权限 |
| POST | `/admin/quotation-calculator/preview` | 服务端计算预览，不持久化 |
| POST | `/admin/quotations` | 保存报价草稿 |
| GET | `/admin/quotations` | 报价草稿列表 |
| GET | `/admin/quotations/:id` | 报价详情 |
| GET | `/admin/quotations/:id/edit-data` | 读取未转订单草稿并回填报价计算器 |
| PATCH | `/admin/quotations/:id` | 更新未转订单草稿并递增 revision；并发转单后拒绝写入 |
| DELETE | `/admin/quotations/:id` | 删除未关联正式订单的报价草稿 |
| POST | `/admin/quotations/:id/convert-to-order` | 报价转订单 |
| POST | `/admin/orders` | 直接创建订单（提交计算输入，不接受最终金额） |
| GET | `/admin/orders` | 订单列表 |
| GET | `/admin/orders/:id` | 订单详情 |
| PATCH | `/admin/orders/:id` | 按状态和权限修改允许字段，金额修改必须重新计算并审计 |

### 5.1 预览请求规则

计算预览与当前报价 Excel 导出只依赖商品、运费、币种和费用输入；客户身份、联系方式、收货地址及订单日期不参与计算，不应因这些资料未填写或尚未完成而阻塞预览/导出。保存报价草稿可保留可选 customer draft。创建正式订单时必须提供有效的客户姓名、E.164 电话、两位 ISO 国家/地区代码、订单日期和完整收货地址。

商品输入为 items（productId、cartonCount、markup、包装尺寸/毛重覆盖值），不含 quantity 或 unitsPerCarton；服务端从 Product 读取 unitsPerCarton，并按箱数重新计算商品总数、金额和运输数据。订单级 KG 报价使用 `volumetricDivisorItemId`、CNY/CBM 与 CNY/kg 单价、`freightCurrencyCode=CNY`、`freightBillingMethod` 和费用输入；服务端重新计算选中的海运费及目标币种总额。不要接受客户端提供的数量、每箱数量、成本、最终售价或分摊结果作为权威值。

响应包括：
- items：SKU/名称快照、成本（仅有成本读取权限）、markup、服务端计算的 quantity（Product 每箱数量 × 箱数）、箱数和每箱数量快照、CNY unit price/line amount、单箱 CBM、商品总 CBM、商品总体积重、商品总毛重、分摊依据、allocated freight。
- freight：总 CBM、CNY/CBM 单价/金额；订单统一体积重系数、总体积重、总毛重、KG 计费重量、计费依据、CNY/kg 单价/金额；海运费币种 CNY、最终选择方式、最终采用 CNY 海运费、目标币种金额与商品分摊。两种报价同时返回。
- fees：每条费用 CNY 和分配后的外币展示值。
- totals：subtotal CNY、freight CNY、delivery CNY、other CNY、total CNY、exchange rate、foreign exact、foreign total。
- warnings：例如产品箱规被本次报价覆盖。
- errors：结构化 code、field、productId。

### 5.2 幂等与并发

- 保存草稿/创建订单/报价转订单必须支持 Idempotency-Key 或等价幂等 token；相同用户、相同 key、相同 payload 返回同一结果。
- 报价转订单在事务内锁定报价行（或使用条件更新）并确保只生成一个订单；并发第二次请求返回已转换订单，不创建重复订单。
- 草稿更新使用 `updatedAt` 或 revision 做乐观锁；版本冲突返回 409。
- OrderNo/QuotationNo 通过数据库唯一约束和安全编号生成器处理冲突重试；不以 count(*) + 1 生成编号。
- 订单事务内写主表、明细、费用、审计记录；任何一步失败全部回滚。

---

## 6. 订单状态与业务保护

第一期状态保持简单：

- Quotation：DRAFT → CONVERTED / EXPIRED / ARCHIVED。
- Order：DRAFT → CONFIRMED → CANCELLED（如直接创建即确认，明确由 API 事务创建状态为 CONFIRMED；不允许前端随意传 status）。

建议第一版创建订单即 `CONFIRMED`，若业务需要审核可增加订单 DRAFT，但必须明确确认按钮和状态权限。取消订单不删除数据；取消前检查是否已有 PI/Shipment（后续阶段）并执行相应规则。

订单创建后：
- Product、Customer、Dictionary 后续变化不影响 OrderItem/OrderFee/Order 快照。
- 不允许直接修改已确认订单的历史金额；需要订单变更单/修订机制，至少记录修改前后快照、原因、操作者。
- 订单删除采用归档/取消，不物理删除。
- 已转换报价锁定其原始计算快照；若客户要求改价，创建新报价版本或订单变更记录。

---

## 7. 测试与验收清单

### 7.1 Decimal 与商品金额

- [ ] 成本 ¥5，markup 20%，销售单价 = ¥6。
- [ ] 每箱 50 件、箱数 2，服务端得到商品总数 100 件、商品金额 = ¥600；篡改客户端 quantity 或 unitsPerCarton 不会改变计算结果。
- [ ] markup 0、500、负数、超过 500、超精度分别测试。
- [ ] Decimal 极小数、长小数、字符串输入；拒绝 NaN/Infinity/科学计数法。
- [ ] 任何计算不得通过 JS Number 累加。

### 7.2 体积重、毛重、海运分摊

- [ ] L=40cm、W=30cm、H=30cm，单箱 CBM = 0.036。
- [ ] 同样尺寸、订单级 divisor=6000 时，单箱体积重 = 6kg；体积重系数不影响 CBM。
- [ ] 2 箱，商品总 CBM = 0.072，商品总体积重 = 12kg。
- [ ] 同一订单所有商品行使用同一个 KG 报价体积重系数；不能为单行单独选择。
- [ ] 单箱毛重 8kg，2 箱商品总毛重 = 16kg。
- [ ] CBM 报价按各商品总 CBM 占比分摊。
- [ ] KG 报价订单总体积重 150kg、总毛重 126kg：计费重量按实际 150kg，不进位，按体积重分摊。
- [ ] KG 报价订单总体积重 100kg、总毛重 160kg：计费重量按实际 160kg，不进位，按毛重分摊。
- [ ] KG 两者相等：按体积重分摊，比例与毛重相同。
- [ ] 同一批商品同时计算 CBM 和 KG 两种报价；两种单价和报价金额固定使用 CNY，与订单目标币种相互独立。
- [ ] 切换最终计费方式只改变选中海运费、分摊和订单总额，不丢失另一种报价结果。
- [ ] 未选中的报价不参与订单金额汇总；不得双重计入。
- [ ] KG 计费重量 233.3333kg × 单价 2，按 233.3333kg 计算，不进位到 234kg 或 233.5kg。
- [ ] 订单级体积重系数从启用字典项选择并保存 itemId/code/value 快照；修改或禁用字典不改变历史订单。
- [ ] 海运费 375 CNY，分摊结果逐行相加严格等于 375。
- [ ] 分摊比例 1/3、2/3 或小数重量造成尾差时，最后一行承接尾差。
- [ ] 计费依据为 0、重量缺失、箱数为 0、尺寸部分缺失时返回明确错误，不除零、不静默按 0 计算。
- [ ] 验证商品海运分摊只用于展示，订单总额没有重复计入。

### 7.3 汇率与舍入

- [ ] CNY rate 自动为 1 且不可编辑。
- [ ] USD 0.1380 表示 1 CNY = 0.1380 USD。
- [ ] ¥1,000 × 0.1380 = $138.00。
- [ ] 外币精确结果 137.5001 → 最终 $137.51（向上到两位）。
- [ ] 精确结果 137.5000 → $137.50。
- [ ] 明细外币分配后总和严格等于外币订单总额。
- [ ] JPY 仍按本功能要求展示两位小数。
- [ ] 汇率为空、0、负数、过长、科学计数法、NaN 均拒绝。
- [ ] 改变币种字典 label/symbol 不改变历史订单币种和金额。

### 7.4 草稿、订单和幂等

- [ ] 临时预览不创建 Quotation/Order/Customer 记录。
- [ ] 用户主动保存后只创建 Quotation DRAFT，不创建 Order。
- [ ] 报价详情刷新后恢复所有商品、包装、费用、汇率、计算快照。
- [ ] 报价转订单后保存 Order、OrderItem、OrderFee 快照，Quotation 标记 CONVERTED。
- [ ] 并发双击/重放转换接口只产生一个订单。
- [ ] 直接创建订单不要求先保存报价，但仍保存相同订单快照。
- [ ] 两种订单创建方式的计算结果一致。
- [ ] 修改 Product 成本、Customer 地址、字典 label 后，历史订单数据不变。
- [ ] 订单创建中任一明细写入失败，事务整体回滚。
- [ ] 未授权用户无法读取成本、保存报价、创建订单或转换报价。

### 7.5 字典、菜单和权限

- [ ] 币种选项只来自启用的 `currency` 字典项。
- [ ] KG 报价的订单级体积重系数只来自启用的 `volumetric_weight_divisor` 字典项；同一订单所有商品共用该系数。
- [ ] 传入其他字典类型的 itemId 返回 400/422。
- [ ] 禁用系数不允许新报价选择，历史订单仍显示快照数值。
- [ ] 菜单 zh-CN/en-US 正确；无权限用户不显示菜单但直接调用 API 仍 403。
- [ ] Permission seed、Menu seed、Dictionary seed 多次运行结果一致，无重复行。

### 7.6 UI、回归和发布

- [ ] 360px、768px、桌面布局无整页横向溢出。
- [ ] 商品增删、排序、箱数修改、包装覆盖后自动重新计算；每箱数量始终显示 Product 主档值，总件数随箱数自动变化。
- [ ] 字典接口加载失败时禁用报价提交并提示，不使用硬编码 fallback。
- [ ] 所有输入有 label、错误提示、loading/disabled 和键盘可用性。
- [ ] Storefront 公共 API、HTML、SSR、缓存无成本/报价/订单字段。
- [ ] 运行相关 unit、integration、e2e、lint、typecheck、build；报告真实结果，不把未运行项标成通过。

---

## 8. 开发实施顺序（建议拆 PR）

### PR-1：审计与数据库基线
- 阅读 AGENTS 与 docs/04/05/18/19/20。
- 审查 Product.priceCny 成本语义、Customer 使用情况、PiDocument、Dictionary seed、Permission/Menu seed。
- 输出当前字段映射和差异清单；没有明确语义不得迁移。
- 新增 Prisma 模型和 migration；本地 PostgreSQL migrate deploy、seed、schema validate。

### PR-2：字典、RBAC、API 基础
- 新增 currency、volumetric_weight_divisor、quotation_fee_type 字典 seed。
- 新增权限 seed 和菜单翻译。
- API config/products/preview；后端 Decimal Calculator、FreightAllocationService、CurrencyConversionService。
- 单元/集成测试覆盖计算、权限、字典引用验证。

### PR-3：报价草稿
- Admin 计算器 UI、商品编辑表格、客户表单、费用区、币种/汇率。
- 临时预览不落库；保存草稿事务创建 Quotation + Item + Fee + snapshot。
- 报价列表/详情/编辑、乐观锁、审计、权限。

### PR-4：订单创建
- 报价转订单与直接创建订单两条路径。
- Order/Item/Fee 快照、编号、幂等键、事务、订单列表/详情。
- 状态与订单金额保护。

### PR-5：回归与部署验收
- 端到端流程、性能/并发、公共价格泄漏、响应式、备份/恢复。
- 更新 API 文档、README 导航、部署/回滚 runbook。
- 未完成 Excel/PDF 模板和 PI/物流功能，不得在菜单显示为已完成入口。

---

## 9. 推荐源码目录（以现有项目实际目录为准）

后端优先沿用现有 NestJS module 组织：

```text
apps/api/src/modules/
  quotation/
    quotation.module.ts
    quotation.controller.ts
    quotation.service.ts
    quotation-calculation.service.ts
    freight-allocation.service.ts
    currency-conversion.service.ts
    quotation-order-conversion.service.ts
    dto/
    calculators/
  orders/
    orders.module.ts
    orders.controller.ts
    orders.service.ts
    dto/
```

Admin 按当前 Next.js locale route 和 feature folder 规范组织：

```text
apps/admin/
  app/[locale]/quotation-calculator/
  app/[locale]/quotations/
  app/[locale]/orders/
  features/quotation/
  features/orders/
```

不得仅为了符合上述示意而重排现有目录；先检查实际 apps 结构与组件复用情况。

---

## 10. 安全、审计、性能与运维

- 内部成本/利润数据只向有权限的 Admin API 返回；日志不记录逐行成本和客户完整 PII。
- 客户地址、电话、邮箱属于个人信息；接口按权限最小化返回，审计 metadata 脱敏。
- 订单、报价、费用保存均用事务；编号依赖 unique constraint，不用 count+1。
- 大批量商品预览采用分页/上限；第一版建议最多 100 个商品行，压测后可调整。
- 计算接口应限流，避免用户输入每次按键都请求后端；前端 debounce，服务端仍做请求限流。
- 计算引擎保存 `calculationVersion`，以后公式变化可识别历史规则版本。
- 本期计算为同步轻量操作；不要为简单 Decimal 计算新增 Redis/BullMQ。未来 Excel/PDF 或批量导出可复用现有 PostgreSQL durable task + Worker。
- 监控 preview P95、计算失败率、草稿保存失败、订单创建失败、事务冲突、字典加载失败。
- 数据库备份覆盖新增报价/订单/客户字段；上线前做恢复演练。

---

## 11. 发布、迁移与回滚

1. PR 合并前执行 Prisma validate、migration diff review、unit/integration/e2e、lint/typecheck/build。
2. 备份数据库并确认可恢复。
3. 发布顺序：数据库 additive migration → 字典/权限/菜单 seed → API → Admin。
4. 新菜单可先仅对 super_admin/测试角色开放，验收后再分配业务角色。
5. 若应用发布失败，先回滚 API/Admin 镜像；保留 additive schema 和已创建业务数据，不自动 DROP 新表。
6. 若迁移失败，在任何应用切换前修复或执行经过审核的 down migration；不要手工删除生产数据。
7. 订单数据一旦产生，回滚应用不得丢失订单、报价、客户快照和审计记录。
8. 恢复验证：随机抽取报价和订单，核对商品行、人民币总额、汇率、外币总额、海运分摊合计与计算快照。

---

## 12. 本期完成定义

- [x] 现有 Schema/seed/API/UI 审计完成，字段语义确认。
- [x] 新增 Quotation/Order 相关表和版本化迁移，复用现有 Customer、Product、Dictionary、PiDocument。
- [x] 币种与体积重系数由两层字典管理，无硬编码业务选项。
- [ ] 临时计算、保存报价草稿、报价转订单、直接创建订单四条路径完整。
- [ ] 商品级涨幅、商品金额、包装、CBM、体积重/毛重、CBM/KG 双报价、计费方式选择及对应海运分摊正确。
- [ ] 所有订单级费用只汇总一次，分摊不重复计入总价。
- [ ] CNY 先核算，外币汇率人工录入，最终订单金额向上进位两位小数。
- [ ] 历史报价/订单快照不受 Product/Customer/Dictionary 修改影响。
- [ ] 菜单、权限、API guard、审计、双语、响应式完成。
- [ ] 单元/集成/E2E/lint/typecheck/build 结果真实记录。
- [x] Excel/PDF 模板导出、PI 页面、发货和物流 API 明确列为后续版本，不宣称已完成。

**实现原则：先确认现有数据语义，再做最小 additive migration；先保证计算正确、快照可靠、权限完整，再扩展模板导出、PI 和物流。**
