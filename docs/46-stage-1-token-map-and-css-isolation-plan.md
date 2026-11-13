# DOC-46 阶段 1 前置方案 — Token 映射表与 CSS 导入链隔离

> 任务书：`docs/46-storefront-brand-visual-refresh-and-theme-system.md`
> 归属：**阶段 0 交付物（阶段 1 前置方案）**
> 状态：**方案已获用户确认；阶段 1 执行中**
> 执行记录：批次 1A（新增 `storefront-entry.css` 并切换 Storefront 入口）已完成，Admin 仍走 `index.css`。
> 边界：本文定义映射与隔离方案；阶段 1 只在 `tokens.css` 的 `--sf-*` 段落与 `storefront.css` 中落地 Default 主题色，不改组件、业务逻辑、API 或迁移。

---

## 1. 已采纳的三项决策

1. **增量迁移 Token**：保留全部现有 `--sf-*` 名称；只新增/调整首页视觉升级所需 Token。禁止修改 Admin 共享的 `--color-*`。
2. **阶段 1 只建设 Default Theme**：Hero、区块/ProductCard、移动端/无障碍/性能、主题注册表/Resolver、11 个节日主题分别留到阶段 2–6。
3. **DOC-45 去重问题移出本任务**：`sku` 与商品 ID 去重不一致单独记录为 DOC-45 整改项，不在本次视觉改造中修复。

阶段 1 的完成目标是“基础视觉系统稳定且不影响现有页面”，不是一次性完成整个主题系统。

---

## 2. Default Theme Token 映射表

### 2.1 映射原则

- 现有组件继续读取原 `--sf-*` 名称，避免大范围重命名和回归。
- 新语义优先使用 `--sf-color-<semantic>`；兼容色（如 yellow）保留为 alias 或继续原值。
- 只改 `packages/ui/styles/tokens.css` 中 Storefront 段落（当前第 47–76 行附近的 `--sf-*`）。
- 不修改第 5–45 行附近的 `--color-*` 共享 Token，不修改 `--radius-*`、`--space-*`、`--text-*`、`--shadow-*` 等 Admin 共用基础 Token。
- 组件不得新增散落色值；新增语义先进入 Token，再在阶段 2–3 的组件样式中消费。

### 2.2 核心色板与兼容映射

| 语义 Token | DOC-46 初始建议 | 当前实际值 | 阶段 1 动作 | 兼容/说明 |
|---|---|---|---|---|
| `--sf-color-page` | `#FFF8F0` | `#fff8f1` | 调整为 `#fff8f0` | 仅 Storefront |
| `--sf-color-page-deep` | 未给 | `#fff1e6` | 保留 | 现有兼容项 |
| `--sf-color-surface` | `#FFFFFF` | `#ffffff` | 保留 | 大小写统一即可 |
| `--sf-color-ink` | `#352B3A` | `#453b4a` | 调整为 `#352b3a` | 提升标题对比度 |
| `--sf-color-ink-soft` | `#665A68` | `#5f5364` | 调整为 `#665a68` | 次级文字 |
| `--sf-color-muted` | `#887D89` | `#786a7c` | 采用 `#766b7a` | DOC-46 建议值对比度不足，`#766b7a` 约 4.8:1 满足 AA |
| `--sf-color-line` | `#F0E5DE` | `#efe2d8` | 调整为 `#f0e5de` | 柔和边框 |
| `--sf-color-line-strong` | 未给 | `#e3d2c6` | 保留/按 line 派生 | 不新增组件专用色 |
| `--sf-color-primary` | `#FF716B` | **缺失** | 新增 `#ff716b` | 品牌主按钮、链接、选中态 |
| `--sf-color-primary-hover` | `#E95D59` | **缺失** | 新增 `#e95d59` | 主按钮 hover |
| `--sf-color-on-primary` | 未给 | **缺失** | 新增 `#352b3a` | 白字在珊瑚色上约 2.68:1，不满足 AA；深色前景约 5.02:1 |
| `--sf-color-pink` | `#FFB8C6` | `#f5b7cf` | 调整为 `#ffb8c6` | 装饰色 |
| `--sf-color-pink-soft` | 未给 | `#fde8f0` | 保留并复核 | 装饰色 |
| `--sf-color-mint` | `#BCE9D2` | `#bde9d0` | 调整为 `#bce9d2` | 装饰色 |
| `--sf-color-mint-soft` | 未给 | `#e7f7ee` | 保留并复核 | 装饰色 |
| `--sf-color-lavender` | `#B9A6F5` | `#c9c6ff` | 调整为 `#b9a6f5` | 装饰色 |
| `--sf-color-lavender-soft` | 未给 | `#efedff` | 保留并复核 | 装饰色 |
| `--sf-color-butter` | `#FFE28A` | **缺失** | 新增 `#ffe28a` | 新语义名 |
| `--sf-color-butter-soft` | 未给 | `#fff1d4` | 新增 alias 指向 `--sf-color-yellow-soft` | 供新样式使用 |
| `--sf-color-yellow` | 未单列 | `#ffc96b` | 保留 | 现有兼容名，不复用为 butter |
| `--sf-color-yellow-soft` | 未单列 | `#fff1d4` | 保留 | 现有兼容名 |
| `--sf-color-whatsapp` | 保留现有 WhatsApp 绿 | `#0b7a3b` | 保留 | 节日主题不得覆盖 |
| `--sf-color-whatsapp-hover` | 未给 | `#08632f` | 保留 | 专属 CTA |
| `--sf-color-whatsapp-soft` | 未给 | `#e6f7ed` | 保留 | 专属 CTA |
| `--sf-color-footer` | 保留/微调 | `#3e3345` | 保留，阶段 2 视首页效果再调 | 页面收尾对比区域 |
| `--sf-color-footer-soft` | 未给 | `#bdb2c2` | 保留 | Footer 次级文字 |
| `--sf-font-display` | 复用现有 | 已存在 | 保留 | 不引入新字体依赖 |
| `--sf-radius-card` | 18–24px | `20px` | 保留 | 在范围内 |
| `--sf-radius-pill` | pill 一致 | `999px` | 保留 | 按钮/标签 |
| `--sf-radius-hero` | 28–36px | **缺失** | 新增 `32px` | 仅 Hero 建议值，阶段 2 可复核 |
| `--sf-shadow-card` | 轻量阴影 | 已存在 | 保留 | 阶段 1 不重做阴影体系 |
| `--sf-shadow-card-hover` | 轻量阴影 | 已存在 | 保留 | 不加重玻璃拟态 |

### 2.3 对比度结论

| 组合 | 估算对比度 | 结论 |
|---|---|---|
| `#352b3a` on `#fff8f0` | 约 12.8:1 | 通过 AA |
| `#665a68` on `#fff8f0` | 约 6.18:1 | 通过 AA |
| `#766b7a` on `#fff8f0` | 约 4.80:1 | 通过 AA |
| `#ffffff` on `#ff716b` | 约 2.68:1 | 不通过，禁止用于主按钮文字 |
| `#352b3a` on `#ff716b` | 约 5.02:1 | 通过，作为 `on-primary` |

> `--sf-color-muted` 不采用 DOC-46 的 `#887D89`，原因是其达不到 AA；这是基于任务书“不要为了匹配色值牺牲可读性”的明确偏离，需在阶段 1 报告中标注。

### 2.4 明确禁止跨层修改

以下共享 Token 在阶段 1 保持不变：`--color-primary`、`--color-primary-hover`、`--color-text*`、`--color-surface*`、`--color-border*`、`--color-success/warning/danger/info`、`--color-whatsapp*`、`--color-hero-*`、`--radius-*`、`--space-*`、`--text-*`、`--shadow-*`。

---

## 3. CSS 导入链隔离方案

### 3.1 当前状态

| 入口 | 当前导入 | 结果 |
|---|---|---|
| `apps/storefront/src/app/globals.css` | `packages/ui/styles/index.css` | 加载 tokens、base、components、storefront、admin |
| `apps/admin/src/app/globals.css` | `packages/ui/styles/index.css` | 同样加载 storefront 与全部 `--sf-*` |

现状问题：Admin 会加载 Storefront 样式和 `--sf-*`，后续阶段一旦扩展 Storefront 规则，存在误污染后台的风险。

### 3.2 目标结构

新增 `packages/ui/styles/storefront-entry.css`，只按顺序导入：

```css
@import './tokens.css';
@import './base.css';
@import './components.css';
@import './storefront.css';
```

`apps/storefront/src/app/globals.css` 改为导入 `storefront-entry.css`；`apps/admin/src/app/globals.css` 继续导入 `index.css`。`index.css` 保持原五段顺序，不作为本阶段重构对象。

### 3.3 文件与兼容策略

| 文件 | 阶段 1 计划 | 兼容说明 |
|---|---|---|
| `packages/ui/styles/storefront-entry.css` | 新增 | Storefront 专属入口，不含 `admin.css` |
| `apps/storefront/src/app/globals.css` | 第 1 行改指向新入口 | 只改导入路径，不动后续 Storefront 局部样式 |
| `apps/admin/src/app/globals.css` | 不改 | 保持 Admin 现有加载结果 |
| `packages/ui/package.json` | 可选新增 `"./storefront-styles.css"` export | 不新增依赖；是否导出以实际导入方式为准 |
| `packages/ui/styles/index.css` | 本阶段不改 | 避免打破 Admin/兼容入口 |
| `packages/ui/styles/storefront.css` | **不得移动、不得重命名** | `apps/storefront/src/lib/product-card-layout.spec.ts` 直接按该路径读取文件 |

### 3.4 执行顺序

1. 先只新增 `storefront-entry.css`，不改任何视觉值，运行 Storefront typecheck/test 确认入口等价。
2. 切换 `apps/storefront/src/app/globals.css` 到新入口，检查 Admin 与 Storefront 构建产物各自包含的 CSS。
3. 隔离验证通过后，才在 `tokens.css` 内开始第一批 Token 调整。
4. 每批 Token 调整后检查 Header、Hero、ProductCard、Buttons、Footer。
5. 每批完成即记录证据；出现回归时只回退当前批次的 Token 或一行入口改动。

### 3.5 回滚

回滚成本为最小改动：

- 入口回滚：把 `apps/storefront/src/app/globals.css` 第 1 行恢复为 `index.css`。
- Token 回滚：按批次恢复对应 `--sf-*` 值；不改 Admin token，不影响后台。
- 新入口文件可保留但不再引用，或按同一变更原子撤销。

---

## 4. 阶段 1 批次建议（验收后才执行）

| 批次 | 内容 | 必查页面/组件 | 停点 |
|---|---|---|---|
| 1A | 新增入口并验证隔离 | Storefront 全路由 + Admin layout | 构建与样式无回归 |
| 1B | 核心颜色：page/surface/ink/line/muted | Header、Hero、ProductCard、Footer | 对比度与截图 |
| 1C | 主色：primary/hover/on-primary + butter | Buttons、链接、badge、focus | 键盘与 AA |
| 1D | 装饰色与 Hero radius | 首页区块、按钮、卡片 | 360px 无溢出 |
| 1E | 阶段 1 汇总证据 | Storefront/Admin 对照 | 提交报告等待验收 |

阶段 1 不做节日主题、不做 Hero 重设计、不做首页区块重构、不做商品数据逻辑改动。

---

## 5. 商品目录首页管理 Collection 缩略图 bug 调查记录（本阶段不修）

### 5.1 已核实链路

- 后台抽屉：`apps/admin/src/components/homepage-collection-drawer.tsx` 的 `ProductThumbnail` 在 `product.coverImageUrl` 为空时显示“无图片”。
- 前端映射：`apps/admin/src/lib/homepage-management-api.ts` 将 `product.productId` 映射为 `id`，`coverImageUrl` 原样透传。
- 服务端：`apps/api/src/modules/.../homepage-management.service.ts` 的 `resolveCollectionCoverImage` 会过滤 `deleteState === 'READY'`，优先 `isCover`，否则取最小 `sortOrder`。
- 序列化：`toProductSummary` 在存在封面文件时生成 `coverImageUrl`；有 `fileAssetId` 走 admin media preview，否则走公开 URL。
- 预览接口：`apps/api/src/modules/files/media.controller.ts` 的 `assets/:id/preview` 要求 `purpose === 'product-image'` 且 `status === 'ready'`，响应 `Cache-Control: private, no-store`。
- `ProductImage.deleteState` 默认值为大写 `READY`，当前过滤大小写与服务端一致，因此**大写/小写不是已确认根因**。

### 5.2 待审计通过后的运行时核查

1. 抓取真实 Collection GET 响应，确认 `coverImageUrl` 是空值、错误 URL，还是 URL 存在但请求被拒绝。
2. 检查真实 `ProductImage` 行的 `deleteState`、`isCover`、`fileAssetId`、`storageKey`。
3. 检查 Admin Next rewrite 是否覆盖 `/api/v1/admin/media/assets/:id/preview`，以及 Cookie 转发是否有效。
4. 检查浏览器请求的 401/403/404 与接口响应。
5. 检查关联 `FileAsset` 的 `status === 'ready'`、`purpose === 'product-image'`；历史/批量导入对象可能不满足预览接口条件。
6. 确认修复后补服务层封面优先级与抽屉渲染回归测试。

此问题触及 API/admin 业务代码，建议在阶段 0 验收后单独提交修复与验收，不混入阶段 1 的 Token/CSS 改动。

---

## 6. 本阶段交付与停点

本阶段只新增/更新 DOC-46 相关 `docs/` 文档，未修改业务代码。请用户验收本 Token 映射表和 CSS 导入链隔离方案；获得明确确认后才进入阶段 1。
