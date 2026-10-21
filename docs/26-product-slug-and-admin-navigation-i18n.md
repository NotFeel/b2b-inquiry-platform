# 商品 URL Slug 随机数字生成与后台英文导航国际化修复方案

> 文档编号：DOC-26  
> 适用模块：商品管理（新建/编辑）、后台 Admin Shell、侧边栏、导航分组、面包屑、菜单管理与国际化缓存  
> 目标 locale：`zh-CN`、`en-US`  
> 文档性质：可执行设计与技术实施方案；本文件本身不代表代码已修改或测试已通过。

## 1. 现状与问题定义

截图路径为 `/en-US/products/new`，页面主体（New product、SKU、Category、Product specifications 等）已经是英文，但侧边栏、面包屑仍显示中文，例如“商品目录 / 商品管理”。这表明 locale 至少在部分页面组件中生效，但导航组件没有完整使用当前 locale。

当前 URL slug 输入框由产品名称生成（或允许直接输入），例如输入名称后得到相同或相似的 slug。相同商品名称很常见，单纯名称转 slug 容易发生唯一性冲突，也缺少简单的重新生成方式。

本次需要一并完成两项任务：

1. 商品创建/编辑页提供多种 slug 生成方式，并由后端和数据库保证唯一性。
2. 在 `/en-US/...` 下，后台侧栏、导航分组、面包屑、页面导航标题都应显示英文；在 `/zh-CN/...` 下显示中文。切换语言后不能只改变表单文案，而导航还保持旧语言。

## 2. 设计决策摘要

### 2.1 URL slug

- 保留人工编辑 slug 的能力，不强制用户只能按名称转换。
- 提供 slug 策略选择：`名称`、`名称 + 6 位随机数字`；必要时可以选择“随机编号”作为名称为空时的兜底策略。
- 新建商品默认勾选“追加 6 位随机数字”，减少同名商品冲突；用户可以取消，使用纯名称 slug。
- 点击“生成 URL slug”才覆盖字段，不在用户编辑名称时静默覆写已经手动编辑过的 slug。
- 后端生成候选值时使用加密安全随机数（Node.js `node:crypto` 的 `randomInt`），先检查冲突；数据库 `Product.slug @unique` 仍然是最终并发保护。
- 手动输入的 slug 若冲突，返回明确的字段级错误，不偷偷替换成另一个值。随机策略生成的值若竞争冲突，可自动重试有限次数。
- 对已有商品，进入编辑页时绝不自动重新生成 slug。已发布商品修改 slug 必须提示 URL 变更；如需要保持旧链接有效，必须另行实现旧 slug 重定向机制，不能静默变更。

推荐新商品示例：

```text
英文名称：Nylon lock nut M12
纯名称：nylon-lock-nut-m12
追加随机数字：nylon-lock-nut-m12-483271
手动自定义：nylon-lock-nut-m12-blue-pack
```

六位数字不是数据库唯一性的替代品，只是降低名称重复概率并提高录入便利性；服务端检查和数据库唯一约束始终必须保留。

### 2.2 后台导航国际化

- 路由中的 locale 是当前后台界面的权威语言来源。`/en-US/...` 就应按 `en-US` 渲染，不得由浏览器 localStorage 中旧语言覆盖 URL。
- 菜单名称继续以数据库 `MenuTranslation` 为数据源，使用 `menuId + locale` 查询对应翻译；当前 Prisma 草案已包含 `MenuTranslation(menuId, locale, label)`，不应为此重复建表。
- 必须补齐每条启用/可见菜单的 `zh-CN` 与 `en-US` 翻译数据，尤其是侧栏分组标题与一级/子菜单标题。
- 侧栏、面包屑和页面顶部导航必须共享同一个 locale 和菜单解析服务，不允许侧栏取中文静态数组而页面主体使用另一套翻译资源。
- 静态 UI 文案（如产品管理页面标题、按钮、面包屑中的通用词）通过统一 `zh-CN` / `en-US` 资源管理，不写硬编码中文字符串。
- 所有客户端缓存键必须包含 locale；后台菜单缓存还应包含用户/权限版本，避免语言串用或不同权限用户之间的菜单数据串用。

## 3. URL slug 交互设计

### 3.1 表单布局

在 `URL slug` 标签下方放置生成操作，不要把操作按钮挤入输入框造成窄屏布局问题：

```text
URL slug *
[ nylon-lock-nut-m12-483271                              ]
[Generate from English name] [✓ Append 6-digit random number]
Used in the storefront URL. Slugs must be unique. Changing a published slug may break existing links.
```

中文模式对应文案：

- URL 路径标识（Slug）
- 根据英文名称生成
- 追加 6 位随机数字（推荐）
- 生成新的候选值
- 此地址用于前台商品链接。Slug 必须唯一；修改已发布商品的 Slug 可能影响旧链接。

建议行为：

1. **新建商品**：随机数字选项默认开启；填入英文名称后点击“生成 URL slug”，得到 `name-xxxxxx`。用户仍可手动修改。
2. **纯名称模式**：关闭随机数字选项后生成 `name`；若冲突，展示“该 slug 已被使用，请添加随机数字或修改内容”。
3. **编辑商品**：显示存量 slug 原值；不因切换中文/英文标签页、编辑名称或刷新表单而自动改变。
4. **重新生成**：仅当用户主动点击时覆盖当前 slug。若字段已有值，点击前用轻量确认或明确的按钮语义，避免误覆盖手写内容。
5. **离开页面**：如果表单未保存，按全局表单规范提醒；不因 slug 预览可用就声称已永久预留。
6. **slug 可用性**：可选支持异步“检查可用性”；结果仅为提示，提交时仍须由后端重新校验。

### 3.2 slug 生成规则

输入：英文商品名称、是否追加随机数字、编辑时可排除的当前商品 ID。

处理规则：

1. 使用英文名称作为 base；先做 NFKD/统一规范化，再小写化，空格和标点转换为 `-`，移除不允许的字符，将连续 `-` 合并，并去除首尾 `-`。
2. 仅名称为空或清洗后为空时，base 兜底为 `product`；不得用中文名称拼音/名称自动填补英文名称，除非项目明确定义且经过业务确认。
3. 若勾选随机数字，后端生成 6 位数字字符串，如 `483271`，拼为 `${base}-${suffix}`。随机数由 `crypto.randomInt(100000, 1000000)` 生成，注意上界不包含在结果中。
4. 如果不追加随机数，候选值为 base。
5. 根据当前商品排除规则检查唯一性。新建不排除任何商品；编辑只排除当前商品 ID。
6. 若冲突且策略为随机数字，最多重试 5–8 次后返回可理解的冲突错误，不无限循环。
7. 后端写入时捕获 Prisma 唯一约束冲突（如 P2002）；不能只依赖“先查后写”，因为并发请求可能同时生成同一候选值。
8. slug 应限制长度（与 schema 的 `VarChar(180)` 一致），超长名称应截断 base 后再加后缀，保证后缀不被截断。

### 3.3 手动 slug 校验

推荐允许字符集：小写 ASCII 字母、数字、短横线。正则示例：

```regex
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

规则：

- 必填，最大长度不超过当前数据库字段长度 180。
- 不允许空格、斜杠、查询符号、连续短横线和首尾短横线。
- 后端必须重新校验格式、长度、唯一性；前端校验仅用于即时反馈。
- 数据库使用现有 `Product.slug @unique` 约束，不应删除唯一索引。
- 对类别 slug 与商品 slug 当前分别是各自表内唯一；不要未经产品决策就新增跨表唯一约束。

### 3.4 建议 API 契约

按现有项目 API 前缀和认证风格适配；下面是建议契约，不代表当前路由已经存在。

#### 生成 slug 候选值

```http
POST /api/admin/products/slug-suggestion
Content-Type: application/json
```

请求：

```json
{
  "name": "Nylon lock nut M12",
  "strategy": "name-random",
  "excludeProductId": null
}
```

`strategy`：
- `name`：只使用英文名称转换值。
- `name-random`：名称 + 六位随机数字。
- 如业务确实需要，后续增加 `random`：`product-483271`。不应在首版无必要增加更多模式。

成功响应：

```json
{
  "slug": "nylon-lock-nut-m12-483271",
  "strategy": "name-random",
  "available": true
}
```

错误处理：
- `400 INVALID_SLUG_NAME`：输入不合法或缺少必需字段。
- `401/403`：未登录或无创建/编辑商品权限。
- `409 SLUG_SUGGESTION_CONFLICT`：有限重试后仍无法生成候选值，提示用户重试。

#### 创建 / 更新商品

创建/更新仍提交最终 `slug` 字段，由现有商品接口保存；不要把 slug 建议端点当作预留机制。建议错误结构：

```json
{
  "statusCode": 409,
  "code": "SLUG_ALREADY_EXISTS",
  "message": "This URL slug is already in use.",
  "fieldErrors": {
    "slug": "Please add a random suffix or choose another slug."
  }
}
```

如果客户端要求后端自动生成，可在创建 DTO 增加明确的 `slugStrategy`，由服务端生成并持久化最终 slug；不能同时接受互相矛盾的 `slug` 与 `slugStrategy`。建议首版使用“生成候选值 API + 用户确认 + 正常商品保存”的方式，行为更透明。

### 3.5 核心服务伪代码（NestJS + Prisma）

```ts
import { randomInt } from 'node:crypto';

async function suggestProductSlug(input: {
  name: string;
  strategy: 'name' | 'name-random';
  excludeProductId?: string;
}): Promise<string> {
  const base = slugifyEnglishName(input.name).slice(0, 165) || 'product';
  const attempts = input.strategy === 'name-random' ? 8 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const suffix = input.strategy === 'name-random'
      ? `-${randomInt(100000, 1000000)}`
      : '';
    const candidate = `${base.slice(0, 180 - suffix.length)}${suffix}`;

    const existing = await prisma.product.findFirst({
      where: {
        slug: candidate,
        ...(input.excludeProductId
          ? { id: { not: input.excludeProductId } }
          : {}),
      },
      select: { id: true },
    });

    if (!existing) return candidate;
  }

  throw new ConflictException({ code: 'SLUG_SUGGESTION_CONFLICT' });
}
```

注意：这是实现参考，`slugifyEnglishName`、DTO、异常格式与现有项目对齐；检查数据库后还要在最终写操作中处理 unique 冲突。纯 `name` 策略发生冲突时不要自动加数字，因为用户可能明确希望使用纯名称，应该返回冲突提示。

## 4. 后台英文菜单导航修复

### 4.1 页面范围

当 locale 为 `en-US`，以下所有区域都必须英文：

- 左侧导航分组标题：Workspace、Catalog、Leads & Analytics、Quotes & Files、Content Management、System Management。
- 左侧所有菜单节点：Operations Overview、Product Management、Category Management 等。
- 顶部面包屑，例如 `Catalog / Product Management`。
- 页面导航标题和页面级固定文案（如 `New product`、`Products`、`Save`、`Cancel`）。
- 导航折叠、加载失败、空状态、权限不足等辅助状态文案。

不能仅修复侧栏文字而遗漏面包屑，也不能让菜单翻译依赖浏览器刷新后才生效。

### 4.2 可能根因与排查顺序

开发前不要凭截图认定某一处就是唯一根因，需检查：

1. 页面 pathname locale 是否从路由段正确读取（`/en-US/products/new`）。
2. `AdminShell`、`Sidebar`、`Breadcrumb` 是否接收同一个 locale。
3. 导航接口是否把 locale 传到后端；后端是否使用它查询 `MenuTranslation`。
4. 数据库现有每个启用菜单是否有 `en-US` 翻译行，特别是父级分组和无 route 的目录节点。
5. 菜单名是否来自中文静态配置数组，而不是翻译表 / 国际化资源。
6. React Query / SWR / 服务端缓存 key 是否缺少 locale，导致 zh-CN 响应被 en-US 页面复用。
7. 语言切换器是否只改变了表单 UI locale，而没有切换路由或刷新导航数据。
8. 面包屑是否通过中文路由映射硬编码生成，而没有调用统一 label resolver。

每个假设应通过代码搜索、网络请求和实际数据库数据验证后再修复；不要无差别重写整套国际化系统。

### 4.3 Locale 单一来源

支持列表固定为 `zh-CN`、`en-US`。建议在路由层定义 `normalizeLocale()`，任何未知 locale 回落至系统默认 `en-US` 或项目已定默认值，并保持一致。

优先从 Next.js 路由段读取 locale，传递到后台应用 Shell；不要在各组件中分别从 localStorage、浏览器语言、默认常量读取 locale。

```ts
type AdminLocale = 'zh-CN' | 'en-US';

function normalizeAdminLocale(value: string | undefined): AdminLocale {
  return value === 'zh-CN' ? 'zh-CN' : 'en-US';
}
```

上例默认值需与当前 middleware / 路由设置保持一致。如果项目已明确默认中文，保留既有默认值；关键要求是 URL 与渲染语言不能互相矛盾。

### 4.4 菜单翻译数据源和返回规则

当前 Prisma 模型已经包含：

```prisma
model MenuTranslation {
  menuId String @db.Uuid
  locale String @db.VarChar(16)
  label  String @db.VarChar(160)
  menu   Menu   @relation(fields: [menuId], references: [id], onDelete: Cascade)

  @@id([menuId, locale])
  @@map("menu_translations")
}
```

因此优先补齐数据与 API，不要重复新建菜单翻译表。

建议导航接口输入 locale，例如：

```http
GET /api/admin/navigation?locale=en-US
```

响应每个节点包含稳定字段和已经解析好的 label：

```json
{
  "locale": "en-US",
  "items": [
    {
      "id": "<menu-uuid>",
      "code": "product-management",
      "label": "Product Management",
      "route": "/products",
      "icon": "package",
      "children": []
    }
  ]
}
```

此处 UUID 和结构仅为契约示例。

服务端要求：

- 查 `Menu` 时依据 `enabled=true`、`visible=true` 和当前用户权限过滤；权限过滤规则复用既有实现。
- 按请求 locale 解析 `MenuTranslation.label`，按 `parentId` 与 `sortOrder` 构造树。
- 对启用且对当前用户可见的菜单，`en-US` 和 `zh-CN` 翻译必须通过数据校验。
- 运行时 fallback 仅作为缺数据时的保护：`zh-CN` 缺失可暂时回退到 `en-US`；`en-US` 缺失时不能直接显示中文，应返回非中文可诊断占位（如人类可读 code）并记录结构化告警，同时要求补数据。CI / 测试必须把核心菜单翻译缺失视为失败，不能以 fallback 代替翻译数据。
- 不得把 `label` 的中文/英文硬编码到 Sidebar 组件中；数据库管理的菜单文字应以 `MenuTranslation` 为源。导航组件自己的按钮文案则用前端 locale 字典。

### 4.5 建议的翻译种子清单

用实际 `Menu.code` / menu ID 对照后执行幂等 upsert，以下为示例映射，最终以当前数据库中存在的 code 为准，不能盲目按显示名称新建菜单。

| 中文 | 英文建议 |
|---|---|
| 工作台 | Workspace |
| 运营总览 | Operations Overview |
| 商品目录 | Catalog |
| 商品管理 | Product Management |
| 品类管理 | Category Management |
| 标签管理 | Tag Management |
| 询盘与分析 | Leads & Analytics |
| WhatsApp 客户 | WhatsApp Leads |
| 访问分析 | Traffic Analytics |
| 报价与文件 | Quotes & Files |
| 报价模板 | Quote Templates |
| 导出记录 | Export History |
| 形式发票 PI | Proforma Invoices (PI) |
| 内容管理 | Content Management |
| 广告管理 | Advertisement Management |
| 内容页面 | Content Pages |
| 系统管理 | System Management |
| 用户管理 | User Management |
| 角色权限 | Roles & Permissions |
| 菜单管理 | Menu Management |
| 字典管理 | Dictionary Management |
| 全局设置 | Global Settings |
| 审计日志 | Audit Log |

`MenuTranslation` 中每条记录都应使用规范 locale 值 `zh-CN` 或 `en-US`，不要混用 `en`、`en_US`、`en-us` 等形式。若当前库已存非规范值，先盘点并迁移，避免直接更改而造成复合主键冲突。

### 4.6 UI 资源和面包屑

- `AdminShell` 从 locale segment 获取 locale，并传给 `Sidebar`、`Header`、`Breadcrumb`、页面布局。
- 数据库维护的菜单节点名称从导航 API 的 `label` 展示。
- 页面标题、按钮、筛选条件等静态文案走统一资源，例如 `admin.products.title`、`admin.products.slug.generate`、`admin.navigation.catalog`。
- 面包屑根据 `route/code` 找到导航节点 label；非菜单路由（如 `/products/new`、`/products/:id/edit`）用页面资源 key，而不是截取路径后显示中文硬编码值。
- 路由生成必须保留 locale 前缀。菜单 `route` 应存不含 locale 的规范路径，例如 `/products`，链接生成函数统一生成 `/en-US/products` 或 `/zh-CN/products`；禁止重复加前缀。

### 4.7 语言切换器行为

点击 `EN`：

1. 从当前路由解析去掉旧 locale 的 pathname（如 `/products/abc/edit`）。
2. 改为 `/en-US/products/abc/edit`，保留合法 query string；不要把 `en-US` 追加在路径末尾。
3. 切换后重新加载对应 locale 的 UI 资源和导航数据；React key 或 query cache key 应包含 locale。
4. 若当前语言下目标路由不存在，跳转到同语言下合理的 fallback 页面（例如 Dashboard），并告知用户；不得无限重定向。
5. 当前表单未保存时，执行项目统一的离开确认策略，避免语言切换丢失录入内容。

### 4.8 国际化缓存规则

客户端查询键示例：

```ts
['admin-navigation', locale, authorizationVersion]
```

服务端缓存建议至少包含 locale 和授权身份/权限版本，不能把不同角色可见的菜单共用一个缓存。例如：

```text
admin-navigation:{userId}:{authorizationVersion}:{locale}:{menuVersion}
```

菜单翻译更新后失效相应 locale 的导航缓存；角色权限调整后使受影响用户的菜单缓存失效。没有可靠失效机制时，可以先采用不缓存或短 TTL，不能为了性能让中英文内容串用。

## 5. 数据库与迁移策略

### 5.1 slug

当前 schema 中 `Product.slug` 已有 `@unique`，实现随机数生成功能通常无需新增字段或迁移。先检查实际 migration 与生产索引是否一致。

如果后续要求已发布 slug 更改后旧链接继续跳转，需要单独设计 `ProductSlugRedirect`（旧 slug、productId、createdAt、状态）并添加版本化 migration、唯一索引与循环重定向测试；首版可先禁止发布后修改 slug，或显示警告并要求明确确认。不应在本次只为随机后缀而增加无必要表。

### 5.2 菜单翻译

通常只需要添加/修正 `MenuTranslation` 种子数据，不需要改变 schema。步骤：

1. 导出现有启用菜单的 `id/code/parentId/route/zh-CN label/en-US label` 状态报告。
2. 为缺少翻译的真实菜单生成映射，经业务确认后通过幂等 upsert 插入或更新 `MenuTranslation`。
3. 不得创建重复的 `Menu` 记录；菜单名称重复不意味着要新增菜单。
4. 校验每个启用/可见的菜单在两个 locale 下各有一条非空 label，检查父级分组也包含在内。
5. 执行回归测试并刷新导航缓存。
6. 若错误映射已发布，回滚相应翻译行到备份值；种子脚本应输出修改摘要，避免无差别覆盖手工翻译。

## 6. 测试方案

### 6.1 Slug 测试

| 编号 | 场景 | 预期结果 |
|---|---|---|
| S-01 | 名称 `Nylon lock nut M12` + 随机后缀 | 生成 `nylon-lock-nut-m12-` 后接 6 位数字 |
| S-02 | 取消随机后缀 | 生成纯名称 slug；若已占用，明确提示冲突 |
| S-03 | 两个同名商品同时创建且使用随机后缀 | 绝大多数情况下生成不同候选；任何竞争冲突由唯一约束保护并可重试 |
| S-04 | 用户手动输入已存在 slug | API 返回 `409 SLUG_ALREADY_EXISTS`，字段显示错误，不静默替换 |
| S-05 | 打开已有商品编辑页 | slug 保留数据库原值，不自动重新生成 |
| S-06 | 改名称但不点击生成按钮 | slug 不被自动覆盖 |
| S-07 | slug 含空格、斜杠、连续短横线或大写 | 按规范化规则处理生成值；手动值非法则显示校验错误 |
| S-08 | 长名称 + 后缀 | 总长不超过 180，后缀完整保留 |
| S-09 | 随机候选与数据库并发冲突 | 正常保存路径捕获唯一约束并返回可恢复错误 |
| S-10 | 已发布商品修改 slug | 显示明确风险与确认；如果未实现重定向，按最终业务规则阻止或要求显式确认 |

### 6.2 导航国际化测试

| 编号 | 场景 | 预期结果 |
|---|---|---|
| I-01 | 直接访问 `/en-US/products/new` | 侧栏、菜单分组、面包屑、页面固定文案均为英文 |
| I-02 | 直接访问 `/zh-CN/products/new` | 所有相应导航文案为中文 |
| I-03 | EN 切换为中文 | locale 路径切换正确，保留当前合法路径与 query，不丢失表单数据或先提醒 |
| I-04 | 两种 locale 连续切换 | 导航数据不串语言、没有旧语言短暂残留或错误缓存 |
| I-05 | 新增启用菜单并提供两个翻译 | 两种语言都正确出现，排序与父子层级不变 |
| I-06 | 菜单缺少 en-US 翻译 | CI/数据校验失败；运行时显示非中文诊断 fallback 并产生可定位告警 |
| I-07 | 导航 API locale 不合法 | 使用统一默认 locale，不发生不一致的路由/响应语言 |
| I-08 | 用户角色不同 | 菜单仍遵守权限过滤；缓存不会让普通用户看到管理员菜单 |
| I-09 | 修改菜单英文翻译 | 刷新/失效对应缓存后显示新文案 |
| I-10 | `/en-US/products/:id/edit` 面包屑 | 目录与页面名称为英文，当前路由高亮准确 |
| I-11 | 页面通过浏览器刷新或粘贴深层链接打开 | 语言与路径一致，不依赖先访问首页建立 localStorage |
| I-12 | 360px、平板、桌面 | 文案较长不造成横向溢出，菜单可展开/收起且键盘可操作 |

## 7. 实施步骤与提交拆分

### 阶段 A：排查与基线

1. 搜索 slug 生成代码、产品创建/更新 DTO、`Product.slug` 唯一索引及相关测试。
2. 搜索 `Sidebar`、`AdminShell`、`Breadcrumb`、locale middleware、菜单导航 API、`MenuTranslation` 的查询和种子脚本。
3. 分别请求 zh-CN / en-US 导航 API，检查数据库翻译是否缺失、请求 locale 是否到达服务端、客户端是否命中错缓存。
4. 记录现有菜单数与两种 locale 翻译覆盖率，导出需回填列表；记录已有产品 slug 冲突/非法值（若有）。

### 阶段 B：slug 功能

1. 定义并测试统一 slugify util 与 slug strategy DTO。
2. 增加后端 slug-suggestion endpoint，实施随机后缀与候选唯一性检查。
3. 在商品新建/编辑页增加随机数字开关和明确的生成按钮。
4. 映射 Prisma P2002 / API 409 为字段级错误，并补并发集成测试。
5. 明确已发布 slug 修改策略与回滚方案。

### 阶段 C：导航国际化

1. 统一 locale 读取与向 Shell 子组件传递。
2. 修复导航 API 的 locale 参数、翻译查询、权限过滤和树构造。
3. 补齐真实菜单的 en-US / zh-CN 翻译数据，包含分组、目录、页面子项。
4. 统一 Sidebar、Breadcrumb、页面标题资源，不允许 hardcode 中文。
5. 更新客户端/服务端 cache key 和缓存失效；修复语言切换时 URL 与 UI 不一致。

### 阶段 D：验收与交付

1. 执行 lint、typecheck、单元测试、集成测试和生产 build。
2. 验证两个 locale 所有启用菜单的翻译覆盖率为 100%。
3. 使用两种语言分别登录、刷新深层路由、切换语言、新建和编辑商品。
4. 提交代码、种子/数据修复脚本、文档、测试记录及发布/回滚说明。

## 8. 验收清单（Definition of Done）

- [ ] 商品新建页面有“名称 + 随机数字”选项，默认策略符合产品决定，数字为 6 位。
- [ ] 用户可手动修改 slug，手动 slug 冲突有明确错误。
- [ ] 修改英文名称不会静默覆盖现有 slug；编辑已有商品不会自动改 slug。
- [ ] 后端重验 slug 格式及唯一性，数据库唯一索引仍然有效，处理并发竞争。
- [ ] `/en-US/...` 的侧栏、导航分组、面包屑和页面固定文案全部是英文。
- [ ] `/zh-CN/...` 的相同内容全部是中文。
- [ ] 所有启用/可见菜单均具有非空 `zh-CN` 与 `en-US` 翻译；缺漏检查可自动执行。
- [ ] 语言切换更新路由、页面资源与导航缓存，避免 locale 串用。
- [ ] 不同角色的菜单可见性仍然由权限策略决定，缓存不发生越权泄漏。
- [ ] 已发布 slug 的更改有明确警告与重定向/阻止策略。
- [ ] 所有验证在实际项目代码中执行过，并记录通过/未通过结果；不能把文档示例当作测试已通过。

## 9. 可直接交给 AI 编码助手的任务提示词

```text
请先读取项目根目录 AGENTS.md、docs/26-product-slug-and-admin-navigation-i18n.md、docs/24-product-management-crud-and-image-storage.md，以及 .agents/skills/product-slug-and-admin-navigation-i18n/SKILL.md。

本次分为两条独立任务线：
A. 商品 URL slug：在新建/编辑商品页提供“根据英文名称生成”和“名称 + 6 位随机数字”策略，默认在新建时选中随机后缀；允许手动编辑；不得在输入名称时静默覆盖已编辑 slug。后端提供候选生成/冲突校验，使用安全随机数，保留 Product.slug 唯一约束，并处理 Prisma 唯一约束竞态。已有商品进入编辑页不得自动改变 slug。已发布 slug 修改必须遵守文档策略。
B. 后台导航国际化：修复 /en-US/... 下侧栏和面包屑仍为中文的问题。先定位根因，再统一 locale 来源，保证 Sidebar/Header/Breadcrumb/页面固定文案共享 locale；导航 label 从真实 MenuTranslation 读取，补齐真实菜单的 en-US 与 zh-CN 翻译；修复 locale 切换路由与缓存 key。禁止仅在前端硬编码英文替换中文菜单。

实施前检查真实代码、schema、migration、menu seed 和现存数据，避免重复建表/重复菜单。完成后提供：文件改动清单、根因证据、API 与数据变更、迁移/回滚步骤、测试命令和测试结果。至少验证同名商品、手动 slug 冲突、随机候选并发，以及 /en-US 与 /zh-CN 的侧栏/面包屑/深层路由/切换/刷新。
```

## 10. 未决项与默认建议

| 项目 | 默认建议 |
|---|---|
| 新建产品的随机数字 | 生成时默认开启 6 位数字后缀；用户可关闭 |
| 随机数字是否直接写数据库 | 只在用户确认创建商品时随产品保存；suggestion API 不预留 slug |
| 已发布商品能否改 slug | 首期默认警告并限制直接修改；如业务允许改，必须同步建立旧 slug redirect |
| 英文翻译缺失时的运行时 fallback | 不回退显示中文；显示可诊断的非中文 fallback 并上报，CI 要求菜单翻译覆盖率 100% |
| 默认 locale | 沿用现有 middleware 的产品决定；不在不同组件分别设默认值 |
| 新数据库表 | 仅为以上两项修复不新增表；先复用 `Product.slug` 与 `MenuTranslation` |

---

**结束条件：** 不以“增加了按钮”或“切换后页面主体是英文”为完成标准。必须验证 slug 的真实唯一性与随机生成流程，并确认在英文 locale 下导航、面包屑和页面文案全链路一致。

---

## 11. 2026-10-18 实施与验收记录

### 11.1 根因

- `Product.slug` 已有数据库唯一索引 `products_slug_key`，但此前只有前端按名称转换；没有服务端候选生成、6 位随机后缀或唯一约束竞态映射。
- `/admin/auth/me` 调用 `listForPermissions()` 时没有传 locale，服务端固定使用 `DEFAULT_ADMIN_LOCALE`（`zh-CN`），因此 `/en-US/...` 的侧边栏和面包屑虽然由页面 Shell 渲染，菜单 label 仍来自中文。
- 前端导航查询没有 `no-store`，SessionProvider 也没有记录菜单所属 locale；切换语言时旧菜单可能在请求完成前短暂残留。

### 11.2 Slug 实现

- 新增共享规范化函数 `slugifyProductName()` 与纯候选构造 `productSlugCandidate()`（`packages/contracts/src/slug.ts`）。
- 新增 `POST /api/v1/admin/products/slug-suggestion`：`strategy=name|name-random`，使用 `node:crypto.randomInt(100000, 1000000)` 生成 6 位后缀，最多重试 8 次；不预留 slug。
- 新建页默认勾选“追加 6 位随机数字”，只有点击“生成 URL slug”才替换字段；名称变化不会自动改写 slug。
- 手动输入仍使用 `^[a-z0-9]+(?:-[a-z0-9]+)*$`，最大 180；重复值返回 `409 PRODUCT_SLUG_CONFLICT`，`details.slug=products.validation.slugTaken`。
- 创建/更新均捕获 Prisma `P2002` 并映射到 slug/SKU 字段错误，防止并发“先查后写”竞态。
- 无旧 slug 重定向表时，仅草稿商品可修改 slug；已发布和曾下架（`UNPUBLISHED`）商品的服务端返回 `409 PRODUCT_SLUG_LOCKED`，编辑页 slug 输入、生成按钮和随机开关均锁定并显示原因。

### 11.3 导航国际化实现

- `/admin/auth/me?locale=en-US|zh-CN` 使用 URL locale 查询 `MenuTranslation`；非法 locale 回退到现有默认 `zh-CN`。
- `MenusService` 不再在 `en-US` 缺失翻译时回退中文：返回可诊断的 `menu.code`，并对缺失项记录一次结构化 `menus.translation_missing` 告警。
- 启用且可见菜单在中英文标签不完整时拒绝写入；新增 `MENU_TRANSLATION_MISSING`。
- 新增 `pnpm check:menu-translations`，只读检查全部启用/可见菜单的两语言覆盖率。
- Sidebar、AdminHeader 面包屑与 `useBreadcrumb()` 共用 `resolveNavigationBreadcrumb()`，支持 `/products/:id/edit` 等深层路由。
- SessionProvider 以 `menusLocale` 隔离菜单数据，切换 locale 时不会显示上一语言菜单；`adminApi` 全部请求使用 `cache: 'no-store'`。
- 语言切换保留当前 pathname 和 query string。
- 商品长表单处于未保存状态时，语言切换会先弹出确认；取消后停留在当前 locale 和当前页面。

### 11.4 实际验证

- Slug 候选：同名请求连续返回 `nylon-lock-nut-m12-668228`、`...-706852`；纯名称为 `nylon-lock-nut-m12`。
- 同名商品：成功创建 `same-name-product-406810` 与 `same-name-product-463844`。
- 手动冲突：重复 slug 返回 `409 PRODUCT_SLUG_CONFLICT`，字段 details 为 `products.validation.slugTaken`。
- 编辑不动 slug：修改名称/标记后 slug 保持 `nylon-lock-nut-m12` 不变；草稿可显式改 slug。
- 已发布/已下架商品修改 slug 均返回 `409 PRODUCT_SLUG_LOCKED`，数据库值未变化。
- 权限：只读 QA 角色调用 slug 建议返回 403；`/admin/users` 返回 403，但商品读取返回 200。
- 菜单 API：en-US 返回 `Workspace / Catalog / Products ...`；zh-CN 返回 `工作台 / 商品目录 / 商品管理 ...`；非法 locale 回退中文。
- 浏览器：`/en-US/products/new` 的侧栏、面包屑、页面标题和 slug 生成器均为英文；切换中文保留深层路径，切回英文无旧语言残留；筛选 query 在切换后保留；刷新后页面/导航状态正确；只读角色侧栏不含 Administration。
- 菜单覆盖率：`24 enabled/visible menus × 2 locales` 全部通过。
- 检查命令：`pnpm run lint`、`pnpm run typecheck`、`pnpm test`、`pnpm run build`、`pnpm run check:menu-translations` 全部通过。

### 11.5 数据与回滚

本轮没有 schema/migration 变更。回滚需同时还原 slug API/前端、locale 查询与缓存键、面包屑解析器及菜单翻译完整性校验；数据库唯一索引和现有 `MenuTranslation` 行保持不动。验收在本地开发库创建了若干 `QA-SLUG-*` 草稿商品；测试用的 `qa.picker` 与 `qa.product.viewer` 账号密码已重置为随机值，并要求下次登录改密。
