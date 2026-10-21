# 系统管理：字典管理两层模型与业务复用改造方案

> 文档编号：DOC-20  
> 版本：1.0.0  
> 适用模块：`/zh-CN/dictionary`、后台表单字典加载、商品状态、付款条款、询盘来源等  
> 文档性质：可执行的产品 / 前端 / 后端 / 数据库 / 测试实施基线  
> 前置规则：先阅读项目根目录 `AGENTS.md`、`docs/07-backend-standard.md`、`.agents/skills/dictionary-management/SKILL.md`。

---

## 1. 背景与当前问题

从当前字典管理页面截图可见，页面将 `home-hero`、`tt-30`、`draft`、`available` 等条目放在同一张平铺表格中，列包含 `code`、`value`、`en-US`、`zh-CN`、状态和操作。用户无法直观看出一个条目属于哪个业务字典，也无法按“商品状态”一次取得全部状态选项。

当前页面还存在几个需要在改造中一起处理的问题：

1. **一级字典类型不可见**：页面直接显示二级字典项，没有“商品生命周期状态”“商品发布状态”“付款条款”等分组上下文。
2. **`code` 与 `value` 含义不清**：下游业务容易混用 code、value 和翻译 label，导致保存中文/英文文案而非稳定业务值。
3. **业务状态被混在同一数据列表**：商品发布状态、商品生命周期状态、付款条款、内容位置、客户来源可能被混为一类。
4. **系统锁定规则与操作按钮不一致**：如果记录为 locked，删除/停用按钮必须被隐藏或禁用，并说明原因，不能让用户点击后才失败。
5. **现有业务字段仍使用 enum**：当前 `Product` 模型的 `lifecycleStatus` 和 `publishStatus` 是 Prisma enum。即使界面展示字典，业务真实字段仍可能没有使用字典配置，因此必须明确迁移策略。
6. **新增字典不能自动改变业务流程**：新增一个状态选项只代表配置中出现了该值，不代表后端自动知道该状态的转移规则、前台展示行为或导出逻辑。

## 2. 目标与非目标

### 2.1 目标

- 字典统一为两层结构：**字典类型（一级）→ 字典项（二级）**。
- 一级类型用稳定的 `typeCode` 标识；二级条目用稳定的 `itemCode` 标识。
- 每个类型可包含任意数量的启用/停用条目；条目支持中英文 label、排序、系统锁定和状态维护。
- 业务页面只传入一级 `typeCode`，API 返回此类型下所有符合条件的二级项；前端可以用作下拉框、单选、多选、筛选器和标签展示。
- 业务存储稳定 code / item ID，不存翻译后的中文或英文 label。
- 类型、条目与业务引用的增删改规则明确，防止删除后产生孤儿数据。
- 区分纯配置型字典与会影响业务流程的状态字典。

### 2.2 非目标

- 不把字典系统做成可任意编程的工作流引擎。
- 不允许管理员通过添加任意状态名称，就自动改变所有后端流程条件。
- 不以字典替代 `Role`、`Permission`、菜单权限、商品分类或其他有专属业务模型的实体。
- 不因本次改造就重写所有业务状态；需按本文迁移计划渐进落地。

## 3. 核心概念与命名规则

### 3.1 两层数据结构

| 层级 | 模型 | 示例 | 说明 |
|---|---|---|---|
| 一级 | `DictionaryType` | `product_lifecycle_status` | 一组语义相同的可选项，以稳定 code 唯一识别 |
| 二级 | `DictionaryItem` | `available` | 某一类型中的一个选项；同一类型下 code 唯一 |
| 翻译 | `DictionaryItemTranslation` | `zh-CN → 可用` | 每个选项针对不同 locale 的展示文案 |

数据读取示意：

```text
传入 typeCode = "product_lifecycle_status"
                 ↓
DictionaryType(code = product_lifecycle_status)
                 ↓
DictionaryItem(typeId = 该类型 id)
  ├─ available      → Available / 可用
  ├─ preorder       → Pre-order / 预售
  └─ discontinued   → Discontinued / 已停产
```

### 3.2 字段定义

- `DictionaryType.code`：一级稳定业务键，全局唯一；建议新值使用小写 `snake_case`，例如 `product_lifecycle_status`。
- `DictionaryType.nameKey`：后台界面翻译资源 key，例如 `dictionary.types.productLifecycleStatus`。不要把当前界面语言的名称直接当业务键。
- `DictionaryItem.code`：二级稳定业务键，在同一类型内唯一；创建后原则上不可修改。示例 `available`、`preorder`、`discontinued`。
- `DictionaryItem.value`：当前模型保留的可选扩展值/兼容字段，**不得与 `code` 或显示 label 混用**。新功能如没有明确用途，留空即可。后续可在完成全仓库引用盘点后决定是否弃用。
- `DictionaryItemTranslation.label`：按 `locale` 存储的显示名称。保存表单时不应把该 label 当业务值提交。
- `sortOrder`：同类型内部排序，值越小越靠前；排序相同需再按稳定字段排序。
- `enabled`：是否提供给普通业务选择器。后台管理列表可查看停用项，但常规选项 API 默认不返回停用项。
- `systemLocked`：是否受保护。锁定项不能通过普通 UI 删除或停用；后端必须再次校验。

### 3.3 业务 API 应用的标准对象

前端标准化为 `value = item.code`、`label = 当前 locale 的翻译 label`，避免各页面自己推导：

```ts
export type DictionaryOption = {
  id: string;
  code: string;       // 稳定业务键，提交/过滤用
  label: string;      // 按 locale 返回的显示文案，只用于展示
  sortOrder: number;
  enabled: boolean;
};
```

不得把 `label` 用于后端条件判断。禁止依赖中文文本（例如 `已发布`）分支业务逻辑。

## 4. 字典类型规划与示例数据

首批建议类型如下。**这是推荐业务分组，不代表应当不经数据核查就自动搬移现有所有数据。**

| typeCode | 后台名称（示例） | 二级 itemCode 示例 | 用途 | 是否影响业务流程 |
|---|---|---|---|---|
| `product_lifecycle_status` | 商品生命周期状态 | `available`、`preorder`、`discontinued` | 表示商品可用、预售、已停产 | 是，需固定允许值或同步实现业务逻辑 |
| `product_publish_status` | 商品发布状态 | `draft`、`published`、`unpublished` | 控制草稿、发布、下架 | 是，需固定允许值或同步实现业务逻辑 |
| `payment_terms` | 付款条款 | `tt_30`、`lc_at_sight` | PI / 报价单付款条款选项 | 通常是可配置选项；金额结算逻辑仍需单独定义 |
| `content_placement` | 内容展示位置 | `home_hero`、`catalog_top`、`sidebar` | 广告/内容展示位（须确认实际语义） | 是，位置代码必须被展示组件识别 |
| `inquiry_source` | 询盘来源 | `manual`、`website_click`、`whatsapp_webhook` | 询盘来源统计（须确认现有含义） | 影响统计分类，但不改变询盘处理流程 |
| `packaging_type` | 包装方式 | 由业务确定 | 商品包装属性 | 通常是可配置选项 |

### 4.1 对当前截图中现有条目的处理建议

页面中的 `home-hero`、`catalog-top`、`sidebar`、`tt-30`、`lc-at-sight`、`manual`、`website_click`、`whatsapp_webhook`、`draft`、`published`、`unpublished`、`available`、`preorder`、`discontinued` 看起来可能属于不同类型。

迁移前必须先查真实关联，不可只按 code 猜测：

```sql
SELECT
  dt.code AS type_code,
  dt."nameKey" AS type_name_key,
  di.code AS item_code,
  di.value,
  di.enabled,
  di."systemLocked",
  di."sortOrder"
FROM dictionary_types dt
JOIN dictionary_items di ON di."typeId" = dt.id
ORDER BY dt.code, di."sortOrder", di.code;
```

根据实际结果确认：

- 如果数据库已经正确保存 `DictionaryType → DictionaryItem` 关系，只是前端把所有 items 扁平化，那么**不需要重建字典表**，主要改页面查询、API 和类型分组展示。
- 如果所有条目确实错误地挂在同一个类型下，再做分类迁移。`manual`、`whatsapp_webhook` 的真实业务含义必须找业务方确认后再分组。
- 先导出备份与映射清单；对未识别条目列入待确认表，不自动删除、不静默丢弃。

## 5. 后台 UI 改造方案

### 5.1 页面模式

路由维持 `/[locale]/dictionary`，但页面内容从平铺 item 表格调整为“一级类型列表 + 选中类型的二级项管理”。

桌面端推荐主从布局：

- 左区宽度建议 `260–320px`：字典类型列表、类型搜索、新建类型、类型启用状态、每个类型的 item 数量。
- 右区占据剩余宽度：当前类型摘要、类型编辑入口、字典项搜索、启用/停用筛选、新增字典项按钮、字典项表格。
- 左侧选中类型后，右侧只显示该类型的 item；URL 建议同步 `?type=product_lifecycle_status`，刷新可恢复上下文。
- 手机端改为先显示类型列表，进入类型后展示二级项；提供明显的返回类型列表按钮。

### 5.2 一级类型列表列

| 列 | 展示内容 |
|---|---|
| 类型名称 | 从 `nameKey` 的 locale 资源解析；必要时显示备用名称 |
| 类型编码 | `product_lifecycle_status`，使用等宽字体 |
| 描述 | 可空，说明该类型的业务用途 |
| 字典项数量 | 当前类型下所有 item 数量，可区分启用数量 |
| 状态 | 启用/停用 |
| 系统锁定 | 锁图标 + 明确说明；不是可随意删除的标记 |
| 操作 | 查看字典项、编辑类型；仅非锁定且无引用时显示删除操作 |

顶部工具栏：关键词搜索（编码/名称 key/描述）、状态筛选、`新建字典类型`。搜索需防抖并提供清空操作。

### 5.3 二级字典项列表列

| 列 | 展示内容 |
|---|---|
| 编码 | item 的稳定 code，例如 `preorder` |
| 扩展值 | 只有 `value` 字段确有业务意义时才展示，否则隐藏 |
| 中文名称 | `zh-CN` 翻译，不是业务键 |
| 英文名称 | `en-US` 翻译，不是业务键 |
| 排序 | 数字或同类型拖拽排序；保存后持久化 |
| 状态 | 启用/停用 |
| 锁定 | 锁定项显示锁图标和原因 |
| 使用情况 | 若接入引用计数，显示产品/PI 等关联数量；至少删除前由服务端校验 |
| 操作 | 编辑、启用/停用、删除（受锁定和引用规则限制） |

顶部显示当前类型名和编码，例如 `商品生命周期状态 / product_lifecycle_status`，防止维护人员误改类型。

### 5.4 新建/编辑字典类型表单

字段：

1. 类型编码 `code`（必填、唯一、创建后只读）。
2. 类型名称翻译 key `nameKey`（必填，必须是可解析的 i18n key；或者沿用团队既有的翻译管理方式）。
3. 描述 `description`（可选）。
4. 状态 `enabled`。
5. 系统锁定 `systemLocked` 只允许受控初始化/系统管理员流程设置，不暴露给普通管理员自由切换。

规则：新建类型创建后可直接进入该类型的字典项管理；类型编码不允许在普通编辑流程中变更，避免业务引用失效。

### 5.5 新建/编辑字典项表单

字段：

1. 所属类型（从一级类型 API 选择；编辑时固定为当前类型，若需要移动条目应设计专门迁移操作，不允许普通编辑直接改 typeId）。
2. 条目编码 `code`（必填、该类型内唯一；创建后原则上只读）。
3. 中文名称 `zh-CN`（按项目语言策略要求必填或按需放宽）。
4. 英文名称 `en-US`（按项目语言策略要求必填或按需放宽）。
5. 扩展值 `value`（非必填，仅当已有下游逻辑确实依赖时显示并说明用途）。
6. 排序 `sortOrder`。
7. 启用状态 `enabled`。
8. 系统锁定状态只读显示；普通用户不可直接切换。

提交校验：code 格式合法；同类型无重复；翻译文本 trim 后非空；长度符合数据库限制；排序为有效整数；不允许通过编辑把 `systemLocked` 改成 false。

### 5.6 删除和停用交互

- 系统锁定的类型/项：按钮隐藏或 disabled，并展示“系统字典不可删除/停用”的说明。
- 有业务引用的类型/项：禁止删除；优先提示“仍被 N 条数据引用，请停用或迁移引用”，不要级联删除业务数据。
- 已被业务记录引用但业务还需显示历史 label 的 item：可停用，但历史数据详情仍需能解析其 code/label；是否允许停用由具体类型策略决定。
- 停用 item 后，常规下拉选项默认不返回它；编辑历史记录时可以通过 `includeDisabled=true` 拉取当前值，避免表单显示空值。
- 删除必须二次确认并展示类型、item code、label；服务端再次执行锁定与引用校验。

## 6. API 设计

统一使用项目现有 API 前缀、认证方式、分页格式和异常结构；以下为推荐资源契约，若已有等价接口应优先复用而不是重复新增。

### 6.1 管理端：字典类型

| 方法 | 路径 | 用途 | 权限建议 |
|---|---|---|---|
| `GET` | `/api/admin/dictionary-types` | 分页/搜索类型列表，返回 itemCount | `dictionary.type.read` |
| `POST` | `/api/admin/dictionary-types` | 新建类型 | `dictionary.type.create` |
| `GET` | `/api/admin/dictionary-types/:id` | 类型详情 | `dictionary.type.read` |
| `PATCH` | `/api/admin/dictionary-types/:id` | 更新名称 key、描述、启用状态 | `dictionary.type.update` |
| `DELETE` | `/api/admin/dictionary-types/:id` | 删除无条目、无引用且非锁定的类型 | `dictionary.type.delete` |

列表支持 `keyword`、`enabled`、`page`、`pageSize`；`pageSize` 必须有上限。默认稳定排序为名称或 code，不依赖数据库默认返回顺序。

### 6.2 管理端：字典项

| 方法 | 路径 | 用途 | 权限建议 |
|---|---|---|---|
| `GET` | `/api/admin/dictionary-types/:typeCode/items` | 获取类型下的 item，默认可查看启用与停用状态供管理 | `dictionary.item.read` |
| `POST` | `/api/admin/dictionary-types/:typeCode/items` | 在指定类型中新建 item | `dictionary.item.create` |
| `GET` | `/api/admin/dictionary-items/:id` | item 详情和翻译 | `dictionary.item.read` |
| `PATCH` | `/api/admin/dictionary-items/:id` | 更新翻译、排序、状态及允许修改的值 | `dictionary.item.update` |
| `DELETE` | `/api/admin/dictionary-items/:id` | 删除未锁定、未被引用的 item | `dictionary.item.delete` |
| `POST` | `/api/admin/dictionary-types/:typeCode/reorder` | 同类型批量排序（可选） | `dictionary.item.update` |

建议 item 列表参数：`locale`、`enabled`、`keyword`、`includeUsageCount`。管理列表默认能看全部项；被业务表单调用的选项 API 默认只返回启用项。

### 6.3 供业务表单复用的选项接口

推荐：

```http
GET /api/admin/dictionaries/product_lifecycle_status/items?locale=zh-CN
```

等价 REST 设计也可以是 `/api/admin/dictionary-types/:typeCode/items?locale=zh-CN&enabled=true`。全项目选定一种路径，不要多套重复契约。

成功响应示例：

```json
{
  "type": {
    "code": "product_lifecycle_status",
    "name": "商品生命周期状态"
  },
  "locale": "zh-CN",
  "items": [
    {
      "id": "3d5bce67-5e8c-4d42-8821-c715f62a57fb",
      "code": "available",
      "label": "可用",
      "sortOrder": 10,
      "enabled": true
    },
    {
      "id": "4235634b-9c2e-41a9-851f-7e3e0c53557b",
      "code": "preorder",
      "label": "预售",
      "sortOrder": 20,
      "enabled": true
    },
    {
      "id": "8cd5a090-f6ed-4c2e-82c8-dcf8f14f0981",
      "code": "discontinued",
      "label": "已停产",
      "sortOrder": 30,
      "enabled": true
    }
  ]
}
```

以上 ID 仅为响应结构示例，不能复制到真实数据；实际 ID 必须由数据库产生。

### 6.4 API 错误处理

| HTTP 状态 | 错误码示例 | 场景 |
|---|---|---|
| 400 | `DICTIONARY_CODE_INVALID` | code 格式不合法 |
| 401 | `UNAUTHENTICATED` | 未登录 |
| 403 | `FORBIDDEN` | 无对应字典权限 |
| 404 | `DICTIONARY_TYPE_NOT_FOUND` | typeCode 不存在 |
| 409 | `DICTIONARY_CODE_DUPLICATED` | 类型内 item code 重复 |
| 409 | `DICTIONARY_ITEM_IN_USE` | 正在被业务记录引用，不能删除 |
| 409 | `DICTIONARY_SYSTEM_LOCKED` | 系统锁定项不可删除/停用 |
| 422 | `DICTIONARY_TYPE_MISMATCH` | 商品生命周期状态误传入发布状态类型的 item |

## 7. 数据库与 Prisma 设计

### 7.1 当前模型判断

当前项目 `schema.prisma` 已经具备：

- `DictionaryType`：一级类型；
- `DictionaryItem`：二级项，包含 `typeId`、`code`、`value`、排序、启用和锁定状态；
- `DictionaryItemTranslation`：二级项多语言翻译。

因此，字典的**基础两层表结构已经存在**。在没有查清实际数据库前，不应再增加一套 `DictionaryGroup` / `DictionaryValue` 表，也不应仅因 UI 扁平展示就立即重建表。

### 7.2 当前模型应保留的约束

```prisma
model DictionaryType {
  id           String           @id @default(uuid()) @db.Uuid
  code         String           @unique @db.VarChar(100)
  nameKey      String           @db.VarChar(180)
  description  String?
  systemLocked Boolean          @default(false)
  enabled      Boolean          @default(true)
  items        DictionaryItem[]
  createdAt    DateTime         @default(now()) @db.Timestamptz(6)
  updatedAt    DateTime         @updatedAt @db.Timestamptz(6)

  @@map("dictionary_types")
}

model DictionaryItem {
  id            String                        @id @default(uuid()) @db.Uuid
  typeId        String                        @db.Uuid
  code          String                        @db.VarChar(100)
  value         String?                       @db.VarChar(240) // 兼容字段，语义需明确
  sortOrder     Int                           @default(0)
  enabled       Boolean                       @default(true)
  systemLocked  Boolean                       @default(false)
  type          DictionaryType                @relation(fields: [typeId], references: [id], onDelete: Cascade)
  translations  DictionaryItemTranslation[]
  createdAt     DateTime                      @default(now()) @db.Timestamptz(6)
  updatedAt     DateTime                      @updatedAt @db.Timestamptz(6)

  @@unique([typeId, code])
  @@index([typeId, enabled, sortOrder])
  @@map("dictionary_items")
}
```

说明：类型的 `onDelete: Cascade` 关系只应在服务端确认该类型没有业务条目/引用后，才允许执行类型删除；优先采用应用层明确阻止删除，并根据数据库迁移评估是否有必要进一步将该关系改为 Restrict。不能让 API 直接删除类型导致字典项被级联清空。

### 7.3 是否增加类型翻译表

当前 `DictionaryType.nameKey` 可接入后台 `zh-CN` / `en-US` 资源文件。MVP 建议先沿用它，避免重复维护同一份翻译。如果运营人员需要在后台直接编辑类型名称，而非由开发维护 locale 资源，再增加 `DictionaryTypeTranslation(typeId, locale, label)`；那属于额外需求，需评估翻译缺失、回退和迁移策略后实施。

### 7.4 商品状态与字典的关系：必须做出的技术选择

当前 `Product` 里 `lifecycleStatus`、`publishStatus` 使用 Prisma enum，而字典管理又希望维护状态选项。必须避免“后台字典改了，但商品接口仍读取硬编码 enum”的双数据源问题。

**推荐方案：让商品记录引用对应的 `DictionaryItem`，并以 item code 执行业务语义。** 这需要一个单独的扩展/回填/收缩迁移；不要和 UI 改造混成一次不可回滚的大改。

目标关系示意：

```prisma
model Product {
  // ...其他字段
  lifecycleStatusItemId String         @db.Uuid
  publishStatusItemId   String         @db.Uuid
  lifecycleStatusItem   DictionaryItem @relation("ProductLifecycleStatus", fields: [lifecycleStatusItemId], references: [id], onDelete: Restrict)
  publishStatusItem     DictionaryItem @relation("ProductPublishStatus", fields: [publishStatusItemId], references: [id], onDelete: Restrict)
}

model DictionaryItem {
  // ...现有字段
  productsAsLifecycleStatus Product[] @relation("ProductLifecycleStatus")
  productsAsPublishStatus   Product[] @relation("ProductPublishStatus")
}
```

该代码展示目标关联方向，不是可直接覆盖现有文件的完整 schema。使用前需要把关系字段合并到现有模型、检查 Prisma 版本并运行 `prisma validate` / `prisma generate`。

后端保存商品时必须验证：

- `lifecycleStatusItemId` 对应的 item 必须属于 `product_lifecycle_status`；
- `publishStatusItemId` 对应的 item 必须属于 `product_publish_status`；
- item 必须启用，或者在某些历史记录编辑流程中明确允许保留当前已停用值；
- item 不存在、类型不匹配时返回 `422 DICTIONARY_TYPE_MISMATCH`；
- DB 外键应禁止删除仍有商品引用的条目。

> 重要边界：状态字典不能完全任意自定义。`draft`、`published`、`unpublished`、`available`、`preorder`、`discontinued` 会影响发布、查询、首页精选、新品和前台可见性等逻辑。MVP 中应把这两个类型标记为系统锁定类型；允许调整 label、排序和启用策略，但不允许普通管理员随意增删改变语义的 item。若业务确实要支持“审核中”等新状态，需要同时设计状态转移、权限、前台过滤、事件、报表和迁移，不能只添加字典项。

### 7.5 纯选项型字典

付款条款、包装方式、询盘来源等更适合动态字典。相关业务记录可按以下方案选一：

- 若历史记录需要严格追踪当时选项且不希望依赖 code 永久不变：存 `DictionaryItem.id` 外键，并在渲染历史记录时读取翻译；
- 若外部接口/导入文件必须稳定使用业务 code：保存 code，同时在服务端确保引用中的 code 不允许删除/改码。建议优先使用 item ID 关联，同时在 API/Excel 中导入导出稳定 `code`。

不论采用何种方式，所有被引用 item 都必须防止物理删除。停用用于阻止新单据选择；历史记录仍需要显示原值。

## 8. 商品状态迁移步骤（若决定将 enum 改成字典引用）

该流程建议与字典管理 UI 单独发布，采用 Expand → Backfill → Verify → Switch → Contract。

1. **盘点与备份**：统计 `Product.lifecycleStatus` / `publishStatus` 所有值与记录数，确认当前产品 API、前台查询、Excel 导出、PI 和测试夹具的使用点。
2. **准备字典数据**：创建两个系统锁定类型，并创建 code 与旧 enum 一一映射的 items 和 `zh-CN` / `en-US` translations。
3. **Expand**：新增可空的 `lifecycleStatusItemId` 与 `publishStatusItemId`，暂时保留旧 enum 字段；新增关系但先不删旧列。
4. **Backfill**：按旧 enum 值映射到对应 `DictionaryItem.id`；遇到无法映射的行，迁移必须失败并输出记录，禁止默认为 `available` 或 `draft`。
5. **Verify**：检查新外键列没有 NULL、所有 item 的 typeCode 匹配预期、行数一致、状态计数迁移前后完全一致。
6. **Switch**：部署同时读取新关系、必要时双写新旧字段的兼容版本；观察后切换所有读写点到新关系。
7. **Contract**：确认无旧版本服务实例、定时任务或脚本仍使用 enum 字段后，再删除旧列和 enum；该步骤放在独立发布中。
8. **Rollback**：切换前可以回退应用并保留新增列；contract 完成后回滚需用反向迁移从 dictionary item code 回填 enum，故 contract 需单独审批与备份。

由于字段命名和 SQL 引号取决于已部署数据库实际结构，迁移 SQL 必须通过生成的 Prisma migration 和测试数据库验证，不要直接复制未经验证的手写脚本上生产。

## 9. 前端调用与缓存规范

### 9.1 通用字典 Hook

封装一个共享 hook / service，例如：

```ts
useDictionaryOptions('product_lifecycle_status', { locale: 'zh-CN' })
```

统一负责：

- 按 `typeCode + locale + includeDisabled` 获取选项；
- `loading`、`error`、空数据和重试状态；
- 相同请求去重，不让每个页面各自复制请求逻辑；
- 从 API 返回的 `item.code` 作为 Select 的 value；`label` 作为 UI 文案；
- 编辑历史记录时允许用 `includeDisabled=true` 加载当前已停用的选项；
- 不把翻译 label 写回产品、PI、询盘等业务字段。

### 9.2 缓存

- key 至少包含 `typeCode`、`locale`、启停筛选参数和 API 版本。
- 修改 item 的 label、排序、enabled 或新增/删除后，失效对应 typeCode 的缓存；翻译变更需同时失效相关 locale。
- 后台管理页面保存成功后要重新请求或更新查询缓存，避免列表和下拉框显示旧数据。
- 可以设置短期服务端/客户端缓存，但不能让停用的状态长时间留在可新建记录的选择器里。

### 9.3 语言回退

建议顺序：请求的 locale → `en-US` → `zh-CN` → item code。缺翻译时不得返回空字符串造成空白 Select；后台可以显示“缺少翻译”提示。

### 9.4 业务提交规则

创建/编辑商品请求应提交稳定的 item ID（若落地第 7.4 节推荐关系），而不是用户看到的 `label`。接口响应可以同时返回 `code` 和本地化 `label`。付款条款等业务接口同理；Excel 导出应按业务需要选择稳定 code、当前语言 label 或两者，不要把 label 当主键。

## 10. 权限、审计和并发安全

建议权限编码：

- `dictionary.type.read/create/update/delete`
- `dictionary.item.read/create/update/delete`

如果项目已有统一的 dictionary 权限编码，复用既有约定，不重复造一套。

服务端每个 API 必须逐接口授权，不能仅靠菜单显示控制。类型编码、item code、翻译 locale、排序和 enabled 全部经过 DTO 校验。删除时在一个事务里检查锁定状态与业务引用，再执行删除；并发创建重复 code 依赖数据库唯一约束，捕获唯一约束异常转换为 409。

应写审计日志：`dictionary.type.created/updated/deleted`、`dictionary.item.created/updated/enabled/disabled/deleted`、`dictionary.item.translation.updated`。日志记录操作者、实体 ID、typeCode/itemCode、变更字段和 requestId；不要记录密码或秘密。

## 11. 测试与验收标准

### 11.1 功能测试

| 编号 | 场景 | 预期结果 |
|---|---|---|
| DIC-001 | 新建 `payment_terms` 类型 | 类型创建成功，code 唯一、进入详情可新增项 |
| DIC-002 | 同一类型重复创建 item code | 服务端返回 409，前端显示可理解错误 |
| DIC-003 | 建立 `product_lifecycle_status` 三个 item | `GET` 该 typeCode 返回全部启用项，按 sortOrder 排序 |
| DIC-004 | locale=zh-CN | 返回“可用、预售、已停产”等中文 label |
| DIC-005 | locale=en-US | 返回“Available、Pre-order、Discontinued”等英文 label |
| DIC-006 | 停用普通 option item | 常规选择器不再返回它，管理端仍可找到并启用 |
| DIC-007 | 编辑已有记录，其选项后来被停用 | 编辑表单仍显示现有值；不应无故清空或让保存失败 |
| DIC-008 | 删除系统锁定 item | UI 禁止操作，直接调用 API 仍被服务端拒绝 |
| DIC-009 | 删除被 Product / PI 等引用的 item | 返回 409，不级联删除业务记录 |
| DIC-010 | 把 publish-status item 传入 lifecycle-status 字段 | 返回 422 `DICTIONARY_TYPE_MISMATCH` |
| DIC-011 | 删除仍有 item 的 DictionaryType | 服务端拒绝，不触发级联清空 |
| DIC-012 | 修改翻译后再次打开产品表单 | 读取到新 label，无过期缓存 |
| DIC-013 | API 请求没有 dictionary 权限 | 返回 403；即使前端手动构造请求也不能操作 |
| DIC-014 | 类型无可用 item 或 API 超时 | 表单显示空态/错误重试，禁止悄悄提交非法值 |
| DIC-015 | 360px、平板和桌面窗口 | 无横向溢出；类型列表和 item 管理可操作 |

### 11.2 数据质量测试

- `DictionaryType.code` 全局唯一。
- `DictionaryItem(typeId, code)` 唯一。
- 每条 translation 的 locale/itemId 组合唯一。
- 启用类型中，业务表单返回的 item 都必须 enabled；特殊编辑场景明确 includeDisabled。
- 代码中没有使用 label/中文字符串作为业务判断。
- 若迁移产品状态，旧 enum 计数与回填后按新 item code 统计的计数相等。
- 不存在无法映射的旧状态、孤儿 item ID 或跨类型状态引用。

### 11.3 完成标准（DoD）

- 页面从平铺 item 表改成明确显示一级类型和二级项。
- 类型与 item 的 CRUD、搜索、筛选、排序、翻译、锁定、引用保护均完成。
- 至少商品状态、付款条款各有一个业务页面通过 typeCode 使用同一字典 API。
- 后端授权、事务、唯一约束、审计和缓存失效测试通过。
- lint、typecheck、单元/集成测试、build 通过；未运行项在交付中说明。
- DB 变更有版本化 migration 和回滚说明；不直接编辑生产数据库。

## 12. 建议实施顺序

### 阶段 A：审计当前实现（先做）

1. 检查 `DictionaryType` / `DictionaryItem` / translations 当前数据库数据。
2. 检查 `/api/admin/dictionary*` 既有 endpoint 和权限码。
3. 搜索代码中 `draft`、`published`、`available`、`preorder`、`discontinued` 与 enum 的全部使用点。
4. 生成“类型 → item → 引用页面/API”清单，确认哪些数据只是 UI 扁平显示、哪些数据确实挂错类型。
5. 给出数据修正预览和备份，不在此阶段删除或重命名任何 code。

### 阶段 B：字典后台 UI/API

1. 实现一级类型列表与二级项主从布局。
2. 复用现有 API；补齐缺失的类型/条目 CRUD、过滤和翻译接口。
3. 加上系统锁定、业务引用计数/删除保护。
4. 实现通用 `useDictionaryOptions`，先接入付款条款或包装方式等纯配置型字典。

### 阶段 C：商品状态接入

1. 将状态类型标记为系统锁定；用固定 code + 中英文翻译种子数据。
2. 明确要不要将 Product enum 迁移为 DictionaryItem 外键。
3. 如需要迁移，按 Expand → Backfill → Verify → Switch → Contract 分批发布。
4. 验证前台产品列表/首页精选/新品/下架过滤、后台商品表单、报价单和 PI 的状态显示保持一致。

### 阶段 D：验收与上线

1. 跑完整测试矩阵，验证 403/409/422 等异常。
2. 检查缓存失效、停用值在编辑历史记录中的回显和审计记录。
3. 对生产数据先备份，并保留迁移前统计与回滚步骤。
4. 上线后监控字典 API 的 4xx/5xx、缓存命中率、空 options 错误和无法映射的状态 code。

## 13. 给 AI 编码助手的执行提示词

```text
请先阅读 AGENTS.md、docs/20-dictionary-management-two-level-model.md 和 .agents/skills/dictionary-management/SKILL.md。

第一步只审计，不要直接改数据库：
1. 检查当前 Prisma DictionaryType、DictionaryItem、DictionaryItemTranslation 模型和真实 API。
2. 输出现有 typeCode、每个类型的 itemCode、translations、systemLocked、enabled、排序以及业务引用情况。
3. 检查 Product.lifecycleStatus / publishStatus enum 的所有读写点。
4. 区分“数据库已经两层但页面扁平”与“数据实际分组错误”，列出差异和低风险修复方案。

审计通过后再分批实现：
A. 字典类型 + 字典项管理 UI/API；
B. code/label 语义统一、locale fallback、查询缓存失效；
C. 系统锁定、被引用条目删除保护、审计日志和 RBAC；
D. 先把一个纯配置字典接入通用 hook，验证后再迁移商品状态。

不要凭猜测重分组 manual、website_click、whatsapp_webhook 等旧数据；必须依据现有 typeId、业务引用和业务方确认。不要直接删除 Product enum，不要创建重复字典表。提交时列出改动文件、migration、测试命令、结果、风险和回滚步骤。
```

## 14. 重要结论

1. **字典的基础两层数据库模型已经在当前 Prisma 草案中存在**；优先排查数据关联、接口和页面为什么被平铺，而不是直接再加两张表。
2. 一级 `typeCode` 是查询一组数据的入口，二级 `item.code` 是稳定业务标识，翻译 label 只负责展示。
3. 业务页面通过一级 key 取回启用的全部二级项，通用 hook 统一 loading/error/cache/locale 逻辑。
4. 商品生命周期/发布状态属于业务流程状态，不能只靠添加字典项改变流程；若切换到字典外键，必须有迁移、引用校验、后端语义校验和回滚方案。
5. 当前 UI 标记 locked 却仍提供删除按钮时，前后端都要整改；真正安全规则必须由后端实施。
