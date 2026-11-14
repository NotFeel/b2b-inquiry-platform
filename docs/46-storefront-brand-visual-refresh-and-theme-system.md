# DOC-46：Storefront 潮流玩具品牌首页视觉升级与节日主题系统实施任务书

> 仓库：`NotFeel/b2b-inquiry-platform`  
> 目标分支：`main`  
> 状态：设计与工程实施规范；本文件提交不代表前台代码已修改或上线  
> 视觉方向：Playful Premium × Trend-led Toy Brand  
> 首页展示：Mixed Hero / Balanced Product Density  
> 核心目标：先完成长期可用的 Default Theme，再以低改动成本扩展节日主题和年度潮流商品企划。

---

## 0. 已确认的产品决策（冻结）

### 0.1 视觉与品牌定位

- 主方向：**A — Playful Premium**。奶油白为基础，珊瑚色作为品牌行动色，搭配草莓粉、薄荷绿、薰衣草紫、奶油黄。
- 品牌气质：可爱但不幼稚、潮流但不廉价、精致但不冷淡。参考现代潮玩/DTC 品牌的编辑式排版、强商品摄影、系列化视觉语言；不得复制任何具体品牌 Logo、IP、插画或页面。
- 首页首屏：Mixed 商品组合，优先展示真实、当前已发布商品的多样化图片。
- 商品密度：Balanced。优先可读性和图片呈现，不追求首屏塞入最多商品。
- 前台主要转化：浏览商品 → 查看详情 / 添加至 Inquiry List → WhatsApp 询盘。不是在线零售结账网站。
- 前台客户可见文案默认英文；所有既有 locale 路由和翻译机制必须保留。

### 0.2 目标节日主题

首批主题配置必须覆盖：
1. Christmas
2. Halloween
3. Valentine's Day
4. Easter
5. Lunar New Year
6. Thanksgiving
7. Mid-Autumn Festival
8. New Year
9. Mother's Day
10. Back to School
11. Black Friday

主题配置应支持未来添加节日，不应将上述列表写死为唯一可选项。各市场节日适用性与日期由可配置的 campaign window 决定；不得假设所有访客都庆祝同一节日。

### 0.3 本次范围边界

本任务书指导分阶段实施，不授权一次性大规模重构。

- 本次先完成前台 Default Theme 和主题扩展架构。
- 本次不更改商品、分类、SKU、询盘、WhatsApp、报价、PI/CI 等业务规则。
- 不新增重复商品/分类/首页 Collection 数据模型。
- 不因主题功能而修改数据库；如实现前发现必须新增持久化配置，先提交技术决策和迁移方案，暂停等待批准。
- 不在本任务书执行时自动部署生产环境。
- 不新增第三方 UI/动画依赖，除非先说明必要性、体积、许可证和维护成本并获批准。

---



### 0.4 首页视觉架构冻结决策（2026-11-14，优先级高于旧版 Hero 草案）

用户已明确确认以下基础页面方向。本节与第 15 节是后续 AI 实施的权威依据；若本文旧章节仍出现 Mixed 四图拼贴、左右分栏 Hero 或非固定导航等旧描述，以本节和第 15 节为准。

- **Hero 主视觉：A — 品牌 Campaign 大图。** 使用一张具有完整摄影构图的宽幅品牌主视觉作为首屏核心，不再使用当前四张独立商品小图拼贴作为 Hero 主体。
- **导航：固定白色 Sticky Header。** 页面滚动时始终固定在视口顶部；初始和滚动状态均保持高可读性，不采用透明叠加在 Hero 上的导航方案。
- **桌面 Hero 高度：75–85vh。** 采用沉浸式大图首屏，具体高度以视口和内容可读性为准，不得遮挡标题、CTA 或导致下一内容区产生异常空白。
- **移动端采用独立构图。** 不得简单把桌面横图强行裁切成手机图；优先使用同一 Campaign 的移动端竖版/近方形裁切素材，或通过现有图片能力提供 art-directed source。
- **阶段门禁：** 阶段 0–3 已按此前阶段报告完成；本次仅冻结基础页面视觉架构并更新实施文档。**阶段 4（移动端/无障碍/性能专项）及阶段 5–6（主题系统）均不得因此自动启动。** 先按第 15 节完成首页架构设计规格和素材准备；视觉架构确认后，再由用户明确授权进入后续阶段。
- 本次决策只约束视觉和页面布局，不授权新增数据库模型、公开 API、后台配置能力、第三方依赖或生产部署。

## 1. 仓库现状审查基线（实施前再次核对）

本任务书制定时已读取 main 分支下列文件。AI 开发时必须重新读取最新版本，不能把本文件当作代码现状的永久替代：

- `AGENTS.md`
- `.agents/skills/frontend-ui/SKILL.md`
- `docs/01-product-requirements.md`
- `docs/06-admin-public-ui-standard.md`
- `docs/45-homepage-product-display-and-collections.md`
- `docs/45-stage-e-admin-homepage-ui-task-book.md`
- `apps/storefront/src/app/[locale]/page.tsx`
- `apps/storefront/src/components/homepage-product-section.tsx`
- `apps/storefront/src/components/product-card.tsx`
- `apps/storefront/src/components/site-header.tsx`
- `apps/storefront/src/components/site-shell.tsx`
- `apps/storefront/src/lib/homepage.ts`
- `apps/storefront/src/lib/homepage-actions.ts`
- `apps/storefront/src/app/globals.css`
- `packages/ui/styles/tokens.css`
- `packages/ui/styles/storefront.css`
- `packages/validation/src/homepage-management.ts`

### 1.1 已确认的现有实现

- Storefront 使用 Next.js 15、React 19、TypeScript；前台代码位于 `apps/storefront`。
- 首页入口是 `apps/storefront/src/app/[locale]/page.tsx`。
- 首页已读取 Site Config、Home Hero 广告、PublicHomepage、Home Sections；Hero 使用真实公开商品图片生成混合图片拼贴。
- 首页已有 New Arrivals 和管理员配置的 Homepage Collections；集合商品由 `HomepageProductSection` 加载，具有 cursor、Load More、loading/error/retry 状态。
- 商品卡片由 `ProductCard` 渲染，包含真实图片、状态标签、商品名称、SKU 复制、摘要、分类信息、详情链接和 Add to Inquiry。
- 已有公共价格隔离：`PublicProductCard` 不包含价格字段。任何新增 UI、数据投影、SSR props、metadata、缓存、HTML 均不得引入内部价格。
- 已有 Storefront 专用设计 Token：`packages/ui/styles/tokens.css` 中的 `--sf-*`；样式集中于 `packages/ui/styles/storefront.css`，入口 `apps/storefront/src/app/globals.css`。
- 已有后台 Homepage 管理能力和 `HomepageCollection` 配置；标题/副标题支持 en-US / zh-CN，商品和排序沿用既有 API 与 RBAC。
- 当前 Homepage Section 使用 pink/mint/yellow/lavender 四种局部色彩主题；可在现有机制上升级，不另建平行组件系统。
- 当前 Hero 标题/描述来自现有广告或 i18n 默认文案，Hero 图片来自公开首页商品 DTO；必须保留该数据优先级和安全边界。

### 1.2 必须遵守的既有首页内容顺序

遵循 DOC-45 已确认规则，不得与既有产品决策冲突：

1. 固定/Sticky 顶部导航（复用现有 Site Header / Layout）。
2. Hero 品牌与商品主视觉。
3. New Arrivals（首页第一个商品区域）。
4. Admin 配置的 Homepage Collections（按后台排序逐区展示）。
5. 工厂能力 / OEM / ODM 内容（保留有效内容、压缩文案）。
6. 询盘 CTA 与 Footer。

**禁止新增独立的全品类总览入口区块**，例如重复的“Shop by Collection”全品类卡片墙或第二套 Category Directory。产品导航仍可保留现有 Products 入口。每个已配置 Homepage Collection 继续作为自己的商品展示区。

### 1.3 既有业务约束不可破坏

- Homepage New Arrivals、Collection 的 API、cursor、去重、排序、缓存失效与展示数量规则以 DOC-45 为准。
- 24 是公开接口批次大小，不是管理员最终展示总数上限。
- Homepage Collection 商品选择、Category 关联和后台权限规则不得改写。
- Inquiry List 继续保留跨页面选择、数量、移除、清空等现有能力。
- WhatsApp 消息必须包含所有被选择 SKU，并遵循现有数量上限和 URL 编码规则；不能静默截断。
- Product URL、Category URL、locale URL、SEO canonical、Open Graph、sitemap、robots 保持有效。
- 前台任何位置不显示价格，不通过 CSS 隐藏价格字段。
- 不得把主题 ID、主题名称或装饰配置用于改变商品发布状态或业务可见性。

---

## 2. 设计系统：Default Theme v2

### 2.1 设计原则

1. Product-first：商品摄影是首屏和商品区的主要视觉内容。
2. Trend-agnostic：主题框架不绑定某一年某种具体玩具、颜色、卡通形象或 IP。
3. Brand-consistent：品牌基础色、排版、间距、卡片和交互在所有节日主题中一致。
4. Campaign-flexible：节日只改变允许变化的视觉 Token、装饰和活动 Banner，不复制页面。
5. Commerce-safe：视觉升级不改变询盘流程，不制造购物车/付款/价格暗示。
6. Content-driven：每年流行商品通过现有商品管理、标签、精选、新品和 Homepage Collection 配置更新，不需要改首页组件。
7. Mobile-first：Facebook 流量大量来自手机，必须从 360px 开始设计，再扩展到平板和桌面。

### 2.2 Default Theme 色板建议

以现有 `--sf-*` 命名空间扩展/调整，不得把 Storefront 主题颜色写入全局 Admin Token，也不得在各组件散落色值。

| Token 语义 | 初始建议 | 用途 |
|---|---|---|
| page | `#FFF8F0` | 温暖奶油白页面底色 |
| surface | `#FFFFFF` | 商品卡片和内容表面 |
| ink | `#352B3A` | 主文字，增强当前标题对比 |
| ink-soft | `#665A68` | 次级文字 |
| muted | `#887D89` | 辅助信息 |
| line | `#F0E5DE` | 柔和边框 |
| primary | `#FF716B` | 品牌主按钮、重点链接、选中状态 |
| primary-hover | `#E95D59` | 主按钮 hover |
| pink | `#FFB8C6` | 草莓粉系列装饰 |
| mint | `#BCE9D2` | 薄荷绿系列装饰 |
| lavender | `#B9A6F5` | 薰衣草紫系列装饰 |
| butter | `#FFE28A` | 奶油黄系列装饰 |
| whatsapp | 保留现有 WhatsApp 品牌绿 | WhatsApp 专属 CTA，不用品牌珊瑚色覆盖 |
| footer | 保留/微调深色品牌底 | 页面收尾和对比区域 |

以上为设计起点。实现前用现有商品图片和实际屏幕对比验证，颜色必须满足 WCAG 2.2 AA 对比度目标。不要为了完全匹配色值牺牲文字可读性。

### 2.3 字体、排版与圆角

- 优先复用当前 `--sf-font-display` 和全局字体，不引入大体积字体依赖。
- Display heading：重量 800–900，紧凑字距；正文保持正常字重和可读行高。
- Hero 桌面主标题建议 52–68px 流式字号；移动端 34–42px，最多 2–3 行。
- Homepage Section 标题桌面 38–52px，移动端 28–34px；不可使用固定大字号导致英文长标题溢出。
- 商品名称 15–18px，最多两行；SKU 11–12px；辅助说明 12–14px。
- 卡片圆角建议 18–24px；Hero 外框 28–36px；按钮主操作采用 pill 或 14–18px 圆角，保持一致。
- 阴影轻量化；避免所有卡片都使用厚重阴影或玻璃拟态。

### 2.4 主题 Token 分层

设计并实现明确的语义 Token，不要让组件直接读取具体节日色值：

- Brand tokens：品牌主色、正文色、页面/表面、边框、按钮。
- Component tokens：Hero、section、product card、badge、button 的语义样式。
- Campaign tokens：节日主题可覆盖的背景、主/辅色、装饰色、活动 Banner 和轻量装饰标识。
- Motion tokens：过渡时间和动效强度，并支持 `prefers-reduced-motion`。

节日主题只能覆盖允许覆盖的 token。不得覆盖 WhatsApp 品牌色、错误/成功状态语义色、focus ring 的可访问性规则或任何业务状态颜色。

---

## 3. 首页视觉与组件规范

### 3.1 Header / Navigation

复用现有 Site Header，不复制首页专属 Header。

- 桌面端保留品牌 Logo、Products、Factory、Quality、FAQ、搜索、Inquiry List、WhatsApp 等现有入口（以当前实际配置为准）。
- sticky 时使用不透明/高可读背景、细边框或轻微阴影；不能让 Hero 图片透过导航影响文字。
- 移动端保持 Logo、搜索、Inquiry 数量和菜单入口清晰；菜单按钮、抽屉和搜索行为不回归。
- 所有可交互触控目标至少 44×44 CSS px。
- 不增加全品类导航 mega-menu，除非另行评审。
- 验证所有 Storefront 路由，不仅首页。

### 3.2 Hero：Full-width Brand Campaign Editorial（冻结方向）

**本节已由 0.4 / 15 节的新决策更新。** 旧版 3–4 张商品图 Mixed collage 不再作为 Hero 主体方案；商品图片仍可在后续 New Arrivals / Collections 中以真实商品卡片呈现。

#### 3.2.1 目标体验

- 进入首页首先看到一张有品牌识别度、摄影质感和视觉冲击力的完整 Campaign 大图。
- Hero 是品牌首页入口，不是商品列表缩略图墙，也不是零售促销结账 Banner。
- 画面传达 WuXuan 是面向品牌商、零售商、进口商和分销商的潮流玩具制造商，突出 Squishy Toys、Building Blocks、Creative Toys 与 OEM/ODM 能力。
- 参考 Satorisan 的大幅沉浸式图片、简洁叠加文案和页面浏览节奏；只借鉴布局与体验原则，不复制其 Logo、字体、图片、文案、图形、代码或独特品牌资产。

#### 3.2.2 桌面端构图

- Hero 宽度：使用 Storefront 主内容容器/视口全宽策略，需与当前 Header 和页面最大宽度体系协调；优先呈现宽幅 Campaign 画面。
- 高度：**75–85vh**；建议以 `clamp()` 约束极端屏幕，建议初始可评估 `min-height: 640px`、`max-height: 900px`，最终以 1366×768、1440×900、1920×1080 实测为准。
- 主素材：一张完整的品牌 Campaign 摄影图，优先使用横向 16:9 或更宽构图。
- 文案位置：优先放在图片左下/左侧留白区域；如果原图主体分布不允许，使用经过验证的对比渐变/柔和遮罩保证可读性。不得用厚重不透明文字卡片遮住主要商品。
- 内容层级：小型 eyebrow → 主标题 → 1–2 行说明 → 两个 CTA → 可选的一行能力标签。
- CTA：主按钮 Browse Products；次按钮 WhatsApp Inquiry。继续使用现有真实路由和 WhatsApp 消息行为。
- 允许轻量的渐变、色块或小型品牌装饰，但不得重新引入四张独立商品卡片拼贴、漂浮 SKU 卡片或无数据依据的数字背书。
- 首屏标题、说明和 CTA 必须在常见桌面高度内完整可见；不得因为 85vh 高度而让关键操作落到首屏之外。

#### 3.2.3 推荐 Hero 文案（通过现有 i18n / 广告配置维护）

英文默认方向：
- Eyebrow：`TOY STUDIO · FACTORY DIRECT · B2B`
- Headline：`Made to Play. Built for Your Brand.`
- Description：`Creative squishy toys, building blocks and playful ideas — made for brands, retailers and distributors.`
- Primary CTA：`Explore Products` 或保留现有 `Browse Products`（需统一全站用词）
- Secondary CTA：`Start an Inquiry` / `WhatsApp Inquiry`

中文方向：
- Headline：`为快乐而创造，为品牌而制造。`
- Description：`创意捏捏乐、积木和潮流玩具，为品牌商、零售商和全球经销商提供产品与定制制造服务。`
- CTA：`浏览产品`、`WhatsApp 询盘`

实施时优先沿用当前已验证的 en-US / zh-CN 文案键与现有广告内容优先级；不得在 JSX 中硬编码仅英文文案。若广告配置覆盖标题/描述，继续遵守现有优先级和安全规则。

#### 3.2.4 图片素材与数据规则

- 图片必须真实表现 WuXuan 实际可供货的产品或经用户批准的真实产品组合；不允许用 AI 生成的虚构商品包装、错误 Logo、错误 SKU 或不存在的产品作为真实商品宣传。
- 优先顺序：现有已批准 Hero/Campaign 广告媒体（若具备合适宽幅图片）→ 现有公开 R2/CDN 商品图片中经过人工挑选的真实素材组合 → 经用户批准新增的 Campaign 摄影资产。
- 不得假设当前广告 DTO 已支持 desktop/mobile 双图字段。实施前先审计 DTO、Admin 编辑能力和图片服务；若没有字段，**不得顺带新增数据库/API**。先以静态受控素材路径或现有安全配置落地，并将后台可编辑 Campaign Media 作为独立 ADR/后续需求。
- 推荐准备 desktop 与 mobile 两种 art direction；可以是同一组真实产品重新构图，不要求商品内容完全不同。
- 图片使用现有 MediaFrame / 图片服务 / CDN 规范；明确 `width`、`height` 或 `aspect-ratio`，避免 CLS；关键首屏主图优先加载，其余非首屏媒体 lazy。
- 若当前组件支持 `srcSet` / `sizes`，必须提供合理断点和尺寸；不要向手机设备无条件发送桌面超大图。
- 主图 alt 应描述真实画面；纯装饰背景图使用空 alt 或 CSS 背景并确保不重复朗读。
- 图片无法加载时使用品牌安全 fallback，不允许出现破图或空白大区域。

#### 3.2.5 移动端构图

- 手机端不是桌面版等比缩小。主视觉优先使用竖版或近方形裁切，建议素材比例 4:5、3:4 或适合首屏的 9:16 安全构图。
- 首屏图片占主要视觉面积；标题、简短描述和 CTA 采用图片下方内容区或图片底部高对比叠加区，按真实素材留白决定。
- 关键商品主体必须完整可见；不能仅依赖 `object-position: center`，需要根据真实图片内容设置受控焦点位置。
- 主标题建议 34–46px 流式字号，最多 2–3 行；描述最多 2–3 行；CTA 垂直排列、可全宽。
- 不得出现四张商品小图挤压文字、CTA 被折叠或首屏只剩图片没有明确询盘/浏览入口。
- 检查 360 / 375 / 390 / 430px 宽度，以及 667 / 740 / 844 / 932px 常见高度；横屏另做验证。

#### 3.2.6 Hero 禁止事项

- 禁止把当前四图商品拼贴简单放大后继续作为主方案。
- 禁止使用未经批准的虚构产品、客户 Logo、工厂资质、销量数字或评价背书。
- 禁止让节日装饰成为 Hero 的必要结构；Default Campaign 本身必须全年成立。
- 禁止把 WhatsApp 绿色覆盖为品牌主色；WhatsApp 保持官方语义色。
- 禁止为了视觉效果删除 Browse Products / WhatsApp Inquiry 任一主要转化路径。
- 禁止在公开 Hero 数据、SSR HTML 或页面 props 中加入价格字段。

### 3.3 Homepage Section Heading：建立明确视觉入口

升级 `HomepageProductSection` 的标题区域，建议抽象出可复用的 Section Heading（可同文件内先实现，确认复用价值后再独立文件）。

每个商品区域采用：
- 上方短 eyebrow / kicker（例如 “JUST DROPPED”、“THE BUILDABLE COLLECTION”）。
- 主标题使用 38–52px 大字和高对比度。
- 装饰线、星点或小型几何图形作为辅助，不使用大量 emoji。
- 副标题可选，限制一行或两行；为空时不占位。
- Collection 可有右侧 View All 链接；New Arrivals 不擅自增加无对应数据筛选的链接。
- 不同 section 可使用既有 pink/mint/yellow/lavender 作为轻量主题色；标题、背景和商品内容仍遵循统一系统。
- 不允许仅靠颜色区分区域，标题语义和层级必须清楚。
- 长标题和翻译标题需要流式缩放、换行测试。

### 3.4 Product Card：商品图片优先、信息降噪

继续复用 `ProductCard` 和 `PublicProductCard`，不创建第二套首页商品卡片数据模型。

视觉层级：
1. 图片（卡片主要面积，目标约 60–70%）。
2. 少量状态 Badge（New / Featured / Pre-order，最多显示必要标签）。
3. 商品名称（最多两行）。
4. SKU + Copy SKU（次级信息）。
5. 简短分类/摘要（可按首页 variant 降低密度；不得删除详情页所需信息）。
6. Add to Inquiry 主操作。
7. View Details 次级入口。

实施注意：
- 当前 ProductCard 展示 summary、category、badge、SKU 和双操作。评估增加 `variant="homepage"` / `density="balanced"` 等最小扩展，或通过样式实现；不能复制全部组件。
- Homepage variant 可以压缩/隐藏过长摘要，但不能让产品名称、SKU、状态、询盘功能丢失。
- 商品卡片图片继续使用 MediaFrame、srcSet、统一比例和 contain；不能裁切产品关键部分。
- 商品图片区域可使用不同浅色 surface，但图片颜色不得被滤镜改变。
- Hover 只用于桌面端：轻微抬升/边框变化/图片微缩放；移动端不能依赖 hover 才能看到按钮。
- 选中状态必须明显、键盘可操作，继续复用 Inquiry context 和 SelectProductButton。
- Add to Inquiry 视觉上是主要动作；不得改成 Add to Cart / Buy Now。
- SKU 复制继续使用 CopyButton。
- 不展示价格、折扣、库存数量、虚构评价星级或零售结账信息。

### 3.5 首页商品密度与内容节奏

- New Arrivals 紧接 Hero，作为第一个商品区。
- New Arrivals 和每个 Collection 继续使用当前分页/Load More 行为。
- Balanced 的目标是首屏/首两屏清楚看到商品，不让每个 section 变成密集无间距的商品墙。
- 桌面商品列数沿用 DOC-45 已确认的首页布局规则；任何调整必须先检查当前实际 CSS 和 DOC-45，不得无理由覆盖既定 6 列规则。
- 平板按容器宽度自适应 3–4 列；手机 360–767px 采用 2 列，必要时小屏单列需有明确理由。
- 不在首页一次性加载所有商品；保留服务端配置总数和 cursor 分批加载。
- 不新增单独全品类入口区块，不把首页变成目录树。
- 工厂/OEM/ODM 内容保留但降低文案密度；只展示真实已配置的工厂内容与媒体。

### 3.6 询盘转化区

- 保留 WhatsApp CTA、Inquiry List 入口和现有消息模板。
- 可在页面末尾设置一个视觉明确的 CTA 区：短标题 + 一句说明 + Browse Products / WhatsApp 两个现有入口。
- 不写“立即购买”“加入购物车”“结账”等零售文案。
- 不承诺客户必定在某个时间内收到回复，除非站点配置/运营实际承诺且已审核。
- 移动端底部 Inquiry/WhatsApp 元素不得遮挡页面内容、焦点或系统手势区域。

---

## 4. 潮流品牌策略：让年度玩具趋势变化不再要求重做首页

本项目的长期关键不是每年重画一套首页，而是把“品牌外壳”和“年度商品内容”彻底分离。

### 4.1 三层解耦模型

**A. Evergreen Brand System（常青品牌层）**
- Logo、字体、排版、页面节奏、按钮、商品卡片、Section Heading、导航、交互规则。
- 原则上多年稳定，只进行小幅设计演进。
- 不绑定某种玩具品类或年度流行色。

**B. Campaign / Holiday Skin（活动与节日层）**
- 只负责主题色 Token、背景装饰、节日 Banner、活动文案和 campaign 时间窗口。
- 不负责创建商品，不修改商品信息，不改变页面结构。
- 节日结束自动回退 Default Theme。

**C. Product Merchandising（年度商品企划层）**
- 当年流行的 Squishy、盲盒、积木、动物、食物、季节性玩具，通过现有 Product、Category、Tag、isFeatured、isNew 和 HomepageCollection 管理。
- 首页组件只渲染当前已配置的公开商品，不在代码里写死某一年玩具名称。
- 通过后台调整新品标记、精选标记、Collection 标题/副标题/商品顺序即可更新商品企划。
- 商品趋势变化不应要求修改 Hero/卡片/主题系统组件。

### 4.2 年度更新流程

每年或每季度上新时，运营人员按以下流程：
1. 在现有 Product Management 中创建/更新真实商品及图片、英文名称、SKU、状态。
2. 使用现有 isNew / isFeatured / 标签等字段维护商品属性。
3. 在现有 Homepage Management 中更新 New Arrivals 展示配置和 Collection 的商品选择/顺序。
4. 如有活动，启用对应 campaign / holiday theme 和活动 Banner。
5. 在手机和桌面预览真实商品图，检查裁切、图片背景、标题长度。
6. 无需更改 React 组件、CSS 结构或数据库商品模型。

禁止把年度趋势商品列表写入主题文件。主题文件只存视觉配置。

---

## 5. Holiday Theme 系统设计

### 5.1 实施原则

- 先完成 Default Theme，再接入 Holiday Theme。
- 所有主题必须由同一套组件渲染。
- 主题配置采用强类型、白名单 token；禁止接受任意 CSS 字符串、任意 className 或用户输入的 CSS。
- 不以节日主题为由新增独立页面、重复组件或商品表。
- 第一版优先采用静态 TypeScript 主题注册表 + 统一 Theme Resolver；只有运营确实需要后台动态管理主题时，才评估复用现有 GlobalSetting / 广告配置能力。
- 若需后台控制主题、时间、市场或优先级，先检查 GlobalSetting 的 public allowlist、安全性、缓存和审计规则。不得开放任意 key 的公共设置读取接口。
- 若现有配置机制不能安全承载，先交付 Default Theme + 代码配置的节日预设，后台可视化管理列为后续独立决策；不得擅自增加数据库迁移。

### 5.2 建议类型（示意，字段需结合项目实际规范）

```ts
type StorefrontThemeId =
  | 'default'
  | 'christmas'
  | 'halloween'
  | 'valentines-day'
  | 'easter'
  | 'lunar-new-year'
  | 'thanksgiving'
  | 'mid-autumn'
  | 'new-year'
  | 'mothers-day'
  | 'back-to-school'
  | 'black-friday';

type StorefrontThemeTokens = {
  page: string;
  surface: string;
  ink: string;
  inkSoft: string;
  line: string;
  primary: string;
  primaryHover: string;
  accent: string;
  decoration: 'none' | 'snow' | 'pumpkin' | 'hearts' | 'eggs'
    | 'lanterns' | 'harvest' | 'moon' | 'confetti' | 'flowers' | 'sparkle';
};

type ThemeCampaign = {
  id: StorefrontThemeId;
  enabled: boolean;
  startsAt?: string;
  endsAt?: string;
  marketAllowlist?: string[];
  priority: number;
  tokens: StorefrontThemeTokens;
  banner?: {
    title: string;
    subtitle?: string;
    imageUrl?: string;
    href?: string;
  };
};
```

以上是概念接口，不得直接照抄后忽略现有设置模型、国际化类型和 API 合约。

### 5.3 主题解析规则

解析优先级必须确定且可测试：

1. 显式开发预览 override（仅开发/授权预览；不可让普通访客通过任意 query 参数永久覆盖线上主题）。
2. 经批准的站点级手动主题设置。
3. 当前日期、市场、启用状态、startsAt/endsAt 与 priority 匹配的 campaign。
4. Default Theme。

冲突处理：
- 多个活动同时有效时，priority 高者优先；相同 priority 使用确定性排序（例如 startsAt DESC，再 id ASC）。
- 时间统一按 ISO 时间和明确站点时区解析；不能依赖服务器本地时区。
- startsAt / endsAt 边界规则采用半开区间：startsAt <= now < endsAt。
- 结束日期为空的 campaign 是否允许长期有效，必须在类型/验证层明确；默认建议必须提供结束时间。
- market 不匹配时不得启用该市场专属节日主题。
- 任何配置缺失/非法/加载失败均回退 Default Theme，不得阻断首页渲染。
- 首屏 SSR 与 hydration 必须使用同一份解析结果，避免主题闪烁。
- 缓存必须考虑 theme/campaign 生效时间边界；如 theme 运行时可变，必须定义缓存标签/失效机制，不能长期缓存过期主题。

### 5.4 首批主题视觉定义

主题必须是品牌系统的变体，而不是完全重做页面：

| Theme | 视觉 Token 方向 | 装饰方向 | 注意事项 |
|---|---|---|---|
| Default | 奶油白、珊瑚、粉、薄荷、薰衣草 | 轻星点/几何形 | 常青主品牌 |
| Christmas | 暖白、莓果红、松针绿、香槟金 | 雪点、丝带、礼物几何 | 不遮挡商品图 |
| Halloween | 暖橙、深紫、柔和炭黑 | 南瓜轮廓、星点 | 避免整页纯黑 |
| Valentine's Day | 奶油白、玫瑰粉、莓红 | 心形线条、丝带 | 不过度甜腻 |
| Easter | 奶油黄、嫩绿、淡紫 | 彩蛋几何、春日花朵 | 保持明亮 |
| Lunar New Year | 暖白、中国红、柔金 | 灯笼/祥云抽象图形 | 避免大面积高饱和红 |
| Thanksgiving | 奶油白、焦糖、南瓜橙、枫叶红 | 秋叶、收获图形 | 保持商品图真实 |
| Mid-Autumn | 月光蓝、桂花金、奶油白 | 月亮、灯笼、兔子剪影 | 不使用未经授权 IP |
| New Year | 深莓紫/午夜蓝、香槟金 | 烟花点、星光 | 控制动效 |
| Mother's Day | 柔粉、奶油白、花叶绿 | 花朵、丝带 | 文案需按市场本地化 |
| Back to School | 活力蓝、柠檬黄、珊瑚 | 几何贴纸、文具线条 | 仍然突出玩具商品 |
| Black Friday | 炭黑/深紫、奶油白、亮珊瑚 | 简洁高对比标签 | 不出现虚假折扣/价格 |

### 5.5 装饰与活动 Banner

- 装饰优先使用 CSS/SVG 小型图形或轻量静态资产；不引入大型背景视频、粒子系统或重型动画库。
- 装饰层必须 `pointer-events: none`，不影响商品点击、键盘焦点和屏幕阅读器。
- 节日 Banner 复用现有广告/内容配置优先；需核实当前广告位和图片资源规则。
- Banner 必须有真实有效的目标链接；没有链接时作为纯信息内容，不渲染假按钮。
- 图片需设置 alt、宽高/比例和合理 loading；节日主题不可让首页首屏 LCP 图片变成过大的装饰图。
- 禁止用未授权第三方角色、商标、IP、影视角色或艺术作品作为节日皮肤素材。

---

## 6. 建议代码落点（以现有结构为准）

必须先确认实际文件和依赖，优先扩展现有文件，避免为了目录整洁进行大规模搬迁。

| 目标 | 优先检查/修改位置 | 说明 |
|---|---|---|
| 首页 Hero 与区块顺序 | `apps/storefront/src/app/[locale]/page.tsx` | 保留数据获取、SEO、广告优先级和页面顺序 |
| Section Heading / 分区 | `apps/storefront/src/components/homepage-product-section.tsx` | 保留分页和错误状态 |
| 商品卡片 | `apps/storefront/src/components/product-card.tsx` | 保留 Public DTO、Inquiry、Copy SKU |
| Header | `apps/storefront/src/components/site-header.tsx` | 仅必要时调整，复用全站 |
| Storefront CSS | `packages/ui/styles/storefront.css` | 统一组件样式和响应式 |
| Storefront CSS 入口 | `apps/storefront/src/app/globals.css` | 保持现有导入链 |
| 主题 Token | `packages/ui/styles/tokens.css` | 仅改 `--sf-*` 命名空间，避免污染 Admin |
| 主题注册表/解析 | 建议 `apps/storefront/src/lib/theme/` 或按现有 lib 结构 | 纯函数、强类型、单元测试 |
| locale 文案 | 现有 Storefront i18n messages | 英文为默认；中文资源同步按现有约定 |
| 图片 | 现有 R2 / MediaFrame / imageSrcSet | 不创建另一套图片 CDN 逻辑 |
| 首页后台配置 | 现有 Homepage Management | 复用 New Arrivals / HomepageCollection |
| Campaign 配置 | 先审查 GlobalSetting、Ads、Home Sections | 未经批准不新增数据库/API |

AI 不得将建议路径当作已存在路径。先检查目录结构、导出索引、测试约定，再确定最终文件清单。

---

## 7. 分阶段 AI 开发计划与验收停点

**强制规则：一次只执行一个阶段。每阶段完成后先提交阶段报告和证据，等待用户明确验收/开工下一阶段；不得连续跨阶段自动开发。**

### 阶段 0 — Baseline Audit & Implementation Plan

目标：
- 核对最新 main、工作区状态、当前 commit、项目脚本、DOC-45、Frontend Skill。
- 检查当前首页、Header、ProductCard、Storefront CSS、Tokens、i18n、R2 图片、Homepage public API。
- 检查现有测试和实际页面截图/DOM；确认本地运行方式。

任务：
1. 输出 `git status --short`、分支、HEAD commit；不得覆盖用户未提交更改。
2. 列出将修改/新增的文件。
3. 识别现有组件和业务能力的复用点。
4. 对照本任务书与 DOC-45 检查冲突。
5. 明确不涉及的 API、DB、商品和 Inquiry 模块。
6. 建立阶段验收基线：桌面、平板、360/375/390px 手机；首页关键功能与性能现状。

验收：
- [ ] 仓库干净状态/未提交状态已如实报告。
- [ ] 页面、API、组件、Token 和 i18n 入口均已定位。
- [ ] 没有重复创建现有模块的方案。
- [ ] 文件变更计划得到确认。
- [ ] 未修改业务代码、未迁移数据库、未部署。

停点：用户确认审计和文件计划后，才进入阶段 1。

### 阶段 1 — Default Theme Tokens & Visual Foundation

目标：建立 Playful Premium 的 Storefront 视觉基础。

任务：
1. 只调整 Storefront 的 `--sf-*` Token；不得改变 Admin 全局 token。
2. 定义 primary、surface、ink、line、accent、radius、shadow、motion 等语义 Token。
3. 对比度达到 WCAG 2.2 AA 目标；保留 focus-visible。
4. 建立 section、button、badge、product card 的统一样式基础。
5. 检查 360px 下无水平溢出。
6. 不改首页数据请求和业务状态。

验收：
- [ ] Token 无组件级散落硬编码色值（必要的装饰例外也必须有理由）。
- [ ] Admin 页面外观没有被 Storefront Token 修改污染。
- [ ] 主/次按钮、链接、badge、focus 状态统一。
- [ ] 文字对比度达到 AA 目标。
- [ ] reduced-motion 生效。
- [ ] Storefront 相关 lint/typecheck/test 通过。

停点：提供 Token 色板、桌面/手机截图和测试结果，等待验收。

### 阶段 2 — Hero First-screen Redesign

目标：让 Facebook 引流访客一眼看懂产品类型并看到真实商品。

任务：
1. 改造现有 Hero 排版、主标题、描述、CTA 和商品拼贴。
2. 保留 Hero Ads 与公共商品图片的数据来源和优先级。
3. 标题和描述通过现有广告/i18n 配置，不写死在组件。
4. 使用真实 R2 商品图、MediaFrame、srcSet、alt、尺寸预留。
5. Mixed 拼贴 3–4 张图片，桌面错落排版、手机自然堆叠。
6. 不添加虚构 SKU、客户评价、销量、工厂认证或统计。
7. 保留 Browse Products / WhatsApp CTA 的真实行为。

验收：
- [ ] 首屏主视觉由真实商品图片构成。
- [ ] 用户可在首屏识别 Squishy Toys / Building Blocks / Creative Toys 业务。
- [ ] 文案明显精简，标题不超过 2–3 行。
- [ ] 两个 CTA 均可正确跳转/触发。
- [ ] 图片 alt、加载优先级和尺寸正确。
- [ ] SEO metadata / canonical / OG 未回归。
- [ ] 360 / 375 / 390 / 768 / 1024 / 1440px 无溢出。
- [ ] 无价格信息进入 SSR / HTML / metadata。

停点：交付首屏截图和交互测试，等待验收。

### 阶段 3 — Homepage Sections & Product Card

目标：让 New Arrivals、Building Blocks 等区域成为明显、精致、易浏览的系列入口。

任务：
1. 重做 Homepage Section Heading：kicker、主标题、可选副标题、装饰、View All。
2. New Arrivals 标题有独立“JUST DROPPED / NEW ARRIVALS”层级。
3. Collection 标题使用可读的大字与对应浅色主题色。
4. 优化 ProductCard 首页密度；图片优先、信息降噪、Add to Inquiry 主操作。
5. SKU Copy、New/Featured/Pre-order、View Details 和选中状态必须保留。
6. 保留 Load More、cursor、loading/error/retry 和服务端展示上限。
7. 不新增全品类总览，不修改 DOC-45 去重/排序/展示语义。

验收：
- [ ] New Arrivals 与各 Collection 标题层级清晰。
- [ ] 每个 Collection 具有统一结构但视觉上可区分。
- [ ] 图片比例统一，商品主体不被裁切。
- [ ] 商品名称、SKU、必要 badge 清楚可读。
- [ ] Copy SKU、详情、Add to Inquiry 全部正常。
- [ ] Load More 正常，失败可重试，重复商品不出现。
- [ ] Homepage 顺序与 DOC-45 一致。
- [ ] 价格字段仍不进入 Public DTO / DOM。
- [ ] 桌面商品列数遵守 DOC-45；手机布局 2 列且可读。

停点：提交每个首页区块截图、功能回归和测试结果，等待验收。

### 阶段 4 — Mobile, Accessibility, Performance & Facebook In-app Browser

目标：让社交媒体移动端流量体验稳定。

任务：
1. 在 360 / 375 / 390 / 430px 逐项验证。
2. 测试 Facebook 内置浏览器常见视口与滚动行为；如无法直接获得真实 Facebook WebView，使用移动浏览器模拟并明确限制。
3. 图片 lazy/eager、srcSet、CLS、LCP 检查。
4. 检查 sticky header、mobile menu、search、Inquiry entry、WhatsApp CTA。
5. 检查 keyboard、screen reader label、focus-visible、reduced motion。
6. 检查 Open Graph 分享预览和产品详情页 OG 图片。
7. 对比改版前后性能，不以装饰效果牺牲加载速度。

验收：
- [ ] 360px 无非预期横向滚动。
- [ ] 触控目标符合 44×44px 基线。
- [ ] sticky header 不遮挡锚点/内容。
- [ ] 首屏关键图没有不必要 lazy，屏下图合理 lazy。
- [ ] 没有明显 CLS；性能指标有记录。
- [ ] Facebook WebView 无阻断性问题；未实测项明确标记。
- [ ] 键盘和 reduced-motion 可用。
- [ ] 分享预览使用真实站点图片与正确 URL。

停点：交付响应式矩阵、性能对比和可访问性检查结果，等待验收。

### 阶段 5 — Theme Registry & Resolver (Default-first)

目标：让主题可以被安全地切换和扩展，先只启用 Default。

任务：
1. 定义强类型 Theme ID、Token schema、Campaign 配置 schema。
2. 建立 Default Theme registry。
3. 实现纯函数 Theme Resolver，处理 fallback、优先级、时间窗口、市场匹配。
4. 确保 SSR 与 hydration 使用同一主题结果。
5. 配置校验采用白名单，不接受任意 CSS。
6. 对时间边界、优先级冲突、非法配置、缺省配置和市场过滤写单元测试。
7. 先评估静态配置是否足够；若后台管理需求必须新增数据/API，先输出单独 ADR，未经批准不做 schema/API 改动。

验收：
- [ ] Default Theme 在无配置时始终可用。
- [ ] 非法/缺失配置自动 fallback。
- [ ] 相同输入的 resolver 结果确定。
- [ ] startsAt / endsAt 边界正确。
- [ ] 多 campaign 冲突优先级正确。
- [ ] SSR/hydration 不闪烁。
- [ ] 不存在任意 CSS 注入入口。
- [ ] 不影响 Admin、产品、询盘和公共缓存安全。

停点：提交类型定义、resolver 测试和运行截图，等待验收。

### 阶段 6 — Holiday Theme Presets

目标：在统一页面上加入首批 11 个节日主题预设。

任务：
1. 按第 5.4 节创建 11 个预设配置。
2. 主题只改变允许的视觉 Token、装饰、活动 Banner，不改变布局和业务逻辑。
3. 主题装饰轻量、非交互、pointer-events none、屏幕阅读器隐藏（除非有实际信息）。
4. 日期、市场、priority 按 resolver 规则解析。
5. 提供仅开发/授权预览的主题切换入口；生产访客不能通过任意 query 参数强制全站换肤。
6. 每个主题至少验证首页、商品列表、商品详情、Inquiry 页面，不得只验证首页。
7. 主题资产需使用已授权素材；不使用未授权 IP。

验收：
- [ ] 11 个主题均能独立解析和预览。
- [ ] 节日结束回退 Default。
- [ ] 未启用/市场不匹配的主题不生效。
- [ ] 商品图片、文字和按钮对比度可读。
- [ ] WhatsApp 绿色与业务状态语义未被覆盖。
- [ ] 主题不改变商品排序、价格、SKU、发布状态或 Inquiry。
- [ ] 主题装饰不阻断点击、不影响可访问性。
- [ ] 无新增 DB/API，除非已单独批准并完成 ADR。

停点：提供 11 个主题截图/矩阵和 resolver 测试，等待验收。

### 阶段 7 — Final Regression, Documentation & Release Readiness

目标：形成可交付、可回滚、可维护的实现。

任务：
1. 执行 storefront lint、typecheck、tests、build；执行仓库根级脚本（按实际 package scripts）。
2. 执行首页、商品列表、商品详情、Inquiry、WhatsApp 流程回归。
3. 复核 Public DTO、SSR props、HTML、metadata、JSON-LD、缓存、日志均无内部价格。
4. 复核多语言、R2 图片、SEO、OG、响应式和主题 fallback。
5. 更新相关开发文档和主题运营说明。
6. 汇总改动文件、测试命令、测试结果、风险和回滚步骤。
7. 只有在用户明确授权后，才提交/推送代码、创建 PR 或部署；本阶段任务书本身不代表部署授权。

验收：
- [ ] lint 通过。
- [ ] typecheck 通过。
- [ ] 相关单元/集成测试通过。
- [ ] production build 通过。
- [ ] 关键用户流程通过。
- [ ] 价格隔离检查通过。
- [ ] 响应式/无障碍/性能验收有证据。
- [ ] 回滚方案可执行。
- [ ] 未完成项和未覆盖风险明确列出。

停点：用户验收最终报告后，再决定是否合并/部署。

---

## 8. 必测场景清单

### 8.1 首页与内容
- Hero 广告存在/不存在、图片存在/缺失、公开商品为空。
- New Arrivals 有商品/无商品、Collection 有商品/空集合。
- Collection 标题长文本、无副标题、英文/中文切换。
- 首页工厂内容存在/缺失。
- 商品图片加载失败、R2 变体缺失。
- 大量 Collection 和较长商品名称下布局正常。

### 8.2 Inquiry 业务
- 未选择商品时 Inquiry 数量和入口状态。
- 单个、多 SKU 添加和移除。
- 跨页面/刷新后的既有持久化行为。
- Copy SKU。
- Add to Inquiry 选中/取消选中。
- WhatsApp 预填消息包含全部 SKU 且正确 URL encode。
- 达到既有选择上限时提示清楚，不静默丢弃 SKU。
- WhatsApp 未配置/无效配置时的错误反馈符合现有行为。

### 8.3 Theme Resolver
- 没有 campaign。
- campaign 刚开始、结束前一刻、结束边界。
- 两个 campaign 同时生效。
- priority 相同。
- marketAllowlist 匹配/不匹配。
- 非法 theme id、非法颜色 token、缺少必需字段。
- 站点配置读取失败。
- SSR 与 hydration 输入一致。
- 开发预览 override 不可在生产环境被普通 query 参数滥用。

### 8.4 安全、SEO 与性能
- 公共 HTML / RSC payload / metadata / OG / JSON-LD 无价格。
- 首页 OG 图片 URL 有效，canonical locale 正确。
- Product detail OG 不暴露内部字段。
- 商品图 srcSet URL 不被错误拼接。
- 屏下图片 lazy；关键 Hero 图片优先加载。
- 动画在 reduced-motion 下关闭/简化。
- 360px 下无横向溢出。
- 装饰元素不拦截指针和键盘操作。

---

## 9. 测试与工程质量要求

每阶段按仓库实际 scripts 执行，至少核实：
- `pnpm --filter @b2b/storefront typecheck`
- `pnpm --filter @b2b/storefront test`
- `pnpm --filter @b2b/storefront build`
- 根目录 lint 命令（以根 package.json 为准）
- 受影响的 packages/ui、contracts、i18n 测试（若有变更）

不得只报告“测试通过”而不列出真实命令和退出结果。不能运行的测试要说明环境原因、未覆盖风险和替代验证，不得假报通过。

### 9.1 禁止引入的回归

- 不得修改后台主题和 Admin Token。
- 不得破坏产品列表、详情、分类筛选、搜索、分页和链接。
- 不得改变 Homepage API、分页 cursor、去重和缓存契约。
- 不得把公开 DTO 替换为管理端 Product 类型。
- 不得将内部价格带入任何前台数据或 HTML。
- 不得破坏 WhatsApp 消息和 Inquiry List。
- 不得用 mock 商品/假评论/假销量替代真实数据。
- 不得为节日主题新增不必要数据库迁移或依赖。
- 不得把节日名称、玩具趋势或具体商品硬编码进共用组件。

---

## 10. 回滚与发布策略

- 每个阶段尽量独立提交，便于按 commit 回滚；不要混入无关重构。
- Token 回滚：恢复 Storefront 专属 `--sf-*` 值，不改全局 Admin Token。
- Hero/Section/Card 回滚：恢复对应组件/CSS/i18n 文件；保留现有数据 API。
- Theme Registry 回滚：移除主题 provider/resolver 使用，强制 Default Theme；不影响商品与 Inquiry。
- Holiday Presets 回滚：停用 holiday registry entries，Default Theme 保持可用。
- 若未来经批准新增数据库配置，必须采用 additive migration、备份、回填验证和向后兼容发布；回滚不得删除仍被旧代码读取的数据。
- 生产发布前需先在 staging/预览环境验证；不得由本任务书自动触发部署。

---

## 11. AI 每阶段交付报告模板

每个阶段完成后，AI 必须按以下格式提交结果，并停止等待验收：

1. **阶段与状态**：阶段编号、PASS / PASS WITH NOTES / FAIL。
2. **改动摘要**：页面、组件、Token、i18n、主题配置。
3. **文件清单**：新增/修改文件及理由。
4. **业务保护**：Inquiry、WhatsApp、SKU、商品路由、分页、缓存、价格隔离。
5. **视觉证据**：桌面、平板、手机截图或明确说明无法截图的原因。
6. **响应式与无障碍**：视口矩阵、键盘、focus、reduced-motion、对比度。
7. **测试证据**：逐条列出命令和结果。
8. **性能结果**：LCP、CLS 等可获得数据；注明测试环境。
9. **风险与未完成项**：不隐藏问题。
10. **下一阶段建议**：只说明下一阶段，不自动执行。
11. **Git / 部署状态**：明确是否提交、推送、部署；未经用户授权不得执行。

---

## 12. 最终 Definition of Done

只有同时满足以下条件，才能将整个视觉升级标记为完成：

- Default Theme 已达到 Playful Premium 品牌效果，首屏商品主导、文案精简。
- New Arrivals 和每个 Homepage Collection 标题清楚、有识别度。
- Product Card 图片优先、信息层级清晰、询盘操作突出。
- 首页顺序遵循 DOC-45，不增加重复全品类入口。
- 年度商品趋势可通过现有 Product/Tag/Featured/New/Collection 后台配置更新，不需要修改前台组件。
- 11 个节日主题由统一主题系统驱动，结束自动回退默认主题。
- 主题配置安全、类型化、可测试、SSR 稳定。
- 360px 到桌面布局、键盘可访问性和 reduced-motion 通过。
- Inquiry、WhatsApp、SKU、商品详情、分页、R2 图片、i18n、SEO 无回归。
- 价格隔离验证通过。
- lint、typecheck、tests、build 通过，或未通过项明确说明。
- 文档、运营更新流程、回滚方式齐全。

**执行口令：每次只执行用户明确指定的一个阶段。完成并报告后必须停止，不得自动开始下一阶段。**


---

## 15. Homepage Visual Architecture Freeze — Full-width Campaign + Sticky Header（2026-11-14）

> **状态：用户已确认视觉方向；本节是 AI 后续执行的强制规格。**  
> 用户确认：Hero = A 品牌 Campaign 大图；导航 = 固定白色 Sticky Header；桌面 Hero = 75–85vh 沉浸式大图。  
> 本节只冻结设计和素材要求，不代表代码已实施，也不授权自动进入阶段 4、主题开发、提交代码或部署。

### 15.1 设计目标与参考边界

目标是把 WuXuan 首页从“文字 + 四张小商品图拼贴”的目录式首屏，升级为有品牌 Campaign 识别度的 B2B 玩具制造商官网。

参考网站：`https://row.satorisan.com/`。允许借鉴：
- 首屏以一张大幅摄影图建立品牌情绪；
- 文案和 CTA 简洁叠加在主视觉上；
- 页面滚动时导航仍可使用；
- 桌面与移动端采用不同的图片构图和内容排列；
- 页面内容有明确节奏，不把所有信息塞入首屏。

禁止复制参考网站的 Logo、商标、字体文件、摄影图片、文案、独特图形、HTML/CSS/JS 或其他受保护品牌资产。WuXuan 必须形成自己的玩具品牌表达。

### 15.2 全站首页信息架构（冻结顺序）

1. **Sticky Header**：固定白色主导航，覆盖首页和所有 Storefront 页面。
2. **Full-width Brand Campaign Hero**：75–85vh 桌面大图；移动端独立构图。
3. **New Arrivals**：首页第一个商品区，沿用当前真实数据、配置总数和 cursor/Load More。
4. **Homepage Collections**：按后台排序逐个呈现，每个 Collection 独立 Section 和商品网格；不增加全品类总览卡片墙。
5. **Brand / Product Story（可选且需有真实素材）**：介绍产品创意、品类开发或设计能力；若没有真实内容，不新增空洞营销区块。
6. **Factory & OEM / ODM**：展示真实工厂、生产流程、质量控制、OEM/ODM、包装定制能力；沿用已有页面/内容，不编造认证或产能数字。
7. **How to Get a Quote**：Choose Models → Send Inquiry → Get Quotation，继续强调无购物车、无在线结账。
8. **Final Inquiry CTA**：Browse Products + WhatsApp Inquiry。
9. **Footer**：公司、产品导航、联系信息、政策等现有内容。

说明：
- 第 2 项必须紧接 Header；第 3 项必须是 Hero 后第一个商品区域。
- 不新增独立的 “Shop by Collection” / “Explore Our Collections” 全品类目录墙。
- 不把 New Arrivals 和后台 Collections 改成横向 Carousel；保持既有网格和分页。
- 若 Brand / Product Story 没有真实素材/有效内容，可省略，不得为了凑结构制造空区块。
- 既有 URL、locale、SEO、公开 DTO、Inquiry 和 WhatsApp 业务规则完全保留。

### 15.3 Sticky Header 规格

**桌面端**
- 白色/奶油白不透明背景；不使用透明文字叠在 Hero 图片上的方案。
- 默认高度建议 72–80px；内容垂直居中。
- 左侧：WuXuan Logo/品牌名。
- 中间：Home、Products、Our Factory、Quality & Awards、FAQ（以现有真实路由和可用页面为准）。
- 右侧：搜索、WhatsApp 入口、Inquiry List（含数量）。
- 页面滚动时始终固定在视口顶部；滚动状态可增加轻微阴影或细边框，不做明显跳动/高度突变。
- 使用稳定层级，确保下拉菜单、搜索面板和移动抽屉层级正确。

**移动端**
- 高度建议 60–68px。
- Logo 清晰可识别；菜单、搜索和 Inquiry 数量入口有足够触控空间。
- WhatsApp 可以位于移动菜单或固定联系入口中，避免 Header 横向拥挤；但必须容易找到。
- 菜单打开时支持键盘/屏幕阅读器语义、Escape 关闭、焦点管理和背景滚动控制（按现有组件模式实现）。
- 所有交互触控目标至少 44×44 CSS px。
- 页面锚点/滚动定位需考虑 sticky header 高度，避免标题被遮挡。
- 验证 Products、详情页、Inquiry、Factory、Quality、FAQ 等全部 Storefront 路由，不只首页。

**实现约束**
- 复用现有 Site Header / Site Shell；禁止另建首页专属 Header。
- 优先 `position: sticky; top: 0`，除非现有布局结构证明必须采用 fixed；不得造成页面跳动。
- 不改 Admin Header，不修改共享 Admin 样式。
- 保留现有 locale、搜索、WhatsApp、Inquiry、移动菜单行为。

### 15.4 Hero 桌面布局规格

- 高度：75–85vh；通过流式 CSS 和上下限适配屏幕，建议初始评估 `clamp(640px, 80vh, 900px)`，最终以截图验收为准。
- 宽度：优先全宽 Campaign 画面；若受现有页面容器限制，需明确说明并保持视觉上接近 edge-to-edge。
- 图片：单张完整 Campaign 主图，横向 16:9 或更宽；主体应为真实的多品类玩具产品组合。
- 构图：左侧或左下预留文字安全区；右侧/中部呈现产品主视觉。可按实际素材镜像/调整，但文字不能压住产品关键主体。
- 叠字区域：使用足够对比的自然留白、局部渐变或柔和遮罩；不允许无依据叠加厚重面板。
- 标题建议：`Made to Play. Built for Your Brand.`；可以在品牌审核后微调，不得把它写死在组件内。
- 标题字号：桌面建议 56–76px 流式；行宽受控，避免在常见桌面宽度下形成过多断行。
- 说明：最多 1–2 行，说明 Squishy Toys / Building Blocks / Creative Toys 与 B2B/OEM/ODM 服务。
- CTA：主按钮 Browse Products；次按钮 WhatsApp Inquiry / Start an Inquiry。按钮必须使用现有真实 href 和消息行为。
- 信任点：可在 CTA 下方显示 Factory Direct、OEM/ODM、Custom Packaging 等能力标签，但不得添加虚构认证、客户数量或交付承诺。
- 不再显示 Hero 四图拼贴、悬浮商品 SKU 标签卡、无意义装饰星点作为主体。

### 15.5 Hero 移动端布局规格

- 不得把桌面图粗暴裁切成移动端图。应提供移动端独立构图/焦点。
- 图片建议 4:5 或 3:4；若采用高屏沉浸式，可用 9:16 素材，但要避免重要产品主体过小。
- 图片是移动端首屏视觉主体；文案可放在图片底部有对比的叠加区域，或放在图片紧接下方的文字区域。最终选择以真实图片留白和可读性为准。
- 标题 34–46px 流式，最多 2–3 行；说明 2–3 行以内。
- CTA 垂直全宽或足够宽，主次层级明确；WhatsApp 入口不能被隐藏到用户难以发现的位置。
- 保证 360 / 375 / 390 / 430px 视口无横向溢出；常见手机高度下标题和至少一个明确 CTA 可见。
- 检查安全区、动态地址栏、底部手势区域、Facebook/Instagram 内置浏览器和 Safari/Chrome 移动浏览器。

### 15.6 图片素材清单与规格

**必须准备的主素材**
1. `home-hero-desktop`：桌面 Campaign 横幅，建议 2400×1350 或更高质量源图；主体和文字安全区明确。
2. `home-hero-mobile`：移动端独立构图，建议 1200×1500（4:5）或 1200×1600（3:4）；重要商品主体不被裁切。
3. `home-hero-fallback`：主图加载失败时的品牌安全 fallback；可使用已批准的单张真实商品组合图。
4. `home-brand-story`（可选）：产品开发/设计过程真实照片。
5. `factory-overview`：真实工厂环境/生产线照片。
6. `factory-quality-control`：真实质检/包装流程照片。
7. `factory-custom-packaging`：真实包装定制/打样照片。
8. New Arrivals / Collections 继续使用商品自身真实图片，不重复制作一套静态商品图库。

**摄影内容要求**
- 产品组合建议涵盖 squishy fruit/food、动物/角色造型、building blocks、creative toys；以当前真实在售/可供货 SKU 为准。
- 画面需体现产品质感、色彩、尺寸层次和真实包装；避免廉价白底图拼贴。
- 背景可使用奶油白、柔和粉、薄荷绿、暖黄色等品牌色，但产品本身颜色必须真实。
- 真实商品包装、商标、SKU 和外观必须与实际产品一致；拍摄或合成不得虚构认证、客户 Logo 或合作品牌。
- Campaign 图片可通过专业摄影或经批准的图像合成制作；若使用 AI 辅助，仅可用于背景/构图辅助，不能将虚构产品当作真实商品宣传。
- 需取得图片使用权/供应商授权，并记录素材来源。

**格式与交付**
- 优先 AVIF/WebP，保留可追溯高质量原始文件。
- 为桌面/移动端提供响应式尺寸；避免移动端加载 2K/4K 原图。
- 关键图片预先声明尺寸/比例，避免 CLS。
- 记录文件名、尺寸、格式、文件大小、来源、版权/授权状态、alt 文案、桌面/移动焦点位置。
- 具体文件存储位置需先遵循仓库现有 public assets / R2 / image pipeline 约定；不得随意新增第二套图片托管机制。

### 15.7 视觉系统与内容风格

- 保留 Default Playful Premium：奶油白基底、珊瑚色行动色、草莓粉/薄荷绿/薰衣草紫/奶油黄作为辅助。
- 相比当前四图拼贴，减少卡片边框、漂浮标签、装饰星点和多层阴影；让摄影和标题承担主要视觉。
- 页面采用明确留白和节奏：大图 Hero → 清晰商品网格 → 精选系列 → 工厂能力 → 询盘转化。
- Section Heading 与阶段 3 的 kicker / 标题 / 副标题 / View All 层级保持一致。
- 商品卡片仍用现有 homepage variant；不在本次架构冻结中再次设计 ProductCard。
- 不改变桌面 6 列、平板自适应、手机 2 列商品网格规则。
- 不新增价格、购物车、在线支付、折扣或零售促销语义。

### 15.8 代码实施建议（后续获得授权后）

实施前必须重新读取最新 main 和工作区状态，至少检查：
- `AGENTS.md`、`.agents/skills/frontend-ui/SKILL.md`、DOC-45、DOC-46；
- `apps/storefront/src/components/site-header.tsx`、`site-shell.tsx`、`apps/storefront/src/app/[locale]/page.tsx`；
- `apps/storefront/src/lib/homepage.ts`、广告/Site Config DTO 与 Admin Hero 编辑能力；
- `packages/ui/styles/storefront-entry.css`、`tokens.css`、`storefront.css`；
- 当前图片组件、R2/CDN、srcSet/sizes 和图片 fallback 实现。

预计涉及范围（以审计为准）：
- Site Header / Site Shell：Sticky 行为和响应式导航。
- Homepage page / Hero 组件：由 Mixed collage 改为 Campaign Hero。
- i18n：en-US / zh-CN 文案和可访问名称。
- Storefront CSS：Hero 桌面/移动构图、Header sticky 状态、focus、reduced-motion。
- 测试：Hero 结构、Header 滚动、locale、CTA、图片加载和价格隔离。

严格禁止：
- 不重构 ProductCard / HomepageProductSection，除非发现 Hero 接口有明确必要改动且先说明。
- 不改 API/DTO/数据库/权限/缓存/商品排序/去重/分页/Inquiry/WhatsApp 业务逻辑。
- 不新增第三方轮播/动画库。
- 不创建独立首页 Header。
- 不自动提交、推送或部署，除非用户明确授权。
- 若发现需新增 Admin 可编辑 desktop/mobile Campaign Media 字段，先写 ADR 并暂停等待批准。

### 15.9 首页视觉架构验收矩阵

**桌面截图**
- 1920×1080
- 1600×900
- 1440×900
- 1366×768
- 1280×800

**平板截图**
- 1024×768
- 768×1024

**手机截图**
- 430×932
- 390×844
- 375×812
- 360×740

**验收项**
- 首屏首先呈现完整品牌 Campaign 大图，而不是四张商品缩略图拼贴。
- Sticky Header 在首页及内页滚动过程中保持固定、清晰且不遮挡内容。
- 桌面 Hero 高度在 75–85vh 设计范围内，标题、说明和双 CTA 完整可用。
- 移动端使用适配构图，主体完整，标题和 CTA 清楚。
- Hero 主图没有明显拉伸、错误裁切、CLS 或破图。
- New Arrivals 紧接 Hero，仍是第一个商品区域。
- 后台 Collections 顺序、标题、商品、Load More / View All 正常。
- Factory / OEM / ODM 内容真实可信，不虚构产能、认证、客户或回复承诺。
- Products、Factory、Quality、FAQ、Search、Inquiry、WhatsApp 等现有入口可用。
- en-US / zh-CN 文案不溢出、不混语言。
- 不显示价格，不产生 Add to Cart / Checkout 等零售语义。
- 桌面/平板/手机均无横向滚动。
- Header、Hero、图片、按钮满足键盘操作、焦点可见和对比度要求。

### 15.10 本次冻结后的阶段门禁与 VS Code AI 执行提示词

本次只完成 DOC-46 设计规格更新。后续 AI 应按以下顺序：

1. **Visual Architecture Readback（只读）**：重新读取 DOC-46 第 0.4、3.1、3.2、15 节和 DOC-45；核对当前实现与规格差异，输出差异表、素材缺口和预计改动文件，不改代码。
2. **Campaign Asset Preparation（素材准备）**：先准备并审核桌面/移动端 Campaign 图片和真实工厂素材；没有用户批准的真实素材，不得把虚构产品图投入网站。
3. **Homepage Visual Implementation（单独授权）**：按冻结规格实现 Sticky Header + Campaign Hero + 首页内容顺序；仍按小阶段实施，每阶段报告后停下等待验收。
4. **Visual Acceptance（单独验收）**：使用第 15.9 节截图矩阵和业务回归完成视觉验收。
5. **Stage 4**：只有基础页面布局和视觉架构验收通过后，用户明确授权，才进入 DOC-46 阶段 4。
6. **Stage 5–6**：在基础页面稳定并通过阶段 4 后，才实施主题注册表、Resolver 和 11 个节日预设。

**交给 VS Code AI 的提示词：**

“请先只读阅读 `docs/46-storefront-brand-visual-refresh-and-theme-system.md` 的第 0.4、3.1、3.2、7、15 节，以及 `docs/45-homepage-product-display-and-collections.md`。本次用户已冻结首页方向：品牌 Campaign 单张大图、白色固定 Sticky Header、桌面 Hero 75–85vh。旧版 Mixed 四图 Hero 规格已被新决策取代。请审计当前 main/工作区代码，输出当前实现与冻结规格的差异、所需真实素材清单、素材缺口、拟修改文件、风险和测试计划。**本次只读，不得修改代码、文档、依赖、数据库，不得提交/推送/部署，不得开始阶段 4 或主题系统开发。** 等待用户批准后再执行具体实现阶段。”

