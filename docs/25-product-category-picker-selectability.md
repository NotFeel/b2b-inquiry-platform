# 商品管理品类选择器：可选择性故障修复与 UI/技术优化方案

- 文档编号：`docs/25-product-category-picker-selectability.md`
- 适用页面：后台商品管理列表、商品新建页、商品编辑页
- 主要路由参考：`/{locale}/products`、`/{locale}/products/new`、`/{locale}/products/{id}/edit`
- 语言：后台中文/英文（`zh-CN`、`en-US`）
- 优先级：P0（品类无法选择会阻断商品创建/编辑）
- 目标：修复品类节点不可选或选择后不生效的问题，并将内嵌的大树改造成紧凑、可搜索、交互明确的选择器

## 1. 截图现状与问题判断

从提供的三张截图可以确认：

1. 商品列表页把整棵品类树直接放在筛选卡片中；树占据很大纵向空间，关键词和状态筛选被挤到下方，筛选区域视觉失衡。
2. 新建/编辑页的「Category」字段旁一直展示树形面板，没有清晰的“打开选择器—选择节点—确认已选路径”交互。
3. 树节点缺乏明显的选中标识（如单选圆点、勾选图标、选中背景和已选路径）；用户不容易判断点击究竟是展开节点还是选择品类。
4. 用户反馈节点无法选择，因此不能只做视觉调整。需要同时追踪点击事件、受控状态、表单值、API payload 和后端校验。
5. 当前项目基线中 `Category.id` 是 UUID、`parentId` 为自关联；`Product.categoryId` 为必填外键。原则上无需为选择器增加新的数据表。最终实现前仍须核对真实代码、API 与迁移。

### 1.1 可能根因：必须通过代码和浏览器验证，不可先入为主

- **展开/选择冲突：** 整行点击只调用 `toggleExpanded(id)`，没有设置 `categoryId`；或只有叶子节点可选，但业务要求允许选择任意层级。
- **数据绑定断开：** 点击改变了树的高亮状态，但表单的 `categoryId` 未同步更新；保存时发送旧 ID、空值或类别名称。
- **标识不一致：** 树数据使用 `id`，表单却尝试写入 `uuid`、`code` 或 `slug`；或后端 DTO 字段名称不一致。
- **异步回填竞态：** 编辑页先打开、后加载树，导致当前商品已保存的品类没有正确回填；或树重新获取后覆盖用户选择。
- **DOM/层级问题：** 透明遮罩、父容器、`pointer-events`、错误的 `z-index`、绝对定位层拦截点击。
- **事件冒泡：** 展开按钮的点击冒泡到行选择/关闭逻辑，造成菜单刚展开就关闭或无法选中。
- **响应数据形态不一致：** 后端返回平铺节点，前端按 `children` 树解析；或返回嵌套树，前端重复构建后产生重复/缺失节点。
- **提交或服务端拒绝：** UI 已选中，但 `categoryId` 没进入请求；服务端因品类禁用、权限、UUID 格式或 DTO 校验拒绝，错误提示未显示。

**排查要求：** 先在浏览器 Network 查看品类树接口的响应，再观察点击节点后的 React/Vue 状态（以当前实际框架为准），最后检查保存请求 payload 和响应。修复必须覆盖端到端链路，不能以“树节点变色”作为修复完成的判断。

## 2. 改造目标与非目标

### 2.1 改造目标

- 品类选择器必须支持单击任意有效节点选择，节点展开/折叠由独立控件负责。
- 商品新建和编辑可以选择任意层级的已启用品类，包括有子节点的一级、二级目录；不限制只能选叶子。
- 表单内部唯一有效值为 `categoryId`（数据库 UUID），展示名称、编码、路径不能作为提交值。
- 选择器可搜索，显示层级路径和明确的已选状态；树数据加载中、空数据、错误均有明确 UI。
- 商品列表筛选区不再永久展开整棵树，使用与商品表单一致的选择器。
- 桌面、平板、手机都可正常打开、选择、清除和键盘操作；中英文文案统一走 i18n。
- 不重复建设分类模型或 API；优先复用项目现有品类树接口及 Query/Mutation 模式。

### 2.2 非目标

- 本次不重构品类管理 CRUD、品类树存储结构或前台品类导航。
- 本次不增加“只能选择叶子节点”的业务限制。
- 未经核实不新增前端组件库或新的后端接口；先复用仓库已有依赖和接口。
- 不允许仅凭前端 `enabled`/`visible` 状态代替服务端校验。

## 3. 推荐 UI 交互

### 3.1 表单里的 Category 字段

把常驻树改成普通表单字段，默认收起：

```text
Category *
┌────────────────────────────────────────────────────┐
│ Toys / Model Toys                         [Change⌄] │
└────────────────────────────────────────────────────┘
Selected category: Toys / Model Toys
```

未选择时显示 `Select a category` / `请选择品类`。已选品类展示完整路径；点击字段或 Change 按钮打开选择器。提供清除按钮（仅在业务允许 categoryId 为空时；当前 Product.categoryId 必填，因此正式产品表单不提供清空成空值的操作，而是要求选另一个品类）。

### 3.2 Popover/弹层选择器

桌面端优先使用项目当前已有的 Popover/Combobox 组件；若已有 Radix/shadcn 类组件，则复用，不新增重复依赖。若当前项目没有可靠 Popover，再实现轻量可访问弹层。

```text
┌──────────────────────────────────────────────┐
│ Select category                         [×]  │
│ [ Search by category name or code         ]  │
│                                              │
│ ▾  Tools                          [○]        │
│    ▾ Hand Tools                  [○]         │
│       Wrenches                   [○]         │
│       Screwdrivers               [●]         │
│    ▸ Power Tools                  [○]        │
│ ▸  Auto Supplies                  [○]         │
│ ▾  Toys                           [○]        │
│    Model Toys                     [○]        │
│    Electric Toys                  [○]        │
│                                              │
│ Selected: Tools / Hand Tools / Screwdrivers  │
│ [Cancel]                         [Confirm]   │
└──────────────────────────────────────────────┘
```

行为约定：

- 点击节点名称、节点行空白区域或单选标志，选中该节点。
- 点击独立的展开/折叠箭头，只展开或折叠，不改变选中值。
- 所有已启用品类都可选择，包括有子品类的节点；图标箭头和单选控件不得共用同一个 click handler。
- 搜索时匹配当前语言名称、备用语言名称和 `code`；显示匹配节点及必要的祖先路径，并自动展开匹配项的祖先节点。
- 当前选中项高亮并显示单选标记；弹层底部或顶部始终能看到已选完整路径。
- 若采用即选即关闭模式，点击节点后应立即更新表单字段并关闭弹层；若使用弹层内“确认”按钮，则临时选择和正式表单值须分离，点击取消必须丢弃临时选择。一个项目只能选择一种交互模式，避免行为不一致。推荐：节点单击即选中并关闭；键盘操作后 Enter 选中。
- 弹层使用 Portal（若项目组件支持），保证不会被父卡片的 `overflow: hidden` 裁切；管理合理 z-index，打开时定位不超出视口。
- 点击遮罩/按 Escape 关闭；关闭前如有尚未确认的临时选择，按既定交互规则处理。

### 3.3 商品列表筛选器

当前整棵树常驻在筛选区域，建议替换为一行或两行紧凑筛选栏：

```text
Keyword [SKU / product name…]  Category [Toys / Model Toys ▾]
Publish status [All ▾]  Lifecycle [All ▾]  Images [All ▾]
Tags [All tags ▾]  Sort [Recently updated ▾]  [Search] [Reset]
[✓ Include products in subcategories]
```

- 选中某品类后，默认勾选“包含下级品类”，筛选逻辑由服务器按 `categoryId` 和后代 ID 查询，不能只过滤当前父节点直属商品。
- 如果业务暂时不支持后代筛选，则 UI 必须明确标为“仅此品类”，不要造成误解。推荐默认包含后代品类。
- 筛选器使用与编辑表单相同的 `CategoryPicker`，通过 `mode="filter"` 允许清空过滤值；商品表单模式不允许清空必填品类。
- 搜索/重置之后保持筛选条件与 URL query state 一致（如果当前列表已有 URL 同步机制，沿用它），避免刷新后状态不一致。

### 3.4 商品表单布局

- 基本信息区域保持 4 列/2 列响应式网格，但 Category 自身是一个普通输入框；树只在打开时出现。
- Category 字段宽度与其他表单控件一致，不要为展开的树预留大量空白。
- 如果需要同时展示路径，使用轻量 breadcrumb 或一行辅助文本，超长路径省略中间部分，悬停/点击可查看完整路径。
- 新建页、编辑页使用同一个 `CategoryPicker` 和同一份校验规则。
- 编辑已有商品时必须先回填真实 `product.categoryId`；若该品类已停用，展示已停用提示并保留当前值供查看，阻止用户将其作为新选择，但允许用户改其他字段并保持该关联不变；如用户主动改品类，只能选择当前允许使用的品类。

## 4. 组件/API 设计

### 4.1 可复用组件接口（TypeScript 示例）

具体文件路径应先按现有项目组件目录调整。建议接口：

```ts
export type CategoryPickerMode = "product" | "filter";

export interface CategoryPickerProps {
  value: string | null;                 // category UUID；不是名称/code/slug
  locale: "zh-CN" | "en-US";
  mode: CategoryPickerMode;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
  onChange: (categoryId: string | null, selected?: CategoryOption) => void;
}

export interface CategoryOption {
  id: string;
  parentId: string | null;
  code: string;
  slug: string;
  enabled: boolean;
  visible: boolean;
  name: string;                         // API 已根据 locale 解析出的展示名
  children: CategoryOption[];
}
```

- `mode="product"`：表单必填；`value` 保存 category UUID；非 null 选择必须是有效、已启用的品类。
- `mode="filter"`：允许 `value=null` 表示不过滤品类；包括下级选项由筛选栏单独控制。
- 若当前 API 返回 `translations[]` 而不是 `name`，应在 API adapter 层归一化成 `CategoryOption`，不要让树节点自己分散处理多种 response shape。
- 不要把英文/中文标签名写到主表，也不要将类别名称存入 Product.categoryId。

### 4.2 受控状态模型

最少维护以下状态（可以由现有 Form 库实现）：

- `value`：当前已正式选中的 category ID。
- `open`：选择器打开状态。
- `searchText`：搜索条件。
- `expandedIds`：被展开的节点 ID 集合。
- `loading/error`：树数据加载状态。
- `selectedPath`：由 `value` 在树中推导出的祖先路径，不作为单独的数据源。

**单一事实源：表单的 `categoryId`。** 树高亮、输入框显示名称和保存 payload 都必须从它派生或与它同步。不要另存 `selectedCategoryName` 再尝试把它当数据库值。

### 4.3 树接口与数据适配

先找出当前页面已有的 category tree API 并优先复用。若现有接口无法满足，可评估增加只读查询接口（路径仅为建议，不能未经检查直接新建）：

```http
GET /api/admin/categories/tree?locale=en-US&selectable=true
```

参考响应：

```json
{
  "data": [
    {
      "id": "<category-uuid>",
      "code": "tools",
      "slug": "tools",
      "parentId": null,
      "name": "Tools",
      "enabled": true,
      "visible": true,
      "children": []
    }
  ]
}
```

必须处理：空列表、请求失败、重复 ID、孤儿节点、循环关系和无名称翻译。后台树查询应返回稳定 ID，并按 `sortOrder`、当前 locale 名称排序（如果现有业务定义不同则沿用既有规则）。

如果树接口只返回平铺数组，客户端 adapter 根据 `id`/`parentId` 构建一次树；不能每次 render 重新构建，避免节点展开状态和选中对象抖动。对于大数据量，考虑服务器端搜索或按需加载，但普通品类目录优先一次加载并缓存。

### 4.4 商品创建/更新接口

现有创建/更新接口若已使用 `categoryId`，无需新增字段，只修复前端绑定及验证。请求关键字段应是：

```json
{
  "sku": "QA-TOY-1001",
  "slug": "model-kit",
  "categoryId": "<selected-category-uuid>"
}
```

服务端必须：

1. 校验 `categoryId` 是合法 UUID 且对应品类存在。
2. 新建商品或修改分类时，拒绝 `enabled=false` 的品类（HTTP 状态码沿用项目错误响应规范，可用 422/409；错误体应带稳定错误码）。
3. 在权限检查后再执行更新；不能信任前端传回的类别名称、`enabled` 或 `visible`。
4. 如果编辑商品保留的原品类已停用，但本次请求并未更改 `categoryId`，可允许保存其他字段；若要更改成停用品类，则拒绝。此规则必须在 DTO/Service 层显式实现并测试。
5. 商品的 `categoryId` 保持指向当前节点；不应因选中父品类而自动写入某个叶子品类。
6. 更新成功后返回产品最新 `categoryId` 和关联品类展示数据；前端更新详情缓存和列表缓存。

数据库关系参考当前基线：`Product.categoryId -> Category.id`，外键限制删除在用品类。除非实际代码核查证明缺失，通常无需新增数据库表或列。

## 5. 推荐前端实现逻辑

### 5.1 节点操作拆分

不要把整行都绑定为展开操作。建议结构（伪代码，需按当前 UI 库实现）：

```tsx
<div role="treeitem" aria-selected={selected} aria-expanded={hasChildren ? expanded : undefined}>
  {hasChildren && (
    <button
      type="button"
      aria-label={expanded ? t("category.collapse") : t("category.expand")}
      onClick={(event) => {
        event.stopPropagation();
        toggleExpanded(node.id);
      }}
    >
      <ChevronIcon />
    </button>
  )}
  <button
    type="button"
    className={selected ? "category-node category-node--selected" : "category-node"}
    onClick={() => onSelect(node.id, node)}
  >
    <CategoryIcon />
    <span>{node.name}</span>
    {selected && <CheckIcon aria-hidden="true" />}
  </button>
</div>
```

注意：示例用于说明行为，不可直接复制后忽略 `role`、键盘焦点或现有 UI 组件约定。原生 `button` 默认行为、表单提交行为以及节点的 `aria` 结构必须通过实际代码和测试确认。

### 5.2 选择回调必须更新表单值

```tsx
function handleCategorySelect(category: CategoryOption) {
  form.setValue("categoryId", category.id, {
    shouldDirty: true,
    shouldValidate: true,
  });
  setOpen(false);
}
```

如果不使用 React Hook Form，应替换成当前项目实际的表单状态管理方法。关键点是：选中 ID 写入受控表单状态、触发校验、标记 dirty、更新路径展示并关闭弹层。

### 5.3 编辑表单回填

- 打开编辑路由后读取商品详情，`categoryId` 应取数据库 UUID。
- 品类树与商品详情可能并行请求；树加载完成之前允许暂时显示 loading placeholder，但不能用 `null` 覆盖已经加载的产品 category ID。
- 表单回填只执行一次，或按 `product.id` 变化时执行；禁止树每次刷新都重置用户刚选择的品类。
- 如果商品详情返回了 `category` 对象，仍以 `product.categoryId` 作为提交权威值。
- 保存失败时保留用户已填内容与选择结果，并在字段附近展示错误。

### 5.4 状态同步与缓存

- 选择器树数据使用当前项目的请求缓存方式（如 TanStack Query/SWR 或自有服务）；在 locale 变化时更新展示名称，但不得把产品所存 ID 改为名称。
- 商品新建/更新成功后刷新/更新产品详情、产品列表和商品数相关缓存。
- 管理员停用或移动品类后，选择器应刷新对应树缓存；已打开表单若引用状态发生变化，要提示重新选择或按服务端返回错误处理。
- 搜索关键词、展开节点和临时 UI 状态无需持久化；已选品类与筛选条件遵循现有页面状态持久化策略。

## 6. 错误和边界状态

| 场景 | 预期行为 |
|---|---|
| 树正在加载 | 显示 skeleton/加载提示，不能误显示“无品类” |
| 树 API 失败 | 显示错误和重试按钮；表单不能假装已可选择 |
| 没有可选品类 | 显示无可用品类提示和管理入口权限提示 |
| 搜索无结果 | 显示“没有匹配的品类”并提供清除搜索操作 |
| 选择当前品类 | 选中标记/路径不变化也应保持一致，避免重复回调造成循环请求 |
| 父品类有子节点 | 名称行可选；箭头独立展开，不能要求用户只能选叶子 |
| 当前编辑品类已停用 | 显示停用状态，可保存其他字段但不能重新选入该停用项 |
| 保存时品类刚被停用 | 后端拒绝变更，前端显示可理解错误并保留表单输入 |
| 品类树出现孤儿/循环 | 不崩溃，不无限递归；日志中记录数据问题，提供受控错误提示 |
| 超长中英文路径 | 文本省略但可查看完整路径，不撑破表单列宽 |
| 用户无品类读取权限 | 服务端返回 401/403，前端正确引导，无权限数据不进入缓存 |
| 快速切换语言 | 显示文字更新，已选 category ID 不变 |
| 商品列表包含下级筛选 | 服务端按所选节点后代集合过滤，分页总数与结果一致 |

## 7. 国际化与视觉规范

- 所有提示、按钮、错误、空状态使用 i18n key，例如 `product.category.select`、`product.category.search`、`product.category.loading`、`product.category.loadFailed`、`product.category.noResults`、`product.category.disabled`。
- 类别名优先使用当前 locale 翻译，缺失时按系统既有规则回退到默认语言；不要硬编码英文/中文在组件内。
- 选中节点使用浅色背景、边框/勾选图标；不能只用粗体表达选中。
- 展开/折叠箭头、类别图标和已选状态图标的视觉含义必须明显不同。
- 桌面弹层建议宽 360–480px、最大高度 420–520px；按当前触发位置与视口自动调整，树区域内部滚动。
- 768px 以上优先 Popover；窄屏可使用全屏 Drawer/Bottom Sheet。具体断点以项目统一 UI Token 为准。
- 所有交互目标高度至少符合当前设计系统的可点击区域标准；确保颜色对比度、focus ring 和键盘操作。

## 8. 权限和安全约束

- 前端隐藏选择入口不构成安全保护。商品创建/更新 API 必须在服务端校验品类和权限。
- 管理后台树 DTO 与前台公共品类树 DTO 分开，不能把内部字段直接暴露给前台。
- 类别 `visible` 决定公共导航曝光，`enabled` 决定是否允许新业务关联，两者不可互换；公共查询还应遵循项目已经定义的父子可见性规则。
- 不返回或接受前端自定义的“品类名称”替代 `categoryId`。
- 对类别树异常增加结构化日志，但不能记录无关的个人数据或认证凭据。

## 9. 测试方案

### 9.1 单元测试

- `buildCategoryTree` 可正确组树、排序、识别无父节点、重复 ID、孤儿和循环数据。
- `getCategoryLabelPath` 对中英文、缺失翻译、根节点和深层节点返回稳定结果。
- 节点选择只更新 `value`；展开按钮只更新 `expandedIds`。
- `mode="product"` 不允许清空值；`mode="filter"` 允许清空。
- 搜索命中节点时自动包含其祖先路径，并能显示与搜索匹配的节点。

### 9.2 组件/集成测试

1. 打开商品新建页，品类字段默认收起，布局不再显示常驻树。
2. 点击有子节点的一级品类名称，选中它；单击箭头仅展开/折叠，不更改已选值。
3. 选择深层子品类，字段显示完整路径或可查看的完整路径。
4. 提交创建请求，检查 `categoryId` 为选中节点 UUID，而不是名称、code 或 slug。
5. 编辑现有商品，已保存的品类正确回显；改选后保存，刷新仍显示新品类。
6. 修改其他字段时，即使树接口稍后返回，也不覆盖当前 `categoryId`。
7. 搜索、清除搜索、键盘上下移动、Enter 选择、Escape 关闭均正常。
8. 品类接口返回 500/403/空列表，均呈现正确状态且不可错误提交。
9. 商品列表筛选选择某父类并勾选包含下级，核对结果和总数都包含后代商品。
10. 语言切换后显示名称变化，但数据库关联 ID 和产品数据不变。

### 9.3 端到端回归

- Chrome 桌面宽度：1440、1280、1024；平板约 768；手机约 390、360（沿用实际项目测试矩阵）。
- 覆盖新建、编辑、保存失败后重试、切换品类、刷新、返回列表和筛选状态恢复。
- 检查弹层不被内容容器裁切，底部和右侧不超出视口。
- 对 3 层以上的树进行测试，不可只测示例中两层节点。

## 10. 验收标准（Definition of Done）

以下条件全部满足才可关闭任务：

- [ ] 所有启用品类节点（包含父级）均可选；箭头只负责展开/折叠。
- [ ] 用户不需要在表单中常驻浏览整棵树；树仅在打开选择器时显示。
- [ ] 选中项有明显状态，字段显示当前语言名称和层级路径。
- [ ] 新建/编辑最终发送的是当前选中的 `categoryId` UUID。
- [ ] 编辑页回显、保存、刷新一致，不受异步加载顺序影响。
- [ ] 业务禁用、请求失败、无结果和无权限场景有清晰提示。
- [ ] 商品列表的品类筛选紧凑可用，含下级过滤行为明确且结果正确。
- [ ] 键盘可操作，至少完成选择、展开/折叠、搜索和关闭测试。
- [ ] 中英文下文案完整，无硬编码文本。
- [ ] 没有未经核准的数据库 schema 变更或重复品类 API。
- [ ] Lint、TypeScript、相关单元/集成测试和生产构建通过。

## 11. 实施拆解

### P0：定位与修复不可选择根因

- 搜索商品新建/编辑页的 category picker、`categoryId` form state、树节点事件、表单 DTO 和 API mapping。
- 在 Network 中确认类别树响应和创建/更新请求 payload。
- 修复行点击与展开点击冲突，统一使用受控 `categoryId`。
- 补上错误提示；不允许吞掉后端拒绝结果。

### P1：统一可复用选择器

- 创建可复用 `CategoryPicker`，产品表单与列表筛选共用底层树 UI。
- 增加搜索、路径展示、选中标识、加载/失败/空状态、键盘与响应式行为。
- 移除表单内常驻展开树，压缩列表筛选区域。

### P2：数据与回归验证

- 校验多语言路径、禁用品类、父节点选择和后代筛选。
- 执行完整 CRUD 回归并更新相关 UI 文档/测试。
- 记录发现的 API/data shape 问题；只有现有接口不足时才提议兼容性扩展。

## 12. 可直接交给 AI 编码助手的任务提示词

> 请先阅读仓库根目录 `AGENTS.md`、`docs/24-product-management-crud-and-image-storage.md`、`docs/22-category-management-tree-workbench.md` 和本文件 `docs/25-product-category-picker-selectability.md`，并加载 `.agents/skills/product-category-picker/SKILL.md`。先检查现有商品创建/编辑页面、品类树组件、API response、表单 DTO 和测试，复现“品类无法选择/选择不生效”问题，确认实际根因后再修改。必须区分展开箭头和节点选择动作；任何层级的已启用品类都可选择；表单只提交 Category UUID 到 `categoryId`；编辑回显不能被异步树加载覆盖。将筛选页常驻树改为紧凑弹层选择器，并在提交后验证真实 payload 与服务端响应。优先复用现有 API、组件库和 schema，不要未经检查新增重复 API/表或依赖。补充单元、组件及端到端测试，执行 lint、typecheck、test 和 build，最后提供修改文件清单、根因、验证命令和仍未完成项。不要只写文档或只改 CSS，必须在可访问的项目代码中完成实际修复后才报告实现完成。

## 13. 文件位置

- 本独立方案：`product-category-picker-selectability.md`
- 项目内方案：`docs/25-product-category-picker-selectability.md`
- AI 技能规则：`.agents/skills/product-category-picker/SKILL.md`
- 全局约束：根目录 `AGENTS.md`
