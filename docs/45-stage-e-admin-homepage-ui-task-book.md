# DOC-45 阶段 E：Admin Homepage 管理 UI AI 执行任务书

> 状态：阶段 E 已实现，待最终验收；本文件保留原始执行边界与验收规格。  
> 适用项目：`b2b-inquiry-platform`  
> 基线文档：`docs/45-homepage-product-display-and-collections.md`  
> 执行前置：必须收到用户对阶段 E 的明确开工指令。  
> 本文件保留阶段 E 的执行边界、实现规格和验收要求，供实现与复核共同追踪。

---

## 0. 冻结基线与强制停点

### 0.1 阶段 D 冻结基线

- 制定本任务书时的分支为 `main`，提交为 `8967a97`。
- 工作区中存在阶段 D 及此前阶段的未提交改动。它们是本次复核与后续阶段 E 的既有基线，不得 reset、clean、覆盖、回滚或重新提交。
- 阶段 D 的公开 Homepage API、Cursor、缓存失效、Collection 去重与分页语义视为冻结。阶段 E 只消费这些能力，不重新设计。
- 阶段 D 的最终业务语义不得在阶段 E 重新打开：
  - New Arrivals 使用 `Product.isNew = true` 与现有 Storefront 上架规则。
  - New Arrivals 与 Collection 去重时，只排除 New Arrivals 实际可展示的前 N 个商品。
  - Collection 遇到重复候选时，在已配置候选范围内继续扫描补位；不得扩到未配置商品或其他分类。
  - 配置总数与单批 24 条相互独立；`newArrivalsLimit`、`productLimit` 可配置为 48、120、600 等合法值。

### 0.2 强制停点

阶段 E 执行时：

- 不提交 Git，不推送，不创建 PR，不部署。
- 不执行生产数据库迁移，不连接生产数据库。
- 不进入阶段 F，不修改 Storefront UI。
- 不修改 `ProductCard`、询盘、SKU、报价、PI 或商业单据业务。
- 不修改阶段 D 的公开聚合 API 业务逻辑。
- 不新增另一套商品、分类、Collection 或权限查询规则。
- 不因 UI 需要而复制 Category、Product 主数据。
- 如果现有阶段 C API 无法支撑本任务书的某个交互，先停止并报告缺口，不得擅自新增平行写接口或改变业务规则。

---

## 1. 阶段 E 目标

实现一个仅属于 Admin 的 Homepage 管理页面，用于：

1. 配置 New Arrivals 最终展示总数。
2. 创建、编辑、启用、禁用和删除 Homepage Collection。
3. 从现有 Category 主数据中选择分类，不创建重复分类。
4. 维护 Collection 的 `en-US` / `zh-CN` 标题和副标题。
5. 按当前 Collection 的 Category 搜索、分页选择商品。
6. 手动调整 Collection 顺序和 Collection 内商品顺序。
7. 确保已选商品数量不超过该 Collection 的 `productLimit`。
8. 全部读写复用阶段 C 已完成的 API、RBAC、审计、事务和缓存失效。

阶段 E 的交付边界是 **Admin UI、Admin API wrapper、路由/菜单、国际化、前端校验、测试和必要文档**，不是后端业务扩展。

---

## 2. 开工前必读与核对

执行 AI 必须先读取并核对：

- `AGENTS.md`
- `docs/45-homepage-product-display-and-collections.md`
- `docs/05-api-contract.md` 的首页与 Storefront 契约
- `docs/06-admin-public-ui-standard.md`
- `.agents/skills/frontend-ui/SKILL.md`
- `.agents/skills/category-management/SKILL.md`
- `packages/validation/src/homepage-management.ts`
- `packages/contracts/src/admin.ts`
- `packages/contracts/src/constants.ts`
- `packages/i18n/src/error-messages.ts`
- `packages/i18n/src/common-messages.ts`
- `apps/api/src/modules/homepage-management/homepage-management.controller.ts`
- `apps/api/src/modules/homepage-management/homepage-management.service.ts`
- `apps/admin/src/components/category-picker.tsx`
- `apps/admin/src/lib/categories-api.ts`
- `apps/admin/src/lib/products-api.ts`
- `apps/admin/src/lib/use-resource.ts`
- `apps/admin/src/components/session-provider.tsx`
- `database/prisma/menu-seed.ts`
- `apps/admin/src/messages/en-US.json`
- `apps/admin/src/messages/zh-CN.json`

开工后第一步必须输出：

1. 实际 `git status --short` 与当前分支/提交，确认未误碰阶段 D 文件。
2. 拟新增/修改文件清单。
3. 将复用的既有 API 与组件清单。
4. 如发现现有契约与任务书冲突，先列出冲突并停止在冲突点，不得自行改业务规则。

---

## 3. 既有后端契约：只复用，不重写

### 3.1 固定 API

| Method | Path | 用途 | 权限 |
|---|---|---|---|
| `GET` | `/admin/homepage-management/config` | 读取首页展示配置 | `homepage.read` |
| `PATCH` | `/admin/homepage-management/config` | 修改 New Arrivals 总数/总开关 | `homepage.config.update` |
| `GET` | `/admin/homepage-management/collections?locale=` | Collection 列表 | `homepage.read` |
| `POST` | `/admin/homepage-management/collections` | 创建 Collection | `homepage.collection.create` |
| `GET` | `/admin/homepage-management/collections/:id?locale=` | Collection 详情与已选商品 | `homepage.read` |
| `PATCH` | `/admin/homepage-management/collections/:id` | 修改标题、状态、数量、分类 | `homepage.collection.update` |
| `DELETE` | `/admin/homepage-management/collections/:id` | 删除首页展示配置 | `homepage.collection.delete` |
| `PUT` | `/admin/homepage-management/collections/sort` | 全量保存 Collection 顺序 | `homepage.collection.update` |
| `PUT` | `/admin/homepage-management/collections/:id/products` | 全量替换商品选择和顺序 | `homepage.product.update` |

### 3.2 不得新增或绕过的能力

- 不得新增 Homepage 专用商品搜索接口；复用 `GET /admin/products`。
- 不得新增 Homepage 专用分类接口；复用 `GET /admin/categories/tree`。
- 不得直接调用 Prisma、数据库或 Storefront 公开 API 完成 Admin 写操作。
- 不得由前端直接调用 `/api/revalidate`；Homepage 写 API 已在服务端完成 `homepage` 缓存失效。
- 不得创建第二套 `HomepageCollection`、Category 或 Product 数据。
- 不得把 `productLimit`、标题、排序或商品选择写入前端缓存/本地存储作为权威状态。

### 3.3 已确认的服务端业务规则

- `homepageDisplayTotalSchema` 只允许：
  - 整数；
  - 最小值 `1`；
  - 6 的正整数倍；
  - 不超过 PostgreSQL `INTEGER` 最大值 `2,147,483,647`。
- 不存在 36、120、600 等固定业务上限。24 是公开接口的单批返回量，不是配置总数上限。
- 每个 Category 最多创建一条 Collection。
- `en-US` 翻译必须存在；同一 Collection 的 locale 不允许重复。
- 商品必须精确属于 Collection 的 `categoryId`，不能选择子分类商品。
- 商品 ID 不允许重复。
- `PUT /collections/:id/products` 是完整替换，不是增量追加。
- 已选商品数量不得超过 Collection 的 `productLimit`。
- Collection 已有已选商品时，服务端禁止修改其 Category；必须先清空商品选择。
- 降低 `productLimit` 时，如果当前已选商品数超过新值，服务端拒绝。
- Collection 删除只删除展示配置和关联选择，不删除 Category/Product。
- `PUT /collections/sort` 必须提交当前全部 Collection ID，且每个 ID 恰好出现一次。
- `expectedUpdatedAt` 是可选的乐观并发令牌；提供过期值会返回并发冲突。

### 3.4 并发错误码

必须处理并翻译：

- `HOMEPAGE_CONFIG_CONCURRENT_UPDATE`
- `HOMEPAGE_COLLECTION_CONCURRENT_UPDATE`
- `HOMEPAGE_COLLECTION_CATEGORY_CHANGE_BLOCKED`
- `HOMEPAGE_COLLECTION_CATEGORY_CONFLICT`
- `HOMEPAGE_COLLECTION_CATEGORY_INVALID`
- `HOMEPAGE_COLLECTION_PRODUCT_CATEGORY_MISMATCH`
- `HOMEPAGE_COLLECTION_PRODUCT_DUPLICATE`
- `HOMEPAGE_COLLECTION_PRODUCT_LIMIT_EXCEEDED`
- `HOMEPAGE_COLLECTION_NOT_FOUND`

不得在前端硬编码英文/中文错误正文；通过现有 `translateError` 和共享错误消息机制解析。

---

## 4. 页面与路由

### 4.1 路由

按 DOC-45 建议新增：

`apps/admin/src/app/[locale]/(admin)/storefront/homepage/page.tsx`

如仓库实际约定有冲突，先报告并采用最接近现有 Admin 目录结构的路径；不得复制 Admin Shell 或新建平行布局。

页面必须：

- 位于现有受保护 `(admin)` layout 内。
- 复用唯一 Admin Shell。
- 使用 `useSession()`、`can()`、`useBreadcrumb()`。
- 页面首屏加载显示 loading/error/empty；不得卸载 Shell。
- 页面语言由 Admin URL locale 决定，不能由浏览器语言或硬编码决定。

### 4.2 菜单

建议在现有 `catalog` 分组下新增：

| 字段 | 值 |
|---|---|
| code | `homepage` |
| route | `/storefront/homepage` |
| permissionCode | `homepage.read` |
| zh-CN | `首页管理` |
| en-US | `Homepage` |

同步要求：

- 更新 `database/prisma/menu-seed.ts`。
- 将 `homepage` 加入 `PROTECTED_MENU_CODES`。
- 同时维护 `zh-CN` / `en-US` 菜单翻译。
- 复用现有 seed 幂等策略，不创建重复菜单记录。
- 菜单隐藏不是权限控制；后端 API 仍逐接口鉴权。

---

## 5. 页面信息架构

建议页面由两个清晰区块组成，避免把全局配置和 Collection 编辑混成一次不确定的保存。

### 5.1 顶部：New Arrivals Settings

展示并编辑：

- 当前 New Arrivals 最终展示总数。
- 首页展示总开关（是否启用首页配置；如果现有 API 的 `enabled` 由产品确认后使用）。
- 当前保存时间或并发版本提示。

交互要求：

- 使用数字输入控件，不使用只有 `6/12/24/36` 的固定下拉。
- 可提供 6、12、18、24、36、48、60 等快捷建议，但快捷项只负责填入，输入仍可接受任何合法值。
- 必须允许 `6`、`12`、`18`、`24`、`36`、`48`、`120`、`600` 等。
- 禁止 `0`、负数、小数、空值、非 6 倍数和超出数据库整数范围的值。
- 页面不得使用 `max=36`、`max=120` 或等效固定业务上限。
- 可仅在技术上使用 `2,147,483,647` 作为数据库边界提示，但不能把它描述为业务推荐值。
- 保存成功后使用服务端返回的 `updatedAt` 更新并发令牌并重新展示服务端值。
- 失败时保留输入与焦点，显示字段错误或可重试错误。

必须显示解释文案：

> 这是配置的最终展示总数，不是单次请求条数。前台首次最多展示 24 个商品，访客继续点击 Load More 时，每批最多再加载 24 个，直到达到配置总数或商品耗尽。

### 5.2 下方：Homepage Collections

列表至少展示：

- 排序位置/拖动手柄。
- `title`（当前 Admin locale 的 Collection 标题）。
- Category 名称、code 或路径。
- Category 的 `enabled` / `visible` 状态。
- `selectedProductCount / productLimit`。
- Collection 自身启用状态。
- 最近更新时间。
- 编辑、删除、上移/下移操作。

列表排序必须采用服务端返回顺序：`sortOrder ASC, id ASC`。

空状态必须提供 Add Collection 入口；错误态显示业务错误和 requestId（如有）。

---

## 6. Collection 创建与编辑

### 6.1 表单字段

| 字段 | 必填 | 规则 |
|---|---|---|
| Category | 是 | 只能选择现有 Category UUID；不得手填 UUID；不得新建分类 |
| `en-US` title | 是 | 非空文本，最多 240 |
| `en-US` subtitle | 否 | 最多 500；空字符串转换为 `null` |
| `zh-CN` title | 按当前 API | 若提交该 locale，则必须非空、最多 240 |
| `zh-CN` subtitle | 否 | 最多 500；空字符串转换为 `null` |
| Enabled | 是 | 布尔值 |
| Product display total (`productLimit`) | 是 | 正整数、6 的倍数、数据库 INTEGER 范围内 |
| Selected products | 否 | 数量不超过 `productLimit` |

UI 必须提供两个 locale 的编辑入口。当前服务端要求 `en-US`，不得让英文标题为空；`zh-CN` 未填时可显示“缺失中文翻译”的提示，但不得伪造翻译。

标题与副标题按纯文本渲染和提交，不使用富文本 HTML，避免产生第二套内容安全/清洗规则。

### 6.2 Category 选择

- 复用 `CategoryPicker`，数据来自 `/admin/categories/tree`。
- 表单只提交 `categoryId`，不提交名称、code 或 slug 作为关联键。
- 分类选择器必须支持搜索、展开/折叠、父级选择、深层节点、键盘操作、加载/错误态。
- 若所选 Category 为停用或隐藏，显示明确警告；不得在 Homepage 页面自动启用/显示该 Category。
- 已存在同 Category 的 Collection 时，前端做提示，后端冲突仍为最终裁决。
- Collection 已有已选商品时，Category 选择器应禁用或明确提示“先清空商品后再更换分类”。服务端会返回 `HOMEPAGE_COLLECTION_CATEGORY_CHANGE_BLOCKED`，前端不得绕过。

### 6.3 创建

- `POST /collections` 成功后重新读取列表或使用服务端返回详情。
- 不先本地插入假 ID 或假更新时间。
- 创建失败时保留所有表单数据。
- 默认 `productLimit` 可使用共享 schema 的默认值 `6`；不得另造不同默认规则。

### 6.4 编辑与并发

- 从详情/列表取得的 `updatedAt` 作为 `expectedUpdatedAt`。
- 收到 `HOMEPAGE_COLLECTION_CONCURRENT_UPDATE` 后：
  1. 保留用户未保存内容；
  2. 提示“已被他人修改”；
  3. 提供“重新加载服务端版本”操作；
  4. 不自动覆盖，不静默重试。
- 字段级错误应关联到具体输入；全局错误保留 requestId。
- 禁止无条件省略 `expectedUpdatedAt` 来掩盖并发冲突。

### 6.5 启用/禁用

- 复用 `PATCH /collections/:id` 的 `enabled`。
- 变更后使用返回详情更新行状态。
- 禁用不删除任何商品选择或主数据。

### 6.6 删除

- 使用 `ConfirmDialog` 二次确认。
- 确认文案必须明确：只删除首页展示配置和商品选择关系，不删除 Category 与 Product。
- 删除中禁用重复提交。
- 成功后重新读取列表；失败保留当前行并显示可重试错误。

---

## 7. Collection 商品选择器

### 7.1 搜索与分页

必须复用：

`GET /admin/products?q=&categoryId=&includeDescendants=false&page=&pageSize=`

强制要求：

- `categoryId` 固定为当前 Collection 的 Category。
- 明确传 `includeDescendants=false`，避免选入子分类商品。
- 使用服务端分页；禁止一次加载该分类全部商品。
- 搜索至少支持名称/SKU，由现有商品 API 的 `q` 处理。
- 搜索输入应防抖；页码变化时重新请求服务端。
- 不得为了“看到全部已选商品”而发起无上限查询。
- 商品选择器不得展示内部价格、成本或其他无权限字段。

### 7.2 展示字段

至少展示：

- 商品主图/占位图。
- 商品名称。
- SKU。
- publishStatus（若可用）。
- lifecycleStatus（若可用）。
- 当前是否已选。

不得展示 `priceCny` 或成本字段。商品接口若因权限不返回价格，UI 不需要也不应请求该字段。

### 7.3 选择规则

- 使用唯一 `productId` 维护选择集。
- 同一商品不能重复选择。
- 分页切换、搜索和筛选不得丢失未保存的已选集。
- 取消选择只影响本地待保存状态，保存前不删除服务端关系。
- 显示 `已选数量 / productLimit`。
- 达到 `productLimit` 后，未选商品的选择控件应禁用并解释原因；仍允许移除已选商品。
- 若用户在并发场景下超过限制，服务端返回 `HOMEPAGE_COLLECTION_PRODUCT_LIMIT_EXCEEDED`，前端必须显示错误并恢复可操作状态。
- `productLimit` 可以很大（如 600），前端不得截断已选集或只允许编辑前 N 个。
- 修改 `productLimit` 低于当前已选数量时：
  - 前端阻止保存并提示先移除商品；
  - 或在独立的“保存设置”动作前明确提示，并由服务端最终拒绝；
  - 不得自动静默删除多余商品。

### 7.4 保存

- 使用 `PUT /collections/:id/products` 完整替换。
- 请求体仅包含 `productId` 和可选 `sortOrder`，不得提交商品名称、分类名称、价格等主数据。
- 提交前发送当前详情/列表的 `updatedAt` 作为 `expectedUpdatedAt`。
- 保存成功后重新读取 Collection 详情，以服务端返回的商品顺序和 `updatedAt` 为准。
- 中途失败时保留本地选择和排序，显示重试入口。
- 不允许把“元数据保存”和“商品完整替换”伪装成单次原子事务；如需同一抽屉完成，必须拆成明确动作并说明状态。

---

## 8. 手动排序

### 8.1 Collection 排序

- 使用上移/下移按钮作为基础可访问交互；若引入拖拽，必须有键盘和按钮替代。
- 不新增拖拽依赖，除非确认现有 UI 库已提供且依赖审批通过。
- 每次调整后构造当前全部 Collection ID 的完整 `orderedIds`。
- 调用 `PUT /collections/sort`。
- 保存期间锁定重复排序，成功后重新读取列表。
- 失败时恢复服务端旧顺序或提示重新加载，不能假装已保存。

### 8.2 Collection 内商品排序

- 上移/下移按钮必须可用；拖拽为增强项。
- 排序只改变待提交数组顺序。
- 保存 `PUT /collections/:id/products` 后重新读取服务端顺序。
- 分页只影响搜索浏览，不影响已选列表的完整排序结果。
- 已选商品较多时，排序区必须可滚动且不丢失焦点，不得因性能优化静默截断。

---

## 9. 并发、保存一致性与恢复

必须区分以下动作：

1. 保存 New Arrivals 配置。
2. 保存 Collection 元数据（Category、标题、副标题、启用状态、`productLimit`）。
3. 保存 Collection 商品完整选择与顺序。
4. 保存 Collection 全量排序。

每个动作独立处理 loading、错误和成功反馈。禁止：

- 用一个“保存全部”按钮串行调用多个无事务关联的 API，却不告诉用户中间失败的状态。
- 在服务端成功后仍保留陈旧本地值。
- 在服务端失败后把 UI 显示成已保存。
- 自动降低 `productLimit` 或自动删除商品来让保存通过。

失败恢复规则：

- 字段校验失败：保留表单与焦点，定位字段。
- 并发失败：保留草稿，提示重新加载服务端版本。
- 商品限制失败：保留选择，显示当前上限和已选数量。
- 分类变更被阻止：保留表单，提示先清空商品选择。
- 网络失败：显示重试，不重复创建记录。

---

## 10. 权限与安全

### 10.1 页面权限

- 页面读取必须要求 `homepage.read`；无权限时不渲染可操作表单。
- 配置保存：`homepage.config.update`。
- Collection 创建：`homepage.collection.create`。
- Collection 编辑/启停/排序：`homepage.collection.update`。
- Collection 删除：`homepage.collection.delete`。
- 商品选择与排序保存：`homepage.product.update`。

按钮隐藏只是体验优化，不能替代服务端校验。

### 10.2 依赖读取权限

Category 选择器与商品搜索仍分别受现有 `category.read`、`product.read` 约束：

- 不应新增代理接口绕过。
- 若用户有 Homepage 权限但缺少 Category/Product 读取权限，页面必须显示明确的权限不足状态，而不是空白、无限 loading 或错误地允许手填 ID。
- 执行 AI 必须在实现报告中说明 Admin 角色的既有授权是否覆盖这些依赖。

### 10.3 数据安全

- 页面、组件 props、浏览器状态、日志、toast 和错误详情不得包含商品内部价格。
- 不渲染富文本 HTML。
- 不对 URL 参数或搜索词做代码执行、SQL 拼接或 DOM 注入。
- 不把 Session、Token、requestId 以外的敏感信息写入日志。

---

## 11. 国际化

### 11.1 Admin 页面文案

同时更新：

- `apps/admin/src/messages/zh-CN.json`
- `apps/admin/src/messages/en-US.json`

至少覆盖：

- 页面标题、说明、面包屑。
- New Arrivals 配置、24 条/批说明、校验错误。
- Collection 列表表头、状态、空状态。
- 创建/编辑表单字段、帮助文案、占位符。
- Category 状态警告、分类变更阻止提示。
- 商品搜索、分页、已选计数、达到上限提示。
- 排序、保存、删除确认、重试、并发冲突。
- 所有按钮的可访问名称和 loading 文案。

### 11.2 错误与权限文案

- 在现有 `packages/i18n/src/common-messages.ts` 中补齐 `HOMEPAGE_*` 错误码的中英文文案。
- 在 Admin 翻译资源中补齐 `permission.homepage.*`，至少覆盖：
  - `homepage.read`
  - `homepage.config.update`
  - `homepage.collection.create`
  - `homepage.collection.update`
  - `homepage.collection.delete`
  - `homepage.product.update`
- 使用现有 `translateError`/翻译机制，不新增第二套错误体系。
- 如前端复用共享 Zod schema，必须为 `validation.homepage.*` 提示提供可展示翻译或映射，不能让用户看到原始 key。

### 11.3 locale 来源

- 所有 Admin 文案由 URL locale 驱动。
- 切换 locale 不改变已选 Category ID、商品 ID 或未保存输入值。
- 不创建以中文/英文 label 作为业务判断条件的分支。

---

## 12. 响应式与可访问性

必须验证：

- 360px 手机、768px 平板、1024px 与桌面宽屏。
- 页面和 Drawer/Modal 无横向溢出。
- Collection 列表在窄屏可转为卡片或可滚动表格，但所有操作仍可触达。
- 表单 Label 与输入关联；错误通过 `aria-describedby` 或等效方式关联。
- Dialog/Drawer 有可访问标题、焦点圈定和关闭后焦点恢复。
- 上移/下移、选择、移除、保存、删除均可用键盘操作。
- 图标按钮必须有可访问名称。
- 颜色不是唯一状态表达；启用/禁用、Category 隐藏/停用同时有文字说明。
- 加载、空、错误、只读、保存中状态均有明确反馈。

---

## 13. 建议文件清单

执行 AI 可根据实际仓库结构调整，但必须保持职责单一并复用现有模式。

### 13.1 新增

- `apps/admin/src/app/[locale]/(admin)/storefront/homepage/page.tsx`
- `apps/admin/src/components/homepage-config-panel.tsx`（可拆分）
- `apps/admin/src/components/homepage-collection-form-drawer.tsx`（可拆分）
- `apps/admin/src/components/homepage-product-picker-dialog.tsx`（可拆分）
- `apps/admin/src/lib/homepage-management-api.ts`
- 与之对应的 pure helper 与 `*.spec.ts`

### 13.2 修改

- `database/prisma/menu-seed.ts`
- `packages/contracts/src/constants.ts`（仅菜单保护列表，如确有需要）
- `apps/admin/src/messages/zh-CN.json`
- `apps/admin/src/messages/en-US.json`
- `packages/i18n/src/common-messages.ts`

### 13.3 不应修改

- `apps/api/src/modules/homepage-management/*` 的业务行为，除非只做本任务书明确要求且有测试覆盖的最小缺口修复；默认不改。
- 阶段 D 的公开聚合查询、Cursor、缓存实现。
- `apps/storefront/**`
- `apps/storefront/src/components/product-card.tsx`
- 询盘、SKU、报价、PI、商业单据模块。
- Prisma schema 和 migrations。

---

## 14. 测试计划

### 14.1 纯逻辑 / 单元测试

至少覆盖：

- 数字解析和校验：
  - 接受 6、12、18、24、36、48、120、600。
  - 拒绝 0、负数、小数、空值、非 6 倍数、超过数据库 INTEGER。
  - 确认没有 36/120 的固定业务上限。
- 双语言翻译 payload 构造：`en-US` 必填、无重复 locale、空 subtitle 转 `null`。
- 已选商品去重、计数、达到 `productLimit` 时阻止继续选择。
- 上移/下移边界：首项不能上移、末项不能下移，顺序稳定。
- `expectedUpdatedAt` 注入与并发错误映射。
- 错误码到翻译 key 的映射。

### 14.2 API wrapper 测试

至少覆盖：

- 每个列表/详情请求携带正确 `locale`。
- PATCH config 携带 `newArrivalsLimit`、`enabled`、`expectedUpdatedAt`。
- 商品搜索固定携带 `categoryId` 与 `includeDescendants=false`，并携带 `page`/`pageSize`。
- Collection 创建/编辑 payload 不包含 Category/Product 主数据副本。
- 商品保存为完整替换，不发送增量字段。
- 排序提交完整 `orderedIds`。

### 14.3 组件/交互测试

至少覆盖：

- 数字输入没有固定下拉限制，也没有 `max=36`。
- 保存失败保留表单；成功使用服务端返回刷新。
- 超 `productLimit` 选择被阻止。
- 重复商品不能重复加入。
- 已选商品跨分页保持。
- Category 已选商品时显示变更限制。
- 删除确认说明不删除 Category/Product。
- 只读权限不显示写按钮；直接越权调用仍由服务端拒绝。

### 14.4 回归与静态检查

执行命令以实际仓库脚本为准，基准命令：

```bash
pnpm --filter @b2b/admin test
pnpm --filter @b2b/admin typecheck
pnpm --filter @b2b/admin build
pnpm lint
pnpm format:check
```

若修改了菜单 seed、i18n 或 contracts，还应执行：

```bash
pnpm --filter @b2b/database test
pnpm typecheck
pnpm test
```

不得为了阶段 E 连接生产数据库。需要数据库的测试只能使用项目本地测试库，并明确记录环境来源。

### 14.5 手工验收矩阵

- New Arrivals：6、12、18、24、36、48、120、600 保存并重新读取。
- 非法值：0、-6、6.5、18.1、7、`2,147,483,648` 被拒绝。
- Collection：创建、编辑双语标题/副标题、启停、删除。
- Category：父节点、深层节点、停用/隐藏分类提示、已有 Collection 冲突。
- 商品选择：搜索、分页、跨页保留、移除、重复阻止、达到上限阻止。
- 商品排序：上移/下移、保存后刷新仍保持。
- Collection 排序：全量顺序保存、失败恢复/重试。
- 并发：用两个会话修改同一配置/Collection，确认冲突提示。
- 分类变更：已选商品时禁止换分类；清空后可换。
- 数量降低：低于已选数量被阻止，且不自动删除商品。
- 权限：只读、缺少 `category.read`、缺少 `product.read` 的账号状态。
- 响应式：360px、768px、1024px、宽屏。
- 无价格泄漏：DOM、props、网络响应消费和 toast 中无内部价格。

---

## 15. 验收标准

阶段 E 只有在以下条件全部满足时才可报告完成：

- [ ] Homepage 菜单和页面可通过现有 Admin Shell 正常进入。
- [ ] New Arrivals 使用数字输入，允许任意正整数 6 的倍数，无固定 36/120 业务封顶。
- [ ] 6、12、18、24、36、48、120、600 均可保存并重新读取。
- [ ] 0、负数、小数、非 6 倍数、越界值被前端和服务端拒绝。
- [ ] Collection 支持创建、编辑、启用、禁用和删除。
- [ ] Category 仅来自现有分类树，未创建重复分类主数据。
- [ ] `en-US` / `zh-CN` 标题和副标题可维护，所有页面文案有双语资源。
- [ ] 商品搜索/分页使用现有 `/admin/products`，固定当前分类且不包含子孙分类。
- [ ] 商品选择不重复，数量不超过 `productLimit`，达到上限有明确提示。
- [ ] Collection 和商品均可手动排序，保存后重新读取结果一致。
- [ ] 所有写操作只调用阶段 C 既有 API，RBAC、审计、事务和缓存失效未被绕过。
- [ ] 并发冲突不会静默覆盖数据，用户可保留草稿并重新加载。
- [ ] 删除只删除首页展示配置，不删除 Category/Product。
- [ ] 未修改 Storefront UI、`ProductCard`、询盘、SKU、报价或 PI 业务。
- [ ] 未新增数据库 migration，未连接或迁移生产数据库。
- [ ] Admin tests、typecheck、build 通过；无法运行的检查必须在报告中说明原因。
- [ ] 360px、平板、桌面及键盘可访问性验收通过。
- [ ] 未提交 Git、未推送、未进入阶段 F。

最终状态只能使用：

- `PASS`
- `PASS WITH NOTES`
- `BLOCKED`

如果存在任何未解决的业务规则冲突、API 缺口、权限绕过或价格泄漏，不得给出 `PASS`。

---

## 16. 执行报告格式

阶段 E 完成后必须按以下结构报告：

1. 实际改动文件与职责。
2. 复用的既有 API、RBAC、审计和缓存机制。
3. New Arrivals 数字输入和校验实现位置。
4. Collection CRUD、双语字段、Category 选择和删除语义。
5. 商品搜索、分页、数量限制和排序实现。
6. 并发处理与失败恢复。
7. 菜单、路由、权限和翻译变更。
8. 测试命令、结果与未执行项原因。
9. 360px/平板/桌面与键盘可访问性结果。
10. 价格泄漏检查结果。
11. 已知风险和回滚方式。
12. 最终结论：`PASS` / `PASS WITH NOTES` / `BLOCKED`。

报告必须明确写出“阶段 D 未修改、未提交；阶段 F 未开始”。

---

## 17. 完成后的边界

阶段 E 完成后仍不得自动：

- 提交或推送 Git。
- 执行生产迁移或部署。
- 修改 Storefront 首页视觉。
- 修改 ProductCard、询盘、SKU 或报价流程。
- 开始阶段 F。

下一步必须等待用户明确批准，再基于本任务书的验收结果决定是否进入阶段 F。
