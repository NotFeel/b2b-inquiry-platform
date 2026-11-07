# 订单管理页面优化 — 产品交互与 AI 开发实施规范

> 文档编号：DOC-43 / B2B-ORDER-MANAGEMENT-UX-01  
> 仓库：`NotFeel/b2b-inquiry-platform`  
> 分支：`main`  
> 状态：开发实施规范，不代表功能已完成  
> 审查基线：`ebebc8b17f6ab52a542c92fbb65c8c15ad20c24d`  
> 主页面：`apps/admin/src/app/[locale]/(admin)/orders/page.tsx`  
> 关联文档：DOC-39、DOC-41、DOC-42

## 0. 目标、范围和原则

本规范指导 VS Code AI 对现有订单管理页面做增量优化。目标是改善订单列表、订单详情、客户资料修正、商品与费用展示、PI/CI 操作和审计信息。**不重建订单系统，不在本期开发完整物流履约模块。**

### 0.1 本期目标

1. 让管理员更快识别客户、订单状态、金额和单据状态。
2. 让筛选、分页、导出、详情查看更加清晰。
3. 优化现有客户/收货人/贸易快照修正体验。
4. 明确订单商品、费用、金额和包装数据的只读边界。
5. 优化 PI/CI 创建、状态、revision、PDF 操作反馈。
6. 补齐 Loading、Empty、Error、Permission Denied、409 冲突等状态。
7. 为未来订单变更历史和履约模块留出扩展位置，但不显示虚假数据。

### 0.2 本期不做

- 不新建 Order、OrderItem、Customer、Quotation 或 PI/CI 模型。
- 不新增 Shipment、ShipmentItem、Package、PackageItem、DeliveryRecord 等履约模型。
- 不改订单金额计算引擎。
- 不用 Product 当前数据覆盖 OrderItem 历史快照。
- 不直接修改已签发 PI/CI。
- 不提供未经后端支持的商品、数量、价格、费用编辑按钮。
- 不执行生产迁移或部署。

### 0.3 优先级

| 优先级 | 内容 |
|---|---|
| P0 | 列表信息可读性、详情信息架构、状态展示 |
| P0 | 客户/收货/贸易快照编辑体验 |
| P0 | PI/CI 生命周期和操作反馈 |
| P1 | Items、Charges、Audit 展示优化 |
| P1 | 筛选、导出、移动端体验 |
| P2 | 为未来履约摘要和 Shipment Tab 预留位置 |

---

## 1. 当前仓库基线与现有能力

### 1.1 主要文件

```text
apps/admin/src/app/[locale]/(admin)/orders/page.tsx
apps/admin/src/lib/quotation-order-api.ts
apps/admin/src/lib/commercial-documents-api.ts
apps/admin/src/lib/admin-api.ts
apps/api/src/modules/quotation-export/quotation-order.controller.ts
apps/api/src/modules/quotation-export/quotation-order.service.ts
apps/api/src/modules/commercial-documents/commercial-documents.controller.ts
apps/api/src/modules/commercial-documents/commercial-documents.service.ts
database/prisma/schema.prisma
```

### 1.2 已有能力，必须复用

当前订单页面和关联实现已经具备：

- 订单列表、分页。
- 关键词、状态、币种、国家、日期范围筛选。
- 是否存在 PI、是否存在 CI 筛选。
- Excel 模板选择和订单 Excel 导出入口。
- 订单详情 Drawer。
- Overview、Customer、Items、Charges、Documents、Audit 六个 Tab。
- Buyer、Consignee、Trade/Reference 等客户快照修正。
- 独立的 Customer 主档同步操作。
- 订单 version 乐观锁；版本冲突返回 HTTP 409。
- 从订单预填并创建 PI/CI 草稿。
- Commercial Document 的预览、渲染、签发、修订和下载能力。

已有 API Client 方法包括订单列表、详情、客户快照更新、客户主档同步、PI/CI prefill 和 createFromOrder 等。编码前必须阅读其真实类型和请求实现，不能创建重复 Client。

### 1.3 已知优化点

| 区域 | 优化方向 |
|---|---|
| 列表 | 客户识别信息不足时，增加公司名、联系人、国家；只使用订单快照 |
| 筛选 | 将常用筛选与高级筛选分组，增加已选条件 chips 和清空 |
| 操作区 | 将 Excel 模板选择与导出归入明确的导出操作组 |
| 状态 | Order 状态与 PI/CI 状态分开呈现 |
| Drawer | Overview 作为摘要入口，其他 Tab 提供详细信息 |
| Customer | 分组编辑、变更摘要、409 冲突恢复、主档同步二次确认 |
| Items | 清晰展示历史商品快照；本期只读 |
| Charges | 展示费用构成及币种；金额以服务端快照为准 |
| Documents | 明确编号、revision、状态、PDF 生成情况和可执行操作 |
| Audit | 转为业务人员可读的操作时间线，隐藏敏感 metadata |
| 状态反馈 | 完整覆盖 Loading、Empty、Error、权限不足、冲突、渲染失败 |

这些是优化方向，不表示某字段一定缺失。实施前需再次检查当前 main 的页面 JSX、列表响应、详情类型和后端查询。任何 UI 字段都必须能指出真实数据来源。

---

## 2. 页面总体信息架构

### 2.1 页面布局

```text
PageHeader
  标题：订单管理 / Orders
  描述：管理订单资料、交易金额和商业单据
  操作：刷新、导出

Order Summary（仅当 API 提供可靠聚合数据）
  订单总数 | 已确认 | 已取消 | 有 PI | 有 CI

Search & Filters
  关键词 | 订单状态 | 日期范围
  高级筛选：币种 | 国家 | PI | CI
  已选条件 chips | 清空筛选

Orders Table
  订单编号 | 客户/国家 | 日期 | 状态
  商品摘要（有真实数据时）| 金额
  PI 状态 | CI 状态 | 行操作

Pagination

Order Detail Drawer
  Header：订单号、状态、客户、金额、操作
  Summary Strip：商品行数、数量/箱数（字段语义确认后）、PI/CI
  Tabs：Overview / Customer / Items / Charges / Documents / Audit
```

### 2.2 响应式要求

- 桌面：完整表格，Drawer 从右侧打开。
- 平板：高级筛选折叠，保留订单号、客户、状态、金额等核心列。
- 手机：采用订单卡片，不强行挤压完整表格；筛选放入折叠面板或弹层。
- 不允许整页横向滚动；只有明细表格在确有需要时允许内部横向滚动。
- 窄屏 Drawer 应使用项目现有 UI 组件能力转为全屏或近全屏详情。

---

## 3. 订单列表规范

### 3.1 推荐列

| 列 | 内容 | 约束 |
|---|---|---|
| 订单编号 | orderNo，支持复制 | 点击打开详情 |
| 客户 | 买方公司名、联系人 | 取 Order 快照 |
| 国家/地区 | buyerCountryCode 或快照国家 | 单独展示 |
| 订单日期 | orderDate | locale 格式化 |
| 订单状态 | CONFIRMED / CANCELLED | 仅来自 Order.status |
| 商品 | 商品行数/SKU 数 | 后端提供后才显示 |
| 数量/包装 | 总件数、箱数 | 先确认字段语义 |
| 金额 | 总额及币种 | 如 USD 1,250.00 |
| PI | 当前有效版本状态 | 来自 CommercialDocument |
| CI | 当前有效版本状态 | 与 PI 独立 |
| 操作 | 查看、导出等 | 按权限展示 |

空间不足时优先隐藏商品摘要和数量/包装，不隐藏订单号、客户、状态和金额。

### 3.2 客户信息展示

- 第一行公司名，第二行联系人。
- 国家/地区独立展示。
- 列表不显示电话、邮箱、税号和完整地址。
- 不从 Customer 实时主档覆盖历史订单客户快照。
- 空值使用统一占位符，不显示 undefined/null。

### 3.3 金额展示

- 使用订单快照中的金额。
- 必须显示币种代码。
- 不将 CNY 与外币混为一个无法辨认的数值。
- 若同时显示两种币种，主金额突出，次金额弱化。
- 复用现有金额 formatter；不得在页面创建另一套精度和舍入规则。
- 空金额显示 —，不能显示 NaN 或伪造 0。

### 3.4 PI/CI 状态

建议显示：未创建、Draft、Review、Issued、Superseded、Cancelled。

- PI 与 CI 分开显示。
- 多 revision 时默认显示后端确定的当前有效版本，并展示 revision 标识。
- 历史版本在详情中可查看。
- 不得仅按 createdAt 最大值推断当前有效版本。
- 如果 API 未返回可靠的当前版本标识，先显示单据详情入口，不在前端猜测。

### 3.5 筛选

保留当前 q、status、currency、country、from/to、hasPi、hasCi：

1. 默认展示关键词、状态、日期。
2. 币种、国家、PI、CI 放高级筛选。
3. 显示已选条件 chips，可逐项清除。
4. 清空筛选后回到第一页。
5. 任一筛选条件变化后 page 重置为 1。
6. 搜索支持 Enter；若即时搜索，必须使用现有 debounce 方案，防止请求风暴。
7. 筛选失败保留用户输入。
8. URL query 同步遵循项目现有路由约定。

### 3.6 列表状态

必须实现：

- 首次加载 Loading/Skeleton。
- 刷新时保留旧列表并显示局部加载反馈。
- 无订单 Empty State，并按权限提供报价计算器入口。
- 筛选无结果 Empty State，提供清空筛选。
- API Error State，支持重试并显示 requestId（若有）。
- Permission Denied。
- 导出进行中状态，防止重复点击。

### 3.7 Excel 导出

现有模板选择和导出必须保留：

- 模板选择和导出按钮放在列表工具栏的导出操作组。
- 未选模板时禁用导出并显示原因。
- 按真实导出权限显示按钮。
- 如果后端只支持单条导出，不得展示虚假的批量导出。
- 导出中显示当前订单和忙碌状态。
- 失败后允许重试。
- 不修改 Excel 计算和模板映射逻辑。

---

## 4. 订单详情 Drawer

### 4.1 Header

固定展示订单编号、Order 状态、买方公司、订单日期、主币种和总额。按权限提供编辑客户资料、创建 PI、创建 CI、Excel 导出、刷新详情等操作。

不得显示当前没有 API 支持的取消订单或商品编辑按钮。

### 4.2 Summary Strip

建议展示商品行数、商品总件数、总箱数、订单金额、PI 状态、CI 状态。数量/箱数必须来自真实订单快照或后端汇总；字段语义不明确时不展示。

### 4.3 Overview

按区块展示：

1. 订单摘要：订单号、日期、创建时间、状态、创建人。
2. 客户摘要：买方、联系人、国家、账单地址摘要。
3. 收货摘要：收货人、国家、地址摘要。
4. 贸易条款：Incoterm、Named Place、付款条款、Buyer Reference、Contract No.
5. 金额摘要：币种、汇率、商品小计、运费、配送费、其他费用、总额。
6. 商业单据：PI/CI 状态、编号和最近操作。
7. 最近活动：最近审计动作，链接到 Audit。

Overview 只做摘要；详细编辑在对应 Tab 内完成。

### 4.4 Customer

分组：Buyer、Billing Address、Consignee、Shipping Address、Notify Party（数据模型支持时）、Trade & References。

编辑规则：

1. 初始值必须来自 Order 快照，而不是 Customer 主档。
2. 保存携带当前 Order.version。
3. 保存前展示修改摘要。
4. HTTP 409 时保留用户输入，提示刷新并比较，不静默覆盖。
5. 成功后用服务端返回的最新 OrderDetail 更新页面。
6. Customer 主档同步是独立显式操作，默认不勾选。
7. 同步操作二次确认，说明会影响客户主档，可能影响后续订单。
8. 若订单快照保存成功、Customer 同步失败，应分别提示两步结果，不得误报整体保存失败。
9. 不在审计摘要、错误日志中输出电话、邮箱、税号和完整地址。

### 4.5 Items

本期只读展示订单快照：

| 字段 | 来源 |
|---|---|
| SKU、商品名称 | OrderItem 快照 |
| 商品图片 | 快照图片且 URL 可用时 |
| 每箱数量 | unitsPerCarton 快照 |
| 箱数 | cartonCount 快照 |
| 订购数量 | OrderItem.quantity |
| 销售单价、行金额 | OrderItem 金额快照 |
| HS Code、原产国 | OrderItem 出口属性快照 |
| 箱规、重量、CBM | OrderItem 包装快照 |

规则：

- 不从 Product 当前主档覆盖历史订单。
- 不显示内部成本、markup，除非已有明确权限且 DTO 支持。
- 金额、数量以服务端详情为准。
- 表格底部合计必须遵循服务端订单金额口径。
- 本期不允许编辑商品、数量和价格。

### 4.6 Charges

以费用明细展示费用类型、名称、说明、金额、币种和是否计入订单总额（模型支持时）。底部展示商品小计、运费、配送费、其他费用和订单总额。

- 金额必须来自订单费用快照。
- 前端不重新计算或覆盖订单总额。
- 如果 API 未返回完整费用，不要用多个请求拼出可能不一致的快照；应评估扩展详情 DTO。

### 4.7 Documents

PI 和 CI 分区显示：类型、编号、revision、状态、模板版本、创建时间、签发时间、PDF 是否生成、当前版本标识。

| 状态 | UI 操作 |
|---|---|
| DRAFT | 编辑、预览、渲染、审核操作（以真实 API/权限为准） |
| REVIEW | 预览及审核操作（后端支持时） |
| ISSUED | 查看、下载、创建修订 |
| SUPERSEDED | 查看历史、下载历史 PDF |
| CANCELLED | 查看历史、下载（按现有策略） |

规则：

- 操作按后端状态和权限展示。
- 已签发版本只读。
- 新修订草稿尚未签发时，旧签发版本仍应保持有效。
- 创建 PI/CI 继续使用订单预填。
- 有现有逻辑单据系列时，UI 不应诱导用户重复创建不同编号系列。

### 4.8 Audit

采用时间线或表格，展示时间、操作人、动作、对象、结果、简要变更摘要。Request ID 放在可展开区域。

禁止直接渲染全部 metadata JSON，避免泄漏客户敏感数据、内部成本或其他非业务信息。

---

## 5. 编辑能力边界

### 5.1 本期可编辑

继续使用现有 customer-snapshot API 支持的字段：Buyer、Consignee、Trade Snapshot、Buyer Reference、Contract No.、Named Place、Payment Terms，以及当前接口明确支持的其他快照字段。

### 5.2 本期只读

OrderItem 商品/SKU 快照、订购数量、销售单价、商品金额、OrderFee 金额、币种、汇率、计算快照和包装快照均只读。

原因：当前审查确认客户快照更新接口存在，但未确认通用商品、价格、费用编辑 API 已实现。UI 不得先于后端暴露写操作。

### 5.3 后续扩展入口

未来增加订单变更时，应独立实现：

- 变更原因必填。
- Order.version 乐观锁。
- 变更前后差异。
- PI/CI 已签发时修订提醒。
- 已发货数量保护。
- OrderAmendment 和 AuditLog 记录。

本期没有对应 API 时，不显示静态“变更历史”数据。

---

## 6. 权限、错误和安全

继续使用 `useSession().can()` 和后端 `@RequirePermissions`。需核对现有权限码并复用：

- `order.read`
- `order.customer_snapshot.update`
- `order.customer_profile.sync`
- `customer.update`
- `commercial_document.create`
- Commercial Document read/update/preview/issue/revision/download 权限
- 现有 Excel 导出权限（以真实 seed 为准）

按钮隐藏只改善体验，API 必须独立授权。

错误处理：

| 错误 | UI 行为 |
|---|---|
| 401 | 交由统一 adminApi/session 机制 |
| 403 | 无权限提示，不自动重试 |
| 404 | 订单/单据不存在，返回列表 |
| 409 | 保留编辑内容，提示刷新和比较 |
| 400 | 显示字段级错误 |
| 429 | 提示稍后重试 |
| 5xx/网络 | 保留表单，显示 requestId 并可重试 |
| PDF 渲染失败 | 显示后端状态和错误，允许按权限重试 |
| 下载失败 | 不改变单据状态，允许重新下载 |

防误操作：

- Customer 主档同步需二次确认。
- 保存前展示变更摘要。
- 提交期间禁用重复提交。
- 关键状态以服务端返回更新，不做未经确认的乐观修改。
- 关闭有未保存内容的 Drawer/表单时提示确认。
- 切换订单时清理上一个订单的编辑状态，防止串单。

---

## 7. 前端文件组织

### 7.1 本期优先修改

| 文件 | 动作 |
|---|---|
| `apps/admin/src/app/[locale]/(admin)/orders/page.tsx` | 列表、筛选、Drawer 编排；适时拆组件 |
| `apps/admin/src/lib/commercial-documents-api.ts` | 核实订单列表/详情类型，按需兼容扩展 |
| `apps/admin/src/lib/quotation-order-api.ts` | 复用 Excel 模板和导出 API |
| 现有 Admin i18n 资源 | 增加中英文订单文案 |
| 现有订单页面测试 | 修改或新增列表、Drawer、权限和错误测试 |

### 7.2 候选组件

先检查项目现有 components/features 组织约定，再决定是否采用：

```text
apps/admin/src/components/orders/
  order-list-toolbar.tsx
  order-filters.tsx
  order-table.tsx
  order-mobile-card.tsx
  order-status-badge.tsx
  order-document-status.tsx
  order-detail-drawer.tsx
  order-summary-strip.tsx
  order-overview-tab.tsx
  order-customer-tab.tsx
  order-items-tab.tsx
  order-charges-tab.tsx
  order-documents-tab.tsx
  order-audit-tab.tsx
```

Page 管理路由级状态、列表请求、分页和 Drawer 生命周期；展示组件不重复发请求；API Client 统一处理请求和类型；格式化和标签复用项目工具。

---

## 8. 分阶段实施计划

### 阶段 A：代码复核，不改代码

1. 阅读完整 orders/page.tsx。
2. 阅读 OrderListRow、OrderDetail 类型。
3. 阅读列表 API 的 Service 查询和返回字段。
4. 检查 `@b2b/ui` 的 Table、Drawer、Tabs、Badge、Pagination、Empty State。
5. 检查 i18n 资源和测试目录。
6. 输出字段来源表、组件拆分和 API 差异清单。

验收：每个拟展示字段都有真实数据来源，不存在前端猜测。

### 阶段 B：订单列表优化

交付：客户列、国家、订单日期、状态、金额/币种、PI/CI 状态、高级筛选、筛选 chips、清空、Loading/Empty/Error、移动卡片；保留分页和 Excel 导出。

验收：
- 所有现有筛选有效。
- 筛选变化重置页码。
- 列表金额与详情一致。
- 不泄漏联系方式等敏感信息。
- 360px、768px、桌面宽度无整页横向溢出。

### 阶段 C：Overview 和 Customer 优化

交付：详情 Header、Summary Strip、Overview 分区、客户表单分组、变更摘要、409 恢复、Customer 主档同步确认和独立结果提示。

验收：
- 客户快照更新仍走现有 API。
- 409 不丢失输入。
- 主档同步失败不误报快照更新失败。
- Customer 主档变化不影响历史订单快照。

### 阶段 D：Items、Charges、Documents、Audit

交付：商品快照表、费用明细、PI/CI 状态及 revision、Audit 时间线、PDF 状态反馈。

验收：
- 不出现未实现编辑按钮。
- 不覆盖历史快照。
- 不改变金额计算。
- 已签发单据只读。
- 不泄漏 Audit metadata 敏感信息。

### 阶段 E：回归

从根目录和 apps/admin 的 package.json 核实真实脚本，再运行 lint、typecheck、test、build。未执行的测试不得标记为通过。

回归报价、订单列表/详情、客户快照编辑、Customer 同步、Excel 导出、PI/CI 创建/预览/渲染/签发/修订/下载、RBAC、中英文和移动端布局。

---

## 9. 测试用例

### 9.1 列表

- 默认加载、关键词、状态、币种、国家、日期、hasPi/hasCi。
- 多筛选组合、清空筛选、无结果。
- 分页、pageSize、刷新、请求失败重试。
- 搜索不会产生请求风暴。
- 导出权限、未选择模板、导出中、导出失败。

### 9.2 详情

- 正常打开、详情加载失败、切换订单不串数据。
- 六个 Tab 正常切换。
- 关闭 Drawer、未保存内容确认。
- 长地址、长商品名称、金额格式和空字段。

### 9.3 客户编辑

- 正常保存、必填校验、409、无权限。
- 保存后刷新详情和列表。
- 不同步 Customer 主档。
- 同步成功。
- 同步失败但订单快照已保存。
- 请求超时保留输入。

### 9.4 单据与安全

- 无 PI/CI、只有 PI、只有 CI、两者都有。
- DRAFT、REVIEW、ISSUED、SUPERSEDED、CANCELLED。
- PDF 未生成、生成失败、历史 revision 下载、无权限下载。
- 键盘可操作，表单 label 关联输入。
- 状态不只依赖颜色。
- 中英文文案完整。

---

## 10. API 与数据库兼容

1. 优先使用现有接口完成 UI 优化。
2. 若列表缺少客户名称、PI/CI 汇总等关键字段，才扩展：
   - `quotation-order.controller.ts`
   - `quotation-order.service.ts`
   - `commercial-documents.controller.ts`
   - `commercial-documents.service.ts`
   - 对应 validation schema 和类型。
3. 接口扩展优先新增可选字段，保持向后兼容。
4. 若数据能从现有 Order/CommercialDocument 关系查询得到，不需要新增 Prisma Model 或迁移。
5. 不为 UI 方便增加冗余业务字段。
6. Order 状态只来自 Order.status；PI/CI 状态来自 CommercialDocument.status。
7. 不得在没有 Shipment 数据时显示虚构的发货/签收状态。

---

## 11. 性能与可维护性

- 列表必须分页，不能一次加载所有订单。
- PI/CI 状态应由服务端聚合返回，避免前端 N+1 请求。
- Drawer 按需加载详情。
- 切换订单时取消或忽略过期请求。
- 刷新列表保留旧数据，减少闪烁。
- 页面复杂度增长后拆分组件，不继续堆积在单个超大页面。
- 拆分不能导致重复请求、重复状态或表单不同步。
- 优先使用 `@b2b/ui`，不引入新的 UI 框架或表格库。

---

## 12. VS Code AI 单阶段执行提示词

每次只执行一个阶段：

```text
你正在维护 NotFeel/b2b-inquiry-platform 的现有订单管理页面。

先完整阅读：
- docs/39-admin-quotation-calculator-and-order-center.md
- docs/41-commercial-invoice-order-documents.md
- docs/42-commercial-documents-implementation.md
- docs/43-order-management-page-optimization.md
- apps/admin/src/app/[locale]/(admin)/orders/page.tsx
- apps/admin/src/lib/quotation-order-api.ts
- apps/admin/src/lib/commercial-documents-api.ts
- 对应 API Controller、Service、Prisma Schema 和测试。

严格要求：
1. 不创建第二套订单系统。
2. 复用现有 API、类型、UI、RBAC、i18n 和格式化工具。
3. 不猜测 API 字段，不使用假数据。
4. 不修改金额计算逻辑，不覆盖历史订单快照。
5. 本期商品、数量、价格和费用保持只读。
6. 客户快照编辑继续使用 version 乐观锁。
7. PI/CI 状态来自 CommercialDocument，不混入 Order.status。
8. 不实现 Shipment/Package/Delivery。
9. 未经明确授权不得部署、提交或推送代码。

开始前输出：当前代码状态、修改/新增文件、API/i18n 影响、测试计划。
完成后输出：文件变更、UI 行为、测试命令及真实结果、未完成事项、风险和回滚方式。

当前阶段：<填写阶段 B/C/D 的具体范围>。
不得超出当前阶段范围。
```

---

## 13. Definition of Done

- 订单列表更容易识别客户、状态、金额和单据。
- 原有筛选、分页和 Excel 导出继续有效。
- 订单详情六个 Tab 均保留。
- 客户快照编辑保留 version 冲突保护。
- Items/Charges 展示准确且只读边界清晰。
- PI/CI 状态与操作符合真实生命周期。
- Audit 不泄漏敏感数据。
- 桌面、平板、手机均可用。
- 中英文完整。
- 无未实现按钮、虚构数据或前端伪造状态。
- Admin lint、typecheck、test、build 通过；未执行检查如实标注。
- 报价、订单和 PI/CI 原流程回归通过。
- 未经授权不执行生产迁移和部署。

**DOC-43 只规范订单管理页面体验和现有功能补齐，不代表商品/价格/费用编辑、订单变更历史或物流履约已实现。**

---

## 14. 阶段 A 复核结论与阶段 B 实施记录

> 实施日期：2026-11-07
>
> 范围：仅阶段 A（只读复核）与阶段 B（订单列表优化）。阶段 C/D/E 未在本轮实施。

### 14.1 阶段 A：字段真实来源

| 列表字段 | 当前前端来源 | 服务端来源 | 结论 |
|---|---|---|---|
| Order No. | `OrderListRow.orderNo` | `orders.orderNo` | 可展示；点击打开详情，支持复制 |
| Customer / Contact | `buyer.companyName` / `buyer.contactName` | `Order.buyerSnapshot`；旧订单回退 `customerSnapshot` / 结构化 buyer 列 | 来自订单快照，不读 Customer 实时主档 |
| Country | `buyer.countryCode` | 同上 | 可展示，不展示电话/邮箱/税号/完整地址 |
| Order Date | `orderDate` | `orders.orderDate`（date） | 前端按 locale + UTC 格式化，避免日期偏移 |
| Order Status | `status` | `orders.status`（`OrderStatus`） | 仅展示 CONFIRMED/CANCELLED |
| Items summary | `itemSummary` | `order_items` 按 `orderId` 聚合行数、`quantity`、`cartonCount` | 真实订单快照；语义为“行数 / 订购件数 / 箱数” |
| Amount | `totalAmountForeign`、`totalAmountCny`、`currencyCode` | `orders` 金额快照 | 主金额为订单币种，CNY 为弱化参考；不在前端重算 |
| PI / CI | `documents.pi` / `documents.ci` | `commercial_documents` 按订单和类型聚合，服务端选择当前版本 | 类型、编号、revision、状态、PDF 是否生成均来自单据记录 |
| Actions | 前端权限 | `order.read`、`commercial_document.create`、Excel 模板读取权限 | 无权限不渲染对应按钮；API 仍独立校验 |
| Updated At | `updatedAt` | `orders.updatedAt` | 已返回，本期列表未作为独立列展示 |

字段复核补充：

1. 订单状态与单据状态是两个独立事实来源，列表未混用。
2. `OrderItem.quantity` 是订单快照中的订购总件数，`cartonCount` 是箱数；列表聚合不使用 Product 当前包装字段。
3. 列表不展示内部成本、markup、电话、邮箱、税号或完整地址。
4. 详情 Drawer、客户快照修正、PI/CI prefill 与创建继续复用既有 API Client，没有新增第二套客户端。

### 14.2 阶段 A 发现的 API 差异及处理

| 差异 | 处理 |
|---|---|
| 列表只有 `documents.piCount/ciCount/latest`，无法可靠区分 PI 与 CI 当前版本 | 服务端新增 `documents.pi` / `documents.ci`。同一 `documentNo` 系列内按最高 revision 选择；不同系列之间按最新 revision 创建时间选择。前端不自行推断 |
| 列表缺少商品行数、总件数、总箱数 | 服务端用一次 `orderItem.groupBy` 聚合，避免 N+1；新增 `itemSummary` |
| 列表未返回 `updatedAt` | `orderDto` 增加 `updatedAt`（向后兼容可选字段） |
| 详情类型已有 `documents`、`buyer`、`trade` 等字段 | 未改动详情接口结构 |
| 没有订单统计聚合 API | 本期不展示虚构的 Summary Strip 数字 |
| 没有商品/价格/费用编辑 API | Items、Charges 保持只读；本期未新增编辑按钮 |

本轮未新增 Prisma Model 或数据库迁移，仅扩展列表响应字段。

### 14.3 阶段 B：已实施内容

新增/修改文件：

- `apps/admin/src/components/orders/order-list-view.tsx`：列表工具栏、桌面表格、移动卡片、空/错/加载状态、单据状态单元格。
- `apps/admin/src/lib/order-list.ts`：URL 筛选、筛选 chips、清空、金额/日期/数量格式化、状态 tone/label。
- `apps/admin/src/lib/order-list.spec.ts`：筛选、URL 解析、格式化、状态映射单元测试。
- `apps/admin/src/app/[locale]/(admin)/orders/page.tsx`：列表请求编排、debounce、URL 同步、过期请求忽略、权限门禁、模板/导出状态。
- `apps/admin/src/app/globals.css`：订单工具条、chips、金额/单据单元格、移动卡片样式。
- `apps/admin/src/lib/commercial-documents-api.ts`：补充列表类型。
- `apps/api/src/modules/quotation-export/quotation-order.service.ts`：列表单据当前版本与商品聚合。
- `apps/admin/src/messages/{en-US,zh-CN}.json`：订单列表中英文文案。
- `apps/api/src/modules/quotation-export/quotation-order.service.spec.ts`：列表聚合单元测试。

列表行为：

1. 常用筛选（关键词、状态、日期）与高级筛选（币种、国家、有 PI、有 CI）分组；高级筛选可折叠。
2. 已选筛选以 chips 展示，支持逐项移除和一键清空；清空后回到第 1 页。
3. 关键词输入 350ms debounce；Enter 可立即提交；筛选写入 URL query，刷新/分享/前进后退可恢复。
4. 首次加载显示 Skeleton；刷新时保留旧列表并显示局部刷新提示；过期请求不会覆盖新结果。
5. 首次失败显示 ErrorState + requestId + 重试；筛选无结果显示清空筛选；无订单时按权限提供报价计算器入口。
6. 无 `order.read` 时不发请求，显示权限不足提示。
7. 桌面/平板使用表格，移动端（<768px）使用订单卡片；页面本身不依赖固定宽度。
8. 订单号支持复制；客户列显示公司/联系人，国家独立展示；不展示电话、邮箱、税号、完整地址。
9. 金额显示订单币种代码和两位小数，CNY 作为弱化参考；无金额显示 `—`。
10. PI、CI 分别显示当前编号、revision、状态和 PDF 可用性；点击进入商业单据编辑器。
11. Excel 模板选择归入导出操作组；每个订单行提供导出按钮；未选择模板时禁用并说明原因。

### 14.4 本轮验证

已执行：

- `pnpm --filter @b2b/admin run typecheck`：通过。
- `pnpm --filter @b2b/api run typecheck`：通过。
- `pnpm --filter @b2b/admin test`：193 项通过（含新增 `order-list.spec.ts`）。
- `pnpm --filter @b2b/api test`：421/424 通过；新增列表聚合测试通过；既有 3 项真实模板夹具测试仍失败（与 DOC-43 无关）。
- `pnpm run lint`：通过。
- `pnpm --filter @b2b/admin run build`（带本地 API 代理变量）：通过。
- 使用真实 Prisma Client 调用 `listOrders` 验证：返回 `itemSummary`、`documents.pi`、`documents.ci`，订单金额与单据金额来自数据库快照。

未执行：

- 浏览器 360px/768px/桌面实机截图回归（沙箱环境未建立登录后的浏览器会话）。
- 阶段 C（Overview/Customer 重构）、阶段 D（Items/Charges/Documents/Audit 深度优化）、阶段 E 全链路回归。
- Shipment/物流履约相关能力按规范未实现。

### 14.5 回滚

- 仅回退本轮 Admin 页面/组件/文案和 API 列表查询扩展即可。
- 无数据库迁移，无业务数据写入，无需数据回滚。
- 历史订单、金额、商品/费用/包装快照和已签发单据均未被修改。
