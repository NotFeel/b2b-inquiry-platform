# 17. 系统管理 - 用户管理编辑能力与角色选择器改造方案

> 文档版本：1.0  
> 适用页面：后台 `/[locale]/users`（以现有项目实际路由为准）  
> 适用技术基线：Next.js + TypeScript 管理端，NestJS REST API，PostgreSQL + Prisma，RBAC  
> 目标：用户可编辑；角色从角色 API 获取并以多选下拉框分配，禁止角色自由文本输入。

## 1. 现状与问题判断

根据提供的两张截图，用户管理页目前存在以下问题：

1. 用户列表操作列有“重置密码”和“停用”，但没有“编辑”，创建后的显示姓名、角色无法通过页面修改。
2. “新建”弹窗的角色字段是普通文本输入，帮助文案提示用英文逗号输入 `sales, viewer`。这会使角色赋值依赖字符串解析，无法保证角色真实存在、可分配或拼写正确。
3. 表格中的角色以 `super_admin` 机器码直接展示，对中文后台用户不够友好；角色应展示本地化名称，机器码用于请求和调试，不应作为主要展示文本。
4. 新建与编辑需要共享表单、验证规则、权限逻辑和反馈，不应维护两套容易发生偏差的界面。
5. 权限边界必须落在服务端。即使前端隐藏编辑按钮或把某个角色设为禁选，API 仍须校验用户是否有权更新用户、读取可分配角色和分配特权角色。

当前截图只足以确认 UI 现象，不能证明现有 API 完全不存在。编码前必须先搜索并复用当前用户、角色、权限、审计模块与 API Client，避免重复造接口。

## 2. 改造目标与范围

### 2.1 必须实现

- 用户列表增加“编辑”操作。
- 编辑表单支持修改显示姓名、分配/取消角色；登录账号创建后默认不可编辑，避免账号变更影响会话、审计与关联记录。
- 新建和编辑共用一个 `UserFormDialog`/`UserFormDrawer`，由 `mode=create | edit` 控制标题和提交接口。
- 角色选项来自真实角色管理 API；界面使用可搜索、多选下拉框，展示本地化角色名和必要说明。
- 选中角色用 `roleIds` 维护，提交 `roleIds: string[]`；不再接收/发送 `sales,viewer` 之类的逗号分隔字符串。
- 加载中、加载失败、无可分配角色、无权限、保存中、重复提交、字段错误、服务端冲突等状态齐全。
- 新建/编辑/角色变更/停用/重置密码按权限显示，并在服务端再次鉴权。
- 角色分配保存为事务：校验用户和角色后，原子替换 `UserRole` 关联并写审计事件。
- 操作成功后更新列表数据；不要求用户手动刷新才能看到新姓名或角色。
- 后台页面文案必须支持 `zh-CN` 和 `en-US`。

### 2.2 本次不包含

- 直接在用户管理页内创建或修改角色本身；角色 CRUD 继续由“角色权限”页面负责。
- 编辑登录账号、修改密码明文、公开注册。
- 仅通过前端控制实现安全授权。
- 未经确认新增批量编辑、批量停用等范围外功能。

## 3. 推荐 UI 结构

### 3.1 用户列表页

页面沿用统一 Admin Shell 与后台设计 Token。建议结构如下：

```text
系统管理 / 用户管理                              [语言] [当前用户]

用户管理
管理后台登录账号、显示姓名、状态和角色。
                                                        [ + 新建用户 ]

[搜索登录账号/显示姓名……] [状态：全部 ▾] [角色：全部 ▾] [查询] [重置]

┌────────────┬────────────┬────────┬──────────────────┬──────────────┬──────────┐
│ 登录账号   │ 显示姓名   │ 状态   │ 角色             │ 最近登录     │ 操作     │
├────────────┼────────────┼────────┼──────────────────┼──────────────┼──────────┤
│ admin      │ Admin      │ 启用   │ 超级管理员       │ ...          │ 编辑 ⋯   │
└────────────┴────────────┴────────┴──────────────────┴──────────────┴──────────┘

合计 N 条                                      每页条数 [20 ▾] [上一页] 1/1 [下一页]
```

#### 列表调整

- 操作列至少提供“编辑”；“重置密码”和“停用/启用”作为可见次级操作或收纳在操作菜单中。
- 当权限允许时，优先显示“编辑”按钮；其他破坏性或安全敏感操作使用次级按钮/菜单，并遵循统一确认交互。
- 角色显示本地化名称，例如“超级管理员 / Super administrator”。如果一个用户有多个角色，以 Tag 展示；过多时显示前 2 个和“+N”，悬浮/点击可查看全部。
- `super_admin` 等 code 可放在角色详情或辅助提示中，不直接取代本地化名称。
- 状态显示为带文本的 StatusTag，例如“启用 / Active”“已停用 / Disabled”，不只依赖颜色。
- 列表至少支持账号/姓名模糊搜索、状态筛选、角色筛选、服务端分页和稳定排序。若后端当前没有某筛选能力，可分阶段实现，但须明确 UI 不显示未接通的筛选器。
- 请求失败显示明确错误和重试操作；空数据与加载中分别使用 EmptyState/LoadingState；不能以假数据代替接口结果。

### 3.2 新建/编辑弹窗

建议桌面端使用宽度 `min(680px, calc(100vw - 32px))` 的 Dialog；手机端改为全宽/底部 Drawer 或适配屏幕高度的 Dialog。弹窗高度不超过视口可用高度，内容区滚动，底部按钮固定。

```text
┌────────────────────────────────────────────────────────────┐
│ 新建用户 / 编辑用户                                   [×]  │
├────────────────────────────────────────────────────────────┤
│ 登录账号 *                 显示姓名 *                       │
│ [输入账号               ] [输入显示姓名                 ]  │
│                                                            │
│ 分配角色 *                                                 │
│ [ 搜索角色……                                       ▾ ]    │
│ [销售人员 ×] [产品运营 ×]                                  │
│ 选择该用户可以执行的后台操作；权限由角色决定。             │
│                                                            │
│ 编辑模式可显示只读信息：状态、创建时间、最近登录（只读）。 │
├────────────────────────────────────────────────────────────┤
│                              [取消] [保存 / 创建用户]       │
└────────────────────────────────────────────────────────────┘
```

#### 字段规则

| 字段 | 新建 | 编辑 | 校验/行为 |
|---|---|---|---|
| 登录账号 `username` | 可输入 | 只读/禁用 | 必填；trim；格式与长度由后端既有规则决定；唯一性由数据库约束兜底 |
| 显示姓名 `displayName` | 可输入 | 可编辑 | 必填；去除首尾空格；限制长度；支持 Unicode 名称 |
| 角色 `roleIds` | 必须选择 | 可修改 | 真实 API 返回的角色 ID 多选；不传角色 code 或文本拼接值 |
| 状态 | 默认启用 | 建议在列表操作单独修改 | 避免在一次普通编辑中误停用账号；状态变更使用单独权限、确认与审计 |
| 密码 | 不提供普通明文输入框 | 不回显 | 继续沿用现有重置/首次改密机制；密码重置为独立操作 |
| 最近登录 | 不适用 | 只读（可选） | 仅辅助信息，不允许编辑 |

新建表单的 `username`、`displayName` 与角色选择应使用同一套设计组件。编辑时账号只读，避免因改变账号字符串影响唯一索引、历史审计和登录会话。

### 3.3 角色多选下拉组件

使用项目现有 UI 库的可访问多选 Select，或实现统一的 `RoleMultiSelect`；不要继续使用普通 TextInput，也不要自行发明逗号解析。

交互要求：

- 支持关键词搜索角色名称与 code。
- 选项展示：本地化名称、可选的简短描述；机器码可作为次级小字。
- 多选后在输入框下方或输入框内部以 Tag 展示，支持单项移除。
- 下拉弹层可使用键盘上下移动、Enter 选中、Escape 关闭；输入框有可访问 label。
- 已分配但当前操作者无权重新分配的角色，应保留可见并明确标记，不可静默从表单移除；具体是否允许只编辑其他字段由后端策略决定。
- `super_admin` 等特权角色须根据当前操作者的分配权限决定是否可选；不能只在前端硬编码禁选来实现安全。
- 默认不自动给新用户赋予 `super_admin`；新建时默认空选，至少选择一个角色后才允许提交（如业务允许无角色用户，须修改本条并同步服务端规则）。
- 下拉框选项加载失败时，显示错误与重试，不得回退成自由文本输入。
- 没有可分配角色时显示“暂无可分配角色”，禁用提交并给出进入角色权限模块/联系管理员的提示。

## 4. 前端实现设计

### 4.1 推荐代码位置

请先确认当前真实应用目录和命名，以下按项目规划路径示例：

```text
apps/admin/src/
├── app/[locale]/users/page.tsx
├── features/users/
│   ├── api/users.api.ts
│   ├── api/roles.api.ts
│   ├── components/UserTable.tsx
│   ├── components/UserFormDialog.tsx
│   ├── components/RoleMultiSelect.tsx
│   ├── components/UserStatusActions.tsx
│   ├── hooks/useUsers.ts
│   ├── hooks/useAssignableRoles.ts
│   ├── schemas/user-form.schema.ts
│   └── types/user.types.ts
└── messages/
    ├── zh-CN.json
    └── en-US.json
```

不要为了遵循示例路径而新建第二个 Admin 应用；应修改当前路由实际使用的文件和已有 API client。

### 4.2 组件职责

- `UsersPage`：页面标题、筛选条件、列表、分页和操作权限。
- `UserTable`：负责行展示和触发 `onEdit(user)`，不直接承担 API 写入业务。
- `UserFormDialog`：统一新建/编辑表单、验证、加载角色、提交、错误展示。
- `RoleMultiSelect`：只接收结构化角色选项与选中 ID，不处理用户保存逻辑。
- `users.api.ts`：封装用户 CRUD 与状态/密码操作 API。
- `roles.api.ts`：封装角色列表/可分配角色 API。
- `useAssignableRoles`：加载角色列表、管理 loading/error、合理缓存和重试。
- `user-form.schema.ts`：使用项目现有校验库定义字段长度、必填、`roleIds` 数组规则；服务端校验仍是最终依据。

### 4.3 新建与编辑状态管理

表单状态建议结构：

```ts
type UserFormValues = {
  username: string;
  displayName: string;
  roleIds: string[];
};

type UserFormMode =
  | { mode: 'create' }
  | { mode: 'edit'; userId: string; initialUser: AdminUserListItem };
```

关键要求：

- 新建与编辑状态在打开时重新初始化，关闭/完成后清空残留状态，避免上一个用户的角色泄漏到下一个表单。
- 编辑打开时先使用列表已知数据提供即时初始值；若 GET detail 是项目标准模式，则加载详情后再完成初始化。保存时仍由服务端校验。
- 加载角色选项时只允许选择当前账号有权分配的角色。用户当前已有角色应与选项做完整对照，不能因为选项接口漏数据导致误清空关联。
- 保存过程中禁用提交按钮并防止重复请求。关闭弹窗时如表单已修改，提示是否放弃更改。
- API 返回字段错误时，将错误映射到相应表单项；其他错误使用统一 Toast/Alert 并保留用户输入。
- 编辑成功后关闭弹窗、刷新或精准更新当前列表缓存；不可在 UI 中先假定保存成功。

### 4.4 角色选项加载策略

推荐打开新建/编辑弹窗时调用角色 API，使用当前项目已有查询缓存库（如 TanStack Query）缓存短时间，避免每次打开都重复加载。不要为此引入新的请求库。

状态规则：

1. `loading`：选择器显示骨架/加载提示，提交禁用。
2. `success && options.length > 0`：可搜索、多选。
3. `success && options.length === 0`：显示空选项提示，提交禁用。
4. `error`：显示加载失败与“重试”；不能用输入框替代。
5. `403`：说明当前用户没有查看/分配角色的权限；不要显示特权角色信息。
6. `401`：沿用全局 Session 过期处理，跳转登录或提示重新登录。

角色选项缓存必须在用户角色权限发生变化后失效；如果缓存时间内发生角色停用/删除，后端保存仍需重新验证，返回可理解的冲突错误。

### 4.5 国际化文案 key

建议在既有翻译文件添加以下 key（命名可依项目现有规范调整，但禁止直接散落硬编码）：

```json
{
  "users": {
    "title": "用户管理",
    "create": "新建用户",
    "edit": "编辑用户",
    "loginAccount": "登录账号",
    "displayName": "显示姓名",
    "roles": "分配角色",
    "searchRoles": "搜索角色名称或编码",
    "rolesHelp": "角色决定该用户可执行的后台操作。",
    "rolesLoading": "正在加载角色…",
    "rolesLoadFailed": "角色加载失败，请重试。",
    "noAssignableRoles": "暂无可分配角色",
    "selectRoleRequired": "请至少选择一个角色。",
    "save": "保存",
    "createSuccess": "用户创建成功",
    "updateSuccess": "用户信息已更新",
    "discardChanges": "存在未保存的修改，确定放弃吗？"
  }
}
```

`en-US.json` 提供语义等价英文，例如 `Users`、`Create user`、`Edit user`、`Assigned roles`、`Search roles by name or code`。不得以 `locale === 'zh-CN'` 判断业务分支；locale 只用于文案和角色显示名解析。

## 5. 后端 API 设计

> 以下是推荐的逻辑契约，不代表现有项目路由必然如此。实施前先检查当前 Controller、OpenAPI/Swagger 和前端 API client；若已有等价端点，应复用现有端点并让行为满足本规范，不要创建重复接口。

### 5.1 角色选项

**推荐：** `GET /api/admin/roles/assignable`

权限：至少要求登录，并校验调用者具备查看用户角色分配选项的权限（可沿用项目已有 `admin.role.read`，或按现有命名体系调整）。

示例响应：

```json
{
  "data": [
    {
      "id": "role-uuid",
      "code": "sales",
      "nameKey": "roles.sales",
      "description": "Sales team access",
      "isSystem": false,
      "assignable": true
    }
  ]
}
```

契约注意：

- 仅返回当前操作者可分配的角色；`assignable` 是 UI 提示，不替代服务端二次校验。
- `nameKey` 由后台翻译资源解析，避免角色显示名只存在硬编码中。若现有系统已提供 locale-aware `displayName`，则复用该能力，不重复存储翻译。
- 使用 `id` 作为提交值；`code` 用于显示辅助信息和排查；不接受角色名称或 code 数组代替 ID，除非现有 API 契约已经固定为 code 且已做严格验证。
- 当前 Prisma 草案的 `Role` 有 `isSystem` 和 `nameKey`，没有 `enabled`/`assignable` 字段。第一版不要假设这些字段存在。角色是否可分配根据现有授权策略决定；只有产品明确需要角色停用/可分配开关时，才新增字段与迁移。
- 若角色数量受控，可一次性返回全部可分配项；如已有分页约定，需确保搜索能查到所有候选项，不能只加载第一页后误报“角色不存在”。

### 5.2 用户列表与详情

`GET /api/admin/users`（复用现有列表接口）应返回用户信息和结构化角色摘要，例如：

```json
{
  "id": "user-uuid",
  "username": "sales01",
  "displayName": "Alex",
  "status": "ACTIVE",
  "roles": [
    { "id": "role-uuid", "code": "sales", "nameKey": "roles.sales" }
  ],
  "lastLoginAt": "2026-10-15T18:28:23.000Z",
  "updatedAt": "2026-10-15T18:28:23.000Z"
}
```

- 列表不返回 `passwordHash`、临时密码、Session、内部敏感 token。
- 返回角色时优先使用 Prisma `select/include` 明确字段，避免直接返回整个 ORM 实体。
- 若现有列表没有角色关联，应通过 `userRoles -> role` 取得结构化角色摘要，避免 N+1 查询。

### 5.3 创建用户

`POST /api/admin/users`

请求：

```json
{
  "username": "sales01",
  "displayName": "Alex Chen",
  "roleIds": ["role-uuid-1", "role-uuid-2"]
}
```

建议响应：

```json
{
  "data": {
    "id": "user-uuid",
    "username": "sales01",
    "displayName": "Alex Chen",
    "status": "ACTIVE",
    "roles": []
  },
  "credentialSetup": {
    "delivery": "show_once",
    "temporaryPassword": "one-time-generated-value"
  }
}
```

安全要求：

- 如果当前创建流程不要求管理员输入初始密码，则由服务端生成高熵的一次性临时密码，数据库仅保存 Argon2id 等合规哈希，并设置 `mustChangePassword = true`；只在本次成功响应中展示一次，响应禁止缓存，审计日志不得保存明文。管理员需要通过安全渠道转交临时密码。
- 如果项目当前已有邀请/首次设置密码流程，复用现有流程，不再创建第二套临时密码逻辑。
- 用户名冲突返回 `409 USERNAME_ALREADY_EXISTS`，字段关联错误应被 UI 显示；不能只返回泛化 500。
- 服务端验证 `roleIds` 非空、去重、全部存在且调用者可分配。不得信任前端的 `assignable` 标志。
- 建立用户与 `UserRole` 关联、记录创建人/审计事件，应在短事务中完成。密码生成和哈希在服务层完成。

### 5.4 编辑用户

`PATCH /api/admin/users/:id`

请求：

```json
{
  "displayName": "Alex Chen",
  "roleIds": ["role-uuid-1", "role-uuid-2"],
  "expectedUpdatedAt": "2026-10-15T18:28:23.000Z"
}
```

`expectedUpdatedAt` 为推荐的乐观并发控制参数；如果当前项目已经采用 `version`、ETag/If-Match 或其他机制，应沿用现有方案。

规则：

- 普通编辑默认不允许修改 `username`、密码哈希、状态、创建时间或最近登录时间。
- 若只有显示姓名变更权限而没有角色分配权限，则前端不应发送 `roleIds`；服务端只允许更新有权修改的字段。若项目当前以整体 `admin.user.update` 权限管理，可先采用更简单的权限模型，但角色分配仍需独立业务校验。
- 当 `roleIds` 出现在请求中时，必须重新验证所有角色存在、当前仍可分配、调用者可授予，并执行防止移除最后有效超级管理员等检查。
- 同一事务中更新 `displayName`、替换 `UserRole` 关联和写入审计事件。角色列表应去重。
- `expectedUpdatedAt` 与数据库当前值不一致时返回 `409 USER_MODIFIED`，提示刷新后重试，避免覆盖其他管理员的更改。
- 更新成功后返回最新用户列表项，包括最新角色摘要与 `updatedAt`。

### 5.5 状态和密码操作

状态与密码继续作为独立操作，不混进通用编辑 DTO：

- `PATCH /api/admin/users/:id/status`：请求 `{ "status": "ACTIVE" | "DISABLED" }`。
- `POST /api/admin/users/:id/password-reset`：服务端生成随机凭据或按当前密码策略走重置流程；必须强制首次改密，且明文只可按既有安全方案展示一次。

如果项目已有不同路由，可保留现有路径。必须有对应的独立权限、确认操作与审计事件。

## 6. 后端服务与数据一致性

### 6.1 事务伪代码

以下为逻辑示意，需按实际 Prisma 版本和项目 Repository 封装改写：

```ts
await prisma.$transaction(async (tx) => {
  const user = await tx.adminUser.findUnique({
    where: { id: userId },
    include: { userRoles: { include: { role: true } } },
  });
  if (!user) throw new NotFoundException('USER_NOT_FOUND');

  // 1. 校验 expectedUpdatedAt / version
  // 2. 校验 actor 对该用户是否有更新权限
  // 3. 校验 roleIds 唯一、存在且 actor 可分配
  // 4. 校验不可移除/降权最后一名有效 super_admin 等约束

  await tx.adminUser.update({
    where: { id: userId },
    data: { displayName: normalizedDisplayName },
  });

  if (roleIdsWasProvided) {
    await tx.userRole.deleteMany({ where: { userId } });
    await tx.userRole.createMany({
      data: uniqueRoleIds.map((roleId) => ({ userId, roleId })),
    });
  }

  await tx.auditLog.create({ data: safeAuditPayload });
});
```

该代码只是事务边界示例，不能直接粘贴上线。生产实现需考虑角色关联为空时是否允许、审计表真实字段、并发保护、错误码映射与超级管理员规则。

### 6.2 角色变更约束

- 角色 ID 不存在、已不允许分配或操作者无权授予：返回 400/403/409 的明确业务错误，不允许静默忽略。
- 不允许通过修改普通用户把特权角色授予自己（除非该操作明确被特权策略允许并经过审计）。
- 不允许把系统最后一名有效超级管理员降权、停用或移除其最后的超级管理员角色。
- 需定义“有效超级管理员”为账号状态 ACTIVE 且具备系统超级管理员角色；并发修改时应使用事务锁/可串行化策略或可靠的计数保护，避免两个请求同时移除最后管理员。
- 用户角色变化后，若权限被缓存，必须使该用户相关权限缓存/会话权限快照失效；下一次请求应应用新权限。不能要求用户等到自然 TTL 到期。
- 每次角色变更的审计事件记录操作者、目标用户 ID、变更前后的角色 ID/code、requestId、时间；不得记录密码。

### 6.3 推荐错误码

| 错误码 | HTTP | UI 处理 |
|---|---:|---|
| `USER_NOT_FOUND` | 404 | 提示用户可能已被删除，刷新列表 |
| `USERNAME_ALREADY_EXISTS` | 409 | 登录账号字段显示“账号已存在” |
| `ROLE_NOT_FOUND` | 400/404 | 提示角色列表已变化，刷新角色后重试 |
| `ROLE_NOT_ASSIGNABLE` | 403/409 | 提示该角色不可分配，刷新后重新选择 |
| `FORBIDDEN` | 403 | 提示无权限，保留表单输入 |
| `USER_MODIFIED` | 409 | 提示数据已被其他管理员修改，重新加载 |
| `LAST_SUPER_ADMIN` | 409 | 解释不能移除/停用最后一名有效超级管理员 |
| `VALIDATION_FAILED` | 400/422 | 按字段展示错误 |
| `AUTH_EXPIRED` | 401 | 走全局登录过期处理 |

状态码应服从当前项目已有的统一异常标准，不要为相同语义制造多套格式。

## 7. RBAC 权限建议

优先复用当前 Permission 表与权限代码命名。若目前尚未定义，可参考：

| 权限代码 | 能力 |
|---|---|
| `admin.user.read` | 查看用户列表和详情 |
| `admin.user.create` | 创建后台用户 |
| `admin.user.update` | 修改用户显示信息 |
| `admin.user.role.assign` | 分配/移除用户角色 |
| `admin.user.status.update` | 启用或停用用户 |
| `admin.user.password.reset` | 重置用户密码 |
| `admin.role.read` | 获取角色/角色选择器数据 |

权限规则：

- 列表 API 校验 `admin.user.read`。
- 新建 API 校验 `admin.user.create` 和角色分配策略。
- 更新显示信息校验 `admin.user.update`；更新 `roleIds` 另校验 `admin.user.role.assign` 或项目统一策略中的等价能力。
- 角色选项 API 校验 `admin.role.read`，并且返回范围应受当前操作者能授予的角色限制。
- 状态、重置密码 API 独立检查对应权限。
- UI 根据权限隐藏/禁用操作只用于改善体验，服务端 Guard/Policy 必须再次校验。
- 超级管理员角色的授予/移除应设置更严格的策略与审计，而非仅依赖角色名称或前端 if 判断。

若当前项目将多个能力合并成较粗的权限代码，可以先不拆权限表，但必须把 API 的字段级变更限制与高权限角色策略落实到服务端，并在后续权限细化时保持兼容。

## 8. 数据库与迁移评估

当前基线 `database/prisma/schema.prisma` 已包含：

- `AdminUser`：`username`、`displayName`、`status`、`mustChangePassword`、`updatedAt` 等。
- `Role`：`id`、`code`、`nameKey`、`isSystem`。
- `UserRole`：`userId + roleId` 复合主键。
- `Permission` / `RolePermission`：权限关联。

因此，实现用户编辑与多选角色的基本功能**原则上不需要新增业务表**。首先检查真实数据库模型与现有迁移。如果实际模型缺失 `Role` 状态、可分配范围或用户版本号，只有在需求确认之后才补字段与迁移。

实施前执行：

```bash
# 按仓库实际 package manager 和路径执行
pnpm --filter api prisma:validate
pnpm --filter api prisma:generate
pnpm --filter api test
pnpm --filter admin typecheck
pnpm --filter admin test
```

以上是示例命令，须先查看 package.json 的真实 scripts，禁止直接假定这些命令在当前仓库已定义。

禁止只修改 `schema.prisma` 而不生成迁移；若未发生 schema 变化，明确记录“无数据库结构迁移”。

## 9. 审计与日志

至少记录：

- `admin_user.created`
- `admin_user.updated`
- `admin_user.roles_changed`
- `admin_user.status_changed`
- `admin_user.password_reset_requested`（不要写入密码）

审计数据建议包含 actor ID、target user ID、before/after 摘要、requestId、时间和结果。记录角色变化时优先存角色 ID 与 code 快照，方便角色后续改名后仍可追溯。普通日志不得包含临时密码、密码哈希、Cookie 或 Session token。

## 10. 测试方案

### 10.1 前端组件测试

| 编号 | 场景 | 预期结果 |
|---|---|---|
| FE-01 | 点击“新建用户” | 打开新建表单，账号/姓名为空，角色从 API 加载 |
| FE-02 | 角色选项加载中 | 显示加载状态，禁止提交 |
| FE-03 | 角色接口返回多个角色 | 能搜索、多选、取消选择，展示名称 Tag |
| FE-04 | 角色接口失败 | 显示错误和重试；不出现自由文本输入框 |
| FE-05 | 角色列表为空 | 显示空状态并禁用提交 |
| FE-06 | 点击列表“编辑” | 打开编辑表单并回填姓名、现有角色 ID |
| FE-07 | 编辑账号 | 账号字段为只读，不能修改 |
| FE-08 | 提交中连续点击 | 只发出一次写请求，按钮显示 loading |
| FE-09 | 保存返回字段验证错误 | 错误展示到相应字段，已填写内容保留 |
| FE-10 | 保存成功 | 关闭弹窗，列表行展示最新姓名与角色 |
| FE-11 | 中文/英文切换 | 标题、字段、按钮、空态、错误提示完成翻译 |
| FE-12 | 360px 手机宽度 | 弹窗/抽屉可用，底部按钮可见，不出现横向溢出 |

### 10.2 API/Service 测试

| 编号 | 场景 | 预期结果 |
|---|---|---|
| BE-01 | 未登录读取角色/用户 | 401 |
| BE-02 | 无 `admin.role.read` 读取角色选项 | 403 或按统一鉴权策略拒绝 |
| BE-03 | 创建时提交不存在的 roleId | 明确校验错误，不创建用户 |
| BE-04 | 创建时重复 roleId | 去重或拒绝，行为固定且有测试 |
| BE-05 | 创建时提交不可分配的高权限角色 | 403/409；数据库无用户或角色关联脏数据 |
| BE-06 | 更新显示姓名 | 姓名变更且原角色保留（当未提交 roleIds 时） |
| BE-07 | 更新 `roleIds` | 角色关联按预期原子替换，不产生重复关联 |
| BE-08 | 事务中审计写入失败 | 依审计一致性策略整体回滚或可靠补偿，不出现半完成状态 |
| BE-09 | 两名管理员并发编辑同一用户 | 乐观锁冲突可见，不静默覆盖 |
| BE-10 | 移除最后一名有效超级管理员 | 拒绝并返回 `LAST_SUPER_ADMIN` |
| BE-11 | 停用用户/角色缓存 | 目标用户新请求权限及时更新；禁用用户无法继续访问后台 API |
| BE-12 | 列表和详情响应检查 | 不返回 passwordHash、临时密码或 Session 信息 |

### 10.3 E2E 流程

1. 使用具有用户管理及角色分配权限的管理员登录。
2. 进入用户管理，新建一个销售用户，选择 `sales` 角色。
3. 验证创建结果：列表显示本地化角色名称；如当前创建流程返回一次性临时密码，只展示一次并标记需首次改密。
4. 点击该用户“编辑”，修改显示姓名，将角色从 `sales` 调整为 `sales + viewer` 并保存。
5. 刷新页面确认数据仍然正确；退出并以目标用户登录，验证权限变更已生效。
6. 使用无角色分配权限的管理员尝试直接调用 API 修改 `roleIds`，确认被服务端拒绝。
7. 验证停用、重置密码和最后一名超级管理员保护仍正常工作。

## 11. 实施步骤与交付清单

### Phase 0：现状勘察

- [ ] 查找 `/users` 页面及表格操作列。
- [ ] 查找新建弹窗、角色输入框和当前 `sales, viewer` 字符串解析代码。
- [ ] 查找现有 role list API、Role Controller/Service、RBAC Guard、审计逻辑。
- [ ] 查找项目 UI 库和已有 Select/Dialog/Form/DataTable 组件。
- [ ] 查清用户创建时的初始凭据策略及首次改密机制。
- [ ] 确认当前 Permission codes，避免新增重复权限。

### Phase 1：后端先行

- [ ] 确保角色选项 API 返回当前操作者允许分配的角色。
- [ ] 确保 create/update API 接收 `roleIds: string[]`，并对角色做服务端校验。
- [ ] 将用户资料和角色关联的写入封装到事务。
- [ ] 保护最后一名超级管理员与权限缓存失效。
- [ ] 增加业务错误码、审计事件和单元/集成测试。

### Phase 2：前端交互

- [ ] 用户列表新增编辑按钮，并按权限控制显示。
- [ ] 建立统一新建/编辑表单，编辑时正确回填字段。
- [ ] 将角色普通输入框替换为 API 多选下拉框。
- [ ] 增加 loading/error/empty/no-permission 状态。
- [ ] 成功后更新列表，失败时保留用户输入。
- [ ] 完成中英文翻译及响应式适配。

### Phase 3：回归与验收

- [ ] 运行 lint、typecheck、unit tests、integration tests、build。
- [ ] 完成上述 E2E 流程。
- [ ] 确认 API 请求和数据库中从未保存逗号拼接角色字符串。
- [ ] 确认所有高权限操作均由服务端授权。
- [ ] 复核审计日志不包含密码和 Session 等机密。
- [ ] 更新截图/操作手册与本文件中的实现差异。

## 12. Definition of Done（验收标准）

全部满足才可认为完成：

- 用户列表对有权限的操作者显示“编辑”入口。
- 创建和编辑使用统一表单；编辑时账号只读，姓名和角色可更新。
- 角色选择项来自真实角色 API，并以多选下拉 UI 展示；没有自由文本角色输入框和逗号解析逻辑。
- API 使用角色 ID 数组；所有角色由服务端重新验证，不能通过伪造请求越权赋予角色。
- 编辑后刷新页面数据仍准确；没有角色关联重复、意外清空或部分写入。
- 新建/编辑/状态/密码操作有清晰权限和审计事件。
- 中英双语、loading/error/empty/validation/conflict 状态完整。
- 最后一名有效超级管理员保护通过测试。
- `lint`、`typecheck`、相关自动化测试和构建通过；没法执行的检查在交付记录里说明原因。
- 若没有模型结构变化，明确记录“无需数据库迁移”；若有变化，包含经过验证的迁移和回滚方案。

## 13. 可直接交给 AI 编码助手的任务提示词

```text
请先阅读根目录 AGENTS.md，以及 docs/06-admin-public-ui-standard.md、
docs/07-backend-standard.md、docs/17-user-management-edit-role-selector.md。

目标：改造系统管理-用户管理页面。
1. 先搜索现有用户页面、角色 API、RBAC 权限、用户 Service、审计日志和 UI 组件，不要假设已有端点不存在，也不要重复创建模块。
2. 在用户列表操作列增加编辑按钮。
3. 新建/编辑共用表单；编辑时账号只读，显示姓名可编辑，角色可编辑。
4. 将当前以逗号分隔的角色自由文本输入框替换为角色 API 驱动的可搜索多选下拉框，提交 roleIds 数组；不得保留字符串解析回退。
5. 服务端校验角色存在和当前操作者是否可分配；用事务保存用户与 UserRole 关联；保护最后一名有效超级管理员；写审计事件；让权限缓存及时失效。
6. 保留现有密码重置和停用能力，不把它们塞进普通编辑请求。
7. 完成中英翻译、加载/失败/空状态、字段错误、保存中反馈和移动端布局。
8. 添加前端组件测试、后端单元/集成测试，并运行项目真实存在的 lint/typecheck/test/build scripts。
9. 不要只提交 UI 假实现。最终报告列出修改文件、接口变化、是否需要数据库迁移、执行过的测试及结果、未完成事项和风险。
```
