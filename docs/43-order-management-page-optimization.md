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

## 11. 二次整改补充规范（DOC-43-R2，2026-11-07）

> 本节是对 DOC-43 原要求的补充和优先级修订。原文继续有效；如与本节冲突，以本节为准。此次补充基于 main 当前代码、运行中的后台页面文本和用户提供的页面截图。它是 AI 可执行实施要求，不代表已完成代码修改。

### 11.1 本轮复核发现与必须修正的问题

| 页面/位置 | 当前可观察情况 | 整改要求 |
|---|---|---|
| 订单列表筛选 | 币种、国家是普通文本输入框，无法浏览合法选项，也容易输入无效代码 | 改为数据库驱动的可搜索选择器；支持完整选项、清空、键盘操作 |
| 订单详情 Drawer | 当前约占屏幕右侧约三分之一；商品明细表格出现左侧列被遮挡/横向内容不可读 | 桌面默认加宽，允许拖动调整宽度和一键最大化；内容区独立滚动 |
| 商品明细 | 截图表头出现字面量 `金额（{{currency}}）`；表格列过宽，用户无法同时查看关键字段 | 修复未插值模板字符串；表头使用稳定文案“金额 / Amount”，每行显示币种代码；窄屏表格内部横向滚动 |
| 客户资料修正 | Buyer 与 Consignee 字段纵向重复较多；买方公司、邮编等空值在截图中不够醒目 | 分成买方主体、账单地址、收货人、收货地址、贸易与参考信息；缺失值有明确提示；避免把两个地址对象混为一套 |
| 电话 | 同一订单的电话在详情与编辑界面格式不一致 | 存储/接口统一 E.164；展示格式化不得改变原始值，复制时提供 E.164 |
| 报价计算器 | 国家代码是自由文本；币种为字典 Select；合同编号仍是可编辑 Input | 国家改为数据库国家选项；合同编号改为系统生成、只读展示，创建订单时由 API 最终生成 |
| 报价计算器布局 | 客户、贸易、地址字段集中在长表单中，必填条件和“报价草稿/正式订单”区别不够明显 | 增加分区导航/锚点或清晰分组、必填标记、创建订单校验摘要；不得为了缩短页面隐藏关键必填项 |

**重要：** 截图中看不到的功能不能直接判断为不存在。实施前应复核实际组件和接口；但上述截图中明确可见的问题必须逐项关闭。

### 11.2 国家与币种：统一数据库选项组件

#### 目标行为

1. 订单列表“币种”筛选：单选、可搜索、可清空，选项覆盖数据库中所有启用币种。
2. 订单列表“国家”筛选：单选、可搜索、可清空，选项覆盖数据库中所有启用国家/地区。
3. 报价计算器“币种”：继续使用现有 `quotation-calculator/config` 的 `currencies`，不另造前端币种常量。
4. 报价计算器国家、账单国家、收货国家：使用同一国家数据源和同一 CountrySelect/Combobox 交互。
5. 订单客户资料编辑的 Buyer、Consignee 国家字段也必须复用同一组件。
6. 所有选项都显示本地化名称和 ISO 代码，例如“United States (US)”/“美国 (US)”；提交和筛选参数使用标准代码。
7. 支持输入代码或名称搜索；支持键盘上下选择、Enter 确认、Escape 关闭、Backspace 清空；移动端可正常触控。
8. 初始加载、加载失败、无匹配项均有明确状态；加载失败不能悄悄退化为任意文本输入。

#### 数据源实施规则

- 币种优先复用 `DICTIONARY_TYPES.currency` 与 `dictionaryItem`，该数据已由 `QuotationOrderService.config(locale)` 查询启用项并返回 `currencies`。
- 国家必须来自后端可维护的数据库参考数据。先检查 `database/prisma/schema.prisma`、`database/prisma/seed.ts`、`apps/api/src/common/services/geo.service.ts` 及现有国家/地区字典；若已有国家表/字典，直接复用。
- 若仓库当前没有完整、可维护的国家数据表/字典，新增受版本控制的国家参考数据（建议沿用现有 DictionaryType/DictionaryItem 架构，类型代码统一为 `country`，数据按 ISO-3166-1 alpha-2，必要时支持地区扩展）。通过 reference-only seed 同步，不允许前端硬编码国家数组。
- 新增只读配置接口建议：`GET /admin/reference-data/countries?locale=zh-CN`；如果已有等价接口则复用，不重复创建。响应至少包含 `code`、`name`、`label`、`enabled`，默认仅返回 enabled 项，完整返回所有启用项，不分页截断。
- 币种若订单模块需要独立接口，可新增 `GET /admin/reference-data/currencies?locale=...`，但必须复用同一数据库字典；优先考虑合并为 reference-data 配置接口，避免多个页面各自请求。
- 选项 API 必须经过现有认证与权限体系；读取选项所需权限应与可进入对应业务页面的权限一致，禁止匿名暴露后台字典管理数据。
- 国家/币种筛选必须校验服务端代码是否存在且启用；无效代码返回 400 字段错误，不可把任意输入静默当作合法筛选。
- 不要将“所有国家”错误地理解为所有历史订单中出现过的国家；选择器数据应为完整启用参考数据，订单查询结果仍只返回匹配订单。
- 对历史订单中已停用但曾使用的国家/币种，详情仍按快照原值显示；筛选选项是否包含停用项由产品规则决定，默认不把停用项作为新筛选条件，但不得破坏历史数据读取。

#### 建议复用/新增文件

| 路径 | 动作 |
|---|---|
| `apps/admin/src/lib/quotation-order-api.ts` | 复用现有币种配置类型；避免复制币种数组 |
| `apps/admin/src/lib/commercial-documents-api.ts` | 按现有 API Client 约定增加/复用参考数据方法 |
| `apps/admin/src/components/` 下现有 Select/Combobox | 先查找并复用 |
| `apps/admin/src/components/reference-data/country-select.tsx` | 若无可复用组件，新增统一国家选择器 |
| `apps/api/src/reference-data-startup.ts`、`database/prisma/seed.ts` | 复用启动时 reference-only seed 同步机制 |
| `packages/contracts` 或现有 dictionary 常量文件 | 复用/定义 country 类型代码，避免魔法字符串散落 |

### 11.3 订单详情 Drawer：可拖动、加宽、最大化

#### 桌面端规格

- 默认宽度建议为视口宽度的 68%（目标 900–1100px）；最小 680px，最大 92vw。若视口不足以满足最小宽度，自动使用 94vw。
- Drawer 顶部标题栏、Tab 导航和底部主要操作区固定；中间详情内容单独滚动。
- 提供可见拖动把手/分隔线，拖动时实时调整宽度；鼠标和触控均支持。
- 提供“最大化/恢复”按钮。最大化宽度为 96vw，不遮挡浏览器可视区域；保留关闭按钮。
- 支持键盘调整：焦点落在拖动分隔线上时，Left/Right 每次调整 24px，Shift+方向键每次 64px；Home 恢复默认宽度，End 最大化。设置正确的 `role="separator"`、`aria-orientation="vertical"`、`aria-valuenow/min/max` 和可访问名称。
- 拖动期间禁止文本误选；鼠标/触控结束、组件卸载时清理监听。
- 默认宽度只在当前 Drawer 会话生效即可；如持久化，使用项目已有偏好机制，不引入 localStorage 之外的新状态服务。未经必要不保存用户行为数据。

#### 移动端

- 768px 以下直接使用全屏 Drawer/详情页，不显示拖动把手。
- 关闭按钮固定可见，Tab 可横向滚动且当前 Tab 自动可见。
- 底部操作按钮换行或采用固定操作栏，不允许按钮被视口裁切。

#### 内容排版

- Drawer 不允许自身出现“内容被裁掉但无法横向滚动”的情况。
- 商品明细、费用明细等宽表格使用 `overflow-x:auto` 的局部容器；首列可选 sticky，但不能遮挡其他列。
- 客户地址使用换行文本，长邮箱/编号允许断行；金额右对齐并始终显示币种。
- 修复截图中金额表头字面量 `{{currency}}`：不要把每行货币动态拼进表头；使用“金额 / Amount”，行单元格展示如 `69.12 USD`。
- Tab 数量徽标只显示真实数据；空值不显示虚假数量。
- 详情请求切换订单时必须防止旧请求覆盖新订单（AbortController 或请求序号）；切换时清理前一个订单的活动 Tab 状态和表单状态。

#### 组件实施约束

- 当前页面使用 `@b2b/ui` 的 `Drawer`，先检查 Drawer 是否支持 `width`、`size`、`className`、`style` 或自定义 header/content slot。
- 如果 Drawer 不支持受控宽度，优先扩展 `packages/ui` 的 Drawer API，而不是在业务页面复制一套 Drawer。
- 拖动逻辑封装为通用、可访问的 ResizableDrawer/ResizablePanel；不在 `orders/page.tsx` 内堆叠大量 pointer event。
- 不引入大型拖拽库；原生 Pointer Events 足够。拖动分隔线不能覆盖关闭按钮或 Tab 点击区域。

### 11.4 客户资料修正：按业务语义拆分

#### 表单结构

1. 买方主体（Buyer）：公司、联系人、电话、邮箱、税号、国家。
2. 账单地址（Billing Address）：收件人/公司、地址 1/2、城市、州/省、邮编、国家。
3. 收货人（Consignee）：公司、联系人、电话、邮箱、税号、国家。
4. 收货地址（Shipping Address）：收件人/公司、地址 1/2、城市、州/省、邮编、国家。
5. 贸易与参考信息：买方参考号、系统合同编号（只读）、贸易术语、指定地点、付款条件。
6. Notify Party 只有在现有 DTO/schema 支持时显示；没有则不显示空白假区块。

#### 交互与数据约束

- 买方与收货人可以通过“收货信息同买方”快捷操作复制字段，但复制后两份表单独立编辑；取消关联不应清空已有内容。
- 账单地址同收货地址是独立选项；勾选后复制当前值，之后的编辑行为要明确（实时同步或解除同步），不得出现 UI 勾选但 payload 不同步。
- 空值统一显示“未填写”，并可定位编辑；不要把空字符串伪装成已有资料。
- 保存前展示字段变更摘要（字段名 + 脱敏前后值；电话、邮箱、税号、完整地址不得写入审计 metadata）。
- 继续使用 `PATCH /admin/orders/:id/customer-snapshot`、当前 Order.version 乐观锁；不新建重复 API。
- 保存后服务端返回最新 OrderDetail，刷新 Drawer 和列表客户摘要；409 保留表单输入并提供“重新加载并对比”，不得直接覆盖用户输入。
- “同时更新客户主档”保持默认关闭；客户主档同步必须在快照保存成功后单独调用现有同步 API，失败时明确提示“订单修正已保存，客户主档同步失败”，并允许单独重试。
- 电话存储仍使用 E.164；UI 可格式化展示，编辑控件保留国家区号和完整号码，不因展示格式变化而改写原始值。

### 11.5 报价计算器：合同编号后端自动生成

#### 产品规则

- 合同编号是系统内部生成的业务编号，不再由管理员手工输入。
- 默认格式：`CT-YYYYMMDD-XXXXXX`，例如 `CT-20261107-A3F91C`。前缀通过环境配置 `ORDER_CONTRACT_NO_PREFIX` 管理，默认 `CT`；日期使用配置的业务时区（默认 `Asia/Shanghai`）；随机段为密码学安全随机字符，建议 6–8 位大写 Base32/Hex。
- 编号由后端生成，前端不得生成、拼接、覆盖或将空字符串当作最终编号。
- 生成时机：正式创建订单时生成；从报价草稿转换为订单时生成。仅保存报价草稿不占用合同编号，草稿界面显示“创建正式订单时自动生成”。
- 创建成功响应必须返回 `contractNo`，成功提示/订单详情展示实际编号。前端只读展示；正式创建订单前可以显示“系统自动生成”，不能预测展示一个尚未持久化的编号。
- 已存在的历史订单合同编号不得批量重写；历史空值保持空值，除非另行执行有审计的补号任务。

#### 后端实现要求

- 复核 `apps/api/src/modules/quotation-export/quotation-order.service.ts` 中 `createOrder`、`convertQuotation`、`customerSnapshot`、`tradeSnapshot` 和 `orderDto`。当前计算器 `CalculatorInput.contractNo` 与页面 `contractNo` 状态仍可编辑，创建订单路径将输入值写入 Order；必须统一改造两个正式订单创建入口。
- 新增独立 `generateContractNo(orderDate?)` 服务方法，使用 Node `crypto` 的安全随机源；不得复用前端 Math.random，也不得使用可预测的时间戳尾数。
- 在订单事务内将生成值写入 `Order.contractNo`、`tradeSnapshot.contractNo`、`customerSnapshot.contractNo`（如该快照仍承载此字段），并保证 PI/CI prefill 和导出读取同一个 Order.contractNo。不能只改前端 label。
- `convertQuotation` 必须从持久化报价快照读取客户和贸易信息，但忽略其中旧的/人工填写 contractNo，重新生成正式合同编号。
- 幂等请求重试必须返回第一次创建的相同编号；现有 Idempotency-Key 逻辑不可破坏。
- 防碰撞：为 `Order.contractNo` 建立非空唯一约束/唯一索引。迁移前检查历史重复值；采用 PostgreSQL partial unique index（仅对非 NULL）或等效 Prisma 可表达方案。冲突时重新生成并有限重试；不要吞掉非唯一约束错误。
- 合同编号生成和订单写入必须在同一事务语义内，避免生成后失败留下“已占用但无订单”的业务记录。
- 订单客户快照修正接口不能允许修改系统合同编号；其输入 schema、Service 更新逻辑需将 contractNo 从可编辑字段中移除或忽略客户端传入值。若商业单据需要修正合同号，必须另立明确的审计操作，不属于本次。
- 报价草稿可以保存合同编号字段的历史兼容值，但不得把它作为正式订单编号；创建/转换正式订单时由服务端覆盖。
- API DTO 和类型增加/确认 `contractNo: string | null`；正式新订单必须非空。错误码、国际化提示同步完善。

#### 前端实现要求

- `apps/admin/src/app/[locale]/(admin)/quotation-calculator/page.tsx`：删除可编辑的 contractNo state/Input；改成只读说明行，显示“系统自动生成（创建订单时分配）”。
- `apps/admin/src/lib/quotation-order-api.ts`：正式创建订单响应类型增加 `contractNo`；报价草稿响应不要求合同编号。
- `apps/admin/src/app/[locale]/(admin)/orders/page.tsx`：客户资料编辑表单移除 contractNo 输入；详情中只读显示订单正式合同编号。
- `apps/admin/src/components/orders/order-list-view.tsx`：不把合同编号加到列表列中，避免列表过宽；详情和 PI/CI 才展示。
- 中英文文案 `apps/admin/src/messages/zh-CN.json`、`en-US.json` 同步更新。
- 如果用户需要客户自己的 PO/Reference，继续使用独立的 Buyer Reference 字段；不得把 Buyer Reference 与系统合同编号混用。

### 11.6 报价计算器表单体验调整

- 将页面分为：客户与单据基本信息、贸易条款、账单地址、收货地址、商品明细、运费计算、其他费用、计算结果/操作。
- 页面顶部提供分区目录或锚点，滚动时可定位；不得强制做成多步向导，以免破坏当前一次性核算流程。
- “创建正式订单”与“保存报价草稿”必须在视觉和文案上区分；创建正式订单前展示必填字段检查结果，并说明创建后会产生订单号、合同编号。
- 货币选择器继续从 `config.currencies` 获取完整启用币种；币种变化时根据当前业务规则校验汇率，CNY 汇率固定为 1。
- 国家选择统一用 CountrySelect，客户国家、账单国家、收货国家不能只让用户输入两个字母代码。
- 日期控件显示格式跟随 locale；提交统一 ISO `YYYY-MM-DD`，不受浏览器语言影响。
- 主要操作区在长页面底部保持可见（sticky action bar），但不得遮挡最后一行费用/商品；小屏自动换行。
- 商品行较多时，商品明细区局部滚动或折叠；总金额与关键运费结果保持可见。
- 表单错误优先定位到字段并滚动到对应分区；保留用户已输入内容，不因单个字段校验失败重置整张表单。
- 页面不得将示例默认国家、汇率、日期误当成真实业务配置；默认值必须标识来源，特别是汇率需有录入人/日期或现有配置来源。

### 11.7 必须核查的真实仓库文件（R2）

以下为已确认存在的路径；编码前仍需查看文件当前内容，按需增量修改，不得整体重建：

| 文件 | 本轮动作 |
|---|---|
| `apps/admin/src/app/[locale]/(admin)/orders/page.tsx` | Drawer、客户资料编辑、详情状态和合同编号只读展示 |
| `apps/admin/src/components/orders/order-list-view.tsx` | 币种/国家筛选控件 props 与布局 |
| `apps/admin/src/lib/order-list.ts`、`order-list.spec.ts` | 筛选 query 序列化/校验及测试 |
| `apps/admin/src/lib/commercial-documents-api.ts` | OrderDetail、OrderListRow、Country/Reference API 类型 |
| `apps/admin/src/app/[locale]/(admin)/quotation-calculator/page.tsx` | 国家选择、合同编号只读、表单分区和操作区 |
| `apps/admin/src/lib/quotation-order-api.ts` | 复用币种 config，创建订单返回值类型 |
| `apps/admin/src/messages/zh-CN.json`、`en-US.json` | 双语文案 |
| `apps/api/src/modules/quotation-export/quotation-order.controller.ts` | 参考数据接口（仅当没有现成接口时） |
| `apps/api/src/modules/quotation-export/quotation-order.service.ts` | 国家选项查询、合同编号生成、创建/转换订单写入 |
| `packages/validation/src/quotation-order-schemas.spec.ts` | 合同编号输入移除/兼容策略、国家代码验证 |
| `database/prisma/schema.prisma` | Order.contractNo 约束及参考数据模型（仅按需） |
| `database/prisma/seed.ts`、reference-data seed | 国家参考数据同步 |
| `database/prisma/migrations/` | 非空合同编号唯一索引（迁移前检查重复） |
| `apps/api/src/modules/quotation-export/quotation-order.service.spec.ts` | 编号生成、幂等、并发碰撞、转换订单测试 |
| `apps/admin/src/lib/order-list.spec.ts` 及订单组件测试 | 选择器和筛选行为测试 |

### 11.8 组件复用清单与禁止重复建设

- 订单筛选、报价计算器、订单客户编辑统一复用项目 Select/Combobox、Field、Input、Button、Tabs、Drawer、Modal、Toast、Pagination。
- 货币选项复用 `QuotationOrderService.config()` 返回的字典，不新增第二套货币配置。
- 国家选项复用/补齐数据库参考数据；不得硬编码在页面组件、i18n JSON 或多个 API Client 中。
- 订单列表继续复用 `OrderListView`、`order-list.ts` 和现有查询参数，不新建第二套订单列表。
- 订单详情继续复用 `OrderDetail` DTO 与六个既有 Tab 的业务数据，不另造 Order 模型或重复 API。
- PI/CI 创建继续复用 `commercialDocumentsApi` 的 prefill/createFromOrder 工作流。
- 计算器继续复用 `quotationOrderApi.config/products/preview/saveDraft/createOrder`。
- 禁止因 Drawer 加宽而重写整个订单详情；只调整 Drawer 容器和内部表格布局。
- 禁止把数据库国家/币种选择改成远程第三方 API 依赖；后台选项应由本系统数据库提供。

### 11.9 实施顺序与验收门槛（R2）

**R2-0：基线核对**
- 确认 Doc43、Doc39–42、当前 main HEAD、订单列表和计算器代码。
- 盘点国家字典/参考数据是否完整，检查币种字典启用项数量。
- 检查 Drawer 组件 API、CSS 结构、详情 Tab、客户快照 schema 和所有合同编号写入路径。
- 输出“现状/改动/复用/不做”四列文件清单。

**R2-1：参考数据选择器**
- 币种/国家选择器覆盖所有启用数据；列表筛选、计算器、客户编辑使用同一组件。
- 选择、清空、搜索、键盘、移动端全部通过测试。
- 服务端筛选验证合法代码。

**R2-2：Drawer**
- 默认加宽、可拖动、最大化、键盘可访问。
- 六个 Tab 内容可完整查看；商品/费用表格只在内部横向滚动。
- 截图中的 `{{currency}}` 原样输出问题修复。

**R2-3：客户资料**
- 表单分组、空值提示、E.164 电话处理、快照与客户主档边界正确。
- 409 不丢输入；主档同步仍需单独确认。

**R2-4：合同编号**
- 正式订单 createOrder 与 convertQuotation 两条路径均后端生成唯一编号。
- 重试返回同一个编号；并发不重复；历史订单不被改写。
- 订单快照、PI/CI prefill、导出均读取相同合同编号。
- 计算器无可编辑合同编号控件。

**R2-5：计算器整体体验**
- 分组、锚点、必填提示、错误定位、sticky action bar。
- 国家、币种数据源统一。
- 中英文、桌面/平板/手机完成回归。

**最终验收**
- 1440px/1600px 桌面下 Drawer 默认能完整显示商品表格主要列；最大化后可查看所有字段。
- 768px 平板及 360px 手机不出现整页横向滚动。
- 订单列表筛选国家/币种只能选择有效数据库选项。
- 正式订单的 contractNo 必须由后端生成且唯一。
- 所有原有 PI/CI、订单快照、金额、导出、权限和幂等测试通过。
- 跑 lint、typecheck、相关单测、Admin/API build；未执行项不得宣称通过。
- 不部署、不运行生产迁移；如需要迁移，只提交 migration 和回滚说明，等待单独审批。

### 11.10 AI 执行指令（可直接交给 VS Code AI）

1. 先按 11.7 的文件清单逐个读取当前 main 文件，确认真实实现；不允许仅根据本 MD 猜测。
2. 按 R2-0 至 R2-5 顺序实施，先写测试再改业务代码。
3. 先复用现有组件、API、字典和数据模型；只有确认缺口后才新增。
4. 任何 schema 变更必须包含迁移、seed、回滚策略和历史数据兼容分析。
5. 不改订单金额算法、商品/费用快照、PI/CI 生命周期语义，不重建订单系统。
6. 每个阶段完成后报告改动文件、行为变化、测试命令和真实结果。
7. 不修改或部署生产环境；本任务仅修改本地开发代码并提交可审查的变更。

---

## 12. R2 执行记录（2026-11-07）

### 12.1 R2-0 基线核对结论

| 项目 | 现状 | 本轮改动 | 复用 | 不做 |
|---|---|---|---|---|
| 国家参考数据 | **缺失**：无 `Country` 表，也无 `country` 字典；订单列表、计算器、客户资料均为自由输入两位代码 | 新增 `country` 系统字典（250 项（ISO 3166-1 alpha-2 加常用 XK），含中英文），启动时由 reference seed 幂等同步；新增统一 `CountrySelect` | `DictionaryType` / `DictionaryItem` / `DictionaryItemTranslation` 两层字典、`/admin/dictionary/options/:typeCode` | 不新增 Country 表，不接第三方国家 API，不在前端硬编码国家列表 |
| 币种参考数据 | 已有 `currency` 字典，本地启用 7 项（CNY/USD/EUR/GBP/JPY/CAD/AUD） | 列表筛选改用统一 `CurrencySelect`；计算器继续使用 `config().currencies` | 现有字典与 `QuotationOrderService.config()` | 不新建第二套币种配置 |
| Drawer 组件 | `packages/ui/Drawer` 只有 `open/title/onClose/footer`，固定宽度，无拖动/最大化 | 扩展为 `size`、`resizable`、`maximizable`、`defaultWidth/minWidth/maxWidth`；原生 Pointer Events + 键盘调整；焦点进入/恢复与 Tab 限制 | 现有 `@b2b/ui` Drawer 与 `.overlay-right/.drawer` 样式 | 不在订单页复制 Drawer，不引入拖拽库 |
| 订单详情 | 六 Tab（Overview/Customer/Items/Charges/Documents/Audit）已存在；Drawer 560px 宽；Items 表头 `t('quotationCenter.amount')` 缺少 `currency` 参数，输出字面量 `{{currency}}` | Drawer 默认 `xl`（`min(96vw, 1180px)`），可拖动/最大化；仅明细表格内部横向滚动；金额表头改为“金额 / Amount” | 现有六个 Tab、`OrderDetail` DTO、`commercialDocumentsApi.prefill/createFromOrder` | 不重写详情数据模型，不改 PI/CI 生命周期 |
| 客户快照 | 前端一个平铺 `PartyForm`；账单/收货国家与主体国家混用；409 只显示错误；勾选同步后立即调用，失败无单独重试 | 主体与地址分组；主体国家/地址国家拆分；复制买方、账单同收货（一次性复制）；脱敏变更摘要；409 对比与显式选择；快照保存后单独确认主档同步，失败可重试 | `PATCH /admin/orders/:id/customer-snapshot`、`POST /admin/orders/:id/sync-customer-profile`、`Order.version` | 不改金额/商品/费用；不允许改合同编号 |
| 合同编号 | `CalculatorInput.contractNo` 可编辑；`createOrder` 与 `convertQuotation` 都把输入值写入 Order；无唯一约束 | 两个正式创建入口均改为后端 `generateContractNo()`；`CT-YYYYMMDD-XXXXXX`，前缀/时区可配置；唯一索引 + 有限重试；客户修正接口不再允许修改 | 现有订单事务、幂等键、`Order`/`tradeSnapshot`/`customerSnapshot`、PI/CI prefill 的 `order.contractNo` | 不重写历史订单；不给历史空值补号；不把 Buyer Reference 与合同编号混用 |
| 计算器 | 客户/贸易/地址/商品/费用/结果混在少量大区块；合同编号可编辑；无分区锚点；操作区在页面末尾 | 8 个可定位分区；顶部锚点；必填检查条；sticky 操作栏；国家选择器统一；合同编号只读说明；日期 `lang` 跟随 locale | `quotationOrderApi.config/products/preview/saveDraft/createOrder`、现有商品选择器、费用与运费规则 | 不改金额引擎、运费算法、Excel 模板映射 |

关键确认：

1. **国家数据原先不完整，实际是完全没有数据库参考数据。** 本轮新增 `database/prisma/reference-data/countries.ts`，并在 `seed.ts` 中作为 `systemLocked` 的 `country` 字典写入；本地数据库已同步 250 项，`US/CN/GB/DE/JP/AU` 等常用项及中英文翻译已验证。
2. **Drawer 原先不支持宽度扩展。** 已在 `packages/ui` 内扩展，而不是在订单页面复制一套抽屉；`package` 构建与 Admin/API typecheck 已通过。
3. **合同编号的写入路径只有两处**：`createOrder` 与 `convertQuotation`。两处均已改造；`Order.contractNo` 已加唯一索引。

### 12.2 R2-1 参考数据选择器

- 新增 `apps/admin/src/components/reference-selects.tsx`：
  - `CountrySelect`：可搜索、可清空、键盘上下/Enter/Escape、移动端可用；值始终为两位 ISO code，历史未知 code 仍显示并标记为不可用，避免编辑旧订单时静默丢失。
  - `CurrencySelect`：复用现有 `Select`，值始终为 ISO-4217 code。
- 订单列表高级筛选的国家/币种改为上述组件；计算器客户国家、账单国家、收货国家及币种改为同一组件；客户资料编辑的两个主体国家、两个地址国家改为 `CountrySelect`。
- 新增 `referenceDataApi.options()`，按 `typeCode + locale` 缓存同一请求；失败不缓存，允许重试。
- `orderListQuerySchema` 仍校验国家/币种格式；`listOrders` 额外校验其必须是对应字典的启用项，避免伪造 code 静默返回空列表。
- 测试：`order-customer-edit.spec.ts`、`reference-data-api.spec.ts`、`order-list.spec.ts` 覆盖筛选/URL/变更摘要/选项搜索。

### 12.3 R2-2 Drawer 与详情

- `Drawer` 新 API：`size`、`resizable`、`maximizable`、`defaultWidth`、`minWidth`、`maxWidth`、`labels`。
- 拖动使用 Pointer Events；分隔条可聚焦，支持 `ArrowLeft/ArrowRight/Home/End`；拖动条不覆盖关闭按钮。
- 打开时焦点进入 Drawer，关闭时恢复；Tab 焦点限制在 Drawer 内；Escape 关闭。
- 订单详情使用 `size="xl"`；1440px 下默认 1180px，最大化后 100vw；商品/费用/单据表格只在 `.table-scroll/.table-wrap` 内部横向滚动。
- 修复 `{{currency}}`：`quotationCenter.amount` 改为不带占位符的“金额 / Amount”；`exchangeRate` 同步改为“1 CNY = 目标币种 / target currency”，避免未传参的字面量。

### 12.4 R2-3 客户资料

- 表单分组：买方主体 + 账单地址、收货人主体 + 收货地址、贸易与参考信息、变更摘要。
- 主体国家与地址国家分离；新增“复制买方资料”和“账单地址同收货地址（仅复制当前值一次，之后独立编辑）”。
- 空值输入框显示“未填写 / Not provided”；电话提示 E.164，保存前仍由服务端 schema 校验。
- 保存前实时显示字段级变更摘要；电话、邮箱、税号、地址行使用掩码，审计只记录字段名，不写敏感值。
- 409：
  - 保留当前表单输入；
  - 重新拉取最新订单，展示服务器值 vs 本地值的差异；
  - 用户可显式“采用服务器版本”或“保留我的编辑”后基于最新 version 再保存；不会自动覆盖输入。
- 主档同步：
  - 快照保存成功后不再自动同步；
  - 若勾选“同时更新客户主档”，先提示“订单修正已保存”，再单独确认同步；
  - 同步失败显示“订单修正已保存，客户主档同步失败”，可单独重试，不会重复保存表单。
- 合同编号在修正表单中只读；服务端即使收到 `contractNo` 也保留原值。

### 12.5 R2-4 合同编号

- 新增 `generateContractNo(orderDate?)`：
  - 默认 `CT-YYYYMMDD-XXXXXX`；
  - `ORDER_CONTRACT_NO_PREFIX`（默认 `CT`）与 `ORDER_CONTRACT_NO_TIMEZONE`（默认 `Asia/Shanghai`）加入 env schema 与 `.env.example`；
  - 随机段使用 `crypto.randomBytes(3)`，6 位大写 Hex；
  - 订单日期按日历日期格式化，避免 UTC 跨时区偏移。
- `createOrder`、`convertQuotation` 均在订单事务内生成并写入 `Order.contractNo`、`tradeSnapshot.contractNo`、`customerSnapshot.contractNo`。
- 唯一冲突有限重试 5 次，只对 `contractNo` 的 P2002 重试；其他唯一冲突与幂等冲突保持原逻辑。
- 幂等重试继续返回第一次创建的订单与合同编号；`convertQuotation` 继续忽略报价草稿中的旧合同编号。
- 数据库：`Order.contractNo` 增加 `@unique`，迁移 `20261107170000_order_contract_no_unique`；迁移前检测重复非 NULL 值，存在重复则失败并提示人工处理。历史 NULL 不重写。
- 计算器删除可编辑合同编号控件，改为“创建正式订单时由系统生成”的只读说明；创建订单/转换订单成功提示展示实际 `contractNo`。

### 12.6 R2-5 计算器体验

- 分区：客户与单据、贸易条款、账单地址、收货地址、商品明细、币种与运费、其他费用、计算结果。
- 顶部 section nav；每个分区有锚点与 `scroll-margin-top`。
- 底部 sticky 操作栏：计算、保存草稿、创建正式订单；窄屏纵向排列。
- 实时显示创建订单必填项是否完整；创建失败时滚动到对应分区并聚焦字段（电话单独定位）。
- 国家使用统一 `CountrySelect`；币种使用 `CurrencySelect`/`config.currencies`；日期控件带 `lang={locale}`。
- 移除示例默认国家 `US` 与示例汇率 `0.1380`：国家必须选择，非 CNY 汇率必须录入正数，汇率日期随单据保存；CNY 固定为 1。
- 保留现有 CNY 汇率固定为 1、币种字典、运费算法、金额服务端计算规则。

### 12.7 迁移、回滚与验证

迁移：

- `20261107170000_order_contract_no_unique`：检查重复后创建 `orders_contractNo_key` 唯一索引。
- 国家数据不新增表：由 `database/prisma/reference-data/countries.ts` + reference seed 幂等写入；API 启动的 `syncReferenceDataAtStartup()` 会在监听端口前同步。
- 回滚合同索引：`DROP INDEX "orders_contractNo_key";`。国家字典可保留，不影响旧页面；如需移除，仅停用/删除该字典类型，不触碰订单历史字段。
- 未执行生产迁移或部署。

验证命令与结果：

- `pnpm run lint`：通过。
- `pnpm --filter @b2b/ui run typecheck`：通过。
- `pnpm --filter @b2b/admin run typecheck`：通过。
- `pnpm --filter @b2b/api run typecheck`：通过。
- `pnpm --filter @b2b/admin run test`：21 个文件、199 项通过。
- `pnpm --filter @b2b/database run test`：4 项通过。
- `pnpm --filter @b2b/validation run test`：26 项通过。
- `pnpm --filter @b2b/api run test`：425/428 通过；3 项失败仍为既有真实 `B2B_Quotation_Template.xlsx` 夹具解析测试，与 R2 改动无关。
- 定向 `quotation-order.service.spec.ts`：7 项通过（含合同编号格式、日期、随机性、唯一冲突重试）。
- `pnpm run db:seed:reference`：本地同步 250 个国家项，1.1s。
- `pnpm run check:production-reference-data`：通过（含国家字典数量/翻译校验）。
- 本地数据库 `orders_contractNo_key` 唯一索引已创建；当前非 NULL 合同编号无重复。
- `ADMIN_API_PROXY_TARGET=http://localhost:3002 pnpm --filter @b2b/admin run build`：通过。
- `pnpm --filter @b2b/api run build`：通过。
- 未执行：登录后 1440/1600/768/360 实机截图回归；需在有管理员会话的浏览器中单独验收视觉与拖动体验。

### 12.8 已知边界

- `CountrySelect` 的 DOM 交互（点击/键盘/移动端）未做浏览器自动化测试；当前以纯函数搜索测试 + typecheck/lint 覆盖。
- 历史订单中不存在于国家字典的 code 仍会显示，不会被强制改写；新订单只能从启用字典项选择。
- 主档 syncing 的并发冲突沿用现有 `version` 检查；若保存快照后其他会话再次修改，重试同步会返回 409 并要求刷新。
