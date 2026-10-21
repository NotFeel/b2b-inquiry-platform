---
name: qa-ops-standard
description: 功能验收、安全回归、部署检查、可观测性与故障处置的开发技能规范。
---

# QA & Operations Skill

先读 `AGENTS.md`、`docs/10-deployment-ops.md`、`docs/12-test-acceptance.md`、`docs/13-security-privacy.md`。

## QA 规则
- 每个需求转化为可验证的 Given/When/Then 或明确的输入/预期结果。
- 必须覆盖正常路径、边界、权限失败、依赖失败、并发/重复提交和恢复路径。
- 前台发布前专项检查价格字段从 API JSON、HTML 源码、hydration payload、metadata、缓存中完全消失。
- 上传测试包含伪造 MIME、错误扩展名、损坏文件、超大文件、恶意文件名和超时场景。
- Excel 生成测试包含公式注入和模板字段缺失；PI 测试金额精度、币种、舍入及历史快照。
- 响应式至少检查 360px 手机、平板和桌面；后台双语翻译没有遗漏。

## 运维规则
- 任何新增环境变量更新 `.env.example` 和部署文档，真实值不得提交。
- 队列任务包含超时、有限重试、失败记录、幂等与监控指标。
- 数据库迁移在 staging 验证；高风险变更确认备份和恢复/回滚方案。
- 文件删除失败不能默默忽略；设置重试任务与告警。
- 日志带 requestId/jobId，但不得包含秘密、完整电话号码或原始 IP。

## 发布结论格式
给出通过/阻塞状态、测试清单及结果、未解决缺陷、迁移与回滚、监控/告警变化、已知风险和验收人建议。
