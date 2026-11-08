# DOC-45 单据模板页面与渲染配置修复规范

> 状态：实施基线（待分阶段开发）
> 目标：修复单据模板的草稿误创建清理、字段显示配置不生效、预览与真实 PDF 不一致等问题，并优化模板管理工作流。
> 依据：2026-11-07 main 分支代码审查、用户提供的列表/编辑/预览截图、DOC-41、DOC-42、AGENTS.md。
> 本文件只定义实施要求；提交本文件不代表业务代码、数据库或生产环境已变更。

---

## 1. 本次审查范围与结论

审查仓库：`NotFeel/b2b-inquiry-platform`  
审查分支：`main`  
审查基线 commit：`b2cc9c6233a9624b26747e14d1239b17ed4eff7f`

本次核对的主要文件：

- `apps/admin/src/app/[locale]/(admin)/document-templates/page.tsx`
- `apps/admin/src/lib/commercial-documents-api.ts`
- `apps/api/src/modules/commercial-documents/document-templates.controller.ts`
- `apps/api/src/modules/commercial-documents/document-templates.service.ts`
- `apps/api/src/modules/commercial-documents/document-templates.service.spec.ts`
- `packages/commercial-documents/src/render.ts`
- `packages/commercial-documents/src/template-config.ts`
- `packages/commercial-documents/src/field-catalog.ts`
- `packages/commercial-documents/src/commercial-documents.spec.ts`
- `packages/validation/src/commercial-documents.ts`
- `packages/contracts/src/constants.ts`
- `database/prisma/seed.ts`
- `database/prisma/schema.prisma`
- `apps/admin/src/messages/zh-CN.json`
- `apps/admin/src/messages/en-US.json`

### 1.1 必须优先修复的缺陷

| 优先级 | 用户可见问题 | 代码核查结果 | 修复结论 |
|---|---|---|---|
| P0 | 字段未勾选，预览仍显示 | `visibleSections()` 已过滤隐藏区域和隐藏字段；但 `render.ts` 仍在页眉硬编码输出单据编号、Revision、Currency，绕过字段配置 | 移除绕过配置的硬编码输出，统一由配置控制 |
| P0 | 某些字段/区域隐藏后仍出现 | Notes、条款提示、真实性声明和签章区存在独立渲染路径；签章区只判断区域存在，内部仍可能输出已隐藏的签名项 | 所有业务字段、区域和条款都必须经过统一可见性判断 |
| P0 | 预览不是纯预览 | Admin 的 `preview()` 先调用 `persistTemplate()`，预览会先保存草稿；`validate()` 也会先保存 | 预览和校验默认使用当前未保存配置，不隐式保存 |
| P1 | 错误创建的草稿无法删除 | Controller 没有 DELETE 路由，Service 没有草稿删除方法，页面只有编辑/停用 | 增加受保护的“删除草稿”操作，只允许删除未发布且未被单据引用的草稿 |
| P1 | 模板列表难以管理 | 页面只请求第 1 页、最多 100 条；没有搜索、类型筛选、状态筛选和分页控件 | 补齐已有列表 API 支持的查询、筛选和分页 |
| P1 | 编辑页面太长 | 基本信息、样式、字段、商品列、条款、版本历史全部连续纵向堆叠 | 按工作步骤分组/Tab，桌面端保留清晰编辑区，移动端使用分段切换 |
| P1 | 预览窗口无法高效对照 | 预览通过 Modal + iframe 打开，编辑和预览不能同时对照 | 桌面端支持编辑/预览并排或可切换工作区；移动端使用“编辑/预览”切换 |
| P1 | 发布/停用操作反馈不足 | 停用按钮直接调用更新，没有确认；停用默认模板时默认标记未明确处理 | 增加确认、影响说明、默认模板状态一致性处理 |
| P2 | 新建误操作风险高 | 新建成功后直接进入编辑，缺少模板用途/默认范围提示和复制模板流程 | 新建时明确 PI/CI、语言、默认范围；增加复制为草稿 |
| P2 | 部分配置项有 UI/渲染不一致风险 | `footer.showPageNumbers` 等配置需逐项核实是否有界面入口和渲染实现 | 每个可编辑配置必须有真实渲染效果；无实现的配置不得伪装成可用设置 |

### 1.2 已存在且应复用的能力

- 模板数据模型 `DocumentTemplate` 与不可变版本模型 `DocumentTemplateVersion`。
- `draftConfig` 保存编辑草稿；发布时复制配置形成不可变版本。
- `CommercialDocument.templateVersionId` 与外键 Restrict 已保护历史引用。
- `documentTemplateListQuerySchema` 已支持分页、PI/CI 类型、状态和关键字 q。
- `documentTemplatePreviewSchema` 已允许提交临时 config、documentType、locale。
- `visibleSections(config, locale)` 已统一过滤隐藏区域和字段。
- `renderCommercialDocumentHtml()` 同时被 API 预览和 Worker PDF 渲染复用。
- 已有 `ConfirmDialog`、`Modal`、`PageHeader`、`Field`、`Button` 等 UI 组件。
- 已有模板校验、预览、发布、版本历史和乐观并发更新机制。

本次不新建模板系统，不替换渲染引擎，不复制一套版本模型。

---

## 2. 业务规则与不可破坏边界

1. 模板分为草稿（DRAFT）、启用（ACTIVE）、停用（DISABLED）。
2. 草稿可以修改；发布后生成新的不可变版本。
3. 已发布版本不得原地修改或删除。
4. 已被任意 PI/CI 单据引用的模板/模板版本不得物理删除。
5. 错误创建的草稿只有同时满足以下条件才允许删除：
   - 当前模板状态为 DRAFT；
   - 不存在任何已发布版本；
   - 不存在任何 CommercialDocument 引用该模板；
   - 不存在版本、渲染任务或其他数据库关系阻止删除。
6. DISABLED 模板不直接删除。用户可先通过现有启用/恢复流程将未发布草稿恢复为 DRAFT，再执行删除；若有发布历史则只能停用。
7. 删除是永久操作，必须二次确认并审计；删除成功后列表和当前编辑区同步刷新。
8. 删除失败必须给出明确原因，不允许前端隐藏错误或假报成功。
9. 不自动删除已签发 PI/CI、PDF、快照、模板版本或关联渲染任务。
10. 不允许通过级联删除绕过历史保护；数据库已有 Restrict 外键继续作为最后一道保护。
11. “预览”只生成 HTML，不修改模板草稿、版本、默认状态或更新时间。
12. “校验”校验当前编辑器内的配置，不应要求先保存草稿。
13. “保存草稿”才是明确持久化操作；“发布新版本”必须展示版本发布确认。
14. PI/CI 预览与 Worker PDF 必须调用同一套渲染规则，不能出现预览隐藏、PDF 又显示的情况。

---

## 3. 字段显示功能修复（核心）

### 3.1 统一渲染原则

模板配置是唯一的显示规则来源。渲染器不得再额外硬编码输出未配置的业务字段。

所有可配置内容必须遵循：

- 区域 `section.visible === false`：该区域整体不输出。
- 字段 `field.visible === false`：该字段的标签、值、占位结构都不输出。
- 字段值为空：默认不输出该字段，除非该字段属于明确允许显示空值的固定布局元素。
- 区域内没有任何可输出字段：不输出区域容器和区域标题。
- 商品列只渲染 `itemColumns` 中 visible=true 的列。
- 特殊字段（页眉元数据、备注、条款、声明、签章、Logo、Stamp）也必须具有明确配置来源，不能绕过字段配置。

### 3.2 已定位的硬编码输出

文件：`packages/commercial-documents/src/render.ts`

当前页眉固定输出：

- Document No. / 单据编号
- Revision / 版本
- Currency / 币种

这三项不受现有字段复选框完整控制。尤其 Revision 字段在“发票信息”区域取消勾选后，页眉仍会输出 Revision R1。用户截图已展示这一现象。

整改要求：

1. 删除页眉中不受配置控制的 Revision、Currency、Document No. 固定行。
2. 这三项统一由现有字段配置控制：
   - `document.number`
   - `document.revision`
   - `trade.currency`
3. 不允许同一个字段因页眉和详情区域分别硬编码而重复显示。
4. 如果产品设计决定保留“页眉元数据”位置，则必须将其配置化，并与正文同一字段 key 共享唯一 visible 状态；不得出现两个互相独立的开关。
5. 对旧版配置保持兼容：历史模板没有新增配置时，按安全的默认配置解析，不得使已发布模板渲染失败。

### 3.3 其他特殊渲染路径必须逐项整改

| 渲染内容 | 当前风险 | 目标行为 |
|---|---|---|
| Seller / Buyer / Consignee / Notify Party | 复用 visibleSections，原则上正确 | 保留；增加隐藏区域/字段测试 |
| Invoice / Trade / Shipping / Payment | 复用 visibleSections，原则上正确 | 保留；禁止额外硬编码字段 |
| Totals | 有独立 totalsVisible / totalsFieldVisible 逻辑 | 统一使用同一配置过滤 helper，避免找不到字段时默认显示 |
| Item table | 列 visible 过滤已实现，但表格外壳仍固定输出 | 无可见列或不允许渲染时不输出空表；保留描述/金额列的业务校验规则 |
| Notes | 当前 data.notes 有值即输出，没有模板字段开关 | 增加可配置显示开关或纳入字段目录；默认值兼容旧模板 |
| Payment notice | 由 terms.paymentNotice 独立输出 | 增加 terms 显示配置，关闭后不输出 |
| Shipment notice | 由 terms.shipmentNotice 独立输出 | 增加 terms 显示配置，关闭后不输出 |
| Authenticity declaration | terms.authenticityDeclaration 可绕过 declaration 区域/字段隐藏 | 统一由声明区域与条款配置共同控制 |
| Declaration fields | 已按 visibleSections 过滤 | 保留并补充回归测试 |
| Signature | 当前只判断 signature 区域存在，内部仍固定输出卖方和买方签名单元格 | 分别按 signature.seller / signature.buyer visible 控制；均隐藏时不输出整个签章区域 |
| Seller Logo | 已有 header.showLogo | 保留 |
| Seller Stamp | 当前与 header.showLogo 共用开关 | 独立控制 Stamp 显示；不能因关闭 Logo 而无法单独显示印章 |
| Header title/subtitle | 由 header 配置控制 | 保留 |
| Footer text | 有文字即输出 | 保留；必要时增加显示开关 |
| Page numbers | 配置模型包含 showPageNumbers，必须核查渲染是否真正实现 | 实现并测试，或移除未实现的配置项/界面入口；不允许显示无效开关 |

### 3.4 统一可见性辅助方法

在 `packages/commercial-documents/src/template-config.ts` 或合适的同包模块中，抽取纯函数，例如：

- `isSectionVisible(config, sectionKey)`
- `isFieldVisible(config, fieldKey)`
- `visibleFields(config, sectionKey, locale)`
- `hasVisibleFields(config, sectionKey)`

具体函数名可以按现有代码风格调整，但必须满足：

1. 渲染器不重复编写不同版本的 visible 判断。
2. 缺失字段配置时使用明确的兼容默认策略。
3. 不允许“找不到配置就默认显示”成为隐藏功能失效的原因；对新配置应有明确默认值。
4. 所有 helper 都是纯函数，可独立单测。
5. UI 的字段计数、预览渲染和校验报告尽量复用同一规则。

### 3.5 配置结构兼容

如果为了 Notes、Terms、Stamp、Header 元数据增加配置字段：

- 优先扩展现有 `DocumentTemplateConfig`，禁止创建第二套配置 JSON。
- 评估 `schemaVersion` 与历史模板兼容性；若不升级版本，也必须在 parser 中为旧配置补齐默认值。
- `parseTemplateConfig()` 必须能解析当前线上历史草稿和所有已发布版本。
- 已发布版本中的原始 config/checksum 不得被批量改写。
- 新默认值不能改变历史已发布单据的渲染结果。
- `createDefaultTemplateConfig()`、`parseTemplateConfig()`、Zod schema、Admin TypeScript 类型和测试必须同步更新。

---

## 4. 预览与校验改为无副作用

### 4.1 当前问题

Admin 页面当前 `preview()` 和 `validate()` 都先执行 `persistTemplate()`。用户只是想查看效果，却会先保存草稿，导致：

- 预览动作修改更新时间；
- 预览动作可能覆盖其他会话保存的草稿；
- 用户无法安全试验字段开关；
- 预览与“保存草稿”操作语义混淆。

### 4.2 预览目标流程

点击“预览”：

1. 读取当前编辑器 state 中的 `meta`、`config`。
2. 直接调用现有 `POST /admin/document-templates/:id/preview`。
3. payload 包含当前 config、当前 documentType、当前 locale。
4. API 使用临时 config 调用 `renderCommercialDocumentHtml()`。
5. 返回 HTML 和必要的预览元信息。
6. 不调用 PATCH，不更新 `draftConfig`，不更改 `updatedAt`。
7. 预览标题应明确显示“样例数据预览”，不能让用户误以为是实际客户单据。
8. 预览结果标明模板名称、PI/CI 类型、语言、纸张和方向。
9. 编辑器内容变化后，用户再次预览得到最新结果。

### 4.3 校验目标流程

校验当前未保存配置：

- 将当前 config 作为请求体传给校验 API。
- API 对临时 config 执行 parse、结构校验和业务警告。
- 不写数据库。
- 返回错误、警告和受影响字段 key。
- 页面将问题定位到对应 Tab/区域/字段。
- 若暂时不扩展校验 API，则必须明确标注“校验已保存草稿”，并要求用户主动保存；不能暗中保存。

建议优先扩展现有 validate API 的 body schema，保持原有空 body 调用兼容。

### 4.4 预览失败和加载状态

- 预览按钮只在预览请求期间 loading。
- 预览失败显示可理解错误，不清空用户当前编辑 state。
- 连续点击应防止并发请求互相覆盖。
- 用户关闭预览后返回原编辑位置。
- 预览 iframe 继续使用 sandbox，不允许引入任意脚本执行或外部资源加载。

---

## 5. 草稿删除与误创建恢复

### 5.1 API

新增：

```http
DELETE /admin/document-templates/:id
```

权限：

- 新增 `document_template.delete`。
- Controller 必须执行服务端权限验证。
- 前端仅在 `can('document_template.delete')` 且目标为可删除草稿时显示按钮。

需要同步：

- `packages/contracts/src/constants.ts`：PermissionCode 增加 delete 权限。
- `database/prisma/seed.ts`：REFERENCE_PERMISSIONS 增加 `document_template.delete`，模块归属 document-template。
- 复核权限树、默认角色授权和现有角色分配方式；不得仅隐藏按钮而不做 API 鉴权。

如果团队决定不新增权限，则必须在实施前明确批准复用 `document_template.update`；不得在代码中静默采用更宽泛权限。

### 5.2 Service 删除前校验

在 `DocumentTemplatesService` 增加独立删除方法，执行顺序：

1. 查询模板，不存在返回 404。
2. 检查 status 必须为 DRAFT，否则返回 409。
3. 检查 `versions` 数量必须为 0，否则返回 409。
4. 检查 `documents` 关联数量必须为 0，否则返回 409。
5. 在事务内再次校验并删除，避免检查与删除之间出现并发引用。
6. 记录审计事件 `document_template.deleted`，metadata 仅记录模板 ID、code、documentType、locale、name；不记录完整 config 中可能存在的敏感业务内容。
7. 返回明确的删除结果。
8. 捕获外键 Restrict 冲突，映射为 HTTP 409 和明确提示。

推荐错误语义：

- `TEMPLATE_NOT_FOUND`：404。
- `TEMPLATE_NOT_DELETABLE`：409（已发布、已停用或存在版本）。
- `TEMPLATE_IN_USE`：409（已有单据引用）。
- `TEMPLATE_CONCURRENT_UPDATE`：409（并发变化）。

具体错误码必须复用项目现有错误码约定；若新增，更新 contracts/errors、错误映射和双语文案。

### 5.3 页面交互

列表每一行根据状态和权限展示操作：

| 模板状态 | 操作 |
|---|---|
| DRAFT 且无版本/无单据引用 | 编辑、预览、复制、删除草稿 |
| DRAFT 但已被单据引用或存在版本 | 编辑、预览、复制；不显示删除 |
| ACTIVE | 编辑草稿、预览、复制、版本历史、停用 |
| DISABLED 且有发布历史 | 查看/编辑草稿、预览、复制、启用；不显示删除 |
| DISABLED 且无版本/无引用 | 可先恢复为 DRAFT，再删除；也可提供明确的“删除未发布草稿”入口，但后端仍须检查 |

删除确认弹窗必须展示：

- 模板名称；
- PI 或 CI 类型；
- 语言；
- 当前状态；
- “此操作不可恢复，仅删除未发布草稿，不影响已签发单据”的说明。

删除成功后：

- 清除 selected/meta/config/validation/preview 状态；
- 重新加载当前页；
- 若删除的是当前页最后一条记录，回到上一页或显示空状态；
- 显示成功 toast。

### 5.4 复制模板

复用现有 create API（create schema 已允许传 config），创建新的 DRAFT：

- 复制当前模板的 config、纸张、方向、语言和 documentType；
- 新名称追加“副本 / Copy”，并允许用户修改；
- 默认 `isDefault=false`；
- 不复制版本记录；
- 不复制历史单据引用；
- 不复制 template ID、code、checksum、version ID；
- 新草稿创建后打开编辑器。
- 如果原模板为 DISABLED，复制出的新草稿仍为 DRAFT。

---

## 6. 默认模板规则修正

当前 Service 的创建/更新逻辑清除默认标记时只按 `documentType` 过滤；而 `activeDefaultVersion(documentType, locale)` 按 documentType + locale 查找。这可能导致设置英文 CI 默认模板时，把中文 CI 默认模板也清除。

目标唯一范围：

**同一 documentType + 同一 locale 只能有一个默认模板。**

实施要求：

- create() 清除默认模板时同时过滤 documentType 和 locale。
- update() 清除默认模板时同时过滤 documentType 和 locale。
- 设置为默认的模板必须处于可用于单据创建的 ACTIVE 状态，或在发布时明确完成默认启用规则。
- 禁止 DISABLED 模板继续显示为“当前默认”。
- 停用默认模板时，在同一事务中取消其 isDefault；不自动把另一个模板设为默认，除非业务明确指定。
- 当某类型/语言没有默认模板时，单据创建流程按现有 active options 规则要求用户选择或使用既定 fallback；不得误选其他语言模板。
- 并发设置默认模板必须有事务/约束/冲突处理，避免两个默认值。

本次优先采用现有模型和索引；是否需要数据库唯一索引，必须先检查历史重复数据和当前数据库迁移规范，不得直接创建可能使线上迁移失败的索引。

---

## 7. 页面布局与用户操作优化

### 7.1 页面信息架构

页面改为两个明确工作区：

**A. 模板列表工作区**

顶部：

- 页面标题、用途说明；
- 刷新；
- 新建模板。

筛选区：

- 关键词：模板名称 / code；
- 单据类型：全部 / PI / CI；
- 状态：全部 / 草稿 / 启用 / 停用；
- 语言；
- 清空筛选。

列表列建议：

- 模板名称（名称 + code 次级信息）；
- 单据类型；
- 语言；
- 纸张/方向；
- 状态；
- 默认；
- 当前版本；
- 最近更新时间；
- 操作。

列表底部：

- 总条数；
- pageSize；
- 上一页/下一页；
- 当前页码。

必须使用 API 返回的 pagination，不得在前端假装分页或一次性拉取所有记录。

**B. 模板编辑工作区**

建议按以下步骤分组：

1. 基本信息：名称、说明、PI/CI、语言、纸张、方向、默认。
2. 页面与样式：标题、主色、强调色、字体、字号、页边距、Logo。
3. 字段布局：区域显示、字段显示、标签、必填、顺序。
4. 商品表格：列显示、列标签、宽度、顺序。
5. 条款与声明：付款说明、运输说明、原产地声明、真实性声明、备注。
6. 预览与发布：校验、样例预览、版本历史、发布新版本。

现有 config 结构不要求强制拆成多个后端对象；Tab 只是前端视图分组，保存仍提交同一份完整 config。

### 7.2 桌面端布局

- 保留 Admin Shell、PageHeader 和项目统一 panel/form Token。
- 列表与编辑区可采用上下布局或列表折叠 + 编辑工作区；不得在 1600px 桌面端让两个完整大表单同时争抢宽度。
- 编辑器顶部显示模板名称、状态、当前版本、未保存标记。
- 操作按钮按主次排列：
  - 主操作：保存草稿；
  - 次操作：预览、校验；
  - 危险/发布操作：发布新版本、停用、删除草稿，需确认。
- 编辑器切换 Tab 不丢失 state。
- 预览可在右侧面板/独立预览工作区展示；至少支持从预览返回原编辑 Tab 和滚动位置。

### 7.3 移动端布局

- 360px 起适配。
- 编辑区单列。
- Tab 可以横向滚动，但不能造成整个页面横向溢出。
- 字段设置不要强制展示 5 列宽表格；移动端改为字段卡片或可读的两列结构。
- 主要操作区可吸底，但不能遮挡表单、错误提示或弹窗按钮。
- 预览使用独立“预览”页签/全屏弹层，不使用桌面双栏强行缩放。
- 点击区域/字段开关的触控目标至少 44×44 CSS px。

### 7.4 字段配置交互

每个区域：

- 区域开关；
- 区域标题；
- 区域顺序；
- 已显示字段数量 / 总字段数；
- 展开后编辑字段。

每个字段：

- 显示开关；
- 字段中文/英文名称；
- 稳定 field key（只读）；
- 输出标签；
- 必填开关；
- 上移/下移。

额外规则：

- 关闭区域后，其字段开关保留，不清空原配置；重新打开区域时恢复用户之前的字段选择。
- 隐藏字段不删除字段配置。
- 调整顺序不改变字段 key 或业务数据。
- 必填与显示是不同概念：隐藏字段不得在签发校验中造成无意义的“模板必填但不可见”冲突；校验必须明确区分业务必填字段与模板显示必填。
- 必须提示关键字段隐藏的风险，例如商品描述、商品金额、买方、总金额；是否允许发布按 DOC-41 业务校验规则执行。
- 一键“全部显示/全部隐藏”只作用于当前区域，并有确认/撤销体验；不可影响其他区域。
- 修改字段配置后，未保存标记即时出现。

### 7.5 新建模板流程

新建弹窗应明确：

- 模板名称；
- PI/CI；
- 语言；
- 纸张；
- 方向；
- 是否设为默认；
- 可选“从现有模板复制配置”。

默认范围提示：默认模板按“单据类型 + 语言”区分，不应让用户误以为全系统只有一个默认模板。

创建前检查名称非空；提交中禁用重复点击；失败时保留已输入内容。

### 7.6 未保存状态与离开保护

- 任意编辑项变化后标记“未保存”。
- 保存成功后清除 dirty。
- 预览/校验不清除 dirty。
- 切换列表模板、刷新页面、离开路由或关闭编辑器时，如果 dirty=true，显示离开确认。
- 放弃修改后重新从 API 加载服务端草稿。
- 并发冲突继续使用现有 expectedUpdatedAt，提示“模板已被其他会话修改，请重新加载后再编辑”，不得自动覆盖。

---

## 8. API 与文件级实施清单

### 8.1 必须修改

| 文件 | 修改内容 |
|---|---|
| `apps/admin/src/app/[locale]/(admin)/document-templates/page.tsx` | 列表筛选/分页、草稿删除确认、复制草稿、Tab/分组编辑、dirty 状态、预览/校验无副作用、停用确认、移动端交互 |
| `apps/admin/src/lib/commercial-documents-api.ts` | 模板列表 query 类型、删除 API、validate payload、preview payload、copy/create 复用；确保 API 返回类型准确 |
| `apps/api/src/modules/commercial-documents/document-templates.controller.ts` | DELETE 草稿路由；validate 接收可选临时 config；维持现有 read/create/update/publish 权限 |
| `apps/api/src/modules/commercial-documents/document-templates.service.ts` | 安全删除、引用检查、事务、审计；validate 支持临时 config；preview 保持纯渲染；默认模板按类型+语言清除 |
| `apps/api/src/modules/commercial-documents/document-templates.service.spec.ts` | 删除条件、引用保护、权限 wiring、并发/事务、validate/preview 不写库、默认范围测试 |
| `packages/validation/src/commercial-documents.ts` | validate body schema；新增配置字段时同步 config schema；DELETE 路由参数复用 idParamSchema |
| `packages/commercial-documents/src/render.ts` | 移除绕过配置的页眉元数据；统一字段/区域/条款/签章/备注显示判断；避免空表和空区域 |
| `packages/commercial-documents/src/template-config.ts` | 可见性 helper；必要时为 Notes/Terms/Stamp 等增加兼容配置；历史 config parser 默认值 |
| `packages/commercial-documents/src/field-catalog.ts` | 仅当新增字段 key 时扩展目录、默认标签和分组；不得重复定义已有 key |
| `packages/commercial-documents/src/commercial-documents.spec.ts` | renderer 对每个隐藏字段、隐藏区域和特殊区块的回归测试 |
| `packages/contracts/src/constants.ts` | 增加 document_template.delete 权限码（若采用独立删除权限） |
| `database/prisma/seed.ts` | 增加删除权限 reference seed，并核对默认角色授权策略 |
| `apps/admin/src/messages/zh-CN.json` | 新增筛选、分页、删除确认、引用保护、复制、未保存、预览和配置提示文案 |
| `apps/admin/src/messages/en-US.json` | 与 zh-CN 对齐的完整英文文案 |

### 8.2 复用，不应重复创建

- `DocumentTemplate`、`DocumentTemplateVersion`、`CommercialDocument` Prisma 模型。
- 现有分页查询 schema 和 list service。
- 现有 preview API 和 `renderCommercialDocumentHtml`。
- `visibleSections` 和现有字段目录。
- 现有 `ConfirmDialog`、`Modal`、`Badge`、`Button`、`Field`、`Select`。
- 现有 AuditService。
- 现有乐观锁 `expectedUpdatedAt`。
- 现有 i18n 机制。

### 8.3 不应修改

除非实施中发现明确必要且经过单独评审，否则本任务不修改：

- 商业单据历史快照结构；
- 已签发 PI/CI 的模板版本引用；
- Worker PDF 任务模型和私有文件存储；
- Admin Shell、Sidebar、全局 Design Token；
- 订单、报价、公司资料和银行账户业务；
- Docker Compose、GitHub Actions、GHCR 发布流程；
- 生产环境配置和生产数据库数据。

---

## 9. 数据库、迁移和审计要求

### 9.1 数据库

按当前 schema：

- `DocumentTemplate` 已有 `versions` 和 `documents` 关系。
- `DocumentTemplateVersion.template` 使用 onDelete Restrict。
- `CommercialDocument.template` 与 `templateVersion` 使用 onDelete Restrict。

因此，当前草稿删除功能原则上不需要增加表或字段，也不应为了删除草稿而放宽外键。

**默认方案：无 Prisma schema migration。**

如果实施发现需要新增字段：

1. 先证明无法复用现有 config JSON。
2. 提交 additive migration。
3. 兼容历史模板配置。
4. 在 staging 验证。
5. 提供回滚方案。
6. 不得重写历史发布版本 JSON。

### 9.2 权限 seed

新增 `document_template.delete` 属于 Permission reference data：

- 更新 PermissionCode 常量；
- 更新 `database/prisma/seed.ts`；
- 确保 reference seed 幂等；
- 检查默认角色授权策略；
- 不自动给所有自定义角色授予删除权限；
- 通过角色权限页面由授权管理员分配。

### 9.3 审计

新增事件：

- `document_template.deleted`
- 必要时记录 `document_template.copied`（若现有审计约定要求记录复制）

审计只记录模板 ID、code、名称、类型、locale、操作者、requestId、时间和结果；不记录整个 config JSON。

预览/校验可按现有审计策略记录请求事件，但不得因预览而记录整份配置或业务样例中的客户隐私。

---

## 10. 自动化测试与验收用例

### 10.1 Renderer 单元测试

| ID | 场景 | 预期 |
|---|---|---|
| RENDER-001 | 隐藏 document.revision | HTML 不含 Revision / R1 |
| RENDER-002 | 隐藏 document.number | HTML 不输出单据编号字段 |
| RENDER-003 | 隐藏 trade.currency | HTML 不输出独立币种字段 |
| RENDER-004 | 隐藏 seller.taxId | HTML 不含卖方税号标签和值 |
| RENDER-005 | 隐藏整个 Buyer 区域 | HTML 不含 Buyer 区域标题及字段 |
| RENDER-006 | Buyer 区域显示但所有字段隐藏 | HTML 不输出空 Buyer 容器 |
| RENDER-007 | 隐藏单个商品列 | 表头和每一行均不输出该列 |
| RENDER-008 | 隐藏所有非必需商品列 | 不生成空白/错位表格；必要列校验按规则失败 |
| RENDER-009 | 隐藏 Totals 区域 | 不输出金额汇总表 |
| RENDER-010 | 隐藏某个 Totals 字段 | 只隐藏该行 |
| RENDER-011 | 隐藏 Signature 区域 | 不输出签章区 |
| RENDER-012 | Signature 区域显示但 seller/buyer 均隐藏 | 不输出空签章单元格 |
| RENDER-013 | 只显示 seller signature | 只输出卖方签章单元格 |
| RENDER-014 | 隐藏 Notes | 即使 data.notes 有值也不输出 |
| RENDER-015 | 关闭 Payment/Shipment Notice | 不输出对应条款 |
| RENDER-016 | 关闭 Authenticity Declaration | 不输出真实性声明 |
| RENDER-017 | showLogo=false、showStamp=true | Logo 隐藏，Stamp 按独立设置显示 |
| RENDER-018 | 历史旧 config 缺少新增配置 | parser 使用兼容默认值，正常渲染 |
| RENDER-019 | 中英文标签 | 标签按 locale 正确渲染 |
| RENDER-020 | HTML 注入字符串 | 所有用户值继续 HTML escape |

### 10.2 API Service / Controller 测试

| ID | 场景 | 预期 |
|---|---|---|
| API-001 | 删除无版本、无引用 DRAFT | 删除成功并审计 |
| API-002 | 删除 ACTIVE 模板 | 409 |
| API-003 | 删除 DISABLED 模板 | 409，除非经批准的安全草稿删除路径 |
| API-004 | 删除有版本的模板 | 409 |
| API-005 | 删除被 CommercialDocument 引用的模板 | 409 |
| API-006 | 删除不存在模板 | 404 |
| API-007 | 无 document_template.delete 权限 | 403 |
| API-008 | 删除过程中并发创建引用 | 事务/外键保护，删除失败且引用保留 |
| API-009 | 删除成功后审计 | 有事件，不包含完整 config |
| API-010 | preview 提交临时 config | 返回新配置 HTML，不写数据库 |
| API-011 | preview 不提交 config | 使用数据库 draftConfig |
| API-012 | validate 提交临时 config | 返回对应配置的校验结果，不写数据库 |
| API-013 | 默认模板按 PI/CI + locale 隔离 | 修改 en-US 不影响 zh-CN |
| API-014 | 停用默认模板 | 取消其默认标记，不产生停用默认值 |
| API-015 | 复制模板 | 新建 DRAFT、配置复制、无版本、非默认 |

### 10.3 Admin 页面测试

- 新建模板成功后进入编辑器。
- 错误创建的 DRAFT 可删除。
- ACTIVE / 有版本模板没有物理删除入口。
- 删除确认显示正确模板名称和类型。
- 删除取消不改变数据。
- 删除成功后列表、计数和编辑器状态同步。
- 搜索、类型筛选、状态筛选和分页回显正确。
- 切换编辑 Tab 不丢失字段配置。
- 字段显示开关即时更新 dirty 状态。
- 预览使用当前未保存配置。
- 预览不会触发 PATCH，也不改变 updatedAt。
- 校验使用当前未保存配置。
- 未保存离开保护有效。
- 乐观锁冲突不会覆盖其他会话数据。
- 发布确认显示新版本语义。
- 停用默认模板时提示默认状态变化。
- 360px、768px、1024px、1440px 下无非预期横向溢出。
- zh-CN 与 en-US 文案完整。
- 键盘可操作 Tab、字段开关、确认弹窗和预览关闭。

### 10.4 端到端验收

必须使用同一份 config：

1. 关闭 Revision、卖方税号、Buyer 电话、Payment SWIFT、某个商品列。
2. 点击预览，不保存草稿。
3. 验证预览 HTML 对应字段全部消失。
4. 保存草稿后重新打开，配置仍保持隐藏。
5. 发布新版本。
6. 用该版本生成测试 PI/CI PDF。
7. 对比 HTML 预览与 PDF：隐藏字段一致，不允许 PDF 重新出现。
8. 已有历史单据仍使用旧模板版本，旧 PDF 和快照不变。

---

## 11. 执行顺序

### 阶段 0：实现前核对

- [ ] 重新读取最新 main、AGENTS.md、DOC-41、DOC-42、DOC-06。
- [ ] 确认当前 main 与本文件审查基线之间的差异。
- [ ] 核对当前 renderer、config schema、测试文件是否变化。
- [ ] 核对 DocumentTemplate 的所有外键和引用情况。
- [ ] 核对 document_template.delete 权限是否已被其他提交新增。
- [ ] 输出实施文件清单和是否需要 migration 的结论。

### 阶段 1：修复字段显示与渲染

- [ ] 先补充 renderer 回归测试，复现硬编码 Revision 等缺陷。
- [ ] 统一字段/区域可见性 helper。
- [ ] 修复页眉元数据、签章、Notes、Terms、Totals、Item table。
- [ ] 为新增 config 属性提供历史兼容默认值。
- [ ] 验证 HTML 预览与 Worker PDF 共用同一渲染结果。

完成标准：所有关闭的字段/区域都不再出现在 HTML 和 PDF 中。

### 阶段 2：预览/校验无副作用

- [ ] preview 直接使用编辑器当前 config。
- [ ] validate 支持当前临时 config。
- [ ] 去除 preview/validate 对 persistTemplate 的隐式依赖。
- [ ] 增加 dirty state 和离开确认。
- [ ] 验证预览不修改数据库 updatedAt。

完成标准：用户可以安全试验配置，只有点击保存才持久化。

### 阶段 3：草稿删除与复制

- [ ] 新增 delete 权限码和 reference seed。
- [ ] 增加 DELETE Controller 和 Service。
- [ ] 事务内二次检查 DRAFT、versions、documents。
- [ ] 增加 409/404/403 错误处理与审计。
- [ ] Admin 增加删除草稿确认。
- [ ] 增加复制为草稿流程。
- [ ] 完成服务端和页面测试。

完成标准：错误草稿可删除；已发布/已引用模板无法删除。

### 阶段 4：列表与编辑工作区优化

- [ ] 使用现有 list API 增加搜索、类型、状态、语言筛选。
- [ ] 接入真实分页。
- [ ] 编辑器按基本信息、样式、字段、商品列、条款、预览发布分组。
- [ ] 桌面端优化预览对照。
- [ ] 移动端字段卡片/分段编辑。
- [ ] 停用/启用/发布操作增加确认与反馈。
- [ ] 修正默认模板按类型 + locale 的作用范围。

完成标准：用户可以快速查找模板、编辑字段、预览、保存、发布、停用或清理错误草稿。

### 阶段 5：回归与交付

执行命令前必须核对 package.json 实际脚本。根目录目前可确认存在：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

相关 workspace 包应读取各自 package.json 再确定精确过滤命令，不得臆造脚本名称。

完成：

- [ ] renderer 测试通过；
- [ ] API Service / Controller 测试通过；
- [ ] Admin 页面测试通过；
- [ ] lint/typecheck/build 通过；
- [ ] 360px/768px/1024px/1440px 响应式验收；
- [ ] 中英文文案检查；
- [ ] 预览 HTML 与 Worker PDF 对照；
- [ ] 历史已签发单据回归；
- [ ] 更新 DOC-42 或新增实施记录，准确记录实际实现和测试结果。

---

## 12. 部署、回滚与风险

### 12.1 数据库

默认不修改 Prisma schema，不需要数据库结构迁移。

新增权限通过 reference seed 同步；上线前先确认 seed 幂等和角色授权影响。不要在生产环境直接运行未审查的 seed 命令。

如果实施阶段确实需要 config schema 兼容，不等同于 Prisma migration；必须先保证 API 能解析历史 JSON。

### 12.2 发布顺序

1. 先在开发/测试环境完成 renderer 和 API 测试。
2. 验证历史模板 config 可以读取。
3. 验证预览和 PDF 一致。
4. 验证草稿删除引用保护。
5. 发布 API、Admin、Worker 相互兼容的镜像版本。
6. 在 staging 生成 PI/CI PDF。
7. 生产发布前备份数据库并保留当前镜像 tag。
8. 观察模板预览、发布和 PDF render 错误日志。

### 12.3 回滚

- 优先回滚 Admin/API/Worker 应用版本。
- 不删除历史模板版本、单据、PDF 或快照。
- 新增 permission reference 可以保留；回滚应用不需要删除 Permission 行。
- 若未来增加 config JSON 字段，旧代码必须能忽略或兼容；不要通过回滚脚本批量重写历史配置。
- 已删除草稿不能自动恢复；如需恢复只能从事前备份恢复，并确认其没有新的 ID 引用。删除确认必须明确说明永久性。

### 12.4 风险

| 风险 | 控制措施 |
|---|---|
| 新旧模板 JSON 结构不一致 | parser 提供兼容默认值，旧版本不回写 |
| 隐藏字段仍在 PDF 输出 | renderer 全路径测试，HTML 与 Worker 共用实现 |
| 删除与新单据引用竞争 | 事务内校验 + 外键 Restrict + 409 |
| 删除权限过宽 | 独立 delete permission，默认不授予自定义角色 |
| 预览误保存 | preview/validate 不调用 PATCH |
| 默认模板互相覆盖 | documentType + locale 作为唯一业务范围 |
| 页面改造影响历史版本 | 不改已发布版本 config，不更改单据 templateVersionId |
| 移动端字段编辑困难 | 字段卡片与 360px 验收 |

---

## 13. 最终验收标准

完成 DOC-45 后必须同时满足：

1. 新建错误草稿可以删除，但发布过或被单据引用的模板不可物理删除。
2. 删除接口有独立权限、服务端校验、事务保护和审计。
3. 复制模板只创建新草稿，不复制历史版本和单据引用。
4. 取消字段显示后，预览 HTML 中不再出现该字段。
5. 取消区域显示后，预览 HTML 中不再出现区域标题、字段或空容器。
6. 页眉不再绕过配置固定输出 Revision、Currency、Document No.。
7. Notes、Terms、Declaration、Signature、Logo、Stamp 均有清晰且有效的显示控制。
8. 商品列、金额汇总和签章区遵守配置开关。
9. 预览和校验不隐式保存草稿。
10. 只有点击保存草稿才持久化编辑器配置。
11. 已发布模板仍然不可变，历史单据仍然引用原版本。
12. 模板列表支持搜索、类型、状态、语言筛选和真实分页。
13. 桌面端编辑效率提升，移动端 360px 可操作。
14. 中文和英文界面完整。
15. lint、typecheck、相关测试和 build 通过。
16. HTML 预览和 Worker PDF 对字段可见性保持一致。

---

## 14. 本次 Git 变更边界

本次只新增 DOC-45 规范文档，不修改业务代码、Prisma schema、migration、seed、API、前端、Worker、Docker Compose、GitHub Actions 或生产数据。

后续实施必须按阶段推进。阶段 0 审查完成后，先提交最终实施文件清单；未获用户明确批准前，不进入业务代码修改和部署。

**最终设计原则：模板配置必须是渲染输出的唯一事实来源；草稿可以安全清理，发布版本和历史单据必须永久可追溯；预览必须真实反映当前配置且不产生保存副作用。**
