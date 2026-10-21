# B2B Inquiry Platform：产品图片布局与按钮完整显示优化方案

- 文档版本：v1.0
- 日期：2026-10-20
- 适用页面：前台产品目录页，例如 `/en-US/products?page=4`
- 目标：解决产品卡片中图片、产品信息和底部操作按钮布局不稳定，导致按钮被挤压、裁切、遮挡或显示不全的问题。
- 实施约束：本文件是可执行改造方案，不代表代码已修改或测试已通过。实施前必须检查仓库实际组件、样式体系、断点和测试命令，不要照搬示例类名。

## 1. 当前页面现象与问题定位

从当前打开的产品目录页可观察到：

- 目录以多列产品卡片展示图片、产品名称、SKU、标签/属性，以及 `View details` 和 `Add to inquiry` 两个主要操作。
- 产品标题、SKU、颜色说明、标签等内容长度并不一致；若卡片高度由内容自然撑开，卡片底部按钮可能在不同卡片中上下错位。
- 图片比例、容器高度或 `object-fit` 未统一时，图片区域会改变卡片内容区可用空间。
- 若卡片、图片容器或信息区使用了不恰当的固定高度、`overflow: hidden`、绝对定位或网格子项默认最小宽度，按钮可能被裁切或挤出卡片。
- 页面底部当前存在分页；本次改造不应破坏分页、筛选条件、询价清单或产品详情链接。

**重要：**仅凭页面可访问文本无法确认具体 CSS 根因。实施时应在浏览器中检查实际可视区域，并检查卡片 DOM、计算样式、控制台和响应式断点。不要未经验证就认定是某一条 CSS 导致。

## 2. 目标布局

### 2.1 产品卡片的纵向结构

每张卡片统一采用以下结构：

1. 图片区域：固定比例，完整占据卡片宽度。
2. 内容区域：徽标、标题、SKU/复制按钮、简短属性或标签。
3. 操作区域：`View details` 与 `Add to inquiry`，始终处于卡片底部且可完整点击。

卡片高度可由网格行统一，也可由内部 Flex 布局保证操作区底部对齐。优先采用 **卡片纵向 Flex + 内容区可伸展 + 操作区 `margin-top: auto`**，避免对整张卡片写死高度。

### 2.2 推荐桌面布局

- 宽屏：根据内容容器宽度使用 4 列或 3 列；列数应由 CSS Grid 的 `minmax()` 或项目现有断点决定。
- 中等宽度：3 列或 2 列，确保按钮文字不换行挤压。
- 手机：1 列或在足够宽时 2 列；若 2 列无法保证两个操作可读、可点，优先 1 列。
- 网格间距：横向、纵向统一，卡片之间留出足够呼吸空间；不要通过负 margin 让卡片重叠。

## 3. 图片区域规则

- 使用独立的图片容器控制比例，不要让原始图片尺寸决定整张卡片高度。
- 推荐产品图区域 `aspect-ratio: 1 / 1`；如现有素材以横图为主，可统一使用 `4 / 3`，但整页必须保持一致。
- 图片使用 `width: 100%`、`height: 100%`、`object-fit: contain`，以尽量完整展示玩具/产品；图片容器可用浅色中性或马卡龙底色。
- 图片区域 `position: relative` 可用于叠放 New、Featured 等徽标，但徽标不得覆盖产品关键细节或按钮。
- 图片区域不应包含卡片操作按钮；按钮应放在独立操作区，避免绝对定位覆盖图片或被图片裁切。
- 缺图和加载失败时使用固定尺寸的占位组件，确保卡片高度不跳动。
- 图片容器避免对内部内容使用会裁切徽标或焦点的 `overflow: hidden`；如果为圆角裁切确需 `overflow: hidden`，只应用于图片容器，不要套在整个卡片操作区外层。

## 4. 卡片结构与 CSS 实施建议

先找到实际产品卡片组件，按现有框架与 CSS 方案调整。以下为结构示意，类名需映射到仓库真实代码：

```tsx
<article className="product-card">
  <div className="product-card__media">
    <img src={imageUrl} alt={productName} />
    {/* 徽标放在媒体区域中，确保不遮挡产品主体 */}
  </div>

  <div className="product-card__body">
    <div className="product-card__badges">...</div>
    <h2 className="product-card__title">...</h2>
    <div className="product-card__sku">...</div>
    <div className="product-card__meta">...</div>
  </div>

  <div className="product-card__actions">
    <a href={detailUrl}>View details</a>
    <button type="button">Add to inquiry</button>
  </div>
</article>
```

CSS 方向示例：

```css
.product-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1.25rem;
  align-items: stretch;
}

.product-card {
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--product-card-border, #eadfea);
  border-radius: 1rem;
  background: #fff;
  overflow: visible;
}

.product-card__media {
  position: relative;
  aspect-ratio: 1 / 1;
  width: 100%;
  flex: 0 0 auto;
  overflow: hidden;
  border-radius: 1rem 1rem 0 0;
  background: #fff9f3;
}

.product-card__media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.product-card__body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
  padding: 1rem 1rem 0.75rem;
  flex: 1 1 auto;
}

.product-card__title {
  margin: 0;
  line-height: 1.4;
  overflow-wrap: anywhere;
  /* 可选：在设计确认后使用 line-clamp；完整名称需在详情页可见 */
}

.product-card__sku,
.product-card__meta {
  min-width: 0;
  overflow-wrap: anywhere;
}

.product-card__actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.625rem;
  padding: 0.75rem 1rem 1rem;
  margin-top: auto;
  align-items: stretch;
}

.product-card__actions > a,
.product-card__actions > button {
  box-sizing: border-box;
  min-width: 0;
  min-height: 44px;
  width: 100%;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.25;
  padding: 0.65rem 0.75rem;
}

@media (max-width: 1100px) {
  .product-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 800px) {
  .product-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.875rem; }
  .product-card__body { padding: 0.75rem 0.75rem 0.5rem; }
  .product-card__actions { padding: 0.625rem 0.75rem 0.75rem; gap: 0.5rem; }
}

@media (max-width: 520px) {
  /* 若两个按钮在窄屏中无法清晰显示，改为纵向堆叠，不要强行压缩 */
  .product-grid { grid-template-columns: 1fr; }
  .product-card__actions { grid-template-columns: 1fr; }
}
```

### 4.1 使用说明

- 示例仅说明实现方向，必须先确认项目使用 CSS Modules、Tailwind、styled-components 还是全局 CSS，并遵守现有规范。
- 如果项目已经有设计 token，优先复用 token，不要新增同义变量。
- 若使用 Tailwind，将上述规则转换为对应 utility class，并检查 `min-w-0`、`flex-1`、`mt-auto`、`grid-cols-*` 等规则是否作用于正确节点。
- 不要直接在未知组件中复制粘贴示例；避免破坏现有交互和国际化。

## 5. 按钮布局与交互规则

### 5.1 桌面与平板

- `View details` 和 `Add to inquiry` 两个按钮应在卡片底部同一行，宽度相近。
- 两个按钮使用 `min-width: 0`，防止 Grid/Flex 子项默认最小内容宽度撑开容器。
- 按钮最小高度建议 44px；图标与文本之间留出间距。
- 文字过长时允许自然换行，不要使用固定高度 + `overflow: hidden` 截断文字。
- 所有卡片的操作区域应有一致的左右内边距。

### 5.2 手机窄屏

- 若两按钮并排后文本被挤压、发生重叠或触控区域不足，切换为纵向堆叠。
- 不得通过把字体缩得过小、缩短到含糊不清或让按钮溢出卡片来维持并排布局。
- 点击后要有清楚的加载、成功、已加入和失败反馈；加入询价清单时避免整张卡片被点击事件拦截。

### 5.3 防止常见布局错误

重点排查：

- 卡片设置固定 `height`，但标题、属性和按钮文本可能换行。
- 操作按钮设置 `position: absolute; bottom: ...`，但父容器没有正确定位或底部没有预留空间。
- 卡片或其祖先容器设置 `overflow: hidden/clip`，裁掉按钮阴影、焦点框或按钮下半部分。
- Grid 子项缺少 `min-width: 0`，长标题或 SKU 撑破列宽。
- 按钮设置 `height` 而非 `min-height`，且 `line-height`/padding 叠加后超出内容盒。
- 图片采用固定像素高度，响应式宽度变化时出现图片区域比例不一致。
- 媒体查询只调整网格列数，没有同步调整按钮排列。
- 产品卡片整体可点击，内部又放链接和按钮，导致点击事件冲突或无障碍语义不正确。

## 6. 马卡龙视觉规范

延续产品目录页轻柔、可爱但清晰的视觉方向：

| 用途 | 建议颜色 |
|---|---|
| 页面背景 | `#FFF9F3` |
| 卡片背景 | `#FFFFFF` |
| 主按钮 | `#7455A6` |
| 主按钮 hover | `#60428F` |
| 柔粉强调底色 | `#FCE7EF` |
| 薄荷绿辅助底色 | `#CDEFE1` |
| 奶油黄辅助底色 | `#FFE5A3` |
| 淡紫辅助底色 | `#DCD7FF` |
| 边框 | `#E9DFE8` |
| 正文 | `#433B49` |
| 次级文字 | `#746B79` |

- 主要 CTA 使用高对比主色；浅粉、薄荷绿、奶油黄用于徽标或轻量背景，不应用浅色作为小字号文字颜色。
- 按钮 hover、focus-visible、disabled、loading、success 状态必须可辨识。
- 键盘焦点轮廓不可被裁切；不要为了圆角视觉而对整个卡片设置会裁切焦点的 overflow。
- 颜色必须通过对比度检查；如达不到可读性要求，优先调整文字/边框颜色而不是降低字体大小。

## 7. 响应式验收断点

至少在以下视口尺寸验证，具体断点可按项目现有标准微调：

| 设备场景 | 参考视口 | 验收重点 |
|---|---:|---|
| 大桌面 | 1440 × 900 | 多列对齐，按钮同一行完整显示 |
| 普通笔记本 | 1280 × 800 | 长标题不挤压按钮，列间距合理 |
| 平板横屏 | 1024 × 768 | 网格列数与按钮宽度协调 |
| 平板竖屏 | 768 × 1024 | 无横向溢出，按钮可点击 |
| 大手机 | 430 × 932 | 标题、SKU、按钮完整显示 |
| 小手机 | 375 × 812 | 按钮必要时纵向堆叠，无截断/重叠 |
| 极窄屏 | 320 × 700 | 无水平滚动条，文字与 CTA 不被裁切 |

## 8. 实施步骤（按顺序执行）

### P0：定位与修复按钮显示不全

1. 在当前产品目录页定位产品卡片组件、图片容器、内容容器和按钮区域。
2. 在至少一张出现问题的卡片上检查 Computed Styles：卡片高度、`overflow`、`display`、`flex/grid`、按钮 `height/min-height`、`min-width`、padding、line-height、定位方式。
3. 检查长标题、SKU、颜色/标签较多的卡片，以及最后一行产品卡片。
4. 将卡片整理为媒体区、内容区、操作区三个独立区域。
5. 移除导致按钮被裁切的固定高度/错误绝对定位；如确有固定高度需求，必须保证内容区与操作区有足够空间，但首选弹性布局。
6. 给卡片和 Grid 子项设置 `min-width: 0`；操作区使用 Flex 或 Grid，窄屏切换为纵向排列。
7. 图片区域固定宽高比，使用 `object-fit: contain`，确保图片加载前后布局稳定。
8. 验证按钮在 loading、disabled、加入成功/失败状态下仍完整显示。

### P1：统一卡片视觉与信息密度

1. 统一图片比例、圆角、卡片边框、内容内边距和操作区高度。
2. 标题可在卡片中限制显示行数以保持整齐，但必须通过详情页或辅助文本保留完整名称；不允许把按钮挤出卡片。
3. SKU 和复制按钮使用可收缩布局；复制图标保留可访问名称与反馈。
4. 徽标仅在图片区域合理叠放，避免遮住产品主体。
5. 统一马卡龙色彩 token 与按钮状态。

### P2：体验、可访问性与性能

1. 图片设置合适的 `alt`；装饰性图片使用正确的空 alt。
2. 对按钮、链接提供清晰可见的 `:focus-visible` 状态。
3. 检查图片懒加载不会造成卡片跳动，必要时为图片容器设置稳定比例。
4. 检查键盘 Tab 顺序：产品详情链接与加入询价按钮均能独立访问。
5. 检查页面缩放到 200% 时操作仍可使用。

## 9. 测试清单

### 功能回归

- [ ] `View details` 始终可见、完整可点击，并进入对应产品详情。
- [ ] `Add to inquiry` 始终可见、完整可点击，且加入的是正确产品。
- [ ] 加入询价清单后数量、状态反馈正确；重复添加遵循现有业务规则。
- [ ] SKU 复制按钮不会与卡片或详情链接产生点击冲突。
- [ ] 图片加载成功、加载中、加载失败时卡片结构稳定。
- [ ] New、Featured、Pre-order 等徽标不遮挡按钮或关键图片内容。
- [ ] 分页、排序、分类筛选、标签筛选和查询参数保持正常。
- [ ] 前台不显示产品价格。
- [ ] 英文与中文界面中的长文本不会导致按钮被裁切。

### 视觉与响应式

- [ ] 所有卡片的图片区域比例一致。
- [ ] 同一网格行中的按钮底部对齐。
- [ ] 标题较长、SKU 较长、属性较多时无溢出、重叠、裁切。
- [ ] 在第 7 节列出的视口尺寸中没有横向滚动条（页面本身业务需要除外）。
- [ ] 320px 宽度下 CTA 仍完整；需要时按钮纵向堆叠。
- [ ] Hover、focus、disabled、loading 状态均可辨识。

### 自动化测试建议

- 使用项目已有的 Playwright/Cypress 测试框架；若未安装，不要为了单个 CSS 修复擅自新增大型测试依赖。
- 可在现有 E2E 中加入按钮可见性和边界检查，例如：

```ts
const actions = page.locator('[data-testid="product-card-actions"]');
await expect(actions.first()).toBeVisible();
await expect(actions.first().getByRole('link', { name: /view details/i })).toBeVisible();
await expect(actions.first().getByRole('button', { name: /add to inquiry/i })).toBeVisible();
```

- 如项目尚无对应 `data-testid`，优先使用稳定且语义化的 role/name 定位；不要为示例而随意添加重复或不稳定的测试选择器。
- 运行仓库已有的 lint、typecheck、unit/E2E 命令，并记录真实结果。不要编造命令或报告通过。

## 10. 完成标准

满足以下全部条件才可视为完成：

1. 产品卡片中的两个操作按钮在目标视口下均完整显示，不被图片、卡片边界或相邻内容裁切。
2. 长标题、SKU、标签/属性和多语言文本不会撑破卡片或造成横向溢出。
3. 图片比例稳定，图片加载状态不会使按钮位置明显跳动。
4. 桌面端按钮对齐；窄屏下按钮可在必要时纵向堆叠，点击区域清晰。
5. 产品详情、询价清单、SKU 复制、分页、筛选、排序功能回归正常。
6. 没有引入价格显示、权限或业务逻辑回归。
7. 完成代码检查和相关测试，并在交付说明中列出修改文件、测试命令/结果和未解决风险。

## 11. 开发交付模板

实施完成后按以下格式汇报：

- **根因**：根据实际 DOM/CSS 检查确认，不写推测为事实。
- **修改文件**：列出真实路径和修改目的。
- **布局调整**：图片比例、卡片结构、按钮布局、响应式断点。
- **测试**：列出实际执行的命令与结果；未执行的明确说明。
- **人工验收**：列出验证过的视口尺寸与关键场景。
- **遗留事项**：明确未完成项和风险。

---

**实施原则：**优先修正卡片内部布局结构和溢出规则，而不是简单地放大整张卡片或缩小按钮文字。产品图、产品信息和操作区应各自承担明确职责，确保询盘按钮在所有设备上都稳定可见。
