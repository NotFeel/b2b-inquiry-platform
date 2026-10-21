# 系统管理－全局设置管理：UI、CRUD 与技术实施方案

> 文档版本：1.0  
> 适用路由：`/:locale/settings`（例如 `/zh-CN/settings`）  
> 当前截图：全局设置页面  
> 目标：将当前逐项输入、逐项保存的长卡片页面，改造为可分类、可搜索、可创建/编辑/删除、支持中英显示且具备配置安全边界的设置中心。

---

## 1. 现状分析与问题定位

当前页面可看到 `site.companyName`、`site.tagline`、`site.contactEmail`、`site.contactPhone`、`site.address`、`site.socialLinks` 等键值。每个配置项独占一张宽卡片，以技术 key 作为主要标题，下面反复显示“值”和独立“保存”按钮。

### 1.1 UI 问题

1. **页面过长且密度低**：同类站点信息被拆成连续卡片，屏幕同时可对比的配置项很少，管理者需要持续滚动。
2. **技术键值直接面向管理员**：`site.contactEmail` 对开发者清晰，但对日常运营人员不够友好；缺少明确的中英文名称、用途说明和所属分类。
3. **缺少查找与过滤**：配置项增加后，很难按 key、名称、分类、类型快速定位。
4. **缺少完整 CRUD**：当前没有明确的新建、编辑、删除流程，也无法区分系统内置项和自定义项。
5. **保存状态反馈不足**：每项都有“保存”，但视觉上很难判断值是否已修改、保存是否处理中、保存失败后如何恢复。
6. **字段控件不匹配数据类型**：邮箱、电话、长文本、社交链接、布尔开关、JSON 等不应全部使用普通单行输入框。
7. **安全属性不直观**：页面有 `public` 字样，但未来配置密钥、Webhook Token 等敏感项时，不能与普通文本采用同一种展示方式。

### 1.2 当前数据模型的影响

现有 Prisma 草案中的 `GlobalSetting` 主要字段为：

- `key`：配置键；
- `value`：JSON 值；
- `isPublic`：是否可以向公共前台公开；
- `isSecret`：是否为敏感配置；
- `updatedById`、`updatedAt`：更新审计信息。

这对存储 key-value 有帮助，但没有直接表达 `groupCode`、字段类型、双语名称、校验规则、是否系统内置、是否允许删除、排序等信息。因此，仅改前端无法安全地做好通用 CRUD；需要先定义配置元数据来源，再据此实现 UI 和 API。

---

## 2. 目标与非目标

### 2.1 目标

- 提供清晰的设置分类和检索能力。
- 提供新增、编辑、删除入口，并对系统内置配置实施保护。
- 支持中文和英文后台文案，配置项名称和说明可国际化。
- 根据值类型渲染合适的表单控件并执行前后端校验。
- 区分公开配置、私有配置和密钥类配置，防止秘密值泄漏。
- 支持单项保存、保存状态、并发冲突提示、审计日志和缓存失效。
- 保持前台商品价格不泄漏这一全局安全规则。

### 2.2 非目标

- 不把此页面变成环境变量编辑器；数据库密码、应用密钥、加密密钥等基础设施配置应继续由部署环境或 Secret Manager 管理。
- 不允许普通管理员任意修改运行时关键系统配置或删除代码运行依赖的配置。
- 第一阶段不做复杂的配置版本工作流或多环境配置发布审批，除非业务另行确认。

---

## 3. 推荐 UI 结构

### 3.1 页面布局

使用后台统一 Admin Shell，不单独实现页面级 Header/Sidebar。页面正文按以下结构：

```text
┌─────────────────────────────────────────────────────────────────────┐
│ 全局设置                                           [+ 新建设置]       │
│ 管理网站资料、联系方式、询盘行为及其他应用配置                         │
├─────────────────────────────────────────────────────────────────────┤
│ [全部 32] [公开 8] [私有 20] [密钥 4] [自定义 6]                       │
├────────────────────┬────────────────────────────────────────────────┤
│ 设置分类           │ [搜索名称或 key........] [类型▼] [可见性▼] [来源▼] │
│                    ├────────────────────────────────────────────────┤
│ 网站资料           │ 名称       Key                类型  可见性  更新时间 操作│
│ 联系方式           │ 公司名称   site.companyName   文本  公开    ...    编辑 ⋯│
│ 社交媒体           │ 标语       site.tagline       多行  公开    ...    编辑 ⋯│
│ WhatsApp 询盘      │ 联系邮箱   site.contactEmail  邮箱  公开    ...    编辑 ⋯│
│ 搜索与 SEO         │ 联系电话   site.contactPhone  电话  公开    ...    编辑 ⋯│
│ 分析与统计         │ ...                                                │
│ 集成与密钥         │                                                │
│ 自定义设置         │                                                │
├────────────────────┴────────────────────────────────────────────────┤
│ 共 N 项                                     每页 20 条   ‹ 1 / N ›     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 页面视觉规则

- 标题区使用 `h1` 和一句用途说明，右侧放“新建设置”主按钮。
- 顶部统计卡片可选，优先级低于分类/搜索；屏幕宽度不足时自动换行或隐藏次要统计。
- 左侧分类导航建议宽度 `208px`，右侧列表自适应；在窄屏改为横向分类下拉或可滚动标签。
- 列表采用后台统一 Table：表头背景轻灰，行高 `48–56px`，悬停有轻量反馈，避免每个设置都用大卡片。
- 配置显示名称优先；技术 key 使用等宽字体和次级灰色。
- 值预览默认截断：普通文本显示最多约 80 字符；长文本/JSON 显示类型和摘要；密钥只显示“已配置/未配置”，不展示明文。
- “编辑”是主要行操作；“删除”放入更多操作菜单，减少误点，系统锁定项不显示可执行删除按钮，并展示锁定状态及原因。
- 删除按钮使用危险色，删除必须二次确认；保存按钮在无改动时禁用，有改动时突出显示。
- 页面空状态给出“当前分类没有设置”和“新建设置”入口；加载失败展示重试，不得让全局导航随数据请求一起消失。

### 3.3 分类建议

第一阶段建议提供固定、可翻译的分类：

| `groupCode` | 中文 | English | 示例 key |
|---|---|---|---|
| `site_profile` | 网站资料 | Site profile | `site.companyName`、`site.tagline`、`site.logo` |
| `contact` | 联系方式 | Contact | `site.contactEmail`、`site.contactPhone`、`site.address` |
| `social` | 社交媒体 | Social links | `site.socialLinks` |
| `inquiry` | 询盘与 WhatsApp | Inquiry & WhatsApp | `inquiry.whatsappNumber`、`inquiry.defaultMessage` |
| `seo` | 搜索与 SEO | SEO | `seo.defaultTitle`、`seo.defaultDescription` |
| `analytics` | 分析与统计 | Analytics | `analytics.provider`、`analytics.measurementId` |
| `integrations` | 外部集成 | Integrations | 外部服务配置；敏感密钥按密钥规则管理 |
| `custom` | 自定义设置 | Custom settings | 管理员创建的非系统配置 |

分类是管理维度，不等同于访问权限。公开/私有由 `isPublic` 决定，敏感性由 `isSecret` 决定，系统锁定由 `isSystem` 等字段决定。

---

## 4. 新建、编辑和删除交互

### 4.1 新建设置 Drawer

建议桌面端右侧 Drawer 宽度 `680–760px`，移动端全屏。新建与编辑复用一个 `SettingFormDrawer` 组件。

**基础信息**

| 字段 | 规则 |
|---|---|
| 配置 Key | 必填、唯一；例如 `site.companyName`；创建后默认不可直接改 key，若确需迁移应走单独改名流程 |
| 配置名称（中文） | 必填，便于后台运营人员识别 |
| 配置名称（英文） | 必填或按当前语言策略设为必填；至少中英双语 |
| 所属分类 | 从允许分类选择，不接受任意未知 group code |
| 用途说明（中文/英文） | 说明使用场景、影响范围和是否立刻生效 |
| 值类型 | 文本、长文本、数字、布尔、URL、邮箱、电话、单选、多选、JSON；密钥另加敏感属性 |

**值与访问属性**

| 字段 | 规则 |
|---|---|
| 配置值 | 控件由值类型决定；服务端必须验证真实 JSON 类型和业务格式 |
| 是否公开 | 只有可安全提供给前台的非敏感配置可开启 |
| 是否密钥 | 密钥开启后不得公开；列表和普通 GET 不返回明文 |
| 是否必填 | 保存时根据元数据验证 |
| 是否系统内置 | 由服务端控制，普通管理员不能把自定义项改成系统项 |
| 是否允许删除 | 内置关键项默认不可删除；服务端再次检查 |
| 排序 | 只控制当前分类中的显示顺序 |

底部固定操作区：`取消`、`保存`。有未保存改动时关闭 Drawer 需确认；保存中禁用重复提交，成功后关闭 Drawer、刷新列表并显示成功反馈。

### 4.2 编辑设置

- 通过行操作打开编辑 Drawer，并展示配置 key、分类、当前值和元数据。
- 如果用户没有修改内容，保存按钮禁用。
- 值类型变更时，必须先尝试将旧值转换成新类型；无法无损转换时阻止保存并提示先修改值。
- 系统内置字段的 `key`、`isSystem`、`isDeletable`、敏感性等受保护元数据不得由普通表单任意修改。
- 如果设置被标为密钥，编辑时仅显示“已配置”及“替换密钥”入口，不返回旧密钥值；未输入新值表示不更改，不得把空输入误解为清空。
- 保存成功后更新 `updatedAt`、`updatedById`、审计日志，并清理相关缓存。

### 4.3 删除设置

删除仅适用于允许删除的自定义配置。删除前弹窗显示名称、key、分类和明确影响提示。服务端必须再次检查：

1. 配置是否为系统内置项；
2. 是否允许删除；
3. 是否被业务代码注册表、内容模块或其他持久化记录引用；
4. 当前操作者是否有 `settings.delete` 权限；
5. 是否存在并发修改。

不能确认引用情况时，采用“停用/标记废弃”而不是直接物理删除。物理删除成功后写审计，失效缓存；若配置变更影响公共站点，必须让 public config 缓存同时失效。

### 4.4 系统内置设置与自定义设置

- 内置设置：由代码/种子数据注册，拥有稳定 key；默认不能删除，部分配置的值可编辑。
- 自定义设置：由有权限管理员创建；可以在规定的分类、类型和校验规则范围内新增/编辑/删除。
- 不允许只凭 `key` 前缀判断安全性；最终规则来自数据库的系统标记、代码允许列表和服务端校验。
- 对代码强依赖的 key，应由注册表定义其类型、默认值、公开策略、敏感属性和删除限制。前端不能自行判断一个 key 是否安全。

---

## 5. 数据模型建议

### 5.1 先核查现有模型，再迁移

目前 `GlobalSetting` 已存在 `key`、`value Json`、`isPublic`、`isSecret`、`updatedById`、`updatedAt`。建议扩展现有表，而不是重新创建第二张 key-value 表。

### 5.2 建议补充的字段

字段名以现有 Prisma 命名风格为准；最终 migration 必须在实际数据库上验证。

| 字段 | 类型建议 | 说明 |
|---|---|---|
| `groupCode` | `String` | 设置分类编码，例如 `site_profile` |
| `valueType` | `String` 或 Prisma Enum | 值类型：`string`、`text`、`number`、`boolean`、`url`、`email`、`phone`、`select`、`multi_select`、`json` |
| `labelKey` | `String?` | 内置项的翻译资源 key；自定义项用翻译表维护自定义文案 |
| `descriptionKey` | `String?` | 内置项用途说明翻译 key |
| `isSystem` | `Boolean @default(false)` | 是否系统内置项 |
| `isEditable` | `Boolean @default(true)` | 值/元数据是否允许普通管理流程编辑；服务端必须检查 |
| `isDeletable` | `Boolean @default(true)` | 是否允许删除 |
| `isRequired` | `Boolean @default(false)` | 值是否必填 |
| `sortOrder` | `Int @default(0)` | 分类内显示顺序 |
| `validation` | `Json?` | 长度、最小/最大值、正则、允许选项等可声明规则 |
| `options` | `Json?` | select/multi-select 的受限选项；不要存放权限凭证 |
| `revision` | `Int @default(1)` | 可选的并发控制版本号 |

对于自定义配置名称/说明的中英双语，建议增加 `GlobalSettingTranslation`：

- `settingKey`：关联 `GlobalSetting.key`；
- `locale`：如 `zh-CN`、`en-US`；
- `label`：配置名称；
- `description`：配置用途说明；
- `@@unique([settingKey, locale])`；
- 删除设置时在事务中删除关联翻译；内置项则可用静态 i18n 资源作为权威来源。

可用两种实现方式，项目选择其一并保持统一：

- **推荐混合方式**：内置项使用代码 i18n key；自定义项使用 `GlobalSettingTranslation` 数据表。
- **全数据库翻译方式**：所有设置均使用 `GlobalSettingTranslation`，便于从后台维护标签，但需要可靠的初始化 seed。

不要同时在主表中保存 `labelZh`/`labelEn` 又在翻译表存一份，避免双数据源不一致。

### 5.3 Prisma 示意（不应直接替代正式迁移）

```prisma
model GlobalSetting {
  key          String   @id @db.VarChar(160)
  value        Json
  isPublic     Boolean  @default(false)
  isSecret     Boolean  @default(false)
  groupCode    String   @default("custom") @db.VarChar(60)
  valueType    String   @default("string") @db.VarChar(30)
  labelKey     String?  @db.VarChar(180)
  descriptionKey String? @db.VarChar(180)
  isSystem     Boolean  @default(false)
  isEditable   Boolean  @default(true)
  isDeletable  Boolean  @default(true)
  isRequired   Boolean  @default(false)
  sortOrder    Int      @default(0)
  validation   Json?
  options      Json?
  revision     Int      @default(1)
  updatedById  String?  @db.Uuid
  updatedAt    DateTime @updatedAt @db.Timestamptz(6)

  translations GlobalSettingTranslation[]

  @@index([groupCode, sortOrder])
  @@index([isPublic, isSecret])
  @@map("global_settings")
}

model GlobalSettingTranslation {
  id          String        @id @default(uuid()) @db.Uuid
  settingKey  String        @db.VarChar(160)
  locale      String        @db.VarChar(16)
  label       String        @db.VarChar(180)
  description String?
  setting     GlobalSetting @relation(fields: [settingKey], references: [key], onDelete: Cascade)

  @@unique([settingKey, locale])
  @@index([locale])
  @@map("global_setting_translations")
}
```

**注意：** 上述 schema 仅为设计参考。需要核对当前项目的 Prisma 版本、UUID/外键风格、现有迁移、用户表关系和数据库约束，再生成正式 migration。禁止覆盖现有表或丢失 `value`。

### 5.4 `value` 的数据类型策略

数据库仍使用 `Json` 便于存储多种类型，但必须由 `valueType` 与服务端 DTO 保证真实值类型一致：

- `string`、`text`、`url`、`email`、`phone`：JSON string；
- `number`：JSON number，后端拒绝 NaN/Infinity 与越界值；
- `boolean`：JSON boolean；
- `select`：单一稳定选项 code；
- `multi_select`：稳定 code 数组；
- `json`：经过大小限制和结构校验的 JSON；
- 密钥字段按实际值类型存储，但通过 `isSecret=true` 实行写入后不可读策略。

对于图片类配置（如 Logo），建议使用受控图片上传/媒体库选择器，保存文件 ID 或对象存储 key；不要让管理员随意填入任意外站 URL，除非明确允许。

---

## 6. API 契约建议

具体 prefix 应遵循项目已有 `/api/admin` 与 `/api/public` 规范；以下为建议契约，实施前先盘点已有 endpoint，避免重复创建。

### 6.1 管理端接口

| 方法 | 路径 | 用途 | 所需权限 |
|---|---|---|---|
| `GET` | `/api/admin/settings` | 分页列表、搜索、分类/类型/公开性/来源过滤 | `settings.read` |
| `GET` | `/api/admin/settings/groups` | 获取分类及当前 locale 的名称 | `settings.read` |
| `GET` | `/api/admin/settings/:key` | 获取设置元数据与安全值摘要 | `settings.read` |
| `POST` | `/api/admin/settings` | 新建自定义设置 | `settings.create` |
| `PUT` 或 `PATCH` | `/api/admin/settings/:key` | 更新配置元数据和值 | `settings.update` |
| `DELETE` | `/api/admin/settings/:key` | 删除允许删除的自定义配置 | `settings.delete` |

### 6.2 列表响应示例

```json
{
  "items": [
    {
      "key": "site.companyName",
      "groupCode": "site_profile",
      "label": "公司名称",
      "description": "显示在网站导航和页脚的品牌名称",
      "valueType": "string",
      "valuePreview": "Your Company",
      "isPublic": true,
      "isSecret": false,
      "hasValue": true,
      "isSystem": true,
      "isEditable": true,
      "isDeletable": false,
      "updatedAt": "2026-10-16T12:00:00Z",
      "updatedBy": "admin"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 1
}
```

这是数据结构示例，并非当前 API 返回结果。`valuePreview` 必须按字段安全规则生成。`isSecret=true` 时只能返回 `hasValue` 和已配置状态，绝不能包含真实值、可逆掩码或原始序列化值。

### 6.3 创建/更新请求示例

```json
{
  "key": "site.tagline",
  "groupCode": "site_profile",
  "valueType": "text",
  "value": "Product catalogue and WhatsApp quotation",
  "translations": [
    { "locale": "zh-CN", "label": "网站标语", "description": "显示在首页 Hero 区域的辅助说明" },
    { "locale": "en-US", "label": "Site tagline", "description": "Supporting text shown in the homepage hero" }
  ],
  "isPublic": true,
  "isSecret": false,
  "isRequired": true,
  "sortOrder": 20
}
```

对密钥配置，更新请求只接收新密钥；GET 永远不回传旧密钥。未提交密钥字段代表“保持原值”，需清空时使用显式的独立操作，并再次确认授权和审计。公开配置和密钥配置不能同时为 true。

### 6.4 公共端配置

不要提供可以读取任意 key 的开放式接口，例如 `GET /api/public/settings/:key`。应使用显式 allowlist 的公共配置聚合接口，例如：

`GET /api/public/site-config`

只返回明确允许公开、非敏感、经过 DTO 过滤的字段，例如公司名称、网站标语、联系方式、社交链接和 WhatsApp 询盘号码。公共接口不得返回 `isSecret` 内容、内部集成配置或商品内部价格。

### 6.5 统一错误码建议

- `SETTING_KEY_CONFLICT`：key 已存在；
- `SETTING_NOT_FOUND`：目标配置不存在；
- `SETTING_SYSTEM_LOCKED`：系统项不允许当前操作；
- `SETTING_IN_USE`：配置仍被引用；
- `SETTING_VALUE_INVALID`：值与配置类型/校验规则不匹配；
- `SETTING_SECRET_WRITE_ONLY`：不支持读取密钥明文；
- `SETTING_REVISION_CONFLICT`：配置已被其他管理员更新；
- `SETTING_PUBLIC_SECRET_CONFLICT`：敏感配置不能公开；
- `FORBIDDEN`：无对应操作权限。

---

## 7. 后端核心校验与安全要求

1. **后端授权**：每个管理端 API 独立执行 `settings.read/create/update/delete` 权限校验，不能依靠隐藏按钮保护。
2. **key 校验**：限制字符集、长度、大小写/点分段规则，唯一约束由数据库保证；禁止使用空白、控制字符和危险路径格式。
3. **值类型校验**：根据 `valueType` 执行 DTO 校验和额外业务校验；客户端控件不能作为可信边界。
4. **公开与密钥互斥**：`isSecret=true` 时必须拒绝 `isPublic=true`；密钥不能出现在列表、详情、公共 API、缓存公开副本、日志或审计 diff 中。
5. **密钥加密**：若数据库保存外部服务密钥，应采用应用层加密或 Secret Manager；加密密钥不能与数据库数据放在同一位置。优先评估能否让部署环境/Secret Manager 管理基础设施密钥。
6. **审计日志**：记录谁在什么时间对哪个 key 执行何种操作。敏感值只记录“已设置/已替换/已清除”，不记录实际值；其他值根据敏感级别做脱敏或哈希摘要。
7. **事务**：设置主记录与翻译文本一起更新时使用事务；删除设置及翻译关系保持原子性。
8. **并发控制**：通过 `revision` 或 `updatedAt` 前置条件防止两个管理员相互覆盖，冲突时提示刷新后重试。
9. **缓存失效**：更新后清除设置缓存；公共设置变更后清除 public config/CDN/ISR 相关缓存。不能让后台保存成功但前台长期读到旧值。
10. **配置注入安全**：URL、HTML、JSON、脚本标识等字段按场景验证/转义；不要将任意配置值直接拼接到 HTML、SQL、shell 或脚本中执行。
11. **默认值与回滚**：系统项应有 seed/注册表默认值或明确降级策略；误修改后需能从审计记录恢复安全值，但恢复过程也必须权限校验。
12. **不存运行时基础设施机密**：数据库密码、应用加密密钥、Session 签名密钥等使用环境变量或 Secret Manager，不允许通过普通设置页面暴露或修改。

---

## 8. 前后端代码结构建议

按项目现有 Monorepo 路径落地，不新增另一套管理应用：

```text
apps/admin/src/
  app/[locale]/settings/page.tsx
  features/settings/
    components/
      SettingsToolbar.tsx
      SettingsGroupNav.tsx
      SettingsTable.tsx
      SettingFormDrawer.tsx
      SettingValueEditor.tsx
      DeleteSettingDialog.tsx
      SecretValueEditor.tsx
    hooks/
      useSettings.ts
      useSettingGroups.ts
    api/
      settings.client.ts
    schemas/
      setting-form.schema.ts
    types/
      setting.types.ts
  messages/
    zh-CN.json
    en-US.json

apps/api/src/
  modules/settings/
    settings.module.ts
    settings.controller.ts
    settings.service.ts
    settings.repository.ts
    dto/
      create-setting.dto.ts
      update-setting.dto.ts
      list-settings-query.dto.ts
    policies/
      setting-policy.ts
    validators/
      setting-value.validator.ts
    tests/

packages/i18n/                    # 共用 UI 文案
packages/validation/               # 允许复用的通用校验
```

如果仓库现有目录命名不同，应遵循实际结构调整，不得为贴合示例而重复创建模块。前端仅保存表单状态；所有权限、值类型、安全标记和引用检查都必须由后端最终校验。

---

## 9. 数据迁移和兼容性实施计划

### 阶段 0：现状盘点

- 核查当前 Prisma schema、实际 migration、`global_settings` 表结构、配置 seed 与读取位置。
- 全仓库搜索 `site.companyName`、`site.tagline`、`site.contactEmail` 等现存 key 的引用。
- 检查 public config 是通过哪一个 service、缓存或 Next.js 数据获取路径提供的。
- 盘点现有配置是否含 Token、密钥或敏感个人信息。
- 形成 `key → groupCode/valueType/isPublic/isSecret/isSystem/isDeletable/defaultValue` 的迁移清单。

### 阶段 1：向前兼容扩展

- 为现有表新增元数据字段并提供默认值，保留所有现有 key/value。
- 为既有配置填充 `groupCode`、`valueType`、`isSystem`、`isEditable`、`isDeletable` 和排序。
- 创建翻译表并 seed 中英文名称与说明。
- 在回填校验完成之前，不删除或重命名任何旧配置键。

### 阶段 2：API 双读兼容

- 管理端新 API 输出元数据和安全摘要。
- 公共端继续通过显式 allowlist 输出当前支持字段；逐步改为新配置 service 读取。
- 新旧 API 并行期间，统一缓存 key 和失效规则，避免出现后台写入一处而前台读取另一处。

### 阶段 3：UI 改造与数据验证

- 上线分类导航、搜索、过滤、列表、抽屉 CRUD 和删除保护。
- 校验每个旧 key 都能在新页面查找、编辑并正确保存。
- 抽样比较迁移前后 JSON 类型和值；对于 `socialLinks` 等 JSON 字段，确认其结构而非只比较字符串化内容。

### 阶段 4：清理与回滚

- 观察一个发布周期，确认前后台无旧读取路径残留后，才移除废弃接口/字段。
- 若出现问题，回滚 API/前端版本；元数据扩展字段保留且可忽略，不先执行破坏性 schema 收缩。
- 生产 migration 必须可重复审查、有执行前备份和迁移计数校验；生产数据变更不得通过手工直接编辑实现。

---

## 10. 测试计划与验收标准

### 10.1 功能测试

| 编号 | 场景 | 预期结果 |
|---|---|---|
| GS-001 | 打开设置页 | 复用统一 Admin Shell，列表和分类正常加载 |
| GS-002 | 按 `site.contactEmail` 搜索 | 返回匹配项，清除搜索后恢复当前分类结果 |
| GS-003 | 选择联系方式分类 | 只显示该分类设置，统计信息同步更新 |
| GS-004 | 新建唯一 key | 保存成功，列表出现新项，刷新后仍存在 |
| GS-005 | 新建重复 key | 后端返回冲突提示，不产生重复记录 |
| GS-006 | 编辑普通文本 | 保存成功，更新时间/操作人更新，相关缓存失效 |
| GS-007 | 邮箱字段填写非法值 | 前端提示，后端同样拒绝绕过前端的非法请求 |
| GS-008 | 修改数字字段为非数字 | 不保存，显示明确错误 |
| GS-009 | 编辑 JSON 为非法 JSON | 保存按钮禁用或后端拒绝，并保留用户输入 |
| GS-010 | 编辑系统项受保护元数据 | 不允许篡改 `isSystem/isDeletable` 等字段 |
| GS-011 | 删除可删自定义项 | 二次确认后删除，翻译、缓存和审计同步处理 |
| GS-012 | 删除系统项/被引用项 | 后端拒绝并解释原因 |
| GS-013 | 密钥配置详情 | 只显示已配置状态，不出现真实值 |
| GS-014 | 更新密钥但未输入新值 | 保持原密钥，不意外清空 |
| GS-015 | 设置公开且密钥为 true | 后端拒绝，不保存冲突配置 |
| GS-016 | 两个管理员并发编辑同一项 | 后提交者看到版本冲突，不静默覆盖 |
| GS-017 | 切换中文/英文 | 分类、标签、说明、校验与按钮正确翻译 |
| GS-018 | 刷新页面 | 新值持久化，公共缓存按规定刷新 |
| GS-019 | API 请求超时 | 显示重试入口，不丢失本地未提交内容 |
| GS-020 | 手机 360px 视口 | 分类、表格替代布局和 Drawer 可操作，无横向溢出 |

### 10.2 安全测试

- 未登录请求所有管理端 settings API，必须拒绝。
- 无 `settings.create/update/delete` 权限的账号，直接请求 API 也必须拒绝。
- 尝试通过请求体将自定义项提升为系统项或解锁受保护项，必须拒绝。
- 检查浏览器网络响应、日志、审计 diff、异常堆栈、缓存中无秘密值。
- 检查公共配置接口仅返回 allowlist 中的非敏感项；不允许构造任意 key 读取私有设置。
- 检查前台 SSR HTML、客户端缓存和 SEO 数据不包含商品价格字段。
- 验证删除无法造成关键业务读取配置时报错或静默回落到不安全默认值。

### 10.3 发布验收门槛

- lint、typecheck、相关单元/集成测试和 build 通过；无法执行的检查必须明确说明。
- migration 在空库和含现有配置的数据副本上均可正确执行。
- 所有旧 key 在迁移后都有映射，key/value 无丢失。
- 密钥读写策略、安全缓存和审计测试通过。
- 360px、768px、1024px、1440px 视口检查通过。
- 用户能完整完成“搜索 → 新建自定义配置 → 编辑 → 刷新验证 → 删除”，且内置项得到保护。

---

## 11. 推荐实施顺序与工时拆分

1. **盘点与模型映射**：现有 schema/API/配置引用、密钥扫描、分类映射。
2. **数据库与 API**：元数据迁移、翻译、CRUD、服务端校验、审计、缓存失效。
3. **后台 UI**：分类导航、搜索过滤、列表、字段渲染器、Drawer、删除确认。
4. **公共配置兼容**：allowlist、DTO 脱敏、缓存/ISR/CDN 刷新。
5. **测试与上线**：迁移演练、权限测试、密钥测试、响应式和回滚演练。

优先级建议：先完成搜索、分类、编辑体验和系统项保护，再开放自定义配置创建/删除。删除机制必须晚于引用盘点与后端保护上线。

---

## 12. 可直接复制给 AI 编码助手的任务说明

```text
请先阅读根目录 AGENTS.md，以及 docs/21-global-settings-management.md 和
.agents/skills/global-settings-management/SKILL.md，再检查实际代码和数据库迁移。

任务：重构系统管理-全局设置页面。

必须先盘点现有 GlobalSetting schema、settings API、公共配置读取路径、缓存和所有已有 key 的代码引用。
不要直接覆盖或重建 global_settings 表，不要丢失现有 value，不要凭空假设已有 endpoint。

实施要求：
1. 将逐项大卡片改造成分类导航 + 搜索/过滤 + 设置表格；技术 key 次要显示，主显示名称中英双语。
2. 新增新建、编辑、受保护删除入口；新建和编辑使用统一 Drawer 表单。
3. 根据 valueType 渲染字符串、长文本、数字、布尔、URL、邮箱、电话、选择器和 JSON 控件。
4. 在现有 GlobalSetting 上增加必要元数据（分类、类型、标签翻译、系统锁定、可编辑/删除、校验、排序等）；迁移前须先检查现有 Prisma 版本与 migration。
5. 系统内置配置不可普通删除；自定义配置需通过服务端检查才能删除。
6. 密钥配置永远只写不读；列表、详情、日志、审计 diff 和公共接口不得返回密钥明文。密钥不能设置为公开。
7. 每个 API 按 read/create/update/delete 权限校验；前端隐藏按钮不算授权。
8. 公共配置只通过 allowlist DTO 输出，修改后清除 server/cache/CDN/ISR 相关缓存；绝不暴露商品价格。
9. 补齐翻译、校验、审计、并发冲突处理、错误状态、loading/empty/retry 状态和测试。
10. 提交版本化迁移、seed/回填、回滚说明、测试报告和最终改动清单。

完成后报告：改动文件、API、migration、测试命令和结果、未完成项、风险与回滚步骤。
禁止用虚构数据冒充接口已完成，禁止把未运行的测试描述为通过。
```

---

## 13. 完成定义

- [ ] 设置分类、名称、说明支持中英文。
- [ ] 搜索、过滤、分页可用。
- [ ] 新建、编辑、删除都有后端真实实现和授权。
- [ ] 系统项/被引用项受到保护。
- [ ] 不同类型使用合适控件且后端验证一致。
- [ ] 密钥采用写入后不可读策略，不进入日志/公共响应。
- [ ] 公共设置采用 allowlist，缓存一致且不泄漏价格。
- [ ] 所有现存设置迁移完成且值一致。
- [ ] 审计、并发冲突、错误提示和恢复路径可验证。
- [ ] 中英双语、手机/平板/桌面体验通过验收。
- [ ] migration、测试、部署与回滚文档同步提交。
