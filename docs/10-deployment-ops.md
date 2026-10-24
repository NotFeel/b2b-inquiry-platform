# 10. 部署、发布与运维规范

## 1. 环境划分

当前目标架构见 `docs/33-lightweight-cloudflare-neon-r2-implementation.md`。代码已使用
PostgreSQL task runner，生产 runtime 不再需要 Redis；SQLite 不在目标范围。

- `local`：开发电脑，Docker Compose 启动 PostgreSQL；非 R2/S3 环境可使用 `.data/`
  和 multipart 上传 fallback。
- `test`：自动化测试环境，使用独立数据库、对象存储桶和虚构测试数据。
- `staging`：尽量匹配生产配置，验证迁移、文件处理、权限、备份恢复和容量。
- `production`：只使用受控密钥管理、TLS、私网数据库、对象存储私有桶和独立服务账号。

禁止将本地 `.env` 复制进镜像或提交 Git；环境之间不能共用生产数据库或对象存储桶。

## 2. 部署组件

- Web：Storefront、Admin 分开构建/部署，可共享 CDN 入口但路由隔离。
- API：NestJS，至少一实例；扩容前确认 Session 与队列状态不依赖单实例内存。
- Runner：独立部署的低并发 task runner，轮询 PostgreSQL 任务表；初始并发 1，
  不监听公网端口。
- DB：PostgreSQL 私有网络、自动备份、连接池、监控慢查询与磁盘。
- Redis：目标生产架构不部署。回滚只能回退到保留的旧镜像，不能让新旧消费者并行处理同一类任务。
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

1. 创建 Neon database/branch、R2 public/private bucket 和最小权限服务账号。
2. 在安全密钥系统设置数据库 URL、Session 密钥、对象存储凭据、WhatsApp 号码、GeoIP 配置等。
3. 使用 `DIRECT_DATABASE_URL` 在 staging/生产独立 release job 执行迁移；runtime 使用 pooled URL。
4. 执行受控 bootstrap 命令创建初始管理员并强制首次改密。
5. 启动 API、Worker、Admin、Storefront；验证 health/readiness。
6. 配置域名、HTTPS、CDN 缓存规则、R2 CORS、presigned URL、备份与监控告警。
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

最低监控：Web/API 可用性、5xx、P95 latency、Neon/SQL 连接、PG 任务积压与租约超时、
Excel 导出失败率、对象存储访问错误、磁盘临时目录、登录失败、
文件删除任务积压和访问量采集异常。

日志字段推荐 `timestamp, level, service, environment, requestId, jobId, actorId(optional), action, durationMs, errorCode`。禁止记录密码、Token、完整 IP、客户完整电话和文件内容。

## 7. 故障处理手册

- API 不可用：查看入口/TLS、容器状态、readiness、数据库连接、最近部署版本；必要时回滚应用。
- Excel 导出队列积压：检查 worker 健康、临时磁盘、内存和失败任务；暂停新任务
  避免资源耗尽。
- 上传失败：检查签名 URL、Bucket 权限、大小限制、MIME 验证、存储配额。
- 文件删除失败：查看 `file_deletion_jobs` 与错误码，重试幂等删除；不要通过手动删数据库记录掩盖残留对象。
- 删除任务长期 `QUEUED`：确认 task runner 正在轮询同一数据库，检查 `runAfter`、
  `attempts`、`lockedBy`、`lockedUntil` 与 storage bucket 配置。租约过期的 PROCESSING
  任务可被重新领取。
- 数据异常：停止可能继续写坏数据的任务，保留日志和 requestId，按备份/审计步骤核查；操作前复制相关记录到安全诊断环境并脱敏。

## 8. 运维交付清单

每个发布版本附带：版本号/提交号、迁移编号、环境变量变化、部署步骤、烟雾测试、风险点、回滚步骤、监控变化、备份确认和负责人。


## 9. 后端发布包与历史版本磁盘清理

东京服务器只有 30GB 磁盘且内存紧张，生产服务器不得执行 pnpm install 或构建。GitHub Actions 在构建、测试、数据库迁移完成后安装生产依赖，将工作区包、生成的 Prisma Client 和运行依赖一并打包；服务器只做归档校验、解压、版本切换、systemd 重启和健康检查。

### 9.1 保留期限与数量

- `/opt/b2b-inquiry-platform/releases/`：保留当前版本 + 最近 2 个完整历史版本，最多 3 个完整版本目录；历史版本按目录修改时间排序。
- 当前 `current` 指向的版本永不由清理逻辑删除。
- 不完整且非当前的发布目录，在下一次成功部署清理时删除；若同一 SHA 重试部署，会先验证目录，只有确认其不完整且不是当前版本才删除重建。
- 部署失败时，切回上一个版本；失败的新版本解压目录会删除。失败压缩包和上传的部署脚本保留用于排查，超过 24 小时后在下一次部署开始时清理（没有后续部署时不会由此脚本定时清理）。
- 部署成功后立即删除本次压缩包和上传的部署脚本；并清理 `incoming/` 中超过 24 小时的遗留发布文件。
- `shared/.env`、`shared/geoip/`、日志、数据库和对象存储数据不属于发布版本清理范围，禁止通过版本清理脚本删除。
- 每次部署解压前，若所在文件系统可用空间不足 1.5 GiB，直接拒绝部署，防止磁盘写满。这个阈值是安全下限，不代表建议长期只剩 1.5 GiB。

### 9.2 清理触发时机

清理在部署健康检查成功后执行；失败时只删除本次失败的解压目录，不删除旧的有效回滚版本。清理按目录与 SHA 操作，不按宽泛通配符删除整个 `releases/` 或 `shared/`。上线前应在服务器执行 `df -h`、`du -sh /opt/b2b-inquiry-platform/releases /opt/b2b-inquiry-platform/incoming` 确认空间。

### 9.3 回滚边界

保留历史应用版本不等于数据库可以回滚。生产数据库迁移继续遵循 expand → migrate/backfill → contract；旧应用只有在与当前 schema 兼容时才可回滚。清理机制只删除应用发布文件，不删除数据库数据或 R2 对象。
