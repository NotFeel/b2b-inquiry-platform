# 03. 项目目录规划

```text
b2b-inquiry-platform/
├── AGENTS.md                         # AI 开发全局强制规则
├── README.md
├── package.json                      # root workspace scripts
├── pnpm-workspace.yaml
├── turbo.json                        # 可选：构建任务编排
├── .env.example                      # 环境变量示例，禁止真实密钥
├── .gitignore
├── .editorconfig
├── .prettierrc.json
├── eslint.config.mjs
├── apps/
│   ├── storefront/                   # 前台 Next.js，英文、SEO、响应式
│   │   ├── app/[locale]/...
│   │   ├── components/
│   │   ├── features/catalog/
│   │   ├── messages/en-US.json
│   │   └── public/
│   ├── admin/                        # 后台 Next.js，中英双语
│   │   ├── app/[locale]/...
│   │   ├── features/
│   │   ├── components/
│   │   └── messages/{zh-CN,en-US}.json
│   ├── api/                          # NestJS REST API
│   │   ├── src/modules/{auth,users,rbac,categories,products,...}/
│   │   ├── src/common/{guards,filters,pipes,interceptors}/
│   │   └── test/
│   └── worker/                       # Excel/PDF/图片与清理任务
│       ├── src/jobs/
│       └── test/
├── packages/
│   ├── contracts/                    # 共享 API 类型与 schema
│   ├── ui/                           # 设计 Token、通用 UI
│   ├── i18n/                         # locale 配置与公共翻译工具
│   ├── validation/                   # 共用输入校验 schema
│   ├── eslint-config/
│   └── tsconfig/
├── database/
│   ├── prisma/
│   │   ├── schema.prisma             # 数据模型定义
│   │   └── migrations/               # 版本化数据库迁移
│   └── sql/
│       ├── seeds/                    # 可重复执行的参考/初始数据脚本
│       ├── maintenance/              # 需要审查的运维脚本
│       ├── reports/                  # 只读排查/报表查询
│       └── README.md
├── docs/                             # 产品、技术、部署、验收等文档
├── .agents/skills/                   # AI 可按需加载的技能文档
│   ├── frontend-ui/SKILL.md
│   ├── backend-api/SKILL.md
│   ├── database-migration/SKILL.md
│   └── qa-ops/SKILL.md
├── infra/
│   ├── docker-compose.dev.yml
│   ├── docker/
│   ├── nginx/
│   └── scripts/
└── tests/
    ├── e2e/
    ├── fixtures/
    └── performance/
```

## 文件放置规则

- 产品/技术/操作/验收文档：统一放 `docs/`，文件名带两位序号，便于阅读顺序。
- AI 规则：全局不可违反规则放根目录 `AGENTS.md`；可复用的任务技能放 `.agents/skills/<skill-name>/SKILL.md`。
- 业务代码：按应用和业务模块组织，禁止把全部逻辑堆进单个 `utils.ts`、Controller 或页面组件。
- 数据库模型和迁移：`database/prisma/`。迁移必须随代码入库，名称包含时间/业务目的。
- 手工 SQL：只放 `database/sql/seeds`、`maintenance`、`reports`。线上变更默认走版本化迁移；任何手工生产 SQL 必须双人审核、备份并有回滚脚本。
- 产品图片等运行时上传文件不得提交到 Git；对象存储保存真实文件，代码仓库只保留必要的占位示例图。
- 生成的导出 Excel、PDF、临时文件和用户上传文件不得写入源码目录；本地开发可用 `./.data`（加入 `.gitignore`），生产使用对象存储/独立挂载盘。
- 测试数据与真实客户数据分离；fixture 使用虚构 SKU、虚构电话和虚构公司信息。
- `.env` 文件只在本地/部署环境存在；提交 `.env.example` 中变量名、说明和安全默认值，不放真实密钥。

## 根脚本建议

```json
{
  "scripts": {
    "dev": "turbo dev",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck",
    "test": "turbo test",
    "build": "turbo build",
    "format:check": "prettier --check ."
  }
}
```

脚本需根据实际初始化结果调整；不能以“示例脚本存在”代替 CI 真正执行。
