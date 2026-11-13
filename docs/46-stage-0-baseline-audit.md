# DOC-46 阶段 0 — Baseline Audit & Implementation Plan

> 任务书：`docs/46-storefront-brand-visual-refresh-and-theme-system.md`
> 阶段：**阶段 0（Baseline Audit & Implementation Plan）**
> 状态：**PASS（审计完成，等待用户验收）**
> 约束：本阶段仅产出审计与计划文档，**未修改任何业务代码、未新增/修改数据库迁移、未部署、未提交**。

---

## 1. 仓库与 Git 基线

| 项目 | 值 |
|---|---|
| 分支 | `main` |
| HEAD commit | `78bf5a802dd19b5bea0bacc2d0fe2af7f100ab7e` |
| `git status --short` | 无输出（工作区干净，无未提交/未跟踪改动） |
| 工作树 | 无额外 worktree |
| 未提交更改覆盖 | 无（审计期间不改动仓库既有文件） |

> 审计开始前工作区干净。本阶段仅新增两份文档（见 §3），不影响任何既有源码。

---

## 2. 已定位的关键现状（组件 / API / Token / i18n 入口）

### 2.1 页面与组件

| 目标 | 实际位置 | 复用结论 |
|---|---|---|
| 首页入口 | `apps/storefront/src/app/[locale]/page.tsx` | 保留数据获取、SEO、广告优先级与区块顺序 |
| 首页商品区块 | `apps/storefront/src/components/homepage-product-section.tsx` | 保留 cursor/Load More/loading/error/retry |
| 商品卡片 | `apps/storefront/src/components/product-card.tsx` | 复用 `PublicProductCard`，不建平行数据模型 |
| Header | `apps/storefront/src/components/site-header.tsx` | 复用全站 Header，仅必要时微调 |
| Storefront CSS 组件样式 | `packages/ui/styles/storefront.css` | 统一组件与响应式样式（2535 行） |
| Storefront CSS 入口 | `apps/storefront/src/app/globals.css` | 现有导入链见 §4 |
| 设计 Token | `packages/ui/styles/tokens.css` | 仅改 `--sf-*` 命名空间（165 行） |

### 2.2 API / 数据（只读复用，本阶段不改动）

- Public 首页 DTO 不含内部价格，价格隔离继续成立。
- Homepage Collection / New Arrivals 的 cursor、去重、排序、缓存失效与展示数量规则以 **DOC-45** 为准。
- 图片路径沿用现有 R2 / MediaFrame / imageSrcSet，不新建图片 CDN 逻辑。
- 后台 Homepage 管理、Collection 商品选择与权限规则改写被禁止。

### 2.3 i18n

- 前台客户可见文案默认英文；后台文案走 `zh-CN` / `en-US` 翻译资源。
- 复用现有 Storefront i18n messages 与 URL locale（`/en-US`、`/zh-CN`）单一来源规则（AGENTS §O）。
- 不新增硬编码菜单/文案；不新增重复翻译表。

### 2.4 Token 现状

- 共享/Admin Token：`--color-*`（`tokens.css` 第 5–45 行），**任何阶段都不得修改**。
- Storefront 专用 Token：`--sf-*`（`tokens.css` 第 47–76 行），是本任务允许修改的唯一 token 命名空间。

---

## 3. 计划新增 / 修改的文件清单

### 3.1 阶段 0（本阶段，已交付）

| 文件 | 类型 | 理由 |
|---|---|---|
| `docs/46-stage-0-baseline-audit.md` | 新增 | 本审计报告 |
| `docs/46-stage-1-token-map-and-css-isolation-plan.md` | 新增 | Token 映射表 + CSS 导入链隔离方案 |

### 3.2 阶段 1 预登记文件（尚未改动，等待验收后执行）

| 文件 | 类型 | 计划改动 |
|---|---|---|
| `packages/ui/styles/tokens.css` | 修改 | 仅调整/新增 `--sf-*`，禁止改 `--color-*` |
| `packages/ui/styles/storefront.css` | 修改 | 统一 section/button/badge/card 基础样式 |
| `packages/ui/styles/storefront-entry.css` | 新增（待批） | Storefront 专用 CSS 入口（不含 admin.css） |
| `apps/storefront/src/app/globals.css` | 修改（待批） | 改指向 `storefront-entry.css` |
| `packages/ui/package.json` | 修改（待批） | 可选：新增 `./storefront-styles.css` export |

> 最终文件清单以用户验收本计划后为准；阶段 1 不触碰任何 `.tsx` 业务逻辑文件。

---

## 4. CSS 导入链现状（隔离方案详见阶段 1 计划文档）

- `packages/ui/styles/index.css` 顺序导入：`tokens.css → base.css → components.css → storefront.css → admin.css`。
- `apps/storefront/src/app/globals.css` 第 1 行与 `apps/admin/src/app/globals.css` 第 1 行**都**导入 `index.css`。
- 因此 **Admin 当前也会加载 `storefront.css` 与全部 `--sf-*` 规则**（在 `apps/admin/.next-dev/static/css/app/layout.css` 中得到确认；`.next` / `.next-dev` 为构建产物，审计 grep 时应忽略）。
- 源码级 `--sf-` 引用仅存在于 `packages/ui/styles/tokens.css`、`packages/ui/styles/storefront.css`、`apps/storefront/src/app/globals.css`；`base.css` / `components.css` / `admin.css` 与 `apps/admin/src` 内 **0 处** `--sf-` 引用。
- **硬约束**：`apps/storefront/src/lib/product-card-layout.spec.ts` 第 10 行以 `fileURLToPath` 直接读取 `packages/ui/styles/storefront.css`，因此该文件**不得移动或重命名**。

---

## 5. 与 DOC-45 的冲突检查与边界

| 维度 | DOC-46 本阶段边界 | 与 DOC-45 关系 |
|---|---|---|
| 首页区块顺序 | 不改顺序（Hero → New Arrivals → Collections → 工厂内容 → CTA/Footer） | 遵循 DOC-45，已冻结 |
| 分页 / cursor / Load More | 不改 | 以 DOC-45 为准 |
| 商品选择 key | 不改（唯一 `productId`） | DOC-45 §产品选择 |
| 价格隔离 | 继续保证公开 DTO/HTML/metadata 无价格 | 不可破坏 |
| SKU vs 商品 ID 去重不一致 | **移出本任务范围** | 见 §7 |

**结论**：DOC-46 的视觉升级与 DOC-45 的数据/业务规则无直接冲突；本阶段不触碰 DOC-45 相关实现。

---

## 6. 明确不在范围内（Out of Scope）

- 不新增/修改任何 API 合约、请求/响应字段或分页逻辑。
- 不新增/修改任何数据库结构或迁移。
- 不改商品、分类、SKU、库存、发布状态等商品业务。
- 不改 Inquiry / WhatsApp / 报价 / PI / CI 流程。
- 不改 RBAC、后台权限、审计。
- 不新增第三方 UI/动画依赖。
- 不自动部署任何环境。
- 不做主题持久化配置（阶段 5 之前不做）。

---

## 7. DOC-45 合规整改项（单独记录，不在本任务修复）

- **问题**：商品去重使用的 key（`sku` 与商品 ID）不一致，属 DOC-45 既有行为偏差，**不属于本次视觉升级核心任务**。
- **处理**：单独记录为 DOC-45 整改项；修复前须先确认：
  1. 对应 DTO 是否已包含商品 ID；
  2. 分页合并逻辑是否会因切换去重 key 而受影响。
- 本任务不做此修复，避免与 CSS/主题改造混在一起。

---

## 8. 阶段验收基线（供阶段 2–4 对比）

- 视口矩阵：**360 / 375 / 390 / 768 / 1024 / 1440px**。
- 关键页面：Storefront 首页、Header、Hero、ProductCard、Footer、以及全部 Storefront 路由。
- 关键功能：Search、Inquiry List（跨页选择/数量/移除/清空）、Copy SKU、Add to Inquiry、WhatsApp CTA、产品/分类/locale 路由、SEO canonical/OG。
- 性能基线（LCP / CLS）：待阶段 4 在真实/预览环境采集并注明环境。
- 无障碍基线：键盘可达、focus-visible、reduced-motion、对比度目标 WCAG 2.2 AA。

---

## 9. 业务保护确认

- 未修改任何业务代码。
- 未新增或执行数据库迁移。
- 未部署任何环境。
- 本阶段仅新增两份 `docs/` 文档。
- 价格隔离、RBAC、Inquiry、商品路由、分页、缓存规则均未受影响。

---

## 10. 风险与未完成项

| 风险 | 说明 | 缓解 |
|---|---|---|
| Admin 误载 Storefront CSS | 当前 `index.css` 被 Admin 复用，会加载 `storefront.css` | 阶段 1 通过 `storefront-entry.css` 隔离（见 §4 与阶段 1 计划文档） |
| 对比度 | DOC-46 `muted #887D89` 在白底约 2.9，**不满足 AA** | 阶段 1 采用 `--sf-color-muted #766B7A`（≈4.8），并自动校验 |
| 主按钮前景 | 白字压珊瑚 `#FF716B` ≈2.68，**不满足 AA** | 主按钮前景改用深色 `--sf-color-on-primary #352B3A`（≈5.02） |
| 无截图证据 | 本阶段未启动本地服务、未采集截图/DOM | 阶段 1 完成后补充桌面/手机截图与测试结果 |

---

## 11. 下一步（阶段 1 建议，不自动执行）

- 执行 `docs/46-stage-1-token-map-and-css-isolation-plan.md`：落地 Default 主题 Token 与 CSS 导入链隔离。
- 阶段 1 完成后按 DOC-46 §11 报告模板提交 Token 色板、桌面/手机截图与测试结果，等待验收。
- **商品目录缩略图 bug**：其修复触及 API/admin 业务代码，超出阶段 0 边界；建议作为审计通过后的独立改动单独验收（见 `docs/46-stage-1-token-map-and-css-isolation-plan.md` §5 调查记录）。
