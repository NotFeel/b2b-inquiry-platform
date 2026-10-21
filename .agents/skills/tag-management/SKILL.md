# Tag Management Skill

改造标签管理前必须先阅读 `AGENTS.md`、`docs/23-tag-management-crud-and-ui-optimization.md`、现有 `Tag` / `TagTranslation` / `ProductTag` 模型与真实 API。

1. 先审查现有 schema、migration、数据和引用，不要重复建立标签模型。当前 `Tag` 没有 `type` 字段；未经设计不得保留不持久化的自由文本“类型”。
2. 标签使用稳定 `code`，展示名存放在 `TagTranslation` 中，至少支持 `en-US` / `zh-CN`；前台默认显示英文。
3. 标签 CRUD 必须有服务端 RBAC、DTO 校验、唯一性处理、事务、审计和缓存失效。隐藏按钮不等于权限控制。
4. `productCount` 是聚合值，不能接受客户端写入。列表搜索/筛选/分页在服务端执行且设 pageSize 上限。
5. 被商品 `ProductTag` 引用的标签默认禁止物理删除，API 返回可识别的 409；建议审核级联外键风险并评估 Restrict 约束。停用保留历史关联，公共端隐藏该标签。
6. `colorToken` 只能映射到项目白名单设计 Token，不接收任意 CSS。表格与表单使用相同 TagBadge 预览组件。
7. 使用统一新建/编辑 Drawer；错误文案、字段标签和状态提示使用 i18n，覆盖 `zh-CN` / `en-US`。
8. 检查 `featured` / `new-arrival` 是否和 `Product.isFeatured` / `Product.isNew` 重复；未经差异统计、迁移方案和验收，禁止自动删除或合并。
9. 删除需要同时处理 RBAC、引用数二次校验、审计与缓存。不得在删除标签时静默级联清理商品关联。
10. 提交前测试创建、编辑、重复 code、翻译、启停、在用删除保护、权限越权、缓存刷新和 360px 响应式；schema 更改必须有版本化 migration 与回滚方案。
