# DOC-44：公司资料与多币种银行账户管理整改实施规范

> 文档编号：DOC-44  
> 版本：1.1.0  
> 状态：已批准（正式实施规范）  
> 适用仓库：NotFeel/b2b-inquiry-platform  
> 基准分支：main  
> 适用模块：Admin、API、Prisma、Dictionary、Commercial Documents  
> 业务规则：已确认  
> 技术细节：已确认  
> 实施状态：已实施（本地开发；生产迁移与部署待单独审批）
> 文档提交状态：本次单文件提交

---

# 1. 整改目标

本次整改围绕公司资料、银行账户和 PI/CI 收款信息三个业务模块展开。

最终建立以下关系：

```
CompanyProfile
    │
    ├── Company Information
    ├── Company Address
    ├── Logo / Stamp
    └── BankAccountProfile
            ├── USD Account
            │      ├── Default Account
            │      └── Backup Account
            ├── EUR Account
            │      └── Default Account
            ├── CNY Account
            │      └── Default Account
            └── Other Currency Accounts
                       │
                       ▼
              CommercialDocument
                       ├── PI
                       └── CI
                       │
                       ▼
                Payment Snapshot
```

核心原则：

1. 一个公司可以维护多个银行账户。
2. 每个公司、每种币种分别设置默认银行账户。
3. 新增公司时可以同时录入多个银行账户。
4. PI/CI 根据单据币种自动匹配对应默认账户。
5. 允许人工切换同币种银行账户。
6. 不允许跨币种自动匹配。
7. 银行账户管理统一采用停用，不物理删除。
8. 已签发 PI/CI 保持原有快照，不受公司资料修改影响。
9. 复用现有数据库字典、API、权限、审计和商业单据模块。

# 2. 已确认业务规则

| 项目 | 最终规则 |
|---|---|
| 新增公司 | 公司信息和多个银行账户一起填写 |
| 保存方式 | 公司与初始账户使用同一数据库事务 |
| 默认银行账户 | 每公司、每币种最多一个 |
| 默认账户缺失 | 允许，不强制创建 |
| PI/CI 自动匹配 | 按单据币种匹配 |
| PI/CI 手动选择 | 允许选择同公司、同币种、已启用账户 |
| 不同币种 | 绝不自动替代 |
| 开户国家 | 使用现有 country 字典 |
| 账户币种 | 使用现有 currency 字典 |
| 历史银行账户 | 统一停用，不物理删除 |
| 历史商业单据 | 保留原始快照 |
| 其他特殊要求 | 暂无 |

## 2.1 账户状态

银行账户统一使用现有字段：

- enabled
- isDefault

不新增复杂账户生命周期状态。

| enabled | isDefault | 业务含义 |
|---|---|---|
| true | true | 当前币种默认收款账户 |
| true | false | 可选择的备用账户 |
| false | false | 已停用账户 |
| false | true | 非法业务状态，禁止产生 |

停用账户必须同步取消默认状态。

# 3. 当前仓库结构与复用结论

已检查 main 分支相关文件。实施前仍须再次核对 main，避免文档提交后仓库继续变化。

## 3.1 数据库

主要模型：

- CompanyProfile
- BankAccountProfile
- CommercialDocument
- CommercialDocumentItem

当前 CompanyProfile 和 BankAccountProfile 已经存在一对多关系。

BankAccountProfile 当前已有：

- companyProfileId
- label
- accountHolder
- bankName
- bankAddress
- accountNumber
- swiftCode
- wireRoutingNumber
- achRoutingNumber
- currencyCode
- isDefault
- enabled
- sortOrder

本次不新建公司表和银行账户表。

## 3.2 后端复用文件

| 文件 | 整改职责 |
|---|---|
| `apps/api/src/modules/commercial-documents/company-profiles.controller.ts` | 公司、银行账户接口 |
| `apps/api/src/modules/commercial-documents/company-profiles.service.ts` | 公司、账户、默认账户事务 |
| `apps/api/src/modules/commercial-documents/commercial-documents.service.ts` | PI/CI 币种匹配 |
| `apps/api/src/modules/commercial-documents/commercial-documents.module.ts` | 核对字典服务依赖注入 |
| `packages/validation/src/commercial-documents.ts` | DTO/Zod 校验 |
| `packages/contracts/src/commercial-documents.ts` | 共享数据类型 |
| `database/prisma/schema.prisma` | 银行账户模型扩展 |

## 3.3 前端复用文件

| 文件 | 整改职责 |
|---|---|
| `apps/admin/src/app/[locale]/(admin)/company-profile/page.tsx` | 公司资料页面 |
| `apps/admin/src/app/[locale]/(admin)/commercial-documents/[id]/page.tsx` | PI/CI 银行账户选择 |
| `apps/admin/src/lib/commercial-documents-api.ts` | API 请求及 DTO |
| `apps/admin/src/lib/dictionary-api.ts` | 字典 API |
| `apps/admin/src/lib/dictionary-options.ts` | 字典选项缓存和加载 |
| `apps/admin/src/messages/zh-CN.json` | 中文文案 |
| `apps/admin/src/messages/en-US.json` | 英文文案 |

不允许另建第二套字典管理或银行账户业务 API 客户端。

# 4. 数据库调整

## 4.1 增加开户国家字段

修改：

`database/prisma/schema.prisma`

BankAccountProfile 增加：

```prisma
bankCountryCode String? @db.VarChar(2)
```

数据库字段暂时允许 NULL，以兼容历史账户。

业务规则：

- 新增银行账户时必须填写开户国家。
- 修改历史账户时允许保留原来的 NULL。
- 用户补录后保存国家代码。
- 国家代码必须通过后端字典校验。
- 只保存国家 code，不保存翻译 label。

国家代码沿用项目 country 字典的实际 code 格式，不自行创建另一套国家编码体系。

## 4.2 币种字段兼容

当前 currencyCode 为：

```prisma
currencyCode String? @db.VarChar(3)
```

本次不直接强制改成 NOT NULL。

原因：当前生产数据库可能存在历史空币种账户，不能擅自给这些账户分配 USD、CNY 等币种。

整改要求：

- 新增账户：currencyCode 必填。
- 修改新账户：不得清空 currencyCode。
- 历史空币种账户：保留原数据。
- 历史空币种账户：不能参与默认账户匹配。
- 历史空币种账户：不得作为 PI/CI 新单据收款账户。
- 补录币种后恢复正常业务使用。

等所有历史数据完成清理，再单独评估 NOT NULL 迁移。

## 4.3 默认账户唯一约束

业务唯一键：

```
companyProfileId + currencyCode
```

PostgreSQL 部分唯一索引：

```sql
CREATE UNIQUE INDEX uq_bank_account_default_per_currency
ON bank_account_profiles (company_profile_id, currency_code)
WHERE is_default = TRUE
  AND currency_code IS NOT NULL;
```

该索引保证：

- 同公司 USD 只能有一个默认账户。
- 同公司 EUR 可以同时有一个默认账户。
- 同公司 CNY 可以同时有一个默认账户。
- 不同公司之间互不影响。

## 4.4 迁移前数据检查

首先检查币种缺失：

```sql
SELECT
  id,
  company_profile_id,
  label,
  currency_code,
  enabled,
  is_default
FROM bank_account_profiles
WHERE currency_code IS NULL;
```

检查重复默认账户：

```sql
SELECT
  company_profile_id,
  currency_code,
  COUNT(*) AS total
FROM bank_account_profiles
WHERE is_default = TRUE
  AND currency_code IS NOT NULL
GROUP BY company_profile_id, currency_code
HAVING COUNT(*) > 1;
```

检查空币种默认账户：

```sql
SELECT id, company_profile_id, label
FROM bank_account_profiles
WHERE currency_code IS NULL
  AND is_default = TRUE;
```

迁移处理：

1. 统计历史空币种账户。
2. 统计重复默认账户。
3. 人工确认异常数据。
4. 对空币种账户取消默认资格。
5. 对重复默认账户确认保留哪一个。
6. 增加 bankCountryCode。
7. 创建部分唯一索引。
8. 检查迁移结果。

禁止在迁移时自动猜测历史账户的币种。迁移脚本不得静默选择重复默认账户；如果异常数据尚未处理，应让迁移前检查阻止迁移或按已审核的数据修复方案执行。

## 4.5 迁移命名

实际执行时使用新的时间戳目录：

```
database/prisma/migrations/
    <timestamp>_company_bank_country_and_currency_defaults/
        migration.sql
```

必须同步修改 Prisma Schema。

不允许只修改 Schema 而不生成 migration。时间戳必须在实施时生成，不得提前猜测。

# 5. 字典复用

## 5.1 Currency

现有字典：

```
DictionaryType
    code = currency
```

当前 seed 已有：

- CNY
- USD
- EUR
- GBP
- JPY
- CAD
- AUD

前端通过现有字典加载机制获取选项；具体 hook 签名以当前仓库实现为准。

展示示例：

```
USD - US Dollar
EUR - Euro
CNY - Chinese Yuan
```

保存：

```json
{
  "currencyCode": "USD"
}
```

不允许保存展示 label。

## 5.2 Country

复用：

```
DictionaryType
    code = country
```

公司注册地址和银行开户国家使用同一字典。

## 5.3 服务端校验

新增银行账户时，后端必须确认：

1. currencyCode 存在。
2. currencyCode 属于 currency 类型。
3. currencyCode 已启用。
4. bankCountryCode 存在。
5. bankCountryCode 属于 country 类型。
6. bankCountryCode 已启用。

复用现有 DictionaryService 或对应的数据库字典查询能力。

不允许仅在前端判断。

# 6. 公司资料页面整改

## 6.1 页面总体结构

保留现有 Admin 页面和布局体系，不重建后台 Shell。

公司资料页面分为：

```
Company Profile
│
├── Header
│   ├── 标题
│   ├── 刷新
│   └── 新增公司
│
├── Company List
│   ├── 公司名称
│   ├── 联系人
│   ├── 国家
│   ├── 默认公司
│   └── 启用状态
│
└── Company Detail
    ├── Company Information
    ├── Company Address
    ├── Logo / Stamp
    └── Bank Accounts
        ├── USD
        ├── EUR
        ├── CNY
        └── Other Currencies
```

保留当前 `document-workbench` 主从布局设计基础，优化内部信息分组和操作流程。

不强制使用固定宽度。

必须适配 360px 手机、平板及桌面。

## 6.2 公司列表

保留现有列表，补充：

- 公司国家。
- 银行账户数量。
- 搜索公司名称。
- 搜索公司编码。
- 启用状态。
- 默认公司标签。

选择公司后显示详细信息。

刷新后尽量保持原选中公司。

## 6.3 公司基本信息

继续使用现有字段：

- code
- companyName
- contactName
- phone
- email
- taxId
- website
- address
- logoAssetId
- stampAssetId
- isDefault
- enabled

地址 countryCode 使用 country 字典。

Logo 和 Stamp 继续使用现有 Upload 与素材管理机制；页面展示预览，删除时登记物理删除任务（见 §22）。

不重新实现对象存储。

## 6.4 银行账户列表

按币种分组。

示例：

```
USD - US Dollar

  USD Main Account
  Bank of China
  Account: ****1234
  Default

  USD Backup Account
  Bank of America
  Account: ****5678


EUR - Euro

  EUR Main Account
  Deutsche Bank
  Account: ****9012
  Default
```

每个账户展示：

- 账户标签。
- 币种。
- 开户国家。
- 账户名称。
- 银行名称。
- 脱敏账号。
- SWIFT 是否已配置。
- 默认状态。
- 启用状态。
- 编辑操作。
- 停用操作。

停用账户不再参与 PI/CI 选择。

## 6.5 银行账户编辑表单

### 基本信息

| 字段 | 必填 |
|---|---|
| 账户标签 | 是 |
| 账户名称 | 是 |
| 银行名称 | 是 |
| 开户国家 | 新账户必填 |
| 银行地址 | 否 |

### 收款信息

| 字段 | 必填 |
|---|---|
| 币种 | 是 |
| 账号 | 是 |
| SWIFT | 否 |
| Wire Routing | 否 |
| ACH Routing | 否 |

### 账户设置

- 是否为当前币种默认账户。
- 是否启用。
- 排序。

不同国家的银行信息要求不同，不强制所有账户填写相同类型的路由信息。

暂不新增 IBAN 等专用字段。

## 6.6 默认账户交互

用户将 EUR Account 设置为默认账户时，确认提示：

```
设置 EUR 默认账户？

同一公司当前 EUR 默认账户将自动取消默认状态。

其他币种的默认账户不受影响。

取消 / 确认
```

不需要用户手动先取消旧默认账户。

后端事务自动完成。

# 7. 新增公司与银行账户组合流程

## 7.1 新增界面

点击新增公司后进入完整表单：

```
Create Company Profile
│
├── Company Information
├── Company Address
├── Logo / Stamp
├── Initial Bank Accounts
│   ├── Add USD Account
│   ├── Add EUR Account
│   └── Add CNY Account
└── Save
```

支持：

- 添加多个银行账户。
- 编辑尚未保存的账户。
- 删除尚未保存的账户。
- 按币种设置默认账户。
- 允许不添加银行账户。

新增公司时，初始账户使用前端本地表单状态维护，最后一次提交。

## 7.2 请求 Schema

在：

`packages/validation/src/commercial-documents.ts`

增加组合创建 Schema，目标名称：

```ts
createCompanyProfileWithBankAccountsSchema
```

逻辑结构：

```ts
{
  company: CreateCompanyProfileInput,
  bankAccounts: CreateBankAccountWithoutCompanyIdInput[]
}
```

初始账户字段复用现有 createBankAccountSchema 的字段定义。

区别：

- 不需要前端传 companyProfileId。
- currencyCode 必填。
- bankCountryCode 必填。
- 账号必填。
- 银行名称必填。
- 账户名称必填。

增加 `superRefine`：

同一币种最多一个 isDefault=true。

不要求每种币种必须设置默认账户。

## 7.3 新增 API

新增：

```http
POST /admin/company-profiles/with-bank-accounts
```

请求结构示例：

```json
{
  "company": {
    "code": "wuxuan-cn",
    "companyName": "Example Trading Co., Ltd.",
    "contactName": "",
    "phone": "",
    "email": "",
    "taxId": "",
    "website": "",
    "address": {
      "line1": "",
      "line2": "",
      "city": "",
      "state": "",
      "postalCode": "",
      "countryCode": "CN"
    },
    "isDefault": true,
    "enabled": true
  },
  "bankAccounts": [
    {
      "label": "USD Account",
      "accountHolder": "Example Trading Co., Ltd.",
      "bankName": "Bank of China",
      "bankAddress": "",
      "bankCountryCode": "CN",
      "accountNumber": "ACCOUNT_NUMBER",
      "swiftCode": "BANK_SWIFT",
      "wireRoutingNumber": "",
      "achRoutingNumber": "",
      "currencyCode": "USD",
      "isDefault": true,
      "enabled": true,
      "sortOrder": 0
    }
  ]
}
```

该请求是结构示例，不能将示例账号作为真实生产数据。

## 7.4 权限

现有权限：

- company_profile.manage
- bank_account.manage

组合创建必须同时满足公司管理和银行账户管理权限。

如果用户只有 company_profile.manage：

- 可以继续使用原有公司创建接口。
- 可以新增没有银行账户的公司。
- 不允许通过组合接口创建银行账户。

前端可以根据权限控制交互：

```ts
const canManage = can('company_profile.manage');
const canManageBanks = can('bank_account.manage');
```

只有同时拥有两个权限时，才允许在新增公司流程中提交初始银行账户。

后端必须执行双权限检查，不能只依赖前端。

原有 `POST /admin/company-profiles` 保留，避免破坏旧调用。

## 7.5 数据库事务

后端 CompanyProfilesService 增加：

```ts
createWithBankAccounts(
  input,
  actorId,
  requestId,
)
```

流程：

1. 校验公司信息。
2. 校验银行账户数组。
3. 校验 currency 字典。
4. 校验 country 字典。
5. 检查公司编码重复。
6. 检查同币种默认账户冲突。
7. 开启 Prisma transaction。
8. 创建 CompanyProfile。
9. 创建所有 BankAccountProfile。
10. 提交事务。
11. 记录审计。
12. 返回安全的公司资料 DTO。

任意数据库写入失败，整笔事务回滚。

不允许公司创建成功、账户只创建一部分。

审计记录不得包含账号、SWIFT、Routing Number 等敏感内容。

# 8. 默认银行账户逻辑

## 8.1 创建账户

原有逻辑只按 companyProfileId 清除默认状态，需要修改为同时按币种过滤：

```ts
where: {
  companyProfileId,
  currencyCode,
  isDefault: true,
}
```

设置 USD 默认账户，只取消同公司其他 USD 默认账户。

EUR、CNY 默认账户保持不变。

## 8.2 编辑账户

必须同时考虑：

- 原 currencyCode。
- 新 currencyCode。
- 原 isDefault。
- 新 isDefault。
- enabled。

当币种改变时：

1. 检查新币种是否合法。
2. 检查当前账户是否被历史单据使用。
3. 如果账户被历史单据使用，不允许直接修改其币种，避免账户身份含义变化。
4. 建议创建新的银行账户替代。
5. 未被历史单据引用的账户允许修改币种。
6. 如设置为新币种默认账户，事务内取消该币种旧默认账户。

由于现有单据主要保存 JSON 快照，无法可靠地从所有历史记录反查来源账户；若无法证明某账户未被历史引用，应采取保守策略，禁止直接改变其币种，要求新建账户替代。

## 8.3 停用默认账户

停用时：

```ts
enabled = false
isDefault = false
```

不自动选择备用账户为默认账户。

如果还有其他启用账户，提示用户可以手动设置默认账户。

如果没有其他账户，允许该币种暂时没有默认账户。

## 8.4 并发处理

所有默认账户变更在数据库事务中完成。

数据库部分唯一索引是最终保护。

遇到唯一约束冲突：

- 返回 HTTP 409。
- 提示用户刷新。
- 不允许静默覆盖其他账户。

# 9. 银行账户删除与历史数据保护

## 9.1 最终规则

历史单据使用过的银行账户不能物理删除。

本次采用更加安全的统一策略：

**银行账户管理页面不再执行物理删除，所有删除操作统一改为停用。**

原因：

当前 CommercialDocument 主要通过 paymentSnapshot 保存收款信息，数据库没有独立的 sourceBankAccountId 外键关联。

因此，不能仅依赖简单的关联查询判断某个账户是否曾经被历史单据使用。

统一停用可以避免历史数据丢失，也不需要破坏现有快照模型。

## 9.2 API 调整

继续使用现有：

```http
DELETE /admin/bank-accounts/:id
```

但后端行为改为：

```ts
await transaction.bankAccountProfile.update({
  where: { id },
  data: {
    enabled: false,
    isDefault: false,
  },
});
```

返回：

```json
{
  "data": {
    "disabled": true
  }
}
```

前端按钮从“删除”调整为“停用”。

需要更新 API 响应类型和相关调用。

不得对历史引用账户执行 DELETE SQL。

## 9.3 历史账户恢复

已停用账户可以恢复启用。

但恢复时：

- 必须重新校验币种。
- 必须校验开户国家；历史 NULL 国家可保留但不能作为新账户创建的默认行为。
- 不自动成为默认账户。
- 如果需要默认账户，用户主动设置。

## 9.4 历史单据保护

已签发单据的：

- sellerSnapshot
- paymentSnapshot
- 其他公司资料快照

均保持原样。

修改公司资料和银行账户不得回写历史单据。

# 10. 银行账号数据安全

## 10.1 当前问题

现有 CompanyProfilesService 的 DTO 会返回完整：

- accountNumber
- swiftCode
- wireRoutingNumber
- achRoutingNumber

现有公司资料列表和 PI/CI 选项接口也会包含完整银行信息。

需要收紧接口数据暴露。

## 10.2 DTO 分层

### 公司资料列表 DTO

只返回：

- id
- label
- bankName
- currencyCode
- bankCountryCode
- isDefault
- enabled
- maskedAccountNumber

不返回完整账号和路由号。

### 银行账户编辑 DTO

增加受权限保护的详情读取接口：

```http
GET /admin/bank-accounts/:id
```

权限：

`bank_account.manage`

只供有管理权限的用户编辑账户时读取完整资料。

### PI/CI 选项 DTO

返回：

- id
- label
- bankName
- currencyCode
- bankCountryCode
- isDefault
- maskedAccountNumber

不返回不必要的完整账号。

后端在实际创建商业单据时，根据 bankAccountId 查询数据库，并在服务端构造完整 paymentSnapshot。

前端不负责传入或重新拼装完整银行资料。

## 10.3 日志和审计

继续遵守现有规则。

禁止记录：

- 完整账号。
- SWIFT。
- Routing Number。
- ACH Routing Number。

审计记录只记录变更字段名称及账户 ID。

# 11. PI/CI 币种匹配整改

## 11.1 当前实现问题

现有文件：

`apps/api/src/modules/commercial-documents/commercial-documents.service.ts`

当前方法：

```ts
resolveBankAccount(
  companyProfileId,
  bankAccountId,
)
```

当前自动选择只按公司和 enabled 查询，再按照 isDefault 和 sortOrder 排序。

这会产生一个问题：

USD 单据可能选中 EUR 默认账户。

本次必须修复。

## 11.2 新的匹配接口

目标：

```ts
resolveBankAccount(
  companyProfileId,
  bankAccountId,
  currencyCode,
)
```

参数类型根据当前代码实际定义调整。

## 11.3 自动匹配

以 USD 单据为例，查询必须同时满足：

- companyProfileId = 当前公司
- currencyCode = USD
- enabled = true
- isDefault = true

Prisma 查询条件：

```ts
where: {
  companyProfileId,
  currencyCode,
  enabled: true,
  isDefault: true,
}
```

## 11.4 手动选择

用户指定 bankAccountId 后，必须验证：

```ts
account.id === bankAccountId
account.companyProfileId === companyProfileId
account.currencyCode === documentCurrency
account.enabled === true
```

任意条件不满足，拒绝创建单据。

不能自动替换为其他账户。

## 11.5 没有默认账户

分三种情况：

### 情况 A：存在默认账户

自动选择。

### 情况 B：有同币种账户，但没有默认账户

要求用户手动选择。

### 情况 C：完全没有同币种账户

提示：

```
No active bank account is configured
for the selected document currency.

Please configure a matching bank account
in Company Profile.
```

禁止跨币种替代。

## 11.6 修改币种

现有商业单据从订单创建时，要求：

```ts
document.currency = order.currencyCode
```

继续保留这一规则。

如果未来支持独立修改单据币种，需要另行设计订单金额换算和财务业务规则，不属于 DOC-44。

## 11.7 必须修改的方法

重点检查：

- prefill()
- createFromOrder()
- resolveBankAccount()
- buildFromOrder()

其中：

- prefill() 必须使用 order.currencyCode。
- createFromOrder() 必须使用最终校验后的 document currency。
- buildFromOrder() 必须继续由后端读取账户数据并生成完整 paymentSnapshot。
- 不能在不同入口分别实现不同的银行账户选择规则。

# 12. PI/CI 页面交互

文件：

`apps/admin/src/app/[locale]/(admin)/commercial-documents/[id]/page.tsx`

继续复用现有商业单据页面。

增加或完善：

```
Seller Company
    │
    ▼
Document Currency
    │
    ▼
Bank Account
    ├── USD Main Account
    └── USD Backup Account
    │
    ▼
Payment Details
```

显示：

- 账户标签。
- 银行名称。
- 币种。
- 开户国家。
- 脱敏账号。
- 默认账户标记。

用户切换银行账户后，页面同步更新相关收款资料。

后端仍负责重新读取真实账户资料，不能信任前端提交的银行信息。

## 12.1 币种变化

如果草稿单据币种发生变化：

1. 重新筛选同币种账户。
2. 检查原账户是否仍符合条件。
3. 不符合时清除旧选择。
4. 优先选择新币种默认账户。
5. 无默认账户时要求手动选择。
6. 不允许保留跨币种账户。

## 12.2 已签发单据

ISSUED 状态只读。

修改银行账户只能通过现有 revision 流程。

不得修改已签发文件。

# 13. API 改造清单

| API | 改造要求 |
|---|---|
| GET /admin/company-profiles | 返回安全的公司及银行列表 DTO |
| GET /admin/company-profiles/options | 返回 PI/CI 所需的最小字段 |
| POST /admin/company-profiles | 保留旧接口 |
| POST /admin/company-profiles/with-bank-accounts | 新增事务式组合创建 |
| PATCH /admin/company-profiles/:id | 保留并核对现有实现 |
| DELETE /admin/company-profiles/:id | 保留现有保护逻辑 |
| POST /admin/bank-accounts | 增加币种、国家校验 |
| GET /admin/bank-accounts/:id | 新增受保护的账户详情接口 |
| PATCH /admin/bank-accounts/:id | 增加币种及默认关系校验 |
| DELETE /admin/bank-accounts/:id | 改为停用 |

所有接口继续使用现有 NestJS Controller、Zod Pipe、Permission Decorator 和 RequestId。

禁止另建一套不受现有权限系统管理的接口。路由参数形式以现有 Controller 实际路由为准，实施时保持兼容。

# 14. 权限整改

继续使用：

- company_profile.manage
- bank_account.manage
- commercial_document.read
- commercial_document.update

不新增重复权限。

权限要求：

| 功能 | 权限 |
|---|---|
| 查看公司资料 | company_profile.manage |
| 新增公司 | company_profile.manage |
| 编辑公司 | company_profile.manage |
| 管理银行账户 | bank_account.manage |
| 读取完整银行账号 | bank_account.manage |
| 新增公司及初始账户 | 公司管理 + 银行账户管理 |
| PI/CI 读取可选公司 | commercial_document.read |
| PI/CI 编辑草稿 | commercial_document.update |

后端逐接口执行权限校验。

不允许通过前端隐藏按钮代替后端鉴权。

# 15. 国际化

修改：

- `apps/admin/src/messages/zh-CN.json`
- `apps/admin/src/messages/en-US.json`

新增文案至少包含：

公司资料：

- 公司国家。
- 银行账户数量。
- 新增公司。
- 保存公司资料。

银行账户：

- 开户国家。
- 币种。
- 默认账户。
- 备用账户。
- 设置默认。
- 停用账户。
- 恢复账户。
- 账号脱敏展示。

异常提示：

- 币种不存在。
- 国家不存在。
- 默认账户冲突。
- 账户币种不匹配。
- 账户已停用。
- 账户被历史单据引用。
- 没有可用收款账户。
- 无权限管理银行账户。

所有界面文案使用 i18n key。

禁止散落硬编码中文或英文。

# 16. 自动化测试

## 16.1 新增测试文件

建议新增：

```
apps/api/src/modules/commercial-documents/
    company-profiles.service.spec.ts
```

继续扩展：

```
apps/api/src/modules/commercial-documents/
    commercial-documents.service.spec.ts
    commercial-documents.wiring.spec.ts

packages/validation/src/
    commercial-documents.spec.ts
```

Admin 测试沿用项目现有测试工具和组织规范。

## 16.2 公司资料测试

| ID | 场景 | 结果 |
|---|---|---|
| CP-001 | 新增公司 | 成功 |
| CP-002 | 公司编码重复 | 拒绝 |
| CP-003 | 公司名称为空 | 拒绝 |
| CP-004 | 新增公司同时创建 USD/EUR/CNY | 成功 |
| CP-005 | 初始账户有非法币种 | 整体失败 |
| CP-006 | 初始账户有非法国家 | 整体失败 |
| CP-007 | 账户创建中途失败 | 整个事务回滚 |
| CP-008 | 只有公司管理权限 | 不允许批量创建银行账户 |
| CP-009 | 公司列表刷新 | 数据正确 |
| CP-010 | Logo/Stamp 上传 | 正常 |

## 16.3 银行账户测试

| ID | 场景 | 结果 |
|---|---|---|
| BA-001 | 新增 USD 默认账户 | 成功 |
| BA-002 | 新增 EUR 默认账户 | 成功 |
| BA-003 | 新增第二个 USD 默认账户 | 自动替换原默认 |
| BA-004 | 设置 EUR 默认账户 | 不影响 USD |
| BA-005 | 同公司多个 USD 备用账户 | 允许 |
| BA-006 | 空币种新账户 | 拒绝 |
| BA-007 | 非法国家 | 拒绝 |
| BA-008 | 停用默认账户 | 取消默认 |
| BA-009 | 停用账户恢复 | 正常 |
| BA-010 | 删除操作 | 实际停用 |
| BA-011 | 并发设置默认 | 最终唯一 |
| BA-012 | 修改历史引用账户币种 | 拒绝 |
| BA-013 | 账号列表 | 脱敏 |
| BA-014 | 无权限读取账号 | 拒绝 |

## 16.4 PI/CI 测试

| ID | 场景 | 结果 |
|---|---|---|
| DC-001 | USD 单据 + USD 默认账户 | 自动匹配 |
| DC-002 | EUR 单据 + EUR 默认账户 | 自动匹配 |
| DC-003 | CNY 单据 + CNY 默认账户 | 自动匹配 |
| DC-004 | USD 单据 + 只有 EUR 账户 | 不匹配 |
| DC-005 | USD 有多个账户 | 优先默认账户 |
| DC-006 | 手动切换 USD 账户 | 成功 |
| DC-007 | USD 单据选择 EUR 账户 | 拒绝 |
| DC-008 | 选择停用账户 | 拒绝 |
| DC-009 | 账户不属于当前公司 | 拒绝 |
| DC-010 | 没有默认账户 | 要求手动选择 |
| DC-011 | 没有同币种账户 | 显示缺失提示 |
| DC-012 | 已签发 PI/CI 修改公司 | 历史快照不变 |
| DC-013 | 已签发 PI/CI 修改账户 | 历史快照不变 |

## 16.5 数据迁移测试

- 空数据库迁移成功。
- 当前版本数据库升级成功。
- 历史银行账户数量保持一致。
- 空币种数据得到正确处理。
- 重复默认账户检查通过。
- 唯一索引创建成功。
- 已签发单据快照没有变化。

# 17. 执行顺序

## 阶段一：数据库与业务审查

1. 读取 AGENTS.md。
2. 读取数据库迁移规范。
3. 读取 DOC-20。
4. 读取 DOC-42。
5. 审查 CompanyProfile。
6. 审查 BankAccountProfile。
7. 审查 CommercialDocument。
8. 审查当前生产数据兼容性。
9. 确认字典服务注入方式。
10. 输出最终修改文件清单。

完成条件：无重复模型，无未经确认的业务规则。

## 阶段二：数据库与后端

1. 增加 bankCountryCode。
2. 完成币种和默认账户异常数据检查。
3. 增加唯一索引。
4. 完成组合创建 Schema。
5. 实现公司和初始账户事务。
6. 修改默认账户逻辑。
7. 增加币种、国家字典校验。
8. 修改账户删除为停用。
9. 增加安全 DTO。
10. 增加 PI/CI 币种匹配。
11. 完成后端测试。

完成条件：相关 API 和测试通过。

## 阶段三：公司资料页面

1. 优化公司列表。
2. 优化公司详情。
3. 优化地址表单。
4. 增加开户国家选择。
5. 优化币种选择。
6. 增加初始银行账户列表。
7. 实现一次性提交。
8. 优化默认账户操作。
9. 优化停用和恢复。
10. 优化敏感账号展示。
11. 完成中英文文案。

完成条件：新增公司与初始银行账户可以一次完成。

## 阶段四：PI/CI 联动

1. 修改 prefill。
2. 修改 createFromOrder。
3. 修改 resolveBankAccount。
4. 增加币种匹配。
5. 增加账户手动切换。
6. 完善错误提示。
7. 验证历史快照。
8. 验证 PDF 渲染。

完成条件：PI/CI 银行信息与单据币种一致。

## 阶段五：回归验收

执行：

```bash
pnpm lint
pnpm typecheck
```

再执行项目已有的相关测试脚本：

```bash
pnpm --filter @b2b/validation test
pnpm --filter @b2b/api test
pnpm --filter @b2b/admin build
pnpm --filter @b2b/api build
```

注意：上述命令需要先对照当前 package.json 核实实际脚本名称，不得假设所有 workspace 命令完全一致。

完成条件：

- lint 通过。
- typecheck 通过。
- 相关测试通过。
- API build 通过。
- Admin build 通过。
- 数据迁移测试通过。
- PI/CI 回归通过。

# 18. 部署与回滚

## 18.1 部署前

1. 备份 PostgreSQL。
2. 确认历史账户异常数据。
3. 在 staging 测试 migration。
4. 确认旧 API 兼容。
5. 确认公司管理权限和银行账户管理权限。

## 18.2 部署顺序

1. 数据库 additive migration。
2. API 更新。
3. Admin 更新。
4. 验证公司资料。
5. 验证银行账户。
6. 验证 PI/CI。
7. 验证 PDF。
8. 观察日志。

## 18.3 回滚

优先回退应用版本。

保留新增字段和唯一索引，避免已写入新数据后直接破坏数据库结构。

如果需要回退数据库：

- 先确认新增银行账户没有被使用。
- 先确认没有新的公司或单据依赖。
- 需要单独审核回滚 SQL。
- 不自动删除新增数据。
- 不删除已签发单据快照。

## 18.4 验收失败处理

如果 PI/CI 发现币种不匹配：

- 阻止创建或签发。
- 保留草稿。
- 显示具体缺失账户。
- 不自动切换其他币种。

# 19. Git 变更约束

本次已批准的 Git 变更范围仅为新增本 DOC-44 文档文件。

本次提交不得：

- 修改任何业务代码。
- 创建或修改数据库 migration。
- 执行 migration。
- 修改生产数据库数据。
- 修改 GitHub Actions。
- 修改 Docker Compose。
- 触发生产部署。
- 顺带修改其他文档或文件。

DOC-44 的业务实施仍须按阶段执行；本次文档提交不代表业务代码实施已经获批，也不代表可以直接部署生产环境。

建议后续业务实施提交信息：

```
feat(company-profile): add multi-currency bank account management
```

# 20. 最终验收目标

DOC-44 实施完成后，必须满足：

1. 新增公司可以同时录入多个银行账户。
2. 公司和账户一次提交，数据库事务保证一致性。
3. 一个公司可以有多个币种的默认账户。
4. 同一币种最多一个默认账户。
5. 币种和国家均来自数据库字典。
6. 银行开户国家得到完整维护。
7. 历史空币种账户得到安全兼容。
8. 银行账号在列表和选项接口中脱敏。
9. 银行账户统一停用，不物理删除。
10. PI/CI 自动匹配正确币种。
11. PI/CI 不允许跨币种错误选择。
12. 已签发商业单据不受资料变更影响。
13. 公司和银行账户权限独立生效。
14. 前后端测试通过。
15. 生产迁移具备备份、验证和回滚方案。

---

# 最终设计结论

DOC-44 不建设新的公司资料系统，而是在现有 CompanyProfile、BankAccountProfile 和 CommercialDocument 架构上完成业务规则升级。

最终实现：

**一个公司 → 多个币种银行账户 → 每币种一个默认账户 → PI/CI 按币种自动匹配 → 已签发单据永久保留原始收款快照。**

银行账户删除统一采用停用策略，避免历史商业单据资料丢失。

本文件是已批准的正式实施规范，不代表代码已经修改或部署。

---

# 21. 实施记录（本地开发）

## 21.1 数据库

新增 migration：

`database/prisma/migrations/20261107190000_company_bank_country_and_currency_defaults/migration.sql`

- `bank_account_profiles.bankCountryCode VARCHAR(2) NULL`，兼容历史数据。
- 历史空币种账户的 `isDefault` 自动清除（不猜测币种）。
- 迁移前检测同一公司、同一币种重复默认账户；存在重复时阻止迁移。
- 创建部分唯一索引：

```sql
CREATE UNIQUE INDEX uq_bank_account_default_per_currency
ON bank_account_profiles ("companyProfileId", "currencyCode")
WHERE "isDefault" = true AND "currencyCode" IS NOT NULL;
```

- 新增 `(companyProfileId, currencyCode, enabled)` 查询索引。
- 本地数据验证：迁移前 2 个账户、0 个空币种默认账户、0 个重复默认；迁移后数量不变。
- 回滚 SQL 已写入 migration 注释；生产回滚需单独审核。

## 21.2 后端接口

- `POST /admin/company-profiles/with-bank-accounts`：公司 + 初始银行账户同一事务；要求同时具备 `company_profile.manage` 与 `bank_account.manage`。
- `GET /admin/bank-accounts/:id`：仅 `bank_account.manage` 返回完整账号资料。
- `GET /admin/company-profiles`：银行账户仅返回安全摘要（脱敏账号、SWIFT 是否配置）。
- `GET /admin/company-profiles/options`：PI/CI 仅使用安全账户摘要。
- `POST /admin/bank-accounts`：新账户必须通过 `currency`、`country` 字典校验。
- `PATCH /admin/bank-accounts/:id`：按币种维护默认账户；停用时强制 `isDefault=false`；改变已被单据使用账户的币种返回 `BANK_ACCOUNT_CURRENCY_IN_USE`。
- `DELETE /admin/bank-accounts/:id`：改为停用，返回 `{ disabled: true }`，不执行物理删除。
- 默认账户唯一冲突返回 HTTP 409 `BANK_ACCOUNT_DEFAULT_CONFLICT`。

## 21.3 PI/CI

- `resolveBankAccount(companyProfileId, bankAccountId, currencyCode)`：
  - 自动匹配必须同时满足公司、币种、启用、默认。
  - 手动选择必须校验公司归属、启用状态、币种一致；不跨币种替代。
- `prefill()` 返回匹配账户、可选同币种账户列表及 `MATCHED / SELECT_REQUIRED / MISSING` 状态。
- `createFromOrder()` 无默认账户时要求手动选择；没有同币种账户时抛出 `BANK_ACCOUNT_MISSING`。
- 商业单据 `calculationSnapshot` 保存 `companyProfileId` / `bankAccountId` 元数据，详情 DTO 返回；
- 草稿更新可提交 `bankAccountId`，后端重新读取完整账户并生成 `paymentSnapshot`；不再信任浏览器提交的 `payment` 数据。
- 已签发单据的 seller/payment 快照不受公司或账户修改影响。

## 21.4 Admin

- 公司资料页改为主从布局：搜索/启停筛选、国家、账户数量、默认公司、启用状态。
- 公司信息、地址、Logo/印章、银行账户分组；国家/币种使用统一选择器。
- 新增公司可同时添加多个初始账户，编辑/删除未保存账户，一次提交。
- 银行账户按币种分组；展示脱敏账号、开户国家、SWIFT 配置、默认/启用状态。
- 支持设置默认（事务内替换同币种默认）、停用、恢复；不提供物理删除。
- 敏感账号编辑通过受权限保护的详情接口加载；列表/选项不返回完整账号。
- PI/CI 编辑页增加卖方公司、单据币种、银行账户选择；账户按公司 + 币种过滤，保存时只提交 `bankAccountId`。

## 21.5 验证

- `pnpm run lint`：通过。
- `pnpm run typecheck`：通过。
- `pnpm --filter @b2b/validation run test`：29 项通过。
- `pnpm --filter @b2b/database run test`：4 项通过。
- `pnpm --filter @b2b/admin run test`：199 项通过。
- `pnpm --filter @b2b/api run test`：439/442 通过；3 项失败仍为既有 `B2B_Quotation_Template.xlsx` 夹具解析测试，与 DOC-44 无关。
- 定向 `commercial-documents`：52 项通过（公司服务、单据服务、模板、权限 wiring）。
- `pnpm --filter @b2b/admin run build`：通过（需设置 `ADMIN_API_PROXY_TARGET`）。
- `pnpm --filter @b2b/api run build`：通过。
- 本地 migration 已应用；部分唯一索引存在；历史账户数量保持 2 个。
- 未执行：登录后 1440/768/360 实机截图回归；建议在 staging 验证公司组合创建、默认账户并发、PI/CI 币种缺失提示。

## 21.6 已知边界

- 历史账户的 `currencyCode` / `bankCountryCode` 仍允许为 NULL；启用或用于 PI/CI 前需补录币种，国家可保留 NULL 但列表会显示未填写。
- 历史草稿没有 `bankAccountId` 元数据时，继续保留原 `paymentSnapshot`，直到用户主动选择银行账户。
- 银行账户历史引用判断采用保守策略：只要 `paymentSnapshot.accountNumber` 或 `calculationSnapshot.bankAccountId` 命中，即禁止改币种。
- 生产迁移需先执行文档 §4.4 的异常数据检查，并按 §18 备份、staging 验证后单独审批。

## 22. Logo/印章预览与物理删除

### 22.1 问题与目标

原公司资料页只显示 `logoAssetId` / `stampAssetId`，不显示图片，也没有删除入口；替换素材后旧对象会失去引用并长期留在对象存储中。本次修复：

- 公司列表和选项 DTO 增加只读 `logoUrl` / `stampUrl`。
- 页面直接展示 Logo 与印章图片，删除按钮放在图片之后。
- 删除必须同时移除公司资料引用，并登记可重试的物理删除任务；不执行仅清空字段的“假删除”。

### 22.2 后端接口

- `GET /admin/company-profiles`
  - 新增 `logoUrl`、`stampUrl`。
  - 仅当素材存在、`status=ready` 且 `isPublic=true` 时返回公开 URL；否则返回 `null`。
- `GET /admin/company-profiles/options`
  - 同步返回 `logoUrl`、`stampUrl`，供 PI/CI 页面复用。
- `DELETE /admin/company-profiles/:id/assets/:kind`
  - `kind` 仅允许 `logo` 或 `stamp`。
  - 权限：`company_profile.manage`。
  - 同一事务内清空对应字段、创建 `file_deletion_jobs` 记录并删除 `file_assets` 元数据。
  - 返回更新后的公司资料（含银行账户与最新 URL）、`assetId`、`removed`、`deletionJobId`。
- `DELETE /admin/company-profile-assets/:assetId`
  - 删除尚未保存到公司的新上传素材。
  - 仅允许上传者本人操作，且素材 `purpose` 必须为 `logo`。
  - 权限：`company_profile.manage`。

### 22.3 引用保护

删除前检查以下引用：

- 其他公司资料的 `logoAssetId` / `stampAssetId`。
- 商业单据 `sellerSnapshot.logoAssetId`、`sellerSnapshot.stampAssetId`、`signatureSnapshot.stampAssetId`。
- 全局设置 `site.logoFileAssetId`。

存在任何引用时返回 HTTP 409 `ASSET_IN_USE`，不会删除对象或公司字段。这样已保存的 PI/CI 快照仍可重新渲染。

通用文件删除接口 `DELETE /admin/files/:id` 也增加相同检查，避免绕过公司资料页破坏单据素材。

### 22.4 物理删除流程

1. API 事务写入 `FileDeletionJob`（`entityType=file_asset`、`storageKey`、幂等键 `file-asset:<assetId>`）。
2. 同一事务删除 `FileAsset` 元数据并清空公司字段。
3. Worker 通过既有 `processFileDeletion` 删除对象存储文件；对象已不存在视为成功。
4. 存储失败时保留任务、错误码和重试状态，不返回虚假成功。

本地开发环境需要 Worker 运行才会真正清理对象；仅启动 API 时任务会保持 `QUEUED`。

### 22.5 Admin 页面

- Logo 与印章各自显示预览框，使用 `alt`、`loading=lazy`、`decoding=async`。
- 删除按钮紧跟在预览之后，使用危险按钮与确认弹窗，文案明确“物理删除、不可恢复”。
- 无图片时显示空状态；素材存在但无法生成公开 URL 时显示“暂无预览”，仍允许删除。
- 删除成功后只更新当前图片字段与预览，不覆盖表单中的其他未保存修改。
- 若当前显示的是尚未保存的替换图，删除会清理新素材并恢复已保存图片；不会误删公司当前已保存的 Logo/印章。
- 被引用的图片返回 409 时使用统一 `ASSET_IN_USE` 文案提示。

### 22.6 验证与边界

- API 单元测试覆盖：预览 URL、公司字段解绑、物理删除任务、单据引用阻止、未保存素材清理、上传者归属校验。
- 权限 wiring 测试覆盖两个新端点。
- 未新增数据库迁移；复用 `file_assets`、`file_deletion_jobs`。
- 已签发单据与草稿快照引用素材时禁止删除，因此不存在“删除后历史单据重新渲染丢失 Logo/印章”的情况。
- 公开图片可能被 CDN/浏览器缓存，对象删除后缓存过期前仍可能返回旧图；本项目未单独实现素材 CDN 主动刷新。
