# Skill: Product Category Picker

在商品新建、编辑和列表筛选中实现品类选择器前，必须先阅读 `AGENTS.md`、`docs/22-category-management-tree-workbench.md`、`docs/24-product-management-crud-and-image-storage.md` 和 `docs/25-product-category-picker-selectability.md`。

## 强制规则

1. 必须先检查现有 Category tree API、组件、表单状态、DTO、API mapping 和测试，定位不可选择的真实原因；不得只改 CSS 或给用户“加一个按钮”后就结束。
2. 所有层级的已启用品类均可选择，包括父节点；展开箭头与选择行是两个独立动作。父节点不能因为有 children 就被禁选。
3. 表单唯一提交值是数据库中的 `categoryId` UUID。禁止把 category name、code、slug 或翻译 label 写到 `Product.categoryId`。
4. 新建、编辑和列表筛选复用同一底层选择器；产品模式要求必填，筛选模式允许清空。筛选是否包含后代节点必须明确显示，并与后端查询一致。
5. 树数据异步加载不得清空或覆盖编辑表单的已存 categoryId；语言切换只更改显示名称，不改变 ID。
6. 选择、展开、搜索、键盘操作、Popover/Portal z-index、加载中、失败、空数据、无权限及禁用品类都必须处理并测试。
7. 服务端再次校验类别是否存在、权限和新选择是否启用；前端隐藏节点不是安全校验。对已有商品引用已停用品类的编辑要遵循产品文档中的兼容规则。
8. 优先复用现有 API、组件库、缓存及 schema。没有证据证明必要时，不得新建重复分类表、重复 API 或新增 UI 依赖。
9. 完成前须执行 lint、typecheck、相关测试和 build，并报告根因、修改文件、测试命令、结果及未完成项。禁止把方案文档或 CSS 变化冒充成已修复的功能。
