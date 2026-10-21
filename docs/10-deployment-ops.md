# 10. 部署、发布与运维规范

## 1. 环境划分

轻量化部署、移除 Redis 与 SQLite 的评估另见 `docs/31-lightweight-deployment-sqlite-redis-image-optimization.md`。本文件中的 PostgreSQL/Redis 步骤描述的是当前标准部署基线，不代表已完成去 Redis 或 SQLite 迁移；未完成相应代码与数据验证前，不得直接移除生产服务。

- `local`：开发电脑，Docker Compose 启动 PostgreSQL / Redis；上传可使用 `.data/` 本地目录。
- `test`：自动化测试环境，使用独立数据库、对象存储桶和虚构测试数据。
- `staging`：尽量匹配生产配置，验证迁移、文件处理、权限、备份恢复和容量。
- `production`：只使用受控密钥管理、TLS、私网数据库、对象存储私有桶和独立服务账号。

禁止将本地 `.env` 复制进镜像或提交 Git；环境之间不能共用生产数据库或对象存储桶。

## 2. 部署组件

- Web：Storefront、Admin 分开构建/部署，可共享 CDN 入口但路由隔离。
- API：NestJS，至少一实例；扩容前确认 Session 与队列状态不依赖单实例内存。
- Worker：独立部署，根据商品报价/PI Excel、图像、清理和聚合队列负载扩容。
- DB：PostgreSQL 私有网络、自动备份、连接池、监控慢查询与磁盘。
- Redis：任务队列与必要缓存；设置认证、网络隔离、内存上限与持久性策略（根据任务风险选择）。
- 对象存储：私有 Bucket、最小权限访问、版本/生命周期策略（结合业务删除要求谨慎配置）。
- 入口：Nginx 或托管入口处理 TLS、请求大小、速率限制、压缩和安全响应头。

后台浏览器统一请求 Admin 同源的 `/api/v1/*`，由 Next 服务端代理到
`ADMIN_API_PROXY_TARGET`（默认 `http://localhost:3002`）。该目标只要求 Admin
服务端可访问，不需要暴露给浏览器；拆分部署时设置该变量即可，无需把内部 API
地址写进客户端 bundle。Admin 开发使用 `.next-dev`、生产构建使用 `.next`，
因此可以在开发服务运行期间执行生产构建，两个进程不会覆盖彼此产物。

前台询盘 POST `/api/v1/public/inquiry-intents` 同样由 Storefront Next 服务端
代理到 `STOREFRONT_API_PROXY_TARGET`（默认 `http://localhost:3002`）。浏览器
只访问前台同源路径，因此不会因 `x-session-id` 请求头触发跨域预检；生产环境需
确保 Storefront 服务端可访问该目标，并验证代理后的客户端 IP 与限流行为。

## 3. 首次部署流程

1. 创建数据库、Redis、对象存储桶和最小权限服务账号。
2. 在安全密钥系统设置数据库 URL、Session 密钥、对象存储凭据、WhatsApp 号码、GeoIP 配置等。
3. 执行数据库迁移；先在 staging 验证，再执行生产迁移。
4. 执行受控 bootstrap 命令创建初始管理员并强制首次改密。
5. 启动 API、Worker、Admin、Storefront；验证 health/readiness。
6. 配置域名、HTTPS、CDN 缓存规则、上传回调/签名 URL、备份与监控告警。
7. 完成前台无价格泄漏、登录 RBAC、WhatsApp、文件上传、Excel 导出和备份恢复
   烟雾测试。

## 4. 数据库迁移与回滚

- 每个迁移进入 Git 并在 CI 对空库/升级库执行测试。
- 遵循 expand → migrate/backfill → contract；避免部署瞬间删除应用仍在读的列。
- 备份完成且可恢复后才做高风险迁移；迁移脚本必须考虑锁表、耗时和大表索引创建方式。
- 回滚优先采用前向修复；数据破坏性迁移必须有事先验证的恢复/回滚策略。
- 生产环境禁止开发者直接运行未经审查的临时 SQL。

## 5. 备份与恢复

- 数据库：按业务 RPO/RTO 目标确定自动备份频率、保留期和 PITR 能力。
- 对象存储：版本控制/复制/生命周期策略与合规删除要求一起设计。
- 至少定期演练一次完整恢复，记录恢复时长、丢失数据范围和修正动作。
- 备份中包含敏感数据时必须加密、限制访问并设置保留期。

## 6. 监控与告警

最低监控：Web/API 可用性、5xx、P95 latency、数据库连接/CPU/磁盘、Redis
队列积压、Excel 导出失败率、对象存储访问错误、磁盘临时目录、登录失败、
文件删除任务积压和访问量采集异常。

日志字段推荐 `timestamp, level, service, environment, requestId, jobId, actorId(optional), action, durationMs, errorCode`。禁止记录密码、Token、完整 IP、客户完整电话和文件内容。

## 7. 故障处理手册

- API 不可用：查看入口/TLS、容器状态、readiness、数据库/Redis连接、最近部署版本；必要时回滚应用。
- Excel 导出队列积压：检查 worker 健康、临时磁盘、内存和失败任务；暂停新任务
  避免资源耗尽。
- 上传失败：检查签名 URL、Bucket 权限、大小限制、MIME 验证、存储配额。
- 文件删除失败：查看 `file_deletion_jobs` 与错误码，重试幂等删除；不要通过手动删数据库记录掩盖残留对象。
- 删除任务长期 `QUEUED`：确认 worker 正在消费、API 与 worker 使用同一个 `REDIS_URL`，且两者 `STORAGE_DRIVER`/桶配置一致。worker 每 `FILE_DELETE_SWEEP_INTERVAL_SECONDS`（默认 30 秒）会从数据库 outbox 恢复超过 60 秒未被处理的任务；恢复成功前图片保持 `DELETE_PENDING`，不会假报已物理删除。
- 数据异常：停止可能继续写坏数据的任务，保留日志和 requestId，按备份/审计步骤核查；操作前复制相关记录到安全诊断环境并脱敏。

## 8. 运维交付清单

每个发布版本附带：版本号/提交号、迁移编号、环境变量变化、部署步骤、烟雾测试、风险点、回滚步骤、监控变化、备份确认和负责人。
