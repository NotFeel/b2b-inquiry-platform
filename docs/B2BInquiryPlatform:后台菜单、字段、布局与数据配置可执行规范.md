# B2B Inquiry Platform：后台菜单、字段、布局与数据配置可执行规范

> 版本：1.0  
> 依据：项目《技术架构与设计决策》《已确认问题与解决方案》、工厂媒体与证书荣誉管理优化方案 v1.1，以及本次可读取的 `schema.prisma`。  
> 目标：明确后台菜单数据、字段定义、列表/表单布局、权限、API、数据关系和验收条件，让 AI 编程助手能够按步骤实施。  
> 重要说明：本文是目标业务契约，不代表所有功能已实现。执行前必须再次检查仓库、迁移、路由、API、组件和测试。字段名/code 是建议契约，若现有实现有等效字段，应映射复用，不得重复建表。

---

## 0. 先确认的仓库事实与执行约束

### 0.1 当前 Schema 已确认存在的能力

本次检查的 `schema.prisma` 中可见以下模型/枚举：

- `Menu`、`MenuTranslation`：菜单、父子关系、路由、图标、权限 code、排序、可见/启用状态及按 locale 的菜单标题。
- `Permission`、`Role`、`RolePermission`、`UserRole`：现有权限与角色关联体系。
- `DictionaryType`、`DictionaryItem`、`DictionaryItemTranslation`：字典组、选项、稳定 code、排序、启用状态和双语 label。
- `FileAsset`：统一文件资产，包含 `storageKey`、`mimeType`、`sizeBytes`、`purpose`、`status`、`isPublic` 等字段。
- `Ad`、`AdTranslation`：广告与翻译。
- `ContentPage`、`ContentPageTranslation`：内容页面、发布状态、排序和双语内容。
- `AuditLog`：审计日志。
- `FileDeletionJob`：对象存储删除的可重试任务；数据库与对象存储不能视为同一事务。
- `PublishStatus`：`DRAFT`、`PUBLISHED`、`UNPUBLISHED`。

当前可见 Schema 中没有看到独立的 `FactoryMedia`、`Credential`、`FactoryProcessStep`、`HomeSection` 模型，也没有看到 `FileAsset` 与工厂内容之间的关联。实施时必须再次核对完整 schema、迁移和代码引用，确认是否由通用内容模型承载；只有现有模型无法表达需求时才新增模型。

### 0.2 必须遵守的原则

1. 先读 `AGENTS.md`、README、项目文档、路由、服务、schema、migration 和测试。
2. 优先复用现有菜单、翻译、字典、文件上传、内容、审计、权限和缓存体系。
3. 不把菜单隐藏当成 API 权限；服务端必须独立授权。
4. 公开 API 只返回已发布且允许公开的数据；不得返回后台备注、私有文件地址、内部存储 key 或不必要的审计字段。
5. 前台及公开 API 不得暴露商品价格；WhatsApp 询盘消息不含价格。
6. 证书过期不等于删除或自动下线，必须遵循明确展示策略。
7. 数据库迁移先审查旧数据、外键、索引、回滚和文件引用；未经授权不执行生产破坏性操作。
8. 不得声称代码或测试已经完成，除非实际执行并获得结果。

### 0.3 冲突优先级

用户本次明确指令 > 仓库 `AGENTS.md` 和已批准决策 > 实际 schema/migration/API/测试 > 本文建议 > AI 默认推断。出现冲突时先报告差异，不得擅自覆盖既有行为。

---

## 1. 目标菜单结构与菜单数据

### 1.1 菜单位置

在现有“内容管理”分组下增加以下入口，保留已有“内容页面”“广告管理”等菜单。不新建独立 CMS。

| 菜单 code（建议） | 中文名称 | 英文名称 | 父级 | 路由建议 | 图标建议 | 排序建议 |
|---|---|---|---|---|---|---:|
| `content.factory-media` | 工厂媒体 | Factory Media | 现有内容管理父菜单 | `/:locale/content/factory-media` | `images` | 30 |
| `content.factory-process` | 生产流程 | Factory Process | 现有内容管理父菜单 | `/:locale/content/factory-process` | `workflow` | 40 |
| `content.credentials` | 证书与荣誉 | Certificates & Awards | 现有内容管理父菜单 | `/:locale/content/credentials` | `award` | 50 |
| `content.home-sections` | 首页区块 | Homepage Sections | 现有内容管理父菜单 | `/:locale/content/home-sections` | `layout-template` | 60 |

说明：父级 code、路由格式、图标名称、排序数值都要在仓库核验后确定。上表是建议值，不是可以盲目插入数据库的 seed。图标必须使用项目现有图标库。

### 1.2 菜单翻译 seed 数据

优先写入现有 `MenuTranslation` 模型。该模型当前按 `[menuId, locale]` 唯一，菜单标题不应另建翻译表。

| menu code | locale | label | description（若现有模型支持） |
|---|---|---|---|
| `content.factory-media` | `zh-CN` | 工厂媒体 | 管理工厂照片、视频、封面、排序与发布状态 |
| `content.factory-media` | `en-US` | Factory Media | Manage factory photos, videos, covers, order and publication |
| `content.factory-process` | `zh-CN` | 生产流程 | 管理生产步骤、说明、配图和展示顺序 |
| `content.factory-process` | `en-US` | Factory Process | Manage production steps, descriptions, media and order |
| `content.credentials` | `zh-CN` | 证书与荣誉 | 管理证书、检测报告、奖项和展会记录 |
| `content.credentials` | `en-US` | Certificates & Awards | Manage certificates, test reports, awards and exhibitions |
| `content.home-sections` | `zh-CN` | 首页区块 | 配置首页工厂展示、品质荣誉展示和区块顺序 |
| `content.home-sections` | `en-US` | Homepage Sections | Configure factory and quality sections on the homepage |

### 1.3 Menu 字段契约

当前 `Menu` 模型已包含下列字段，实际新增菜单应尽量复用：

| 字段 | 现有语义 | 实施规则 |
|---|---|---|
| `id` | UUID 主键 | 由数据库/ORM 生成，不由客户端指定 |
| `code` | 唯一菜单 code | 稳定且唯一；显示语言变化不改变 code |
| `parentId` | 父菜单 ID | 使用现有内容管理父菜单 ID；禁止形成循环引用 |
| `route` | 路由 | 遵循项目真实路由结构；不要照抄示例路径而不核验 |
| `icon` | 图标 key | 必须是项目图标库支持的 key |
| `permissionCode` | 菜单可见性关联 | 只用于菜单展示/过滤，不代替服务端 API 授权 |
| `sortOrder` | 同级排序 | 与现有菜单排序协调，不覆盖已有顺序 |
| `visible` | 是否显示 | 结合权限决定导航可见性 |
| `enabled` | 是否启用 | 禁用后不出现在正常导航中 |
| `external` | 是否外链 | 本文新增项均为内部页面，默认 false |

菜单变更后，按现有机制清理导航/权限缓存。缓存 key 应包含 locale 和权限上下文或版本。深层路由刷新后侧栏、面包屑、当前菜单高亮必须正确。

---

## 2. 权限 code 与授权矩阵

先查找现有权限 code。以下 code 为建议命名；若系统已有等效权限，必须复用而非重复创建。

| 功能 | 查看 | 创建 | 编辑 | 发布/下线 | 删除 |
|---|---|---|---|---|---|
| 工厂媒体 | `content.factory-media.read` | `content.factory-media.create` | `content.factory-media.update` | `content.factory-media.publish` | `content.factory-media.delete` |
| 生产流程 | `content.factory-process.read` | `content.factory-process.create` | `content.factory-process.update` | `content.factory-process.publish` | `content.factory-process.delete` |
| 证书与荣誉 | `content.credentials.read` | `content.credentials.create` | `content.credentials.update` | `content.credentials.publish` | `content.credentials.delete` |
| 首页区块 | `content.home-sections.read` | 可复用 update 或单独 create | `content.home-sections.update` | `content.home-sections.publish` | 按现有策略决定是否需要 |

权限规则：

- 列表/详情：要求对应 `read`。
- 新建：要求 `create`。
- 编辑：要求 `update`。
- 发布、撤回、上下线：要求 `publish` 或现有等效权限。
- 删除数据库记录/物理删除文件：要求 `delete`，同时执行引用检查和审计。
- 草稿预览仅允许已认证且具备相应后台权限的用户访问。
- 公开 API 不要求后台管理权限，但必须强制过滤未发布、已删除和不允许公开的数据。
- 权限变化后刷新权限缓存并记录审计。

角色语义建议（实际角色名称必须沿用现有 RBAC）：

| 角色语义 | 查看 | 编辑 | 发布/下线 | 物理删除 | 修改角色/菜单权限 |
|---|---:|---:|---:|---:|---:|
| 系统管理员 | 是 | 是 | 是 | 按现有系统策略 | 按现有系统策略 |
| 内容运营 | 是 | 是 | 按授权 | 默认否 | 否 |
| 只读审核 | 是 | 否 | 否 | 否 | 否 |

---

## 3. 后台通用布局

### 3.1 页面框架

所有新增页面使用现有共享后台 Layout，不得单独重建侧栏、顶部栏或面包屑。

页面从上到下：
1. 面包屑。
2. 页面标题、简短说明和主操作按钮。
3. 筛选工具栏（列表页）。
4. 表格/卡片/表单主体。
5. 分页或底部操作。
6. Toast、空状态、加载状态、错误状态和确认弹窗。

桌面端：左侧侧栏可折叠；内容区合理利用宽度。移动端：侧栏使用抽屉，表单单列，表格可局部横向滚动或改卡片，禁止整页横向溢出。

### 3.2 列表页交互

- 筛选变化后回到第一页。
- 搜索使用项目既有 Enter/防抖策略。
- 清空筛选恢复默认列表。
- 默认排序稳定且明确，不能依赖数据库自然顺序。
- 发布/下线/删除必须确认；成功后显示反馈并刷新数据。
- 错误时保留当前筛选和表单内容。
- 空状态应说明为空的原因，并在有权限时提供新增入口。

### 3.3 表单页交互

- 按业务分组展示字段；每个字段有 label、必填标识、帮助文本和错误信息。
- 保存中禁用重复提交。
- 上传区显示预览、进度、失败原因、重试和移除。
- 编辑页显示只读的创建人、创建时间、更新时间（仅在现有审计字段可用时）。
- 有未保存更改时离开页面提示（复用现有能力）。
- 表单必须覆盖 loading、success、validation error、network error、no permission、resource missing 等状态。

---

## 4. 工厂媒体管理：列表字段与表单字段

建议路由：`/:locale/content/factory-media`、`/:locale/content/factory-media/new`、`/:locale/content/factory-media/:id/edit`。最终以现有路由约定为准。

### 4.1 列表筛选

| 字段 code | 控件 | 数据类型 | 规则 |
|---|---|---|---|
| `keyword` | 输入框 | string | 搜索当前语言标题/说明；服务端限制长度 |
| `mediaType` | 下拉 | code | 全部、图片、视频；使用稳定 code |
| `placement` | 下拉/多选 | code | 只显示系统配置过的展示位置 |
| `publishStatus` | 下拉 | `PublishStatus` 映射 | 全部、草稿、已发布、已下线 |
| `updatedFrom` | 日期 | date | 可选 |
| `updatedTo` | 日期 | date | 可选；不得早于起始日期 |

### 4.2 列表列

| 列 code | 中文 | 英文 | 展示规则 |
|---|---|---|---|
| `thumbnail` | 预览 | Preview | 图片缩略图；视频显示封面或视频图标 |
| `title` | 标题 | Title | 当前 locale 标题，缺失时按统一 fallback |
| `mediaType` | 类型 | Type | 图片/视频 |
| `placements` | 展示位置 | Placements | 展示位置标签 |
| `sortOrder` | 排序 | Order | 数字 |
| `publishStatus` | 状态 | Status | 草稿/已发布/已下线 |
| `updatedAt` | 更新时间 | Updated | 本地化日期时间 |
| `actions` | 操作 | Actions | 编辑、预览、发布/下线、删除 |

不在列表返回或展示内部 `storageKey`、后台备注、私有文件 URL、敏感上传信息。

### 4.3 表单分组 A：基本信息

| 字段 code | 中文 label | 英文 label | 类型 | 必填 | 校验/行为 | 公开策略 |
|---|---|---|---|---|---|---|
| `mediaType` | 媒体类型 | Media type | 单选/下拉 | 是 | `image` / `video`，映射现有 code | 可公开 |
| `title.zh-CN` | 中文标题 | Chinese title | string | 按发布规则 | 长度限制沿用项目标准 | 发布后公开 |
| `title.en-US` | 英文标题 | English title | string | 按发布规则 | 长度限制沿用项目标准 | 发布后公开 |
| `description.zh-CN` | 中文说明 | Chinese description | textarea | 否 | 长度限制；按项目富文本策略处理 | 发布后公开 |
| `description.en-US` | 英文说明 | English description | textarea | 否 | 长度限制；按项目富文本策略处理 | 发布后公开 |
| `altText.zh-CN` | 中文替代文本 | Chinese alt text | string | 图片发布时建议必填 | 描述图片内容 | 发布后公开 |
| `altText.en-US` | 英文替代文本 | English alt text | string | 图片发布时建议必填 | 描述图片内容 | 发布后公开 |

### 4.4 表单分组 B：媒体文件

| 字段 code | 中文 label | 英文 label | 类型 | 必填条件 | 规则 |
|---|---|---|---|---|---|
| `assetId` | 图片/视频文件 | Media file | 上传/媒体选择器 | 新建发布时必填 | 引用现有 `FileAsset` 或媒体资源 ID；服务端验证文件状态、purpose、权限和可公开性 |
| `coverAssetId` | 视频封面 | Video cover | 上传/媒体选择器 | 视频发布时按策略必填 | 仅视频类型显示；切换类型不得静默丢失输入 |
| `videoSourceType` | 视频来源 | Video source | 下拉 | 仅视频 | 只允许项目明确支持的来源类型 |
| `videoUrl` | 视频地址 | Video URL | URL 输入框 | 外部视频来源时必填 | HTTPS；按允许域名策略校验；禁止任意服务端抓取 |
| `sourceNote` | 素材来源/授权备注 | Source/licensing note | textarea | 否 | 仅后台可见，不返回公开 API |
| `adminNote` | 后台备注 | Internal note | textarea | 否 | 仅后台可见，不返回公开 API |

`assetId`、`coverAssetId` 是业务契约名称，不代表当前 schema 已有对应列。必须先复用现有 `FileAsset` 和存储服务；不要只保存临时 URL。

### 4.5 表单分组 C：展示与发布

| 字段 code | 中文 label | 英文 label | 类型 | 必填 | 规则 |
|---|---|---|---|---|---|
| `placements` | 展示位置 | Placements | 多选 | 按业务规则 | 使用稳定 code，数据源为配置/现有模型 |
| `sortOrder` | 排序值 | Sort order | integer | 是 | 默认追加到当前末尾；同位置稳定排序 |
| `publishStatus` | 发布状态 | Publication status | 下拉/状态操作 | 是 | 映射现有 `PublishStatus`：`DRAFT`、`PUBLISHED`、`UNPUBLISHED` |
| `publishedAt` | 发布时间 | Published at | 只读日期 | 否 | 服务端维护 |
| `createdBy` | 创建人 | Created by | 只读 | 否 | 复用现有审计能力 |
| `updatedAt` | 更新时间 | Updated at | 只读 | 否 | 服务端维护 |

### 4.6 工厂媒体发布校验与交互

- 发布前验证媒体引用有效、文件状态允许使用、类型/大小符合策略、标题符合语言要求、展示位置有效。
- 上传失败可重试，不清空其他表单字段。
- 视频默认只显示封面，用户点击后播放；首页不自动加载全部大视频。
- 排序保存后前台同展示位置顺序同步更新。
- 被首页区块或生产流程引用的媒体，删除时展示引用位置并阻止静默删除。
- 下线保留数据和文件；删除是单独的高风险动作。
- 数据库与对象存储不是同一事务。复用现有 `FileDeletionJob` 或文件服务的幂等删除/补偿机制；不得假定删除数据库记录就等于文件已删除。

---

## 5. 证书与荣誉：字典、列表和表单字段

### 5.1 类型字典

当前 schema 已有 `DictionaryType`、`DictionaryItem`、`DictionaryItemTranslation`，应优先使用现有字典体系。先检查是否已有相同类型组，禁止重复创建。

建议字典组：`credential_type`。

| option code | 中文 label | 英文 label | sortOrder | enabled |
|---|---|---|---:|---|
| `certificate` | 证书 | Certificate | 10 | true |
| `test_report` | 检测/测试报告 | Test Report | 20 | true |
| `award` | 奖项 | Award | 30 | true |
| `exhibition` | 展会记录 | Exhibition | 40 | true |
| `other` | 其他资质 | Other Credential | 90 | true |

这些是建议数据。若现有字典已有等效 code，应沿用当前 code，不要新增重复选项。业务保存稳定 code/ID，不保存翻译后的 label。

### 5.2 列表筛选

| 字段 code | 控件 | 规则 |
|---|---|---|
| `keyword` | 输入框 | 搜索名称、颁发机构、编号；服务端限制长度 |
| `credentialType` | 下拉 | 从 `credential_type` 字典组读取 |
| `publishStatus` | 下拉 | 全部/草稿/已发布/已下线 |
| `validityStatus` | 下拉 | 全部/有效/即将到期/已过期/无有效期；属于计算/筛选维度，不替代发布状态 |
| `updatedFrom`、`updatedTo` | 日期范围 | 可选；校验日期范围 |

### 5.3 列表列

| 列 code | 中文 | 英文 | 规则 |
|---|---|---|---|
| `thumbnail` | 封面 | Preview | 主附件缩略图，无图显示类型占位 |
| `name` | 名称 | Name | 当前 locale 标题 |
| `credentialType` | 类型 | Type | 字典双语 label |
| `issuer` | 颁发机构 | Issuer | 真实机构名称 |
| `credentialNumber` | 编号 | Number | 可配置是否展示；不能默认公开所有编号 |
| `validity` | 有效期 | Validity | 日期范围/永久有效/未设置 |
| `publishStatus` | 发布状态 | Status | 草稿/已发布/已下线 |
| `sortOrder` | 排序 | Order | 数字 |
| `updatedAt` | 更新时间 | Updated | 本地化日期 |
| `actions` | 操作 | Actions | 编辑、预览、发布/下线、删除 |

### 5.4 表单分组 A：基本信息

| 字段 code | 中文 label | 英文 label | 类型 | 必填 | 校验/规则 | 公开策略 |
|---|---|---|---|---|---|---|
| `credentialType` | 类型 | Type | 下拉 | 是 | 来自稳定字典 code/ID | 可公开 |
| `name.zh-CN` | 中文名称 | Chinese name | string | 按发布规则 | 长度限制 | 发布后公开 |
| `name.en-US` | 英文名称 | English name | string | 按发布规则 | 长度限制 | 发布后公开 |
| `issuer` | 颁发机构 | Issuing organization | string | 按类型决定，证书/报告通常必填 | 不得虚构；服务端条件校验 | 经批准后公开 |
| `credentialNumber` | 证书/报告编号 | Certificate/report number | string | 否 | 长度限制、规范化空格 | 默认不公开 |
| `description.zh-CN` | 中文说明 | Chinese description | textarea | 否 | 长度限制 | 发布后公开 |
| `description.en-US` | 英文说明 | English description | textarea | 否 | 长度限制 | 发布后公开 |

### 5.5 表单分组 B：日期与有效期

| 字段 code | 中文 label | 英文 label | 类型 | 必填 | 规则 |
|---|---|---|---|---|---|
| `issuedAt` | 颁发日期 | Issue date | date | 按类型决定 | 由服务端校验日期合法性 |
| `validFrom` | 有效期开始 | Valid from | date | 否 | 如填写结束日期，检查先后关系 |
| `validUntil` | 有效期结束 | Valid until | date | 否 | 不早于 `validFrom`；空值不能自动判定过期 |
| `validityType` | 有效期类型 | Validity type | 下拉/单选 | 是 | 建议 `dated` / `perpetual` / `not_specified`，映射实际模型 |
| `showExpiredBadge` | 显示过期标记 | Show expired badge | checkbox | 否 | 仅控制 UI 展示，不替代发布状态 |

规则：过期不等于删除。是否继续展示历史证书、是否显示过期标记或自动下线，必须有明确业务决策；未配置有效期的奖项不能误判为过期。即将到期的阈值应集中配置，不得在多个页面硬编码不同天数。

### 5.6 表单分组 C：附件与验证

| 字段 code | 中文 label | 英文 label | 类型 | 必填 | 规则 |
|---|---|---|---|---|---|
| `primaryAssetId` | 主图片/扫描件 | Primary image/document | 上传/媒体选择器 | 按发布规则 | 复用文件服务，验证文件状态与公开资格 |
| `additionalAssetIds` | 其他附件 | Additional attachments | 多文件选择 | 否 | 仅在业务确需多附件且模型支持时启用 |
| `verificationUrl` | 验证链接 | Verification URL | URL 输入框 | 否 | 必须 HTTPS；服务端校验 |
| `verificationLabel.zh-CN` | 中文链接文案 | Chinese verification label | string | 有链接时可选 | 例如“查看验证信息” |
| `verificationLabel.en-US` | 英文链接文案 | English verification label | string | 有链接时可选 | 例如 “Verify credential” |

不能公开私密附件或内部下载地址。不能由服务端任意抓取用户输入的 URL，避免 SSRF。若附件包含未获授权的个人信息，禁止公开。

### 5.7 表单分组 D：展示与发布

| 字段 code | 中文 label | 英文 label | 类型 | 必填 | 规则 |
|---|---|---|---|---|---|
| `sortOrder` | 排序值 | Sort order | integer | 是 | 默认追加到末尾 |
| `placements` | 展示位置 | Placements | 多选 | 按页面规则 | 如品质页/首页，使用稳定 code |
| `publishStatus` | 发布状态 | Publication status | 状态操作 | 是 | 复用 `PublishStatus` |
| `adminNote` | 后台备注 | Internal note | textarea | 否 | 不返回公开 API |
| `createdBy`、`updatedAt` | 创建人/更新时间 | Created/updated | 只读 | 否 | 仅在现有审计能力可用时显示 |

发布前验证类型存在且启用、名称符合语言规则、日期合法、附件可用、验证链接安全、展示位置有效。服务端必须执行全部校验，不能只禁用前端按钮。

---

## 6. 生产流程管理

建议路由：`/:locale/content/factory-process`。

### 6.1 列表筛选与列

筛选：`keyword`、`publishStatus`、`updatedFrom`、`updatedTo`。

列表列：步骤顺序、当前语言标题、配图预览、排序值、发布状态、更新时间、操作（编辑/预览/发布或下线/删除）。

### 6.2 表单字段

| 字段 code | 中文 label | 英文 label | 类型 | 必填 | 规则 |
|---|---|---|---|---|---|
| `title.zh-CN` | 中文步骤名称 | Chinese step title | string | 发布时按语言策略校验 | 长度限制 |
| `title.en-US` | 英文步骤名称 | English step title | string | 发布时按语言策略校验 | 长度限制 |
| `description.zh-CN` | 中文说明 | Chinese description | textarea | 否 | 长度限制 |
| `description.en-US` | 英文说明 | English description | textarea | 否 | 长度限制 |
| `assetId` | 步骤配图 | Step media | 媒体选择器 | 否/按展示策略 | 只能引用有效且可公开的媒体 |
| `sortOrder` | 排序值 | Sort order | integer | 是 | 稳定排序来源 |
| `publishStatus` | 发布状态 | Publication status | 状态操作 | 是 | 复用现有状态体系 |
| `adminNote` | 后台备注 | Internal note | textarea | 否 | 仅后台 |

只有当现有 `ContentPage` 或区块模型不能表达步骤内容、媒体、排序和发布状态时才新增独立模型。若步骤编号由排序计算，不要再保存容易失配的独立编号字段。删除前检查引用；关联媒体下线后后台提示原因，前台按策略隐藏图片或整个步骤。

---

## 7. 首页区块配置

首期只配置两个区块，不开发通用拖拽页面搭建器。优先复用现有 `ContentPage`/内容区块能力。

### 7.1 区块建议数据

| section code（建议） | 中文名称 | 英文名称 | 页面 | 用途 |
|---|---|---|---|---|
| `home.factory-preview` | 工厂实力预览 | Meet Our Factory | 首页 | 精选工厂照片/视频，链接到工厂页 |
| `home.quality-preview` | 品质与荣誉预览 | Quality & Awards | 首页 | 展示少量证书/奖项，链接到品质页 |

实际排序必须核对现有首页布局后确定，不能覆盖已有区块顺序。

### 7.2 区块表单字段

| 字段 code | 中文 label | 英文 label | 类型 | 必填 | 规则 |
|---|---|---|---|---|---|
| `sectionCode` | 区块 code | Section code | 只读/系统生成 | 是 | 稳定唯一标识 |
| `enabled` | 启用区块 | Enable section | checkbox | 是 | 关闭时前台不渲染 |
| `title.zh-CN` | 中文标题 | Chinese title | string | 启用时按语言策略必填 | 长度限制 |
| `title.en-US` | 英文标题 | English title | string | 启用时按语言策略必填 | 长度限制 |
| `description.zh-CN` | 中文简介 | Chinese description | textarea | 否 | 长度限制 |
| `description.en-US` | 英文简介 | English description | textarea | 否 | 长度限制 |
| `itemIds` | 选择展示内容 | Select content | 关联选择器 | 启用时建议必填 | 仅允许已发布且可公开的媒体/证书 |
| `displayLimit` | 展示数量 | Display limit | integer | 是 | 服务端设置合理上下限 |
| `sortOrder` | 区块顺序 | Section order | integer | 是 | 同页面稳定排序 |
| `ctaLabel.zh-CN` | 中文按钮文案 | Chinese CTA label | string | 否 | 按 locale 展示 |
| `ctaLabel.en-US` | 英文按钮文案 | English CTA label | string | 否 | 按 locale 展示 |
| `ctaUrl` | 按钮链接 | CTA URL | 内部路由/受控 URL | 否 | 优先内部路由；外链须校验 |
| `adminNote` | 后台备注 | Internal note | textarea | 否 | 仅后台 |

行为规则：区块关闭时完全不渲染；区块开启但无有效公开内容时默认隐藏整个区块；关联内容用稳定 ID，不复制 URL；关联内容下线后公开查询必须过滤；展示数量有服务端上限；CTA 链接经过校验；预览应支持 locale。

---

## 8. 建议的数据关系与 Schema 变更原则

### 8.1 先复用这些现有模型

- `Menu` / `MenuTranslation`：菜单与翻译。
- `Permission` / `RolePermission`：权限和角色授权。
- `DictionaryType` / `DictionaryItem` / `DictionaryItemTranslation`：类型字典。
- `FileAsset`：文件元数据与对象存储引用。
- `ContentPage` / `ContentPageTranslation`：通用内容页面与翻译。
- `AuditLog`：后台操作审计。
- `FileDeletionJob`：文件物理删除重试/补偿。

### 8.2 只有确实缺失时才新增模型

可能需要的逻辑实体（名称不强制）为：
- 工厂媒体记录：媒体类型、资源 ID、封面 ID、发布状态、排序、展示位置、审计字段。
- 证书/荣誉记录：类型 code、颁发机构、编号、日期、附件 ID、验证 URL、发布状态、排序。
- 生产流程步骤：翻译、媒体引用、排序、发布状态。
- 首页区块配置：稳定 code、启用、翻译、展示数量、排序、关联内容。
- 关联表：只有在现有模型无法可靠表达多对多关联时才新增。

多语言优先复用现有 `*_translations` 子表模式。不要在未做架构决策时同时创建 `titleEn/titleZh`、翻译表和 locale JSON 三套数据源。

### 8.3 数据库约束

- 主键使用现有 UUID 规范。
- 关联文件引用现有 `FileAsset.id`，不要只存客户端临时 URL。
- `sortOrder` 有默认值，查询排序稳定。
- 字典选项通过稳定 code/ID 关联，不依赖翻译 label。
- 公开查询必须有状态过滤。
- 删除策略明确：阻止删除、软删除或物理删除；不能含糊。
- 根据实际查询模式评估 `(status, sortOrder)`、展示位置与排序等索引；先检查已有索引，避免重复。
- 迁移先审查 SQL，考虑旧数据、锁表、默认值、非空字段和回滚。

---

## 9. API 契约与服务端规则

API 前缀、分页格式、DTO 校验库、错误响应必须沿用项目现有标准。以下定义业务操作，不强制采用具体 URL。

| 领域 | 操作 | 权限 | 必须执行的规则 |
|---|---|---|---|
| 工厂媒体 | 列表/详情 | read | 分页、筛选、稳定排序；后台详情与公开详情分离 |
| 工厂媒体 | 新建/编辑 | create/update | DTO 校验、文件引用检查、状态校验、审计 |
| 工厂媒体 | 发布/下线 | publish | 发布前重新校验全部必填条件，清理缓存 |
| 工厂媒体 | 删除 | delete | 引用检查、幂等删除/补偿、审计 |
| 生产流程 | 列表/详情/CRUD | read/create/update | 翻译、媒体、排序、状态校验 |
| 生产流程 | 发布/下线/删除 | publish/delete | 权限、引用检查、缓存失效 |
| 证书荣誉 | 列表/详情/CRUD | read/create/update | 类型、日期、附件、URL 校验 |
| 证书荣誉 | 发布/下线/删除 | publish/delete | 公开资格、引用检查、审计 |
| 首页区块 | 读取/预览 | read | locale 与关联内容过滤 |
| 首页区块 | 更新/排序/启停 | update/publish | 关联项必须是已发布且可公开内容 |

所有写 API：服务端认证、权限校验、DTO 校验、业务规则、数据库约束、事务（需要时）、审计、缓存失效。错误使用项目统一格式，区分参数错误、未认证、无权限、资源不存在、冲突、状态不允许、文件错误和服务器错误。

公开 API 只返回前台需要的字段：当前语言标题/说明、公开媒体地址、排序、展示信息。不得返回后台备注、内部存储 key、上传者隐私信息、敏感编号、草稿、未发布内容或商品价格。不能依赖客户端传 `publishStatus=PUBLISHED` 来控制访问；服务端查询必须强制过滤。

---

## 10. 前台布局与数据联动

### 10.1 工厂页 `/:locale/factory`

模块顺序建议：
1. Hero：工厂标题、简介、CTA。
2. Factory Gallery：后台指定展示位置的精选照片/视频。
3. Production Process：已发布流程步骤，按排序展示。
4. Capabilities / Quality：后台已配置并获准公开的内容。
5. Contact CTA：复用现有 WhatsApp/Contact 设置。

没有数据时隐藏可选区块，不得用虚构工厂图片、设备或认证填充。视频先显示封面，用户点击后再加载/播放。图片不拉伸，使用 alt 文本。

### 10.2 品质页 `/:locale/quality`

模块顺序建议：品质介绍、质检流程（如已配置）、证书与检测报告、奖项/展会记录、Contact CTA。

只展示已发布且获准公开的数据。过期证书按已确认策略显示历史状态、过期标记或隐藏，不自动删除。编号默认不公开，验证链接只在合法且获准公开时显示。

### 10.3 首页

- `home.factory-preview`：展示后台选择的精选工厂媒体，链接到工厂页。
- `home.quality-preview`：展示少量精选证书/奖项，链接到品质页。

区块开关、标题、简介、排序、展示数量和关联内容都由后台数据驱动，不写死在前端。关闭区块或没有有效公开内容时，不渲染空白容器。

---

## 11. 国际化 key 建议

先检查当前语言包的 key 命名规则。以下为语义示例，若现有 key 风格不同应沿用现有风格，避免重复创建同义 key。

```text
content.factoryMedia.title
content.factoryMedia.fields.mediaType
content.factoryMedia.fields.title
content.factoryMedia.fields.description
content.factoryMedia.actions.create
content.factoryMedia.actions.publish
content.factoryMedia.actions.unpublish
content.factoryMedia.messages.uploadFailed

content.factoryProcess.title
content.factoryProcess.fields.stepTitle
content.factoryProcess.fields.sortOrder

content.credentials.title
content.credentials.fields.credentialType
content.credentials.fields.issuer
content.credentials.fields.issuedAt
content.credentials.fields.validUntil
content.credentials.fields.verificationUrl

content.homeSections.title
content.homeSections.fields.enabled
content.homeSections.fields.displayLimit
content.homeSections.fields.itemIds
```

菜单、字段 label、placeholder、帮助文本、按钮、Toast、确认框和错误提示都必须国际化。业务内容翻译沿用现有翻译子表模式（schema 已有 `ContentPageTranslation` 作为例子）；缺失翻译按统一 fallback 处理，不显示 `undefined`、内部 key 或空白。

---

## 12. 文件上传、引用检查和物理删除

### 上传

- 复用现有上传服务和 `FileAsset`。
- 校验扩展名、实际 MIME、大小、内容类型、权限和用途 `purpose`。
- 使用安全 `storageKey`，不信任客户端文件路径或 MIME。
- 上传成功后通过稳定 asset ID 关联，不只存临时 URL。
- 上传失败允许重试并保留其他表单数据。

### 物理删除

删除前必须检查：
1. 用户具有删除权限。
2. 内容是否被首页区块、生产流程或其他内容引用。
3. 文件是否是仍在使用的封面/主图。
4. 资源是否被其他实体共享。
5. 本次操作是解除关联，还是要物理删除底层对象。

数据库和对象存储不能共用一个事务。优先复用 schema 中已有的 `FileDeletionJob` 和当前 worker 的重试/补偿机制。删除失败必须保留可排障状态、错误码和重试路径，不得在对象未删除时报告“物理删除成功”。

删除弹窗中文：
- 标题：确认删除？
- 正文：此操作可能永久删除记录或媒体文件。请先确认该内容未被其他页面引用。
- 按钮：取消 / 删除

英文：
- Title: Delete this item?
- Body: This action may permanently delete the record or media file. Make sure it is not referenced elsewhere.
- Buttons: Cancel / Delete

文案必须进入现有 i18n 资源。

---

## 13. 测试和验收矩阵

### 菜单与权限
- [ ] `zh-CN`/`en-US` 菜单、面包屑和导航高亮正确。
- [ ] 深层路由刷新正常。
- [ ] 无权限用户看不到菜单，也不能直接调用 API。
- [ ] 菜单禁用/删除前检查子菜单和角色引用。
- [ ] 权限变化后缓存失效并写审计。

### 工厂媒体
- [ ] 创建图片记录、上传有效文件、编辑、排序、发布/下线闭环正常。
- [ ] 上传失败可重试，其他表单字段不丢失。
- [ ] 不合法文件类型/大小由服务端拒绝。
- [ ] 草稿和下线记录不出现在公开 API。
- [ ] 被引用媒体删除时阻止操作并展示引用位置。
- [ ] 对象存储删除失败可记录、重试/补偿。
- [ ] 中英文标题、说明和 alt 正确。

### 证书与荣誉
- [ ] 类型从字典加载，保存稳定 code/ID，不硬编码 label。
- [ ] 有效期结束早于开始时保存失败。
- [ ] 无有效期记录不会误判过期。
- [ ] 过期不会自动触发删除。
- [ ] 非 HTTPS/非法验证链接被拒绝。
- [ ] 后台备注、私有附件和未发布内容不出现在公开 API。
- [ ] 排序和缓存更新正确。

### 生产流程与首页区块
- [ ] 步骤按排序显示，草稿/下线不公开。
- [ ] 区块关闭后首页不渲染。
- [ ] 关联内容下线后公开 API 自动过滤。
- [ ] 展示数量有服务端上限。
- [ ] CTA 链接校验有效。
- [ ] 没有内容时无空白大容器。
- [ ] 修改内容后缓存失效。

### 响应式与工程质量
- [ ] 验证 1440、1280、1024、768、390、320–360px 视口。
- [ ] 小屏无整页横向溢出，表单可操作。
- [ ] loading、empty、error、success、no-permission 状态完整。
- [ ] lint、typecheck、相关测试和 build 的真实结果已记录。
- [ ] migration 在目标测试环境通过，旧数据兼容性已验证。
- [ ] `git diff` 不包含无关变更或敏感信息。

---

## 14. 推荐实施任务拆分

### Task 0：仓库核验（不得跳过）
输出：菜单/权限/翻译现状、内容/媒体/文件模型现状、路由/API/上传/审计/缓存现状、与本文的差异表、最小修改方案。默认不修改业务代码。

### Task 1：菜单、权限和 i18n
复用 `Menu`、`MenuTranslation`、RBAC；新增四个菜单项及必要权限；验证中英文、路由高亮、权限过滤和缓存。

### Task 2：工厂媒体管理
完成列表筛选、表格、创建/编辑、上传、预览、排序、发布/下线、引用检查、删除补偿、公开查询和前台图库联动。

### Task 3：证书与荣誉管理
复用字典体系；完成 CRUD、附件、日期校验、验证链接、排序、发布/下线、公开字段过滤和过期展示策略。

### Task 4：生产流程和首页区块
先判断 `ContentPage`/现有区块能力是否可复用；只在确有必要时增加模型和迁移；完成关联、排序、启停、预览和前台联动。

### Task 5：回归与交付
验证响应式、权限、审计、缓存、文件删除、原商品目录与 WhatsApp 询盘；运行 lint/typecheck/test/build；交付真实结果、风险、部署/迁移和回滚步骤。

---

## 15. AI 编程助手执行提示词（可直接复制）

```text
请执行《B2B后台菜单字段布局与数据配置_可执行规范.md》。

你需要以资深产品经理、UI/UX 设计师、前端工程师、后端工程师、数据库设计师和测试工程师的标准完成工作。

1. 先读取 AGENTS.md、README、项目背景、技术架构、已确认问题和本规范。
2. 检查实际 Prisma schema、migration、Menu/MenuTranslation、Permission/RBAC、Dictionary、FileAsset、ContentPage、审计、缓存、上传服务、路由、API 和测试。
3. 先输出当前实现、目标差异、需复用的模型/组件和最小修改计划。
4. 本文的字段名、菜单 code、权限 code、模型名均是目标契约或建议，不得未经核验就直接建表或覆盖已有实现。
5. 优先复用现有菜单、翻译、字典、内容、媒体、权限、审计、文件删除和缓存机制。
6. 菜单可见性与 API 授权必须分离；每个写 API 都要服务端校验权限。
7. 草稿、下线内容、后台备注、私有文件 URL、内部 storage key 不得通过公开 API 泄漏；前台不得暴露商品价格。
8. 证书过期不等于删除；文件物理删除必须检查引用并处理对象存储失败。
9. 涉及数据库时审查 migration、旧数据、外键、索引、约束、兼容性和回滚。
10. 完成 UI、API、业务规则、数据库、权限、审计、缓存、i18n 和测试的完整闭环。
11. 运行项目已有 lint、typecheck、相关测试和 build；未运行的检查说明原因，不得虚报通过。
12. 最终交付：修改文件、菜单/权限变化、字段/API变化、migration、真实测试结果、风险与后续事项。

遇到架构冲突、数据丢失风险或必须由我决定的业务规则时，先列出具体冲突和选项，不要擅自做破坏性变更。
```

---

## 16. 完成定义（Definition of Done）

任务只有满足适用条件后才能标记完成：

1. 菜单、路由、locale、面包屑和权限配置一致。
2. 列表、筛选、表单、状态、确认框和错误状态符合字段契约。
3. 服务端校验、权限、事务、审计、缓存失效完整。
4. 数据模型复用情况和 migration 已记录。
5. 前台只展示已发布且获准公开的内容。
6. 文件上传、引用检查、物理删除和失败补偿可验证。
7. 中英文 UI 与内容 fallback 正常。
8. 正常路径、异常路径、越权路径和关键边界有测试。
9. lint、typecheck、测试和 build 的真实结果已记录。
10. 未完成、未验证事项和人工操作步骤明确列出。

**最终原则：菜单数据、字段数据、页面布局、API 契约、数据库关系、权限和测试必须形成一套一致契约。AI 不应只生成页面和按钮，而应完成可验证的业务闭环。**
