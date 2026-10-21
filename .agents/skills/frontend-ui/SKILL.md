---
name: frontend-ui-standard
description: 前台/后台页面开发、UI 统一、响应式、国际化与前台价格隔离的强制规范。
---

# Frontend UI Standard Skill

开始前必须读取根目录 `AGENTS.md`、`docs/06-admin-public-ui-standard.md`、`docs/01-product-requirements.md`。

## 执行流程
1. 识别目标是 `apps/storefront` 还是 `apps/admin`，复用正确应用的 layout、design tokens、组件和 locale 路由。
2. 核对 API 合约；前台只能使用 public DTO，不得直接引用管理端 Product 类型或读取内部价格。
3. 先实现 loading / error / empty / success 状态，再完成正常态，不提交只有静态截图效果的假功能。
4. 根据设计系统 Token 构建页面；所有交互组件响应键盘和窄屏布局。
5. 所有后台文字加翻译 key，并同时维护 `zh-CN`、`en-US`；前台默认英文，不在组件中硬编码混合语言。
6. 运行 lint、typecheck、相关测试及 build；补充响应式与价格泄漏验收结果。

## 强制规范
- 断点必须覆盖 360px 手机、平板和桌面；避免硬编码宽度、非必要横向滚动。
- UI 组件优先复用 `packages/ui`；若要新增组件，先检查现有组件是否能扩展。
- 页面文案和验证错误通过 i18n key；业务逻辑不能以中文 label 作条件判断。
- 表单支持 Label、帮助文案、错误态、提交中状态、防重复提交和服务端错误映射。
- 删除/下架/批量操作有确认；异步操作有可感知的状态反馈。
- 图片处理 `alt`、尺寸预留、响应式资源和 loading lazy 策略必须合理。
- 公共产品类型显式定义允许字段；不得用 `...product` 展开管理数据到公共组件。
- 前台不渲染价格，也不能在 HTML、hydration state、metadata、JSON-LD、浏览器 storage 中持有内部价格。
- WhatsApp 消息必须对所有选中的 SKU 进行 URL 编码；超出数量限制时明确阻止或要求分批，不可截断。

## 完成报告格式
- 页面/组件变更
- 响应式与无障碍处理
- locale 资源变化
- 价格泄漏验证结果
- 已执行命令及结果
- 未覆盖风险
