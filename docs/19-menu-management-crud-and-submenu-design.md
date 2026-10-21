# 系统管理：菜单管理 CRUD、子菜单与权限绑定改造方案

> 版本：1.0.0  
> 适用页面：`/{locale}/menus`（当前示例：`/zh-CN/menus`）  
> 目标读者：产品、前端、后端、测试、运维及 AI 编码助手  
> 状态：可执行设计基线；实施前必须对照实际代码、API、Prisma schema 与现有种子数据完成盘点。

## 1. 现状与必须解决的问题

从当前截图可确认：页面只有一个平铺表格，列出“名称、code、路由、权限、状态、子菜单数量”；没有搜索工具栏，也没有新增、编辑、添加子菜单、排序或删除操作。管理员无法查询、创建或修改菜单配置。当前列表还存在两条显示名称均为“系统管理”的记录：`administration`（启用且有 6 个子菜单）和 `system`（停用且没有子菜单）。不能仅凭名称重复就删除任意一条，需要先核对 ID、子菜单、角色授权、路由和审计数据。

### 1.1 改造目标

1. 把菜单管理从只读列表改造成可维护的多级菜单树。
2. 支持菜单查询、新增一级菜单、新增子菜单、编辑、启停、显示/隐藏、排序和受保护删除。
3. 每个菜单能维护 code、父菜单、路由、图标、排序、启用状态、导航可见性、绑定权限以及每种 locale 的名称。
4. 中英文先完整支持，数据结构不得写死只有两种语言；新增语言主要通过翻译记录和语言配置完成。
5. 菜单决定“导航怎样展示”，权限系统决定“用户可以访问什么”。菜单隐藏不能替代 API 授权。
6. 改造不能破坏现有后台路由、系统角色和权限编码，也不能将菜单名称、路由或权限编码硬编码在多个位置。

## 2. 页面整体设计

### 2.1 页面顶部

页面标题：**菜单管理**。副标题说明：菜单控制后台导航结构与显示，API 权限仍由服务端独立校验。

标题右侧主按钮：`+ 新增菜单`；次要动作：`展开全部`、`折叠全部`、`刷新`。如果后端实现了安全的批量排序，再显示“保存排序”；未实现前不要显示无效按钮。

### 2.2 查询工具栏

首版提供以下条件：

- 名称：对当前语言名称、英文名称和中文名称做包含查询。
- 菜单编码：精确或前缀查询，例如 `catalog`、`leads`。
- 路由：按内部路由查询，例如 `/products`。
- 权限编码：按绑定权限 code 查询，例如 `product.read`。
- 菜单类型：全部、目录/分组、页面、外部链接（仅在系统支持外部链接时显示）。
- 启用状态：全部、启用、停用。
- 导航可见性：全部、可见、隐藏。
- 父菜单：选择某个菜单后查看其后代；可选“仅一级菜单”。

按钮：`查询`、`重置`。回车可提交搜索。筛选条件应用后必须保留在 URL query 或页面状态中，刷新时恢复查询条件。树形搜索应显示匹配节点及其祖先路径，不可把子菜单扁平化到让管理员看不出父级。

### 2.3 主体：默认树形表格

使用可展开/收起的树形表格作为默认视图。建议列：

| 列 | 展示与行为 |
|---|---|
| 菜单名称 | 树缩进、图标、当前语言名称；必要时可显示英文/中文次级名称；父级可展开。 |
| 类型 | 目录 / 页面 / 外部链接（类型实现时再展示）。 |
| 编码 | `code` 使用等宽字体，允许复制；不随语言切换变化。 |
| 路由 | 路由地址；目录为空时显示“—”。长路由可截断并在 Tooltip 展示全值。 |
| 绑定权限 | 展示 permission code；未绑定显示“未绑定”。父级权限不可被误认为子页面 API 权限。 |
| 子菜单 | 子节点数量，可点击展开。 |
| 排序 | 显示 `sortOrder`，使用上下移动或拖拽；需要服务端持久化。 |
| 状态 | 分开展示“启用/停用”和“可见/隐藏”，不可合并为一个状态。 |
| 操作 | `编辑`、`添加子菜单`、`上移/下移`（若实现）、`启用/停用`、`删除`（满足条件才可用）。 |

表格右侧操作列固定（宽屏），小屏幕将次要操作放入“更多”菜单；操作按钮必须有 loading、成功/失败提示及权限控制。即使前端隐藏操作按钮，后端仍必须验证对应权限。

### 2.4 视图与布局细节

- 桌面端内容最大宽度可使用页面容器的全宽模式，菜单树需要足够宽度显示路由及权限编码。
- 表格外层白底卡片、细边框、统一圆角；不要把整页做成巨大空白区域。
- 父级目录用半粗体，子菜单正常字重；当前选中行使用浅色背景，不以颜色作为唯一状态标识。
- 提供空状态：“没有找到符合条件的菜单”，并给出清除筛选按钮。
- 初次加载显示 Skeleton；请求失败显示错误提示与重试按钮；不得用虚假菜单数据填充。
- 360px 手机端不强行压缩所有列，改为每个菜单的摘要卡片，名称/code 为主，其他信息折叠到详情和操作菜单中。

## 3. 新建与编辑表单：字段逐项定义

建议统一使用右侧 Drawer（桌面宽约 680–760px；移动端全屏），新建和编辑复用同一表单组件。编辑模式下，除业务允许修改的字段外，不能改变 ID；`code` 默认创建后不可修改，以免破坏外部引用和审计可读性。

### 3.1 基础信息区

| 字段 | 类型 | 必填 | 约束/规则 |
|---|---|---:|---|
| 菜单编码 `code` | 输入框 | 是 | 小写英文、数字、连字符或下划线；全局唯一；首尾不能是分隔符；创建后只读。例：`catalog`、`product-management`。实际正则需与现有代码规范一致。 |
| 菜单类型 | 单选 | 是 | 推荐 `GROUP`（目录/分组）、`PAGE`（后台页面）、`EXTERNAL`（外链，若需要）。见第 5 节的数据兼容决策。 |
| 父菜单 `parentId` | 树选择器 | 否 | 空表示一级菜单；不能选自己或自己的后代；停用父菜单时需提醒子菜单影响。 |
| 菜单图标 `icon` | 图标选择器/受控输入 | 否 | 必须来自项目允许的图标集合；不要执行数据库中任意 HTML/SVG 字符串。没有图标时使用统一默认图标或按设计规范隐藏。 |
| 路由 `route` | 输入框 | 视类型 | `GROUP` 为空；`PAGE` 必填并为规范化的站内路径，例如 `/products`；`EXTERNAL` 必须是 `https` URL 并标注新窗口行为。禁止 `javascript:` 等协议。 |
| 排序 `sortOrder` | 数字输入 | 是 | 整数；同级菜单按升序显示。允许相同值但建议保存时以稳定规则排序，优先保证 UI 一致。 |
| 启用 `enabled` | 开关 | 是 | 停用会使该菜单不出现在可导航菜单结果中；不替代后端权限控制。停用父级时展示影响子级数量。 |
| 导航可见 `visible` | 开关 | 是 | 仅控制是否出现在侧栏导航；隐藏菜单不等同于禁止直接路由访问。直接访问是否允许取决于页面权限和路由守卫。 |

### 3.2 国际化名称区

- 使用动态 locale 表单项，初始至少显示 `zh-CN`、`en-US`；实际 locale 列表从项目 i18n 配置读取，不把语言列表散落在页面代码中。
- 每种语言维护菜单标签 `label`。中文和英文都应填写；如果产品允许缺省翻译，应明确采用 fallback 策略并在表单标注。
- 所有翻译项使用同一个 `menuId`，同一 locale 对同一个菜单只能有一条记录。
- locale code 必须标准化（例如 `zh-CN`、`en-US`），不能使用“中文”“English”作为数据库 locale 值。
- 名称只影响展示，不作为 code、API 权限或路由的标识。
- 增加第三种语言时，新增 locale 配置与翻译记录即可，不应新增 `nameZh`、`nameEn` 等固定列。

### 3.3 权限绑定区

- `permissionCode` 应是从权限定义 API 返回的可搜索选择器，而非随意输入的自由文本。
- 选项至少展示权限名称（按当前语言翻译）、`code`、模块 `module`；支持按 code/名称搜索。
- 页面菜单通常绑定该页面所需的 `*.read` 权限；目录节点可以不绑定页面权限，由拥有可见子菜单的权限决定是否展示。具体沿用现有导航服务的计算规则。
- 选择器必须明确提示：“菜单绑定用于导航可见性；对应 API 仍需独立执行权限检查”。
- 若当前选择的 permission 已停用、不存在或操作者无权分配，后端应拒绝保存并返回可理解错误。
- 只有在权限目录中已有对应权限 code 时才可绑定。菜单管理不得暗中创建权限，也不得通过修改菜单来授予角色权限。

### 3.4 子菜单影响提示

编辑父级时展示子菜单摘要，例如“此目录包含 4 个子菜单”。用户停用父菜单、隐藏父菜单或移动父级时，列出可能受影响的后代。不要默默级联改变所有孩子的 `enabled` 或 `visible`。

## 4. 新增、编辑、排序、启停与删除流程

### 4.1 新增一级菜单

1. 点击“新增菜单”。
2. 父菜单默认“无（一级菜单）”。
3. 输入 code、类型、翻译名称、图标、路由、排序、状态和绑定权限。
4. 前端做即时校验，提交后端仍须重复校验。
5. 成功后关闭 Drawer、刷新树、保留当前筛选和展开路径，提示“菜单已创建”。

### 4.2 添加子菜单

每条目录行都有“添加子菜单”快捷操作，打开与新增相同的表单并预选当前节点为父菜单。若当前节点类型为页面，不允许直接添加子菜单；应先选择/转换成 GROUP（转换仅在无冲突时允许）或选择其他父目录。

### 4.3 编辑菜单

点击编辑，先读取菜单详情和所有翻译记录，再填充表单。保存时仅提交允许变更的字段。`code`、`id`、创建时间不允许在普通编辑中变更。父节点变更必须重新执行循环检测、深度限制和路由冲突检查。

### 4.4 排序

- 同一个父级下排序；不能拖拽跨层级，除非显式通过父菜单选择完成移动。
- 一次拖拽提交完整的同级 ID 与新 sortOrder 列表，服务端校验这些 ID 都是同一父级的菜单。
- 排序更新在事务中完成，失败时回滚并恢复原 UI；保存成功后使导航树缓存失效。
- 如首版不实现拖拽，则必须先不显示拖拽控件；可以提供“上移/下移”并调用同一排序端点。

### 4.5 删除保护

删除必须二次确认并展示名称、code、父级和影响。

- 有子菜单的节点不可直接删除；提示先移动或逐个处理子菜单。
- 系统关键菜单（Dashboard、用户/角色/菜单管理等）应通过系统保护策略阻止普通删除，保护策略依据 code/系统标记配置，不可只靠按钮隐藏。
- 删除前检查该菜单是否在当前导航、路由配置、书签/外部链接或其他业务配置中被引用；删除菜单不等于删除权限定义。
- 删除菜单不得级联删除 `Permission` 或 `RolePermission`；菜单 `permissionCode` 只是一项引用。
- 对仍被使用的权限 code、具有子节点或违反系统保护策略的删除请求，服务端返回 `409 MENU_IN_USE` 等明确错误。
- 操作必须写审计日志。若需要软删除，需先在数据模型中明确状态和恢复流程；当前 schema 没有 `deletedAt`，不要未经批准擅自增加后假设已有软删除能力。

## 5. 数据模型与现有 Prisma schema 的兼容方式

### 5.1 当前结构（实施前核实实际仓库）

当前基线草案 `database/prisma/schema.prisma` 已包含：

- `Menu`: `id`、唯一 `code`、`parentId`、`route`、`icon`、`permissionCode`、`sortOrder`、`visible`、`enabled`、时间戳和自关联父子关系。
- `MenuTranslation`: `menuId`、`locale`、`label`，联合主键 `(menuId, locale)`。
- `Permission`: 唯一 `code`、`nameKey`、`module`。
- `RolePermission`: 角色与权限关联。

因此，基本 CRUD 与中英名称通常不需要新建重复表。先核对真实 schema 和 Migration，再决定是否需要字段迁移。

### 5.2 菜单类型字段的决策

现有 schema 没有 `menuType`。如果当前约定稳定为 `route == null` 表示目录、`route != null` 表示页面，首期可沿用该约定并在后端集中封装判断，降低迁移风险；但不能让各个 UI 组件各自推断。

若确认需要支持外部链接、纯分组、路由页面等不同类型，建议新增枚举/字段 `menuType`，并按以下安全迁移顺序执行：

1. 添加可空字段或带兼容默认值的字段；
2. 回填 `route IS NULL` 的目录节点和 `route IS NOT NULL` 的页面节点；
3. 校验数据：页面有 route、目录无 route、外链 URL 合法；
4. 更新 API 与 UI 同时兼容旧数据；
5. 生成 Prisma migration、测试升级和回滚；
6. 数据稳定后再改成非空约束。

在没有真实代码审计前，不要直接强制新增字段或改变 `route` 语义。如果现有 schema 与实际项目不一致，以真实仓库为准，文档不是修改生产数据的授权。

### 5.3 推荐约束与数据校验

- `code` 唯一且稳定，创建后不允许普通编辑。
- `parentId` 不得等于自身，不允许把节点移动到自己的任何后代下面。
- 目录树应有最大深度限制（建议初始 5 层，可配置）；若业务明确要无限层级，则仍应有防循环校验。
- `route` 需要规范化；同一应用中不允许两个启用的 PAGE 菜单使用同一路由，除非确认为别名并有显式设计。
- 同一父级排序读取采用 `ORDER BY sortOrder ASC, code ASC` 之类的稳定次序。
- `MenuTranslation` 同一 locale 的 label 去空格后不能为空；建议限制 1–160 字符。
- `permissionCode` 应在保存时验证存在；如当前权限管理 API 允许权限停用，需验证是否可继续绑定。
- 改父级、路由、权限绑定、启停、可见性、翻译都写入审计变更摘要，但日志不要记录不必要的敏感数据。

## 6. API 合约建议

> 实施前先搜索并复用现有端点。如果已有路径或响应格式不同，按现有 API 规范映射，不要创建功能重复的第二套 API。

建议 REST 端点：

| Method | Path | 用途 | 权限示例 |
|---|---|---|---|
| GET | `/api/admin/menus/tree` | 获取菜单树，支持 `locale`、`enabled`、`visible`、`q` | `menu.read` |
| GET | `/api/admin/menus` | 分页列表/筛选；如树查询已覆盖后台用例可不另设 | `menu.read` |
| GET | `/api/admin/menus/:id` | 详情及所有 locale 翻译 | `menu.read` |
| POST | `/api/admin/menus` | 新建菜单 | `menu.create` |
| PATCH | `/api/admin/menus/:id` | 更新允许编辑字段 | `menu.update` |
| PATCH | `/api/admin/menus/:id/status` | 启停/导航可见性 | `menu.update` |
| PATCH | `/api/admin/menus/reorder` | 同级排序 | `menu.update` |
| DELETE | `/api/admin/menus/:id` | 受保护删除 | `menu.delete` |
| GET | `/api/admin/permissions/options` | 菜单表单可选权限清单 | `permission.read` 或按当前模型制定安全规则 |

权限 code (`menu.read` 等) 只是建议名，需对照已有 `Permission` 种子数据；如果当前系统使用 `menus.read` 或其他命名，应沿用已存在规范，迁移需同步菜单与角色授权。

### 6.1 新建/更新请求示例

```json
{
  "code": "product-management",
  "parentId": "<uuid-or-null>",
  "route": "/products",
  "icon": "package",
  "permissionCode": "product.read",
  "sortOrder": 20,
  "visible": true,
  "enabled": true,
  "translations": [
    { "locale": "zh-CN", "label": "商品管理" },
    { "locale": "en-US", "label": "Product Management" }
  ]
}
```

示例字段必须由 DTO 显式校验。若采用 `menuType`，请求应显式包含并根据类型校验 route；若未采用该字段，则由服务端依据已确认的现有规则校验。更新请求建议使用 `PATCH` 并拒绝未识别字段。

### 6.2 权限选项响应示例

```json
{
  "items": [
    { "code": "product.read", "name": "读取商品", "module": "product" },
    { "code": "product.update", "name": "编辑商品", "module": "product" },
    { "code": "category.read", "name": "读取品类", "module": "category" }
  ]
}
```

### 6.3 删除冲突响应示例

```json
{
  "code": "MENU_HAS_CHILDREN",
  "message": "该菜单仍有子菜单，请先移动或处理所有子菜单。",
  "details": { "childrenCount": 3 }
}
```

建议错误码：`MENU_CODE_EXISTS`、`MENU_ROUTE_EXISTS`、`MENU_PARENT_CYCLE`、`MENU_PARENT_INVALID`、`MENU_HAS_CHILDREN`、`MENU_IN_USE`、`PERMISSION_NOT_FOUND`、`MENU_TYPE_ROUTE_MISMATCH`。前端应将错误映射到中文/英文文案，不直接把服务端 stack trace 展示给用户。

## 7. 菜单层级建议及每个子菜单的维护细节

以下结构与当前侧栏截图和现有页面路由相对应，是建议的导航基线。具体 code、路由与 permission code 必须以实际代码及现有权限种子为准；下表中的部分权限编码是规范化示例，不可未经核对直接批量写入生产库。

| 一级菜单（建议 code） | 子菜单显示名 | 建议路由 | 建议权限 code（需核实） | 菜单属性/说明 |
|---|---|---|---|---|
| 工作台 `workspace` | 运营总览 | `/dashboard` | `dashboard.read` | 一级分组；子级页面。 |
| 商品目录 `catalog` | 商品管理 | `/products` | `product.read` | 商品列表、搜索、上/下架入口受独立权限控制。 |
| 商品目录 `catalog` | 品类管理 | `/categories` | `category.read` | 维护无限级目录树。 |
| 商品目录 `catalog` | 标签管理 | `/tags` | `tag.read` | 管理商品标签。 |
| 询盘与分析 `leads-analytics` | WhatsApp 客户 | `/leads` | `customer.read` | 客户电话查询、接待人与询盘记录。 |
| 询盘与分析 `leads-analytics` | 访问分析 | `/analytics` | `analytics.read` | 国家聚合、PV/UV/活跃会话等数据。 |
| 报价与文件 `quotes-files` | 报价模板 | `/quote-templates` | `quote-template.read` | Excel 模板上传、版本、字段映射。 |
| 报价与文件 `quotes-files` | 导出记录 | `/quote-exports` | `quote-export.read` | 下载历史导出文件、删除记录与物理文件联动。 |
| 报价与文件 `quotes-files` | 形式发票 PI | `/pi` | `pi.read` | PI 草稿、明细、版本和 Excel 输出。 |
| 内容管理 `content-management` | 广告管理 | `/ads` | `ad.read` | 广告素材、投放位、启用状态和时间范围。 |
| 内容管理 `content-management` | 内容页面 | `/content-pages` | `content.read` | About、Contact、FAQ 等页面维护。 |
| 系统管理（优先核实 `administration` / `system`） | 用户管理 | `/users` | `user.read` | 用户 CRUD；登录账号、角色、状态分权操作。 |
| 系统管理 | 角色权限 | `/roles` | `role.read` | 角色 CRUD、角色与权限关联。 |
| 系统管理 | 菜单管理 | `/menus` | `menu.read` | 当前正在改造的菜单树管理。 |
| 系统管理 | 字典管理 | `/dictionaries` | `dictionary.read` | 业务字典类型和字典项。 |
| 系统管理 | 全局设置 | `/settings` | `settings.read` | 系统级配置，敏感设置需额外权限。 |
| 系统管理 | 审计日志 | `/audit-logs` | `audit-log.read` | 查询管理操作审计。 |

### 7.1 父级菜单的规则

- 父级主要用于分组和导航折叠，本身通常不对应一个页面路由；没有 route 时应显示 `—`。
- 父级是否出现在侧栏，应根据 `enabled`、`visible` 和用户可访问的后代菜单计算，避免出现“空目录”。
- 如果父级配置了 permissionCode，必须查明当前导航筛选算法是否使用它；禁止同时用父级权限和子级权限造成不透明的双重隐藏。
- 父级停用/隐藏不自动修改子级字段；运行时导航应遵循统一规则并提示管理员影响范围。

### 7.2 子菜单规则

- 页面子菜单通常要配置唯一 `route`、图标可选、排序、至少一个 locale 标签和读权限 code。
- 左侧导航是否显示和页面 API 是否允许访问是两项不同判断：导航服务可以按权限过滤菜单，页面路由和后端 API 还需执行独立校验。
- 新页面上线顺序应为：先注册路由与 API 权限，再配置权限定义/种子，然后创建菜单及翻译，最后给角色分配权限。不可先把菜单显示出来但对应页面/接口不存在。
- 删除一个菜单不应自动删除该页面路由，也不应删除权限定义；这两个资源需要各自走下线流程。

### 7.3 当前重复“系统管理”的数据治理

截图显示 `administration` 有 6 个子菜单且启用，`system` 无子菜单且停用。建议：

1. 通过只读查询取得两条菜单的 ID、父级、翻译、route、permissionCode、所有子菜单及创建更新时间。
2. 确认 `/users`、`/roles`、`/menus`、字典、全局设置、审计日志实际挂在哪个父节点。
3. 查询代码与种子数据是否仍引用 `system` code；查询当前路由是否依赖菜单 ID。
4. 先将规范的活动节点定为唯一“系统管理”父级，迁移/移动子菜单需保留稳定 ID 或准备映射方案。
5. 只有确认 `system` 节点无孩子、无外部引用且不再需要后，才通过菜单管理删除或在维护迁移中清理；操作要有数据库备份、审计和回滚 SQL。
6. 不允许 AI 看到重复名称就直接删除 `administration` 或 `system`，更不得批量重建所有菜单造成角色授权丢失。

## 8. 服务端权限、安全和一致性

### 8.1 菜单管理本身的权限

读取菜单必须校验 `menu.read`（或已存在的等价权限）；创建、更新、排序和删除分别校验对应权限。只有 `super_admin` 可以管理关键系统菜单的策略应在服务端明确配置，不以角色名称字符串作为唯一检查手段；优先通过 `isSystem`/受保护 code 集合与专用权限校验执行。

### 8.2 防止树结构损坏

所有树约束只由前端校验不够，后端必须再次检查：

- `parentId` 对应记录存在；
- 父菜单类型允许承载子节点；
- 不形成循环；
- 移动后不会超出最大层级；
- 更新排序时传入的菜单 ID 都属于同一个 `parentId`；
- route 唯一性与 route 格式有效；
- translation locale 合法、同一 locale 不重复；
- permission code 存在且有效。

树变化和翻译更新应该在同一个数据库事务中提交。出现冲突时整笔回滚，不可只保存了 Menu 却没有保存翻译。

### 8.3 导航缓存和权限缓存

新增、编辑、删除、移动、排序、切换 enabled/visible、修改 permissionCode 或翻译后，必须让相关菜单树缓存失效。改变 permission 定义或角色授权时还需按角色/用户维度刷新授权缓存。刷新失败要记录可观测错误并安全重试；不能要求管理员必须重新部署前端才看到变化。

### 8.4 审计日志

至少记录 actor、action、entityType=`menu`、entityId、requestId、发生时间和非敏感变更摘要。需要记录的 action 示例：`menu.created`、`menu.updated`、`menu.reordered`、`menu.enabled_changed`、`menu.visibility_changed`、`menu.deleted`。日志不要记录 session token、Cookie 或堆栈中的密钥。

## 9. 前端组件、状态和 i18n 要求

建议组件拆分：

- `MenuManagementPage`：页面容器、查询条件和 API 状态。
- `MenuTreeTable`：树渲染、展开收起、空/加载/错误态。
- `MenuFilterBar`：搜索与过滤。
- `MenuFormDrawer`：新增/编辑统一表单。
- `MenuParentSelector`：排除当前节点及其后代。
- `PermissionCodeSelector`：从权限 API 查询、搜索并选择 code。
- `MenuTranslationFields`：根据 locale 配置动态生成翻译输入。
- `MenuDeleteConfirmDialog`：展示不可逆动作和后代影响。
- `MenuReorderControls`：同级排序、保存和失败恢复。

前端状态必须区分 `loading`、`saving`、`error`、`empty`。提交期间防止重复点击；关闭有未保存更改的 Drawer 时提示确认；保存失败保留表单值。权限树的当前数据和翻译必须由服务端返回，不可只修改本地显示而未持久化。

建议 i18n key（具体命名遵循现有项目约定）：

- `menu.title`、`menu.create`、`menu.edit`、`menu.addChild`
- `menu.fields.code`、`menu.fields.parent`、`menu.fields.route`、`menu.fields.permission`
- `menu.fields.enabled`、`menu.fields.visible`、`menu.fields.sortOrder`
- `menu.translations.zhCN`、`menu.translations.enUS`
- `menu.errors.codeExists`、`menu.errors.routeExists`、`menu.errors.hasChildren`
- `menu.errors.parentCycle`、`menu.errors.permissionNotFound`
- `common.search`、`common.reset`、`common.save`、`common.cancel`、`common.retry`

## 10. 测试计划与验收标准

### 10.1 功能用例

1. 列表加载成功并按 `sortOrder` 稳定显示父子层级。
2. 新建一级菜单，输入中英文名称，保存后在树中出现，刷新后仍存在。
3. 在某目录下新增子菜单，确认父子关系正确并能展开/收起。
4. 编辑标签、图标、路由、权限绑定、排序、enabled、visible，逐项刷新验证持久化。
5. 搜索子菜单时返回匹配项以及必要祖先，重置恢复全树。
6. 切换 `zh-CN` / `en-US`，菜单名称正确切换，code/route 不变。
7. 删除有孩子的目录得到明确拒绝；删除允许删除的叶子菜单需要二次确认并成功；相关 `Permission` / `RolePermission` 不被级联删除。
8. 角色无菜单读取权限时无法调用 GET API；无更新权限时直接调用 PATCH 必须被拒绝。
9. 无效 permission code、重复 code、重复启用 route、未知 locale、无效 URL 均返回 4xx 且不写入部分数据。
10. 把节点移动到自己的后代下应失败；移动跨层级成功后树与缓存都正确。
11. 排序请求部分失败时事务回滚，UI 恢复服务端顺序。
12. 两名管理员同时编辑时，采用 `updatedAt` 或版本号的乐观锁策略，避免后写静默覆盖前写（如项目暂无版本字段，至少比较更新时间并提示刷新）。

### 10.2 数据/权限专项

- 确保菜单隐藏不代表直接访问页面就被授权；无 API 权限访问仍返回 403。
- 子菜单权限不足时，父级空目录按统一策略隐藏。
- 删除系统保护菜单、删除含子菜单节点、修改最后一条系统管理入口、移动权限关键节点全部被拒绝。
- 系统菜单改动写审计日志；菜单变更后菜单树缓存及时失效。
- 处理 `administration` / `system` 重复节点时有查询记录、备份和回滚步骤。

### 10.3 UI 与兼容

- 视口至少验证 360px、768px、1024px、1440px。
- 不出现横向页面溢出；手机端操作收纳进更多菜单。
- 所有按钮有可访问名称、键盘焦点、禁用/加载态。
- 中英文标题、表单校验、确认弹窗、API 错误均完成本地化。
- 无真实数据时显示清晰空状态，不展示静态假菜单。

## 11. 分阶段实施计划

### Step 1：现状盘点（先做）

- 检查真实项目中 `/menus` 页面、共享 Admin Shell、路由与翻译文件。
- 找到现有 Menu CRUD / 导航树 / Permission 查询 API；复用已有 API，避免重复实现。
- 对照当前数据库迁移核实 Menu 与 MenuTranslation 字段，运行只读数据检查。
- 明确所有权限 code、系统菜单保护策略以及当前 `administration`/`system` 两个节点的引用关系。

交付：现状清单、API 映射表、数据风险清单。不修改生产数据。

### Step 2：先完成后端

- 为缺失的菜单读取、详情、新建、更新、排序、状态和删除接口补实现。
- DTO 做严格校验；树约束、角色授权和系统节点删除保护必须在服务端执行。
- 确保 Menu + MenuTranslation 事务一致；写审计日志、失效菜单缓存。
- 如需变更 Prisma schema，提交版本化 migration、回滚说明与测试数据迁移。

### Step 3：实现前端管理页

- 将平铺表格升级为树形表格。
- 增加查询栏、展开/折叠、刷新、添加一级菜单、添加子菜单、新建/编辑 Drawer、权限选择器和删除确认。
- 完成中英文翻译、加载/错误/空状态、表单校验与未保存提醒。
- 按响应式规范处理窄屏布局。

### Step 4：修复现存重复数据并验收

- 在开发/测试数据库先演练系统管理节点清理，不直接在生产库尝试。
- 执行单元、集成和 E2E 测试；验证权限拒绝和缓存失效。
- 发布前备份数据库、演练回滚；监控 API 4xx/5xx 与菜单读取异常。

## 12. Definition of Done

- [ ] 页面提供可用的查询、清空、刷新、展开/折叠和新增操作。
- [ ] 可新增一级菜单和子菜单；同一个表单支持编辑。
- [ ] 菜单名称按 locale 动态管理，中文/英文切换正常。
- [ ] route、permissionCode 来自被校验的结构化字段，而非未验证文本。
- [ ] enabled 与 visible 含义分离，界面和服务端行为一致。
- [ ] 树循环、父子类型、路由冲突、权限缺失、删除冲突在服务端拒绝。
- [ ] 删除不级联删除 Permission 与 RolePermission。
- [ ] 菜单变化写审计、缓存及时失效。
- [ ] `administration` / `system` 重复节点经过调查，不被盲目删除或重建。
- [ ] lint、typecheck、相关测试、build 和数据库 migration 验证通过；未执行的检查在交付中明确说明。

## 13. 给 AI 编码助手的执行提示词

> 请先读取项目根目录 `AGENTS.md`、`docs/06-admin-public-ui-standard.md`、`docs/07-backend-standard.md`、`docs/18-role-permission-crud-and-menu-permissions.md` 和 `docs/19-menu-management-crud-and-submenu-design.md`，以及 `.agents/skills/menu-management/SKILL.md`。先检查实际仓库中的菜单页面、API、Prisma schema、权限 code、导航缓存和现有种子数据，再列出现状及差距，不要凭文档直接假定代码已存在。
>
> 按本方案实现菜单管理的查询、树形展示、新增一级菜单、新增子菜单、编辑、权限绑定、国际化翻译、排序、启停/可见和受保护删除。权限选项必须从现有权限 API 返回；不要硬编码权限列表。先后端后前端，事务处理菜单和翻译更新，添加审计及缓存失效。对 `administration` / `system` 重复菜单只提供诊断和迁移建议，未经验证不能自动删除或重建。完成后运行 lint、typecheck、相关单元/集成测试与 build，汇总改动文件、迁移文件、测试结果和剩余风险。

## 14. 设计决策摘要

1. 默认主视图为可展开树形表格，不再只显示无层级的平铺记录。
2. 新建与编辑复用 Drawer，支持父菜单、路由、权限、状态、排序和多语言翻译。
3. `code` 是稳定系统标识，创建后普通编辑只读；显示标签可翻译。
4. `enabled` 表示该配置是否参与导航，`visible` 表示是否向用户展示导航项；二者都不等于 API 授权。
5. permission code 来自权限目录 API；菜单绑定不自动授予角色权限。
6. 先兼容当前 Prisma schema；只有确认存在实际业务需求后再新增 `menuType`，任何 schema 变化都必须有 migration、数据回填和回滚步骤。
7. `administration` 与 `system` 的重复节点必须查明引用后治理，不进行盲目删除。
