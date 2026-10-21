# Menu Management Skill — 强制规则

## 开始前
- 必须先阅读根目录 `AGENTS.md`、`docs/19-menu-management-crud-and-submenu-design.md`、前后台 UI 规范、后端规范及角色权限方案。
- 检查真实仓库中现有菜单 API、路由、权限码、Prisma schema、迁移、i18n 与缓存策略。文档仅是目标设计，不能视为现有功能已实现。
- 不得直接删除当前重复显示的 `administration` / `system` 菜单；必须先追踪 ID、子节点、route、permissionCode、种子和角色授权引用。

## 数据与业务规则
- Menu 是导航配置；Permission + RolePermission 是服务端授权来源。不得新建一套与之冲突的角色菜单授权机制。
- 菜单 CRUD 与 MenuTranslation 更新需要服务端校验并尽量在同一事务中完成。
- `code` 创建后稳定且不可通过普通编辑修改；翻译 label 可随 locale 更新。
- permissionCode 必须从现有权限目录中验证；禁止硬编码前端权限选项或把菜单修改当成权限授予。
- 验证父菜单存在、不可自为父级、不可形成循环、路由格式与唯一性、locale 合法性、权限 code 存在性和排序同级约束。
- 删除有子菜单或系统关键菜单应拒绝；删除菜单不得级联删除 Permission / RolePermission。所有敏感变更写审计。
- `enabled`、`visible` 和 API 授权必须区分；隐藏菜单不能被解释为 API 权限控制。
- 每次变更后让菜单树缓存失效；角色权限变更仍须沿用现有权限缓存失效流程。

## UI 与国际化
- 菜单主列表使用树形结构，支持查询、展开/折叠、添加一级菜单、添加子菜单、编辑、排序、启停/可见和受保护删除。
- 新建和编辑复用一个 Drawer；字段有 label、必填、校验、loading、错误状态和未保存确认。
- 翻译表单依据 locale 配置动态生成；至少支持 `zh-CN` 和 `en-US`，不得增加固定 `nameZh`/`nameEn` 数据库列替代翻译表。
- 不得显示无功能按钮；不使用虚构数据作为 API 已成功的证据。

## 测试与交付
- 覆盖 CRUD、树循环、父子约束、重复 code/route、缺失权限、未知 locale、删除保护、权限拒绝、缓存失效、审计、移动端布局。
- schema 有变化必须提交 Prisma migration、回填和回滚说明；没有必要不要增表/加字段。
- 交付时汇报具体文件、API、migration、测试命令及真实测试结果；不能声称未运行的检查已通过。
