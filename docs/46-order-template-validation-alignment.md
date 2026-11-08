# DOC-46 订单创建 PI / CI 时模板与必填校验一致性修复规范

> 文档编号：DOC-46  
> 状态：可执行实施基线（待分阶段开发）  
> 目标仓库：`NotFeel/b2b-inquiry-platform`  
> 目标分支：`main`  
> 审查基线：`511ecbcb183a78967782fd13dbca1d77a8ae8453`（2026-11-08，`feat-单据模板`）  
> 关联规范：`AGENTS.md`、`docs/41-commercial-invoice-order-documents.md`、`docs/42-commercial-documents-implementation.md`、`docs/43-order-management-page-optimization.md`、`docs/45-document-template-page-optimization.md`  
> 本文只定义问题、代码定位、修改要求和验收方案；提交本文不代表业务代码或数据库已修改。

---

## 0. 本次问题与结论

用户反馈：在订单管理中点击“创建 CI”，选择某个模板后，弹窗里的“签发前需补全字段”与所选模板中配置的字段/必填项不一致。用户要求按真实操作路径核查，并形成可执行修改规范。

本次依据：
- 用户提供的订单管理截图：创建商业单据弹窗显示单据类型、默认模板、币种、金额、模板选择、语言、银行账户和缺失字段列表。
- 用户提供的商业单据编辑页截图：创建后编辑页再次显示缺失字段列表。
- 连接的后台浏览器标签页文本：当前打开的是 `/zh-CN/commercial-documents` 列表页，可读取当前 DOM 文本；当前 Browser 连接仅提供标签读取能力，不能在本会话中点击、导航或提交表单。因此没有把“截图观察”冒充为已完成真实点击测试。后续验收章节给出可逐步执行的浏览器测试流程。
- main 分支实际代码：订单页、API prefill、模板配置、缺失字段计算和创建单据服务。

**确认存在两个相互叠加的问题：**

1. **P0：切换模板后，创建弹窗没有重新计算缺失字段。** `orders/page.tsx` 的 `openCreate()` 只在打开弹窗时调用一次 `commercialDocumentsApi.prefill(orderId, type)`。用户切换模板时，onChange 只更新 `createTemplateVersionId` 和 `createLocale`，但缺失字段仍读取第一次 prefill 返回的 `prefill.missingFieldLabels` / `prefill.missingItemLines`。所以用户选了另一个模板，提示列表仍然可能属于初始默认模板。
2. **P0：业务级必填与模板级必填没有在 UI 中区分。** `packages/commercial-documents/src/missing-fields.ts` 的 `findMissingDocumentFields()` 先加入固定业务必填字段（卖方、买方、贸易条款、付款信息、CI 运输和报关字段等），再加入模板中 visible 且 required 的字段。模板的 required=false 不能取消业务级必填。这是服务端当前明确的业务规则，但 UI 只显示一张合并列表，用户容易误以为这些字段全部来自模板的 required 勾选。
3. **P1：语言选择可能与模板版本脱节。** 切换模板时会同步设置语言，但语言下拉仍可单独更改；用户可以形成“选择了 en-US 模板版本，却把单据 locale 改为 zh-CN”的组合。应统一模板版本与单据语言的选择约束。
4. **P1：模板选项和初始模板选择没有足够明确的用户反馈。** 弹窗上方摘要显示初始模板，而用户下方可以另选模板；摘要、选中项和缺失字段可能不同步，造成用户不确定最终使用哪一份模板。

这不是单纯的视觉问题，必须同时修复 Admin 状态、prefill API 参数和服务端校验口径。

---

## 1. 当前真实代码链路

### 1.1 用户流程与实际实现

| 步骤 | 用户操作 | 当前代码行为 | 问题 |
|---|---|---|---|
| 1 | 订单列表点击“创建 CI” | `openCreate(type, orderId)` | 正常 |
| 2 | 前端请求订单预填数据 | `commercialDocumentsApi.prefill(orderId, type)` | 请求未携带用户最终选择的 templateVersionId / locale |
| 3 | API 选择模板 | `CommercialDocumentsService.prefill()` 使用固定 `'en-US'`、`null` 调用 `resolveTemplateForOrder()` | 计算结果基于默认解析出的模板 |
| 4 | API 计算缺失字段 | `findMissingDocumentFields(renderData, template.config)` | 只对应步骤 3 的模板配置 |
| 5 | 用户切换模板 | 只执行 `setCreateTemplateVersionId()`、`setCreateLocale()` | 不重新请求或重算 missingFields |
| 6 | 用户查看缺失列表 | UI 继续显示 `prefill.missingFieldLabels`、`prefill.missingItemLines` | 结果与当前选中模板不一定一致 |
| 7 | 用户创建草稿 | `createDocument()` 提交所选 `templateVersionId` 和 `locale` | 实际创建使用所选版本，和弹窗校验预览可能不是同一模板 |
| 8 | 打开单据编辑页 | 详情 DTO 使用单据实际 templateVersion/config 计算 missingFields | 此处结果可能与创建弹窗不同，用户感知为前后矛盾 |

### 1.2 关键代码位置

| 文件 | 现有实现/职责 | 必须修改 |
|---|---|---|
| `apps/admin/src/app/[locale]/(admin)/orders/page.tsx` | `openCreate()`、`createDocument()`、创建 Modal、模板/语言下拉和缺失字段展示 | 模板或语言变化时重新请求对应 prefill；增加请求竞态保护；显示校验分类和当前校验模板 |
| `apps/admin/src/lib/commercial-documents-api.ts` | `prefill()` API 客户端及 `DocumentPrefill` 类型 | 增加可选 templateVersionId、locale 参数；补齐校验分类类型 |
| `apps/api/src/modules/commercial-documents/commercial-documents.controller.ts` | 订单商业单据 prefill 路由 | 解析并校验可选 templateVersionId / locale query |
| `apps/api/src/modules/commercial-documents/commercial-documents.service.ts` | `prefill()`、`resolveTemplateForOrder()`、`createFromOrder()` | prefill 使用用户选定模板版本的 config 计算；创建前确保模板类型、语言、状态一致 |
| `packages/commercial-documents/src/missing-fields.ts` | 固定业务必填 + 模板 required 字段 + 行项目缺失检查 | 拆分业务必填与模板级必填报告；保留统一服务端校验事实来源 |
| `packages/commercial-documents/src/field-catalog.ts` | 稳定字段 key、所属 section 和中英文标签 | 复核字段与 item column key 映射；不要复制第二套字段目录 |
| `packages/commercial-documents/src/template-config.ts` | 字段/区域/itemColumns visible、required 配置 | 提供可复用的可见/必填查询 helper，禁止前后端各自猜规则 |
| `apps/admin/src/messages/zh-CN.json` | 后台中文文案 | 增加校验分类、模板版本切换加载、模板语言冲突等文案 |
| `apps/admin/src/messages/en-US.json` | 后台英文文案 | 与中文 key 对齐 |
| `apps/api/src/modules/commercial-documents/commercial-documents.service.spec.ts` | 商业单据服务测试 | 覆盖 prefill 对不同模板版本的差异 |
| `packages/commercial-documents/src/commercial-documents.spec.ts` 或对应 missing-fields 测试文件 | 共享模板与缺失字段测试 | 覆盖业务必填和模板必填分组、隐藏字段行为 |
| Admin 订单页相关测试 | 订单创建流程 | 覆盖切换模板后列表刷新、请求竞态、语言联动 |

说明：实施前需重新检查上述文件在最新 main 的实际内容、controller 的真实路由和测试文件命名；如路径已有调整，以真实引用为准，不得凭本表盲目创建重复文件。

---

## 2. 必须明确的校验业务规则

### 2.1 校验分成三层，不得混为一个“模板必填列表”

**A. 系统业务必填（不可由模板开关关闭）**

这是 PI/CI 签发的业务完整性规则，不属于模板 required 勾选项。当前 `missing-fields.ts` 中已有：

- 卖方公司名称、卖方地址
- 买方公司名称、买方地址
- Incoterm、Named Place、Payment Terms
- 签发日期
- 收款账户名称、银行名称、银行账号
- CI 运输方式、CI 箱数
- 商品行必须存在
- 总金额必须大于 0

其中 CI 行项目目前检查：
- 商品描述
- 数量大于 0
- 单位
- HS Code
- 原产国

上述清单以当前代码为审查事实。具体业务要求如需变更，必须单独评审 DOC-41 的业务规则，不得为了让模板弹窗“看起来一致”而降低服务端签发门槛。

**B. 当前模板额外必填（由模板配置控制）**

- 只遍历当前模板配置中 section.visible=true 的区域。
- 只遍历该区域 field.visible=true 的字段。
- 仅 field.required=true 的字段加入“模板额外必填”。
- 字段值为空时，列入模板额外必填缺失。
- field.required=false 时，不因模板配置产生额外缺失。
- 被隐藏的字段不应因为模板 required=true 而作为“模板额外必填”提示；隐藏状态优先于 required 状态。
- 不允许缺少 field 配置时默认将字段视为 visible/required。

**C. CI 行项目业务校验**

CI 的 HS Code、原产国等当前是业务规则级逐行校验，不是普通模板字段的 required 勾选。即使某模板隐藏了 HS Code / Origin 列，当前系统业务校验仍然可能阻止签发。

必须在 UI 中将其标注为“CI 业务必填（不受模板隐藏/required 开关影响）”。如果产品决定这些字段在某类 CI 中可选，需修改 DOC-41 业务规则并由服务端统一调整，不能只改前端显示。

### 2.2 模板隐藏与业务必填的冲突提示

若业务必填字段被当前模板隐藏，不能静默忽略，也不能只提示用户补数据却不告诉用户该字段不会显示在 PDF。

新增模板配置诊断：
- 识别业务必填字段与当前模板可见字段的交集。
- 当业务必填字段被隐藏时，提示“此字段仍是签发必填，但当前模板不会打印该字段”。
- 对必须出现在 CI 文件中的清关/运输字段（例如 HS Code、原产国、运输方式、箱数），将冲突提升为模板校验错误或明确的发布阻断项；最终字段集合以 DOC-41 和现有业务约束评审为准。
- 对仅用于内部完整性校验、并非必须打印的字段，显示信息提示，不得自动将字段强制设为 visible。
- 模板校验 API 和 UI 必须返回稳定错误码/field key，不得依赖英文错误文本正则判断。

### 2.3 不允许的“修复”

- 不得把业务必填数组简单删除。
- 不得让浏览器提交 `missingFields=[]` 作为校验通过依据。
- 不得因模板切换而绕过服务端 issue endpoint 的校验。
- 不得把模板 hidden 当成业务数据不存在或不需要收集。
- 不得把所有字段强制 required=true 来消除差异。
- 不得只改订单弹窗显示，不改 API prefill 的实际配置来源。
- 不得在前端重新实现一份独立的字段必填规则。

---

## 3. API 与服务端改造要求

### 3.1 Prefill 必须支持“指定模板版本”计算

保留现有订单 prefill 路由和响应兼容，增加可选参数：

```http
GET /admin/orders/:orderId/document-prefill?type=CI&templateVersionId=<uuid>&locale=en-US
```

参数规则：
- `type` 必填且只能 PI / CI。
- `templateVersionId` 可选；未传时按当前默认模板解析，维持旧客户端兼容。
- `locale` 可选；未传时使用默认语言解析。
- 传入 `templateVersionId` 时，必须从数据库加载该已发布版本，并校验：
  - 模板版本存在；
  - 所属模板类型与请求 type 一致；
  - 模板版本状态为 PUBLISHED；
  - 模板本身处于允许创建单据的 ACTIVE 状态；
  - locale 与所选模板语言一致；
  - 当前用户拥有原 prefill 所需权限。
- 禁止接受客户端传来的 config JSON 作为正式 prefill 校验依据；只接受数据库中的不可变已发布版本配置。
- 若 `locale` 与模板版本语言冲突，返回明确 400/业务错误码，不能静默切换语言或继续返回错配结果。
- 返回值必须包含 `resolvedTemplate`，明确返回 templateId、versionId、version、name、locale、checksum（如现有 DTO 已提供）；前端摘要与校验报告使用同一对象。

### 3.2 共享构建数据与避免重复计算

将 prefill 中与模板无关的数据构建与模板相关校验拆清楚：
1. 加载订单快照、公司资料、币种匹配的银行账户和商品行。
2. 构建同一份服务端 `CommercialDocumentRenderData`。
3. 根据本次请求指定的 templateVersion.config 计算 missing report。
4. 不因切换模板重复改变订单、银行账户或金额快照。
5. 对同一订单连续切换模板时，服务端每次以数据库版本配置重新计算。

可采用内部纯函数/私有 helper 复用数据构建，避免每次切换模板重复访问所有关系。性能优化不得造成旧 templateVersionId 结果被缓存到新版本。

### 3.3 创建草稿时二次校验

`createFromOrder()` 已使用请求中的 templateVersionId 解析模板。需确保：
- 所选模板版本与请求 locale 一致；
- 重新使用同一个共享缺失字段函数计算校验报告；
- 创建接口不依赖客户端 prefill 缓存状态；
- 如业务允许“先创建草稿、后补资料”，创建草稿可以成功，但响应必须返回当前模板的缺失报告；如果当前既有规则要求创建前阻止，则按现有规则执行，不擅自改变。
- 签发接口必须重新读取单据保存的 templateVersion.config 与最新可签发数据，重新执行硬校验；不能信任创建时的报告。
- 已签发版本继续引用创建时的不可变模板版本，不允许后来模板修改影响它。

### 3.4 错误响应

使用现有 ApiError / ERROR_CODES 体系：
- 模板版本不存在：not found 或既有模板错误码。
- 类型不匹配：validation/business conflict。
- locale 不匹配：明确的模板语言不匹配错误码。
- 非 PUBLISHED / 模板 DISABLED：明确的不可用于创建错误码。
- 不得把数据库错误、模板 JSON 或银行账号快照原文返回给浏览器。

如果新增错误码，必须同步更新 contracts、错误翻译、API 测试和 Admin 文案。

---

## 4. Admin 创建弹窗交互修复

### 4.1 模板与语言必须成为一个一致的选择状态

建议将 `createTemplateVersionId` 与 `createLocale` 收敛为一个 template selection 状态，或建立严格同步函数，避免两份状态漂移。

推荐交互：
- 模板选项显示：模板名称 + 版本 + 语言 + 默认标记。
- 用户选择模板后，单据语言自动跟随模板 locale。
- 语言不再允许独立改成与模板不一致的值；若产品确实需要“同一模板切换单据语言”，必须改成选择同一模板的另一语言版本，而不是只改 locale 字符串。
- 如果同一业务类型/语言有多个模板，用户可明确选择。
- 选中模板发生变化时，校验状态进入 loading；在新 prefill 完成前，不展示旧报告为当前模板报告。
- 摘要中的模板名、版本、语言、币种与下方选择器保持一致。

### 4.2 切换模板后的刷新行为

模板切换时：
1. 更新当前选择状态。
2. 清空/标记旧 missing report 为 stale，不将其当成新模板结果。
3. 调用带 `templateVersionId` 和 `locale` 的 prefill。
4. 请求完成后检查 sequence/request key；若用户已经再次切换模板，丢弃旧请求结果。
5. 成功后更新 resolvedTemplate 与 missing report。
6. 失败时显示当前模板的校验加载失败，可重试；不得回退展示另一模板的缺失列表。
7. 创建按钮在 prefill 重新计算期间禁用，避免创建所选版本但展示旧校验结果。
8. 银行账户选项与选中值应保留；若 locale 改变，不应无故重置币种账户。

### 4.3 校验结果显示分组

弹窗至少分三组：

**系统业务必填**
- 订单/公司/付款/贸易等业务规则必填项。
- 明确说明：此类字段不受模板 required 开关控制。

**当前模板额外必填**
- 仅列出当前模板 visible + required 字段中缺失的字段。
- 显示字段名称和所属模板版本。

**CI 商品行缺失**
- 按行号显示 HS Code、原产国、商品描述、数量、单位等缺失信息。
- 每一项可定位到单据编辑页对应商品行。
- 不把逐行缺失折叠成一个含糊的“商品信息不完整”。

若某字段同时命中业务必填和模板额外必填，UI 合并展示一次，并显示两个来源标签，避免重复行。

### 4.4 弹窗摘要与按钮

- 摘要必须展示最终选择的模板名称、版本和语言，不使用最初 prefill 的 template 信息。
- 显示币种、订单总金额和所选银行账户。
- 缺失字段为提醒信息时，允许按现有规则创建草稿并在编辑页补全。
- 若银行账户是创建硬前置条件，继续禁用创建按钮并显示原因。
- prefill loading 时显示状态，API 失败提供重试。
- 取消弹窗不应创建任何单据。
- 防止重复点击创建；创建成功后导航到刚创建的单据详情页。

---

## 5. 编辑页与签发流程一致性

### 5.1 编辑页

- 单据编辑页的 missing report 必须基于该单据实际绑定的 templateVersion.config。
- 显示同样的三类校验结果，避免创建弹窗与编辑页出现不同分类口径。
- 用户在编辑页切换 templateVersion 时，立即以新版本配置重新计算；若切换模板版本后需要保存，报告必须清楚标记“当前编辑配置”或“已保存配置”。
- 变更模板后不得自动修改已签发单据；已签发只能按 revision 流程创建新修订。
- 变更模板时，旧模板的校验报告立即失效。

### 5.2 签发前检查

- 继续使用服务端 `findMissingDocumentFields()` 或升级后的统一报告函数。
- 服务端重新读取最新 document snapshot 和 templateVersion config。
- 校验数据必须对应同一 document version，避免前端旧数据覆盖。
- 失败返回稳定的 field keys、section/category 和 item lineNo。
- 签发失败不得更改状态、PDF 指针、模板版本或签发时间。
- 成功签发后保留模板版本、快照、PDF 和哈希。

---

## 6. 推荐共享数据结构

可在 `packages/commercial-documents/src/missing-fields.ts` 中扩展现有报告，不要求机械采用以下名称，但语义必须一致：

```ts
interface MissingFieldEntry {
  key: string;
  label: string;
  source: 'BUSINESS_RULE' | 'TEMPLATE_REQUIRED' | 'CI_ITEM_RULE';
  sectionKey?: string;
  lineNo?: number;
}

interface MissingFieldReport {
  businessRequired: MissingFieldEntry[];
  templateRequired: MissingFieldEntry[];
  itemLineMissing: Array<{
    lineNo: number;
    fields: MissingFieldEntry[];
  }>;
  templateVisibilityConflicts: Array<{
    key: string;
    reason: 'REQUIRED_BUT_HIDDEN';
  }>;
  // 可为兼容旧客户端保留扁平 missing / missingItemLines
  missing: string[];
  missingItemLines: Array<{ lineNo: number; fields: string[] }>;
}
```

约束：
- key 必须来自共享 field catalog 或受控 item column key。
- label 按 locale 生成；不要固定使用 en-US。
- API DTO 与前端类型一致。
- 旧字段可短期兼容，但不得存在两套互相矛盾的计算结果。
- 不把业务字段值、账号、客户地址原文写入错误日志或审计 metadata。

---

## 7. 逐文件修改清单

### 7.1 Admin

**修改**
- `apps/admin/src/app/[locale]/(admin)/orders/page.tsx`
  - 抽出创建弹窗的模板切换处理函数。
  - 以 templateVersionId + locale 重新获取 prefill。
  - 增加 request sequence / AbortController（按项目已有模式选择）竞态保护。
  - 统一模板/语言选择状态。
  - 增加校验分组、当前模板标识、加载/失败/重试状态。
  - 创建按钮绑定当前 prefill 对应的模板版本，不允许 stale report。
- `apps/admin/src/lib/commercial-documents-api.ts`
  - 扩展 prefill 参数与 response types。
  - 若复用旧响应字段，标明 deprecated/compatibility，不复制业务逻辑。
- `apps/admin/src/messages/zh-CN.json`、`apps/admin/src/messages/en-US.json`
  - 增加业务必填、模板额外必填、CI 行项目、模板隐藏冲突、校验刷新中、刷新失败等文案。

### 7.2 API

**修改**
- `apps/api/src/modules/commercial-documents/commercial-documents.controller.ts`
  - prefill query 支持可选模板版本和 locale。
  - 复用原权限声明，不新增绕过授权的路由。
- `apps/api/src/modules/commercial-documents/commercial-documents.service.ts`
  - prefill 解析确切版本。
  - 通过共享 builder 生成一次 render data。
  - 对确切版本计算校验报告。
  - createFromOrder 和 issue 流程再次校验类型、locale、版本状态。
- 对应 validation schema 文件（以 controller 当前实际 DTO/query schema 为准）
  - 增加 UUID、locale、documentType 校验；不接受 config JSON。

### 7.3 Shared package

**修改**
- `packages/commercial-documents/src/missing-fields.ts`
  - 拆分业务级、模板级和 CI 行级结果。
  - 业务规则清单继续作为后端权威来源。
  - 模板额外必填只看当前模板 visible + required。
  - 输出隐藏冲突诊断。
- `packages/commercial-documents/src/template-config.ts`
  - 复用 `isSectionVisible()`、`isFieldVisible()`。
  - 如有必要增加可见字段索引 helper；不要重复遍历时写不同的默认策略。
- `packages/commercial-documents/src/field-catalog.ts`
  - 仅在确认现有 catalog 缺少业务映射时扩展；不得重复定义字段 label。
- `packages/contracts/src`
  - 只有在新增稳定 API 错误码或共享 DTO contract 时才修改；不要为了 UI 文案把业务类型重复放进 contracts。

### 7.4 Tests

**修改/新增**
- `apps/api/src/modules/commercial-documents/commercial-documents.service.spec.ts`
- `packages/commercial-documents/src/commercial-documents.spec.ts` 或当前真实 missing-fields 测试文件
- `apps/admin` 当前 orders 页面测试目录下对应测试
- 如项目未配置 Admin 页面测试环境，至少增加可测的纯函数/状态 helper 单测，并通过 API 集成测试覆盖端到端服务契约；不得声称已完成浏览器 E2E。

---

## 8. 测试矩阵

### 8.1 Prefill API

| 场景 | 预期 |
|---|---|
| 不传 templateVersionId | 兼容旧行为，按默认模板解析 |
| 传入 CI 模板版本 A | 报告使用 A 的 config |
| 传入 CI 模板版本 B（required 字段不同） | 报告随 B 的 required 字段变化 |
| 传入 PI 版本用于 CI | 明确拒绝 |
| 传入草稿版本 | 明确拒绝 |
| 传入已停用模板版本 | 明确拒绝 |
| locale 与模板不一致 | 明确拒绝 |
| 版本不存在 | not found |
| 无 prefill 权限 | 403 |
| 同一订单连续切换 A → B | B 的响应不能被 A 的慢响应覆盖 |

### 8.2 字段校验

| 场景 | 预期 |
|---|---|
| 系统业务必填缺失，模板未勾 required | 仍进入业务必填报告 |
| 系统业务必填缺失，模板隐藏该字段 | 仍进入业务必填报告，并出现隐藏冲突提示 |
| 非业务必填字段 visible=true、required=true、值为空 | 进入模板额外必填报告 |
| 非业务必填字段 visible=true、required=false、值为空 | 不进入模板额外必填报告 |
| 字段 visible=false、required=true、值为空 | 不进入模板额外必填；若是业务必填则只进入业务报告并提示隐藏冲突 |
| section.visible=false | section 内字段不作为模板额外必填 |
| CI 商品 HS Code / 原产国缺失 | 按现有 CI 业务规则逐行报告 |
| PI 商品缺少 CI 专属 HS Code / 原产国 | 不错误套用 CI 行规则 |
| 商品行为空 | 业务必填报告有 items 缺失 |
| 总额为 0 或负数 | 业务必填报告有 grandTotal 缺失 |
| 同一字段命中多个来源 | UI 合并显示一次并标明来源 |

### 8.3 Admin 用户流程

1. 打开订单管理，选择一个已确认订单。
2. 点击“创建 CI”。
3. 等待默认模板 prefill 完成。
4. 记录当前模板版本和缺失字段。
5. 切换到另一个 CI 模板（该模板的 required 配置应与默认模板不同）。
6. 确认弹窗进入 loading，旧缺失字段不再标记为当前结果。
7. 等待新结果返回，确认模板摘要、语言和缺失字段均对应新版本。
8. 快速连续切换 A → B，确认最终结果只显示 B。
9. 切换语言时确认系统会切换到同语言可用模板版本，或阻止不一致组合。
10. 选择银行账户，确认账户仍与订单币种匹配。
11. 创建草稿，确认单据详情页使用同一个模板版本。
12. 对比创建弹窗和编辑页的缺失字段分类；同一数据快照、同一模板版本应得到一致结果。
13. 补齐字段并保存，再刷新详情，确认缺失提示减少。
14. 尝试签发：未补齐业务必填应被服务端拒绝；全部满足后才允许签发。
15. 检查历史已签发单据仍指向原模板版本，模板后续修改不影响历史 PDF。

### 8.4 浏览器验收尺寸

- Desktop：1440px 或 1600px。
- Tablet：768px。
- Mobile：360px。
- 所有 loading/error/empty/permission 状态均需验证。
- 手机端创建弹窗不得横向溢出；缺失字段较多时应可滚动，底部主要操作可触达。

---

## 9. 执行顺序

1. **阶段 0：重新核查最新 main**：读取 AGENTS、DOC-41/42/43/45，确认 controller、API、DTO、测试和缺失字段算法当前实现。
2. **阶段 1：修复 API prefill 模板版本一致性**：支持 templateVersionId + locale，验证版本类型/状态/语言；为 API 增加测试。
3. **阶段 2：拆分校验报告**：共享函数输出业务必填、模板额外必填、CI 行级缺失和隐藏冲突；保持旧 issue gate 不降低。
4. **阶段 3：修复 Admin 状态联动**：模板切换重新 prefill、语言锁定/匹配、请求竞态保护、分组展示。
5. **阶段 4：编辑页与签发流程统一**：确保详情、保存、预览和 issue 使用同一模板版本配置。
6. **阶段 5：完整回归**：API tests、shared tests、Admin tests、typecheck、lint、build、桌面/平板/手机人工验收。

不建议先大规模重做订单管理布局。本次以创建弹窗的校验正确性为 P0，视觉优化只做支持校验一致性所必需的分组与状态反馈。

---

## 10. 验收标准（Definition of Done）

- [ ] 创建弹窗显示的模板版本与 prefill 校验所用版本完全一致。
- [ ] 切换模板后一定重新计算，不再显示上一个模板的旧报告。
- [ ] 语言与模板版本一致，无法产生隐性错配。
- [ ] API 能对任意指定模板版本返回正确 missing report。
- [ ] 系统业务必填与模板额外必填在界面明确分组。
- [ ] 模板 required 开关只影响模板额外必填，不会静默关闭系统业务校验。
- [ ] 被隐藏的业务必填字段有可理解的冲突提示。
- [ ] CI 行项目缺失按行号显示，字段来源清楚。
- [ ] 创建弹窗与编辑页在相同数据/模板版本下报告一致。
- [ ] 签发端仍由服务端重新校验，浏览器不能伪造通过。
- [ ] 模板版本历史、已签发单据、PDF 快照均未被破坏。
- [ ] zh-CN / en-US 文案完整。
- [ ] 360px、768px、桌面布局无横向溢出。
- [ ] lint、typecheck、相关 tests、build 通过；无法运行的检查明确说明。

---

## 11. Git 与变更边界

- 本文提交仅允许新增 `docs/46-order-template-validation-alignment.md`。
- 后续业务开发按阶段实施，未经用户确认不得一次性修改所有阶段。
- 不得顺带改造订单金额、汇率、客户快照、银行账户匹配、模板渲染样式或 PDF Worker。
- 不得删除业务级必填规则来规避 UI 不一致。
- 不得修改已发布模板版本或历史 PI/CI 快照。
- 如无需数据库结构变化，不创建空 migration。
- 不修改 Docker Compose、GitHub Actions、生产环境变量或触发生产部署。
- 执行前核实 package.json 的真实脚本名，不得猜测 lint/test/typecheck/build 命令。

**最终目标：用户在订单中选择哪一个已发布模板版本，创建弹窗就必须针对哪一个版本展示校验结果；业务必填与模板额外必填有清晰边界，创建、编辑、预览和签发使用同一套服务端校验事实来源。**
