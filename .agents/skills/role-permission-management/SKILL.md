---
name: role-permission-management
description: 后台角色 CRUD、菜单权限树、RBAC 授权和安全删除的专项开发规范。
---

# Role & Permission Management Skill

开始前必须读取：
- 根目录 `AGENTS.md`
- `docs/06-admin-public-ui-standard.md`
- `docs/07-backend-standard.md`
- `docs/18-role-permission-crud-and-menu-permissions.md`
- 现有 Prisma Role / Permission / RolePermission / UserRole / Menu 数据模型

## 强制执行步骤

1. 先检查已有角色、权限、菜单 API、RBAC Guard/Decorator、审计和权限缓存；只补缺口，不重复造模块。
2. 校验 `Menu.permissionCode` 与 `Permission.code` 的映射、`Permission.module` 约定和 `Role.nameKey` 翻译资源。
3. 把 `Permission.code` + `RolePermission` 作为授权事实来源；不得另造并行的 RoleMenu 授权数据源。
4. 角色创建仅允许自定义角色；客户端不能设置 `isSystem=true`、permissionCount、userCount 等服务端计算字段。
5. 角色基础信息编辑与权限集合更新分离；分别检查 `roles.update` 与 `roles.permissions.update`。
6. 权限保存必须由服务端校验 actor、目标角色、所有 permission code、可授予范围和系统角色保护，在事务内替换 RolePermission，写审计并失效权限缓存。
7. 系统角色不可编辑/删除；有用户关联的角色不可删除。相关规则必须在后端强制，不能只禁用 UI 按钮。
8. 权限树的父节点状态由 permission code 集合推导；搜索过滤不可篡改未显示的已选权限。
9. 所有后台文案提供 zh-CN / en-US；权限 code 作为稳定机器标识，不翻译。
10. 完成创建、保存、重读回显、角色实际权限验证、越权请求、并发更新、删除保护、审计和缓存测试。

## 不可违反规则

- 隐藏菜单或按钮不是安全授权，所有端点必须在后端 fail-closed。
- 不允许普通管理员授予自己没有权力分配的权限；超级管理员行为应由明确服务端策略决定。
- 不能静默忽略无效 permission code，也不能部分保存权限。
- 不得删除系统角色或删除仍被用户关联的角色。
- 不得将角色 code、权限 code 或 menu code 作为展示语言判断逻辑。
- 不能把 `Role.nameKey` 当作用户可随意输入的实际名称，必须先确认现有国际化方案。
- 任何数据库变化必须有 Prisma migration、回填/回滚说明和测试。

## 完成报告

交付说明必须列明：UI 变更、API 变更、permission code、事务/审计/缓存方案、迁移情况、测试命令及结果、已知风险。
