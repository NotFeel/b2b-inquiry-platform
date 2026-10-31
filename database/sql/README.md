# SQL 与迁移文件存放规则

## 单一事实来源

数据库正式结构以 `database/prisma/schema.prisma` 与 `database/prisma/migrations/` 中已审查并提交的迁移为准。不要同时维护一份手工“全量建表 SQL”并声称它与 ORM schema 自动同步；否则会产生双重事实来源。

## 目录用途

- `database/prisma/schema.prisma`：实体、字段、关系与约束定义。
- `database/prisma/migrations/<timestamp>_<purpose>/migration.sql`：生成后审查的版本化迁移 SQL；与代码一起提交。
- `database/sql/seeds/`：字典、权限代码或非敏感参考数据初始化脚本。要求幂等，不得含真实管理员密码。
- `database/sql/maintenance/`：线上诊断/维护 SQL。默认 dry-run，须说明风险、影响行数和回滚方式。
- `database/sql/reports/`：只读报表/排查查询；涉及客户个人信息需脱敏和授权。

## 执行规则

1. 本地先生成迁移并检查 SQL，不可只看 Prisma schema diff。
2. CI 在空数据库与上一版本测试数据库上分别验证迁移。
3. staging 应先执行；生产执行前确认备份、窗口、告警和回滚/前向修复方案。
4. 不把生产连接串放在 SQL 文件、截图或命令历史里。
5. 初始化权限和字典的脚本用 `INSERT ... ON CONFLICT` 或等价幂等写法，并保留系统锁定标识。

## 报价单导出菜单与权限增量数据

`database/sql/seeds/20261030_quotation_export_menu_permissions.sql` 用于修复已有数据库尚未同步
`products.quotation-export` 菜单、双语翻译和报价单导出权限的问题。它属于可重复执行的数据脚本，
不是 schema migration；脚本会校验父菜单、系统角色、路由冲突和最终授权数量，任一检查失败时整笔事务回滚。

本地 PostgreSQL 容器启动后，可直接进入开发容器执行：

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres
docker compose -f infra/docker-compose.dev.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U app -d b2b_catalog \
  < database/sql/seeds/20261030_quotation_export_menu_permissions.sql
```

执行后刷新 Admin 页面即可重新读取导航；当前权限守卫每次请求都读取数据库，不依赖进程内权限缓存。
如需回滚，先确认没有其他功能引用这些记录，再按 SQL 文件末尾列出的语句单独执行。

## Excel 转 PDF 菜单与权限增量数据

`database/sql/seeds/20261030_excel_pdf_menu_permissions.sql` 为已有数据库补齐
`excel-pdf` 菜单、双语翻译和 `excel_pdf.*` 五项权限。脚本只给 `super_admin` 授权，
不会默认授予普通业务角色重试或删除能力。

正常情况下不再需要手工执行此文件：本地 `pnpm dev`、测试/staging 和生产 API 启动时都会以
`--reference-only` 自动、幂等地同步 reference data；生产发布脚本也会在切换应用前执行同一同步。
进程级启动失败会阻止 API 监听端口。下面的 SQL 仅用于 API 无法启动时的受控诊断/恢复兜底，
执行方式与上方 SQL 相同：

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres
docker compose -f infra/docker-compose.dev.yml exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U app -d b2b_catalog \
  < database/sql/seeds/20261030_excel_pdf_menu_permissions.sql
```

脚本在单个事务内校验父菜单、系统角色、路由冲突和最终记录数；任一断言失败都会
回滚。回滚和生产前检查要求见文件末尾，功能停用应优先关闭
`EXCEL_PDF_ENABLED`，保留任务、审计和私有文件历史。
