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
