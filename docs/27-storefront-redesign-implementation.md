# 前台页面优化实施记录

- **日期：** 2026-10-18
- **依据：** `docs/b2b-inquiry-platform-前台页面优化与技术改造执行手册.md`
- **范围：** `apps/storefront`、共享前台样式、公共询价消息契约
- **数据库迁移：** 无

## 1. 已实施内容

### 1.1 品牌与设计系统

- 新增前台专用 `--sf-*` 设计令牌：暖白页面、粉色/薄荷绿/黄色/薰衣草辅助色、圆润标题字体、20px 卡片圆角与高对比 WhatsApp 绿色。
- 共享后台视觉不受影响：前台令牌独立于原有 `--color-*` 令牌。
- 支持 `prefers-reduced-motion`，卡片与媒体悬停动效在减少动态效果时关闭。

### 1.2 Header / Footer

- Header 增加语言切换、WhatsApp CTA、搜索、询价入口与移动菜单。
- 语言切换保留当前 path 与 query string；移动菜单支持 Escape 关闭、路由变化后关闭。
- Footer 的联系方式、地址、标签和 WhatsApp 号码统一从公共站点配置读取。
- 明显的种子占位值（`sales@example.com`、`Add your company address`、连续零号码、`E2E Company` 等）不会作为真实客户信息展示。
- 占位值在进入 React 树前统一清洗，不会出现在可见页面或 RSC 序列化数据中。

### 1.3 国际化

- 新增完整 `zh-CN` 前台字典，不再静默回退英文。
- 导航、按钮、筛选、空状态、错误页、404、询价清单和产品详情文案均按 URL locale 输出。
- `html lang` 由 middleware 传入根布局，`/zh-CN` 与 `/en-US` 输出对应语言。
- 产品/分类名称继续使用 API 的内容翻译数据；SKU、slug、分类 ID 不随语言变化。

### 1.4 首页

- 首屏改为品牌主张 + 真实产品图组合 + 两个 CTA：浏览产品、WhatsApp 询价。
- CTA 不再错误地指向 FAQ。
- 分类只展示有公开产品的分类。
- Featured、New、Pre-order 区块按 SKU 去重，避免同一产品重复占据多个首页区块。
- 工厂区块仅在 About 内容可公开读取时显示，不使用虚构工厂规模、证书或奖项。
- 增加询价三步流程与最终转化区。

### 1.5 产品目录、分类与详情

- 产品目录增加结果数量、活动筛选 chip、清空搜索、移动筛选抽屉、稳定分页。
- 侧栏隐藏没有产品的空分类；分类树保留层级与真实计数。
- 分类页显示父级面包屑、子分类入口和真实产品结果。
- 产品卡改为“View details / Add to inquiry”，不再在卡片上直接打开单品 WhatsApp。
- 产品详情支持目标数量、图库、规格与包装分组；缺失字段不渲染空表格行。
- 修复详情页规格与包装面板重叠的布局问题。

### 1.6 询价清单与 WhatsApp

- 清单状态保持单一来源，浏览器本地持久化。
- 同一 SKU 重复加入时合并并累加数量；数量限制为 `1–999999` 的整数。
- 清单支持缩略图、数量增减、单项移除、清空和消息预览。
- 单品与批量消息统一由 `buildInquiryMessage` 构建，包含产品名、SKU、数量、公开产品链接。
- 中文页面生成中文预填消息；链接保留当前 locale。
- 点击 WhatsApp 只记录 `whatsapp_click`，不声称消息已发送。
- 消息长度超过批量上限时由 API 明确拒绝，不静默丢产品。

### 1.7 SEO 与错误状态

- 产品 JSON-LD 使用 `APP_BASE_URL` 生成公开 canonical URL，不再误用 API 主机。
- Sitemap 覆盖 `en-US` / `zh-CN`，并为首页、产品目录和产品详情提供语言替代链接。
- 404 与全局错误页按当前 URL locale 输出。

## 2. 公共数据与安全边界

- 前台继续只消费 `PublicProductCard` / `PublicProductDetail` 等无价格 DTO。
- 未新增任何后台接口、公开价格字段或前台价格渲染。
- 未修改 Prisma schema，无数据库迁移或回填。
- 询价数量仅用于 WhatsApp 消息生成，正式询盘记录仍以后续人工确认为准。

## 3. 验证结果

| 项目 | 实际命令 | 结果 |
|---|---|---|
| Lint | `pnpm run lint` | 通过 |
| Typecheck | `pnpm run typecheck` | 通过 |
| Tests | `pnpm run test` | 通过（API 168、Admin 151、Contracts 15、Storefront 4） |
| Build | `pnpm run build` | 通过（API、Admin、Storefront、Worker） |
| 价格泄漏检查 | 抓取产品详情 HTML 搜索 `pricecny` / `unitprice` / `"price"` | 未发现 |

---

## 4. 2026-10-20 按 v1.0 重设计方案补齐

### 4.1 本轮范围

依据 `docs/B2BInquiryPlatform前台重设计与可执行改造方案.md`，在既有 P0 视觉与询盘闭环上补齐以下内容：

- 新增公共内容页索引 `GET /api/v1/public/content/pages`，只返回已发布页面 slug/pageType，前台不再通过逐个探测页面产生 404。
- Header 导航调整为 Home / Products / Our Factory / Quality & Awards / About / Contact；工厂、品质与隐私入口仅在后台上线对应内容页后出现，不生成死链。
- Footer 同样按已发布状态显示工厂、品质与隐私链接；Categories、FAQ、询价清单仍可从页脚进入。
- 通用内容页支持 `about`、`contact`、`factory`、`quality`、`privacy`，使用统一面包屑、Hero、正文面板与 WhatsApp CTA；未填写正文时显示明确空状态，不伪造内容。
- 首页「Meet our factory」优先读取 `factory` 内容页，未上线时回退 `about`；从正文生成纯文本摘要，不使用虚构工厂规模、证书或奖项。
- 英文产品数量增加单数形式（`1 product` / `N products`），分类卡片与目录结果共用同一 helper。
- Sitemap 仅收录实际发布的内容页，避免 draft/缺失页面进入索引。

### 4.2 数据与安全

- 无 Prisma schema 变更、无数据库迁移。
- 前台继续只消费 public DTO；新增内容页索引只返回 `slug`、`pageType`，不包含草稿正文、内部设置或价格。
- 首页与产品详情 HTML 抽查未发现 `priceCny`、`unitPrice`、CNY 金额或内部报价字段。

### 4.3 验证结果

| 项目 | 结果 |
|---|---|
| Lint | `pnpm lint` 通过 |
| API tests | 169 项通过 |
| Storefront tests | 6 项通过（新增单复数与 HTML 摘要测试） |
| Storefront typecheck | 通过 |
| API / Storefront build | 通过（构建时本地 API 可访问） |
| HTTP smoke | `/en-US`、`/zh-CN`、`/en-US/products`、`/en-US/about`、`/en-US/contact` 均 200 |
| 条件页面 | 未发布的 `/en-US/factory`、`/en-US/privacy` 正确 404，导航不显示死链 |
| 内容索引 | `GET /public/content/pages` 返回 `about`、`contact`，无 404 探测日志 |

### 4.4 尚未覆盖

- 工厂照片/视频、证书/奖项的专用后台媒体管理需要扩展数据模型与后台 CRUD；本轮未新增重复表，也未用占位内容冒充。
- 真实内容需由运营在后台发布 `factory`、`quality`、`privacy` 页面后自动出现在导航、首页与 sitemap。

---

## 5. 2026-10-20 产品目录按钮、分页、分类树与标签筛选优化

### 5.1 根因与处理

- **重复搜索**：目录页侧栏和 Header 各有一个搜索表单。已移除目录内表单，Header 搜索成为唯一入口。
- **分类树只渲染两层**：原页面手动渲染根节点和第一层子节点。新增递归客户端树，支持任意深度、独立展开/折叠、选择节点、完整路径、搜索祖先自动展开和键盘可访问的 `aria-expanded`。
- **标签只取当前页前 6 个**：原标签来自当前页产品并截断。新增 `GET /public/tags`，按已发布商品聚合启用标签及数量；页面区分 Highlights（New/Featured/Pre-order）与运营 Tags，并支持展开全部。
- **Pre-order 语义统一**：首页 Presale 区域和目录 `preorder` 标签筛选均以 `preorder` 标签关系为准，不再额外要求生命周期为 `PREORDER`；产品详情和卡片同时按标签显示 Pre-order 徽标。
- **排序需额外提交**：改为选择后立即更新 URL，并重置页码。
- **分页只有上一页/下一页**：实现桌面编号分页、省略号、首末页禁用态；手机显示 `Page X of N`。非法页码自动重定向到有效页。
- **按钮文案不清**：产品卡 CTA 改为完整 `Add to inquiry`，复制 SKU 成功文案改为 `SKU copied`。

### 5.2 验收结果

- `/en-US/products?page=2`：200，显示 `Showing 13–24 of 54 products`、`Page 2 of 5` 和 1–5 页码。
- `tag=preorder` 返回 5 个已打标商品，其中包含生命周期为 `AVAILABLE` 但运营上标记为 `preorder` 的商品；公开标签接口 `preorder` 计数为 5。
- `demo-fasteners` 分类页显示选中路径、递归展开控件和标签 Highlights。
- 目录页 HTML 仅保留 1 个 Header 搜索输入；中英文标签、筛选和按钮正常。
- 产品目录 HTML 未发现 `priceCny`、`unitPrice` 或内部价格。
- API 176 项测试、Storefront 6 项测试、相关 ESLint/typecheck 与生产构建通过。

### 5.3 已知限制

- 标签筛选首期为单选；运营标签 OR 多选尚未实现。
- 分类树桌面 sidebar 与移动 Drawer 各保留一份展开/搜索 UI 状态，但筛选结果和 URL 状态共享。
- 产品图片比例、颜色对比度和 320–360px 实机布局仍需浏览器视觉回归；本轮完成代码与 HTML 级验证。
- 首页每个运营标签区域最多展示 12 个商品；更多商品通过区域右上角的标签筛选链接查看。
| 中文消息接口 | `POST /api/v1/public/inquiry-intents`，`locale=zh-CN`，数量 25 | 返回中文消息、数量与 locale 链接 |
| 浏览器验证 | 1440px 桌面与 390px 手机 | 首页、目录、详情、中文询价页可见；390px `scrollWidth === innerWidth` |

## 4. 已知事项与上线前核对

1. 当前开发数据库仍包含 `DEMO-*`、`QA-*` 和测试内容；前台没有硬编码这些数据，但生产发布前必须在后台清理或下架。
2. `E2E Company`、`sales@example.com`、`8613800000000` 等种子值已在公开展示层隐藏；正式品牌、邮箱、地址、电话和 WhatsApp 号码仍需业务方在全局设置中填写。
3. 工厂照片、视频、证书和奖项尚无独立公开数据模型；本次仅使用可公开读取的 About 文案，没有伪造证书或产能。
4. WhatsApp 点击无法确认消息是否真正发送，页面与埋点均不将点击表述为“询价已发送”。
5. 图片仍使用现有上传/存储与公共文件 URL；本次未更换 CDN 或存储方案。

## 5. 回滚方式

- 无数据库迁移，回滚以前台代码与共享前台样式文件为单位。
- 询价 API 新增字段为可选兼容字段；旧客户端仅传 `skus` 时仍可使用。
