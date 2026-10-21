# 16. 后台 Dashboard 布局修复与可折叠导航抽屉：设计和技术实施方案

> 文档版本：1.0  
> 适用路由：`/[locale]/login`、`/[locale]/dashboard` 以及所有受保护的后台页面  
> 当前问题：用户登录后进入运营总览页，侧边导航栏、面包屑和顶部工具栏有时完全不可见；不同截图中同一路径表现不一致。  
> 实施原则：**先修复统一 App Shell 的挂载与布局约束，再实现可开关导航；不得仅通过新增按钮或 CSS 临时遮挡来规避根因。**

---

## 1. 目标与非目标

### 1.1 目标

1. 登录成功后进入当前语言下的后台首页，例如 `zh-CN` 登录后进入 `/zh-CN/dashboard`，`en-US` 登录后进入 `/en-US/dashboard`。
2. 所有受保护的后台页面始终复用一个统一的后台应用框架（Admin App Shell）：左侧导航、顶部栏、面包屑、内容区。
3. 用户可以通过每个后台页面始终可见的菜单按钮显示/隐藏导航；导航状态不能造成页面空白、内容被覆盖或布局宽度计算错误。
4. 桌面端支持展开/收起或隐藏；平板端支持紧凑导航/抽屉；手机端使用遮罩抽屉。
5. 所有导航项由菜单配置和权限共同驱动，当前路由高亮正确；隐藏菜单不代替后端权限检查。
6. 中英双语文案、键盘操作、屏幕阅读器和响应式布局均可验收。

### 1.2 非目标

- 不重写 Dashboard 指标卡、统计 API 或图表业务逻辑；此任务先修复页面框架和导航交互。
- 不在本次改动中擅自更换 UI 框架、路由系统或状态管理库。
- 不将导航可见状态当作授权状态；API 仍必须按用户角色、权限独立校验。

---

## 2. 截图诊断与根因定位

### 2.1 可见问题

- 截图 A 中，左侧约 216px 宽的深色导航、顶部工具栏、面包屑均正常出现。
- 截图 B 的地址仍为 `/zh-CN/dashboard`，但左侧导航、顶部工具栏、面包屑全部消失，页面标题从浏览器内容区最左边开始；卡片布局也变得不同。
- 两张截图的差异不只是“侧栏收起”：截图 B 没有可用于重新打开导航的菜单按钮，也没有正常的 Admin Shell 顶部栏。

### 2.2 根因优先排查清单

按以下顺序排查，不要先改颜色或边距：

1. **路由是否共用同一 Layout：** `/[locale]/dashboard` 是否意外落在与其他后台页面不同的 layout、route group 或独立 page wrapper 中。
2. **条件渲染状态是否错误：** 是否使用 `isSidebarOpen && <Sidebar />` 并错误地把整个 Header / Shell 一起条件隐藏；是否在初始化时把 `isSidebarOpen` 默认设为 `false` 且没有提供打开按钮。
3. **CSS 是否误隐藏整层：** 检查 `display:none`、`visibility:hidden`、`opacity:0`、`transform:translateX(...)`、`hidden`、`md:hidden`、`lg:hidden`、`overflow:hidden` 和断点条件。
4. **布局容器是否分叉：** Dashboard 页面是否自带 `min-h-screen`、`width:100vw`、负 margin 或独立 `grid/flex`，绕开共享布局，造成 Sidebar 与 Header 未挂载或被覆盖。
5. **断点逻辑是否写反：** 检查 `window.innerWidth` 或 CSS breakpoint。桌面 1600px 不应该误进入移动端布局分支。
6. **Z-index / 定位问题：** 查 Sidebar、Header、main 的定位层级。若被内容区覆盖，需用 DevTools 检查 DOM 与 computed styles。
7. **刷新与导航差异：** 分别测试登录后跳转、直接输入 `/zh-CN/dashboard`、浏览器刷新和从其他管理页点击进入。

### 2.3 Debug 操作清单

- 浏览器 DevTools → Elements：确认 `<AdminLayout>`、`<AdminHeader>`、`<AdminSidebar>` 是否存在于 DOM。
- 如果 DOM 不存在：追查路由树、layout nesting 和条件渲染。
- 如果 DOM 存在但不可见：检查 computed `display / visibility / opacity / transform / width / position / z-index`。
- 浏览器 DevTools → Console：处理 React hydration warning、渲染异常和访问权限重定向循环。
- 浏览器 DevTools → Network：确认 Dashboard API 失败不会令整个 Shell 卸载；数据请求失败只显示局部错误状态。
- 增加临时开发日志时只输出路由、布局状态和断点，不输出 Session、Token 或客户隐私信息。

---

## 3. 页面架构与路由约定

### 3.1 统一后台应用框架

所有需登录的后台页面必须处在相同受保护 Layout 下。若项目使用 Next.js App Router，建议结构如下（如现有目录不同，按语义对应调整，不得为套结构而复制第二套 Shell）：

```text
apps/admin/app/
└── [locale]/
    ├── (auth)/
    │   └── login/
    │       └── page.tsx             # 独立登录页，不包含后台导航
    └── (admin)/
        ├── layout.tsx               # 唯一受保护后台 Shell
        ├── dashboard/
        │   └── page.tsx             # 只负责看板内容
        ├── products/
        ├── categories/
        ├── whatsapp-customers/
        └── ...
```

`(auth)`、`(admin)` 是路由组织示例。Route Group 名称不出现在 URL 中。若已有路由体系，优先复用现有共享布局，不复制 `AdminLayout`。

### 3.2 Shell 组件职责

```text
AdminLayout
├── AdminSidebar / AdminDrawer
│   ├── Brand / Workspace
│   ├── 菜单分组
│   └── 当前菜单高亮
├── AdminHeader
│   ├── MenuToggle（任何导航状态下都可见）
│   ├── Breadcrumbs / 页面标题上下文
│   ├── 语言切换（中文 / EN）
│   └── 用户菜单 / 退出登录
└── MainContent
    └── 当前后台路由页面
```

Dashboard 页面禁止重复渲染侧栏、顶栏、面包屑；它只输出看板主体内容。无论指标 API 成功、空数据、加载中或失败，Shell 都必须继续显示。

### 3.3 登录跳转和路由保护

- 登录成功：使用 router 的 replace 导航至 `/${locale}/dashboard`，保持用户当前语言。
- 登录失败：留在登录页，显示可理解的错误；不得先进入 Dashboard 再闪回登录页。
- 已登录访问登录页：重定向到对应语言的 Dashboard 或安全校验后的 `returnTo` 路由。
- 未登录访问受保护路由：重定向到 `/${locale}/login?returnTo=...`；`returnTo` 仅允许站内相对路径，拒绝外部 URL、`//host`、协议相对路径和危险 scheme。
- 不要硬编码只适用于 `zh-CN` 的跳转；locale 需来自路由参数或统一国际化配置。
- 服务端路由/API 必须验证 Session；仅在客户端隐藏页面不是安全边界。

---

## 4. 导航交互规格

### 4.1 状态模型

使用明确的导航状态，禁止由多个互相矛盾的 boolean 拼凑状态：

- `expanded`：桌面完整侧栏，显示图标和文字。
- `rail`：桌面紧凑侧栏，仅显示图标，图标需有 Tooltip 和可访问名称。
- `closed`：桌面完全隐藏侧栏，主内容占满可用宽度，但顶部菜单按钮仍保留。
- `mobile-open`：手机/窄屏抽屉打开，显示遮罩；这一状态仅在移动断点有效。

可以把桌面偏好简化为 `expanded | rail | closed`，移动抽屉使用独立的临时开关。不得把移动端抽屉的打开状态持久化，否则用户下一次打开页面可能被遮罩挡住。

### 4.2 行为表

| 场景 | 初始状态 | 点击菜单按钮 | 其他行为 |
|---|---|---|---|
| 桌面 ≥ 1280px | expanded | expanded → closed；closed → expanded | 可提供独立“收窄侧栏”按钮切换 rail；切换路由不应重置偏好 |
| 平板 768–1279px | rail 或 closed（二选一，建议 rail） | rail ↔ expanded；若空间不足可使用 drawer | 内容最小宽度不足时允许进入 drawer 模式，不可挤压表格到不可读 |
| 手机 360–767px | closed | 打开左侧 overlay drawer | 点击遮罩、选中导航、按 Escape 后关闭；打开时禁止背景滚动 |
| 任意尺寸进入 Dashboard | Shell 必须存在 | 可显示/隐藏导航 | 业务数据加载失败不得隐藏导航 |

推荐采用两类控件：顶部 `MenuToggle` 用于显示/隐藏；可选侧栏底部 `Collapse sidebar` 用于 expanded/rail 之间切换。若希望交互更简单，也可以桌面仅实现 expanded/closed，平板与手机使用 drawer。

### 4.3 交互细节

- `MenuToggle` 始终位于 Header 左侧，即使 Sidebar 为 `closed` 也不能随 Sidebar 一起消失。
- 按钮应设置 `aria-label`（例如 `Open navigation` / `Close navigation`）、`aria-expanded` 和 `aria-controls`。
- 点击导航后：桌面保留侧栏状态；移动端关闭抽屉并将焦点返回菜单按钮。
- 当前路由高亮：使用精确路由或路由段匹配；不能让 `/products/123` 误高亮多个不相关菜单。
- 二级菜单展开状态与侧栏开关状态独立；收窄到 rail 时二级菜单应通过 Tooltip/Popover 或点击弹层访问，不得无法访问。
- 支持键盘 Tab、Enter/Space、Escape；抽屉打开时焦点管理合理，关闭后焦点回到触发按钮。
- 动效建议 160–220ms，使用 transform/width 等低成本过渡；尊重 `prefers-reduced-motion`。
- 图标采用统一 icon 库，不以 emoji 作为主要导航图标。

---

## 5. 布局与设计 Token

### 5.1 尺寸建议

| 项目 | 建议值 |
|---|---:|
| 展开侧栏宽度 | 248px |
| Rail 紧凑侧栏宽度 | 72px |
| Header 高度 | 56px（桌面）/ 56px（移动） |
| 页面主内容左右内边距 | 桌面 24px；平板 20px；手机 16px |
| 页面内容最大宽度 | 看板可流式占满；表单类页面可根据场景设 max-width |
| Drawer 宽度 | `min(288px, calc(100vw - 56px))` |
| Overlay 层级 | 40 |
| Drawer / Sidebar 层级 | 50 |
| Header 层级 | 30；移动抽屉打开时低于 Overlay |
| Toast 层级 | 70 |

以上尺寸统一存放在设计 Token，不得按页面单独散落硬编码。Z-index 数值可根据现有系统层级规范映射，但必须形成单一层级表。

### 5.2 布局 CSS 参考

以下为实现示例，需根据项目 CSS Modules、Tailwind 或现有 CSS-in-JS 规范转写；不要同时引入第二套样式体系。

```css
:root {
  --admin-sidebar-expanded: 248px;
  --admin-sidebar-rail: 72px;
  --admin-header-height: 56px;
  --admin-page-padding: 24px;
  --admin-bg: #f5f7fa;
  --admin-surface: #ffffff;
  --admin-border: #e3e8ef;
  --admin-text: #17212b;
  --admin-muted: #64748b;
  --admin-brand: #126b5b;
  --z-header: 30;
  --z-overlay: 40;
  --z-drawer: 50;
  --z-toast: 70;
}

.admin-shell {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: var(--admin-sidebar-expanded) minmax(0, 1fr);
  grid-template-rows: var(--admin-header-height) minmax(0, 1fr);
  background: var(--admin-bg);
}
.admin-shell[data-sidebar="rail"] {
  grid-template-columns: var(--admin-sidebar-rail) minmax(0, 1fr);
}
.admin-shell[data-sidebar="closed"] {
  grid-template-columns: minmax(0, 1fr);
}
.admin-header {
  grid-row: 1;
  grid-column: 1 / -1;
  position: sticky;
  top: 0;
  z-index: var(--z-header);
  height: var(--admin-header-height);
}
.admin-sidebar {
  grid-row: 2;
  grid-column: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}
.admin-main {
  grid-row: 2;
  grid-column: -2 / -1;
  min-width: 0;
  padding: var(--admin-page-padding);
}

@media (max-width: 767px) {
  .admin-shell,
  .admin-shell[data-sidebar="rail"],
  .admin-shell[data-sidebar="closed"] {
    display: block;
  }
  .admin-main {
    padding: 16px;
  }
  .admin-sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: var(--z-drawer);
    width: min(288px, calc(100vw - 56px));
    height: 100dvh;
    transform: translateX(-100%);
    transition: transform 180ms ease;
  }
  .admin-sidebar[data-open="true"] {
    transform: translateX(0);
  }
  .admin-overlay[data-open="true"] {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    background: rgb(15 23 42 / 45%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .admin-sidebar { transition: none; }
}
```

**注意：** 上方 CSS 用于说明布局结构，不可原样盲贴。实际实现时需要校验 CSS Grid 的列/行定位和 Sidebar 在桌面、移动端的 DOM 关系，确保 Header 与 Main 不被覆盖。更简单的现有 Flex 架构可以继续用 Flex，不必为应用 Grid 而重写项目。

### 5.3 关键布局约束

- 主内容容器必须有 `min-width: 0`，防止表格/长文本把布局撑破。
- 禁止将主内容宽度设为 `100vw` 后再叠加侧栏宽度；通常使用 `width: 100%` 或 grid `minmax(0, 1fr)`。
- 桌面侧栏关闭时，主内容左边缘从应用内容容器起点开始，不保留 248px 空白。
- 页面标题、面包屑、Header 不得被 `isSidebarOpen` 条件一并隐藏。
- `100dvh` 可用于适配移动浏览器动态视口；如项目需要兼容旧浏览器，提供 `100vh` fallback。
- 抽屉打开时禁止 body 背景滚动；关闭时恢复原值，避免遗留 `overflow:hidden`。

---

## 6. 状态持久化策略

建议保存用户的桌面侧栏偏好（`expanded | rail | closed`），让刷新后体验稳定。移动端每次进入页面默认关闭抽屉。

可选实现优先级：

1. 如果应用已有用户偏好接口，将该偏好绑定到当前管理员账户；避免跨设备状态不一致。
2. 否则使用已有的客户端持久化方案，Key 建议 `admin.sidebar.mode.v1`。
3. SSR 场景必须规避 Hydration Mismatch：不要让服务器首次输出 `closed`，客户端首次 render 又输出 `expanded`。可在首次挂载后读 localStorage，或用可安全读取的偏好 Cookie 让服务端和客户端首屏一致。
4. localStorage 读取失败（隐私模式/浏览器限制）时使用默认值，不得阻断后台操作。
5. 仅存显示偏好，不存认证 Token、权限列表或任何敏感业务数据。

---

## 7. 开发实施任务拆解

### P0：定位并修复 Shell 丢失

1. 检查 `/login`、`/dashboard` 的真实路由文件和 layout 继承链。
2. 保证所有后台受保护页面仅使用同一个 Admin Shell。
3. 移除 Dashboard 页面内重复/冲突的全屏容器和错误的 Sidebar 条件渲染。
4. 保证 API loading/error/empty 分支仅影响看板内容，不影响 Sidebar/Header。
5. 在登录成功后采用当前 locale 跳转到 Dashboard，直接刷新 Dashboard 同样保有 Shell。
6. 测试桌面 1600px：完整 Header + Sidebar + 面包屑始终出现。

### P1：实现导航开关与响应式抽屉

1. 创建或复用 `AdminSidebar`、`AdminHeader`、`MenuToggle`、`DrawerOverlay`。
2. 建立唯一状态源（例如 layout state/context），禁止 Header 和 Sidebar 各自维护互相冲突的 state。
3. 桌面支持 expanded/closed；可选 rail；移动端 drawer + overlay。
4. 补充 Escape、遮罩点击、导航跳转后关闭、焦点回归和禁止背景滚动。
5. 增加状态持久化和 hydration 处理。
6. 根据权限与菜单配置渲染菜单，同时保留服务端 RBAC。

### P2：视觉与体验优化

1. 统一品牌区、图标大小、菜单行高、分组标题、选中态、悬浮态、焦点态。
2. 建议导航项高度 40–44px，左右内边距 12–16px；一级分组间距 12–20px。
3. 当前项使用低饱和品牌色背景和清晰文字，不使用过度强烈的阴影/渐变。
4. Tooltip 在 rail 模式显示菜单名称；菜单长文本截断并保留完整可访问名称。
5. Header 保留菜单按钮、面包屑、语言切换和用户菜单；小屏将非高频项收入用户菜单。

---

## 8. 参考实现伪代码

以下展示状态职责，不绑定具体状态库。请依照项目现有 React/Next.js 版本、UI 组件库和命名规范实施。

```tsx
// AdminLayout：仅一个地方拥有侧栏状态
const [desktopMode, setDesktopMode] = useState<"expanded" | "rail" | "closed">("expanded");
const [mobileOpen, setMobileOpen] = useState(false);

// MenuToggle 永远在 AdminHeader 中，不放在 Sidebar 内
function onMenuToggle() {
  if (isMobile) {
    setMobileOpen((value) => !value);
    return;
  }
  setDesktopMode((mode) => (mode === "closed" ? "expanded" : "closed"));
}

// AdminSidebar 在桌面由 desktopMode 控制；手机由 mobileOpen 控制
// Dashboard page 只渲染 DashboardContent，不负责 mount/unmount 整个 Shell。
```

实施注意事项：

- `isMobile` 应由统一 breakpoint hook 或 CSS 媒体查询策略提供，避免组件间断点不一致。
- 事件处理函数、状态持久化和 resize 监听必须正确清理，避免重复订阅。
- 若使用 shadcn/ui、Radix 或现有 Drawer/Sheet 组件，优先复用其焦点管理和键盘支持；不要手写一个不完整的模态抽屉。
- `setDesktopMode` 不应在每次路由切换后重置。
- Dashboard 请求抛错时应显示局部 `ErrorState` 和重试按钮，Shell 保持可见。

---

## 9. 国际化、权限与菜单配置

- 导航标题统一来自菜单配置的 i18n key，例如 `nav.workspace`、`nav.dashboard`、`nav.products`、`nav.system.users`。
- 中文、英文文案分别维护在现有翻译资源（例如 `messages/zh-CN.json`、`messages/en-US.json`），不得在组件里用路径判断直接硬编码所有文字。
- 菜单配置可以声明 `key`、`href`、`icon`、`group`、`requiredPermission`、`children`。
- 客户端根据权限决定是否展示菜单；后端每个 API 仍需检查权限。
- 对没有菜单权限但直接输入 URL 的用户，服务端返回 403 或跳转无权限页，不能把隐藏菜单当安全措施。
- locale 切换时保留当前路由语义，例如 `/zh-CN/products` → `/en-US/products`；若对应翻译路由不存在，使用安全回退策略。

---

## 10. 测试方案与验收标准

### 10.1 功能验收

- [ ] `/zh-CN/login` 登录成功后进入 `/zh-CN/dashboard`；英文登录使用英文 locale。
- [ ] 未登录直接打开 Dashboard 会跳转登录页；登录后可返回被授权的目标页。
- [ ] 登录后 Dashboard 始终显示 Header、菜单按钮、面包屑（按现有信息架构）和侧栏/抽屉入口。
- [ ] 桌面点击菜单按钮可隐藏/重新打开导航，主内容无 248px 空白残留。
- [ ] 可选 rail 模式下所有菜单项仍可识别和访问。
- [ ] 移动端抽屉可打开；点击遮罩、选中菜单、按 Escape 会关闭；焦点回到按钮；背景不会滚动。
- [ ] 刷新和直接访问 Dashboard 不丢失 Shell；切换后台页面不会意外重置桌面状态。
- [ ] Dashboard API 加载中、无数据、报错时，Shell 不闪烁、不消失。
- [ ] 当前菜单高亮正确；多级菜单可展开；权限过滤和后端权限校验分别有效。
- [ ] 中英文切换后导航文案完整，较长英文菜单不会覆盖按钮或溢出。

### 10.2 视口回归

至少在以下尺寸检查截图并执行交互测试：

| 视口 | 预期 |
|---|---|
| 1600 × 900 | 展开侧栏、完整 Header、主内容从侧栏右侧开始；可隐藏并重新打开 |
| 1280 × 800 | 桌面布局正常，表格区可以使用足够宽度 |
| 1024 × 768 | 进入紧凑/可切换导航，内容不会被挤出视口 |
| 768 × 1024 | 平板交互可用，菜单和内容不互相覆盖 |
| 390 × 844 | 默认抽屉关闭；菜单按钮可见；打开后有遮罩和关闭行为 |
| 360 × 800 | 无非预期整页横向滚动；按钮可点击；文字可读 |

### 10.3 自动化测试建议

- 单元测试：桌面开关状态转换、移动抽屉状态、当前路由 active match、locale 跳转逻辑。
- 组件测试：MenuToggle aria 属性、Escape 关闭、overlay 点击关闭、导航项选择后关闭。
- E2E：`login → dashboard → hide sidebar → open sidebar → navigate → refresh`；覆盖中文和英文 locale。
- 权限用例：无权限菜单不可见，直接访问 API 仍被拒绝。
- Playwright 视口截图：1600px、1024px、390px；与已验收基准图做合理视觉回归。

### 10.4 Definition of Done

- [ ] 根因已经定位并记录，不是只加 CSS 隐藏/显示。
- [ ] Dashboard 与其他后台页复用统一 Shell。
- [ ] 登录跳转、直接访问、刷新和权限流程测试通过。
- [ ] 桌面、平板、手机行为达到本文件规格。
- [ ] Lint、TypeScript、相关单元/集成/E2E 测试和构建通过；未执行项需说明原因。
- [ ] 不引入第二套设计 Token，不增加未经批准的依赖。
- [ ] 交付说明包含改动文件、根因、测试命令、遗留风险和回滚办法。

---

## 11. 建议给 AI 编码助手的执行任务

```text
请先阅读根目录 AGENTS.md，以及 docs/06-admin-public-ui-standard.md 和
 docs/16-dashboard-layout-sidebar-fix.md。先检查现有 /[locale]/login、
 /[locale]/dashboard 的路由文件、共享 layout、Sidebar/Header 组件和相关 CSS，
 不要猜测或另建重复的 AdminLayout。

按 P0 → P1 顺序实施：先定位为什么同一个 /zh-CN/dashboard 会出现整套后台导航壳层
消失的情况，并修复所有受保护后台路由统一挂载 Shell；然后添加始终可见的菜单按钮，
 实现桌面端显示/隐藏、移动端遮罩抽屉、Escape/遮罩关闭、焦点管理和响应式布局。
 登录成功后按当前 locale 跳到对应 Dashboard。Dashboard 的 loading/error/empty 状态
 只影响内容区，不能卸载 Header/Sidebar。保留现有技术栈和设计 Token。

完成后运行项目中实际存在的 lint、typecheck、test、build 命令；新增或更新测试，
输出根因、变更文件列表、测试结果、手工验收步骤和回滚方式。禁止伪造测试通过结果。
```

## 12. 推荐落地结论

**优先级最高的是修复共享布局挂载问题。** 正确架构应保证：登录页独立；登录成功进入 Dashboard；Dashboard 位于受保护后台共享 Layout 中；Header 的菜单按钮永远可见；Sidebar 在桌面可以隐藏/恢复，在手机上表现为可关闭的抽屉。只要这条结构稳定，后续所有后台页面都会获得一致的导航体验，而不需要每个页面单独修复。
