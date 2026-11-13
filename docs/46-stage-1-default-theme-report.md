# DOC-46 阶段 1 验收报告 — Default Theme Token 与视觉基础

> 任务书：`docs/46-storefront-brand-visual-refresh-and-theme-system.md`
> 前置方案：`docs/46-stage-1-token-map-and-css-isolation-plan.md`
> 阶段 0 审计：`docs/46-stage-0-baseline-audit.md`
> 阶段：**阶段 1（Default Theme Token 与基础视觉系统）+ 前置导入链隔离**
> 状态：**PASS WITH NOTES**（代码与构建全部通过；截图证据受环境限制，见 §6）
> 边界：仅改动 `packages/ui/styles/*` 与 Storefront 入口导入；**未改组件结构、未改业务逻辑、未改 API、未新增/修改数据库迁移、未部署、未提交**。
> 停点：本阶段到此结束，**等待用户验收后再进入阶段 2（Hero）**。

---

## 1. 改动范围（文件清单）

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/ui/styles/storefront-entry.css` | 新增 | Storefront 专属样式入口：`tokens → base → components → storefront`，不含 `admin.css` |
| `apps/storefront/src/app/globals.css` | 修改（1 行） | 第 1 行导入由 `index.css` 改为 `storefront-entry.css`；后续 Storefront 局部样式未动 |
| `packages/ui/styles/tokens.css` | 修改 | 仅编辑 `--sf-*`（Storefront）段落：调整/新增 Default 主题 Token |
| `packages/ui/styles/storefront.css` | 修改 | 将散落硬编码 RGBA 通道对齐到新 Token 值；不改结构、不改选择器、不改布局 |
| `docs/46-stage-0-baseline-audit.md` | 新增（阶段 0） | 基线审计（阶段 0 交付物） |
| `docs/46-stage-1-token-map-and-css-isolation-plan.md` | 新增 | Token 映射表与导入链隔离方案 |
| `docs/46-stage-1-default-theme-report.md` | 新增 | 本报告 |

未改动（刻意保持）：`packages/ui/styles/index.css`、`apps/admin/src/app/globals.css`、所有共享 `--color-* / --radius-* / --space-* / --text-* / --shadow-*` Token。

---

## 2. Default 主题 Token 落地明细

仅 `tokens.css` 的 Storefront 段落（`--sf-*`）发生变化，最终值如下：

| Token | 阶段 1 最终值 | 动作 | 说明 |
|---|---|---|---|
| `--sf-color-page` | `#fff8f0` | 调整 | 页面底色 |
| `--sf-color-ink` | `#352b3a` | 调整 | 标题/正文，对比度约 12.8:1 |
| `--sf-color-ink-soft` | `#665a68` | 调整 | 次级文字，约 6.18:1 |
| `--sf-color-muted` | `#766b7a` | 调整 | 弱化文字，约 4.80:1（满足 AA） |
| `--sf-color-line` | `#f0e5de` | 调整 | 柔和边框 |
| `--sf-color-primary` | `#ff716b` | **新增** | 品牌主色（主按钮/链接/选中态） |
| `--sf-color-primary-hover` | `#e95d59` | **新增** | 主色 hover |
| `--sf-color-on-primary` | `#352b3a` | **新增** | 主色上的前景色（白字仅 2.68:1，不达标，改用深色 ≈5.02:1） |
| `--sf-color-pink` | `#ffb8c6` | 调整 | 装饰色 |
| `--sf-color-mint` | `#bce9d2` | 调整 | 装饰色 |
| `--sf-color-butter` | `#ffe28a` | **新增** | 新语义名 |
| `--sf-color-butter-soft` | `var(--sf-color-yellow-soft)` | **新增** | alias 指向现有 `--sf-color-yellow-soft` |
| `--sf-color-lavender` | `#b9a6f5` | 调整 | 装饰色 |
| `--sf-radius-hero` | `32px` | **新增** | Hero 建议值（阶段 2 可复核） |

保留不变（兼容）：`--sf-color-page-deep`、`--sf-color-surface`、`--sf-color-line-strong`、`--sf-color-pink-soft`、`--sf-color-mint-soft`、`--sf-color-yellow`/`yellow-soft`、`--sf-color-lavender-soft`、`--sf-color-whatsapp*`、`--sf-color-footer`/`footer-soft`、`--sf-font-display`、`--sf-radius-card`、`--sf-radius-pill`、`--sf-shadow-card*`。

**对任务书建议值的偏离（1 处，需确认）：**
- `--sf-color-muted` 未采用 DOC-46 的 `#887D89`，改用 `#766b7a`。原因：`#887D89` 在 `#fff8f0` 上对比度不足 AA；改用 `#766b7a`（≈4.80:1）以满足“不要为了匹配色值牺牲可读性”的约束。

---

## 3. CSS 导入链隔离落地

| 入口 | 导入 | 结果 |
|---|---|---|
| `apps/storefront/src/app/globals.css` | `storefront-entry.css` | tokens → base → components → storefront（**不再加载 `admin.css`**） |
| `apps/admin/src/app/globals.css` | `index.css`（未改） | tokens → base → components → storefront → admin（结果与改动前一致） |

隔离验证证据：

- `apps/admin` 与 `packages/ui/styles/admin.css` 源码中 **无任何 `--sf-*` 引用**（`grep` 无结果），因此共享 `--sf-*` 值变化不会影响后台渲染。
- `admin.css` 选择器均以 `admin-*` / `.admin-shell` 隔离，Storefront 组件未使用这些类名，Storefront 去掉 `admin.css` 无回归。
- 构建产物确认：`apps/storefront/.next` 编译 CSS 中含 `--sf-color-primary:#ff716b`、`--sf-color-on-primary:#352b3a`、`--sf-color-butter:#ffe28a`。

> 说明：`index.css` 仍保留 `storefront.css` 以满足历史兼容（Admin 目前仍打包 Storefront 样式）。本阶段验收目标是“**视觉不污染**”，非“严格从 Admin 打包中剔除 Storefront 文件”。严格剔除留待后续如需单独引入 `admin-entry.css` 时评估。

---

## 4. 稳定性与安全保护

- **未触碰共享基础 Token**：`--color-* / --radius-* / --space-* / --text-* / --shadow-*` 全部保持原值。
- **未改组件/业务逻辑/API/迁移**：改动仅为 Token 值、导入路径和硬编码颜色通道对齐。
- **前台价格隔离不受影响**：本阶段不涉及 DTO、查询、SSR、HTML、JSON-LD、搜索索引或缓存。
- **装饰性例外（有意保留，非漏改）**：`storefront.css` 中少数与 Token 无直接对应的装饰色保留硬编码，例如 `line-strong rgba(227,210,198)`、黄色 `rgba(255,201,107)`、WhatsApp `rgba(11,122,59)`，以及三处深色 hover `#2f2734` / `#332b38`。这些属于与语义 Token 无一一映射的局部装饰/交互态，本阶段不强行归并，避免过度改动引发回归。

---

## 5. 验证结果（可复现）

| 检查 | 命令 | 结果 |
|---|---|---|
| UI 包构建 | `pnpm --filter @b2b/ui build` | ✅ 通过 |
| Storefront 类型检查 | `pnpm --filter @b2b/storefront typecheck` | ✅ 通过 |
| Admin 类型检查 | `pnpm --filter @b2b/admin typecheck` | ✅ 通过 |
| Storefront 测试 | `pnpm --filter @b2b/storefront test` | ✅ 通过（8 文件 / 36 用例） |
| Admin 测试 | `pnpm --filter @b2b/admin test` | ✅ 通过（28 文件 / 248 用例） |
| Storefront 生产构建 | `pnpm --filter @b2b/storefront build` | ✅ 通过（6/6 静态页） |
| Admin 生产构建 | `API_BASE_URL=http://localhost:4000 pnpm --filter @b2b/admin build` | ✅ 通过 |

> Admin 构建需要 `ADMIN_API_PROXY_TARGET` 或 `API_BASE_URL` 指向 API origin（`next.config.mjs` 的显式保护），本地以占位值满足门禁即可完成纯前端构建校验。

---

## 6. 视觉验证证据与限制

- 已通过静态证据确认 Token/隔离正确（§2、§3）。
- **未提供像素级截图证据**：本环境无 Playwright/Puppeteer 等浏览器自动化依赖（且未获批新增依赖），首页为运行时服务端渲染，缺少数据库与 API 无法离线渲染真实 Header/Hero/ProductCard/Buttons/Footer。
- 因此本阶段判定为 **PASS WITH NOTES**：代码、类型、测试、构建全部通过，视觉终验需在完整开发栈（DB + API + 双端 dev）下由用户确认。

**用户验收 runbook（建议）：**

1. `pnpm dev`（或 `pnpm run dev:run`）启动 DB 迁移、包构建与双端 dev。
2. Storefront 桌面与 360px：
   - 检查 Header（sticky、半透明底）、Hero（`--sf-color-ink` 标题、按钮）、ProductCard（边框/阴影）、主要按钮（hover 用 `--sf-color-primary-hover`）、Footer（深色收尾区）视觉是否与 Default 色板一致。
   - 确认无横向溢出、键盘焦点可见、图片 alt 正常。
3. Admin 桌面与 360px：确认后台外观与改动前**一致**（因无 `--sf-*` 引用，预期零视觉差异）。
4. 如有差异，回滚见 §7。

---

## 7. 风险与回滚

**风险：**
- 低：Token 值变化会同时影响 Storefront 全部页面观感，属于预期；若某页面观感不理想，按 Token 逐项回退即可。
- 低：Admin 仍打包 Storefront 样式文件，但无 `--sf-*` 消费，视觉无影响。

**回滚（成本最小）：**
- 导入入口回滚：把 `apps/storefront/src/app/globals.css` 第 1 行恢复为 `index.css`。
- Token 回滚：恢复 `tokens.css` 中对应 `--sf-*` 旧值（见 `git diff`）。
- 硬编码对齐回滚：恢复 `storefront.css` 对应行旧通道值。
- `storefront-entry.css` 可保留不引用，或与其它改动一并原子撤销。

---

## 8. Git / 部署状态

- 分支：`main`，基线 HEAD `78bf5a8`。
- 工作树：上述改动均为**未提交**的工作区改动；**未 commit、未 push、未部署、无数据库迁移**。
- 另有与本任务无关的既有 stash（`WIP on main: 75693f0`）**未被触碰**。

---

## 9. 停点

阶段 1（Default 主题 Token + 导入链隔离）已完成。请验收本报告；**获得确认后才进入阶段 2（Hero 视觉升级）**。DOC-45 商品去重与后台 Collection 缩略图 bug 均不在本阶段范围，另行按各自文档处理。
