---
name: database-migration-standard
description: PostgreSQL 数据模型、Prisma、索引、约束、迁移与维护 SQL 的规范。
---

# Database & Migration Skill

开始前读取 `AGENTS.md`、`docs/04-data-model.md` 与 `database/sql/README.md`。

## 规则
- 先确认 schema 与现有 migration 历史；不得仅改 `schema.prisma` 而漏掉 migration。
- 每个迁移只解决一个清楚的业务目标，名称说明目的；需要数据回填时把回填逻辑和重跑策略写清楚。
- 新增唯一/外键/检查约束前检查现存数据；为高频过滤与关联字段评估索引。
- 采用 expand/backfill/contract 以支持滚动部署；避免在单次部署中破坏旧代码需要的列。
- 大表变更评估锁与执行时间；生产 migration 先在 staging 和类生产数据量测试。
- 数据库约束作为最后防线：SKU、username、phone_e164、PI No、locale 组合等均需唯一约束。
- 递归品类移动要验证无环；金额用 NUMERIC；UTC 时间戳和索引设计一致。
- 手工维护 SQL 默认只读或 dry-run；删除/更新需显式确认、影响行数检查、事务/回滚计划。
- 任何生产数据查询导出遵守最小权限并脱敏。

## 迁移交付内容
- 迁移名称和目的
- schema 变化/约束/索引
- 现有数据兼容性分析
- 估计锁表/执行影响
- 应用部署顺序
- 回滚或前向修复策略
- 自动化验证结果
