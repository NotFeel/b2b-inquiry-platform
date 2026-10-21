---
name: backend-api-standard
description: NestJS API、RBAC、安全校验、业务逻辑、文件处理与异步任务的开发规范。
---

# Backend API Standard Skill

开始前必须读取根目录 `AGENTS.md`、`docs/05-api-contract.md`、`docs/07-backend-standard.md` 与相关领域文档。

## 实施步骤
1. 确认该操作的 actor、权限 code、输入/输出 DTO、状态规则和审计要求。
2. 编写 DTO/schema 和业务规则；所有外部输入进行服务端校验。
3. 在 Service/Use Case 实现业务流程，Controller 只做 HTTP 协调；数据访问放入明确的数据访问层。
4. 需要长耗时/文件处理时创建队列任务与状态查询，不在请求中同步执行。
5. 加入事务、唯一约束、幂等、错误码、requestId/jobId 日志字段。
6. 添加单元/集成测试，验证成功、非法输入、无权限、并发冲突与依赖失败。

## 不可违反规则
- 所有管理端点使用认证与权限校验；默认 deny-by-default。
- 不提供后台自助注册；初始化管理员使用受控 bootstrap 流程。
- 公共商品接口返回白名单 DTO，绝不输出 `price_cny`、`unit_price` 等价格字段。
- 不依赖隐藏菜单/按钮实施安全授权。
- 不用 float 做金额运算；PI/报价用 Decimal 并由服务端重算。
- 客户电话统一规范化；电话唯一约束落库；客户主档和询盘活动分离。
- 文件按随机 key 存储，下载重新鉴权；不要把用户文件写入源码目录。
- 外部对象存储和数据库没有原子事务；用删除任务/outbox 和幂等重试。
- 不在日志输出 password、cookie、token、完整客户电话、原始 IP、文件内容。
- 未经确认，不新增第三方服务、改 API 版本或升级关键依赖主版本。

## 交付说明
每次变更列出权限 code、接口、数据库迁移、错误码、事务/幂等设计、测试命令和运维影响。
