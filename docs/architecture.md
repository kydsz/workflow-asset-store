# 架构总览

技术选型与运行形态的决策依据见 `docs/adr/`，领域词汇见 `CONTEXT.md`。本文只描述当前的结构形状。

## 一句话架构

本地自托管的 TypeScript pnpm monorepo：`packages/core` 是唯一持有领域逻辑与数据访问的深模块，Web、MCP、CLI 三个薄壳进程各自消费 core，共享同一个 SQLite 库与一个数据目录。

## 目录结构

```
/
├── CONTEXT.md
├── docs/adr/
├── packages/
│   └── core/                  # 领域模型 + 数据访问 + 入库解析（唯一的"重"模块）
│       └── src/
│           ├── domain/        # Recipe(生成配方) / GenerationRecord / Artifact 类型 + DomainError
│           ├── db/            # Drizzle ORM schema 与仓库（better-sqlite3 驱动，ALTER 试错做旧库升级）
│           ├── ingest/        # 入库管线：嗅探 → 解析 → 去重 → 落库（1 记录 N 产物、needs_manual）
│           ├── extractors/    # 生成工具元数据解析器（当前仅 ComfyUI PNG tEXt / JSON）+ 模板化与规范化
│           ├── recipes/       # 配方身份（模板哈希归并）、新建/补挂/复制/带参导出
│           └── storage/       # 文件存储抽象：copy 模式按内容哈希落 data/files，reference 模式指原路径
├── apps/
│   ├── web/                   # Next.js 16 App Router：src/webApi.ts 适配层 + 页面 + app/api 路由 + Server Actions
│   ├── mcp/                   # MCP stdio server：六个工具，直调 core
│   └── cli/                   # 占位（package.json），commander 未引入
└── data/                      # ASSET_DATA_DIR，运行时生成：asset-store.db + files/ + uploads/
```

`packages/core` 是 composite TS 项目引用，产物在 `dist/`；vitest 用 alias 直接读 `src`，所以改 core 后不重建 `dist` 时测试仍全绿而 web/MCP 跑的是旧代码。

## 关键数据流

入库（ADR-0004）：源文件 → `sniffSource` 选 extractor（ComfyUI 元数据优先）→ 解析不到的字段标 `needs_manual` 交手动补录 → 按文件内容哈希去重（命中已有记录则不重复入库）→ 工作流按**模板哈希**归并到唯一配方（ADR-0007），当次提示词/seed 等运行值写在生成记录上 → storage 层按 copy/reference 安置文件 → 写入一条生成记录 + N 个产物（同一批次不拆记录）。

读路径：Web 与 MCP/CLI 都只经 core 的仓库接口取数，任何一处不得绕过 storage 抽象直接拼文件路径。Web 的 `src/webApi.ts` 是 core 与页面之间的唯一适配层（列表卡片、详情、待补录、PATCH 编辑、FormData 上传、文件读取带路径穿越防护），`app/api/*` 路由与 Server Actions 都只调它。

检索（ADR-0006）：一条 SQL 内组合 `LIKE` 全文命中（提示词 / 备注 / 参数 JSON / 配方名）与结构化过滤（工具、媒体类型、有无配方、待补录、时间区间），排序与 limit 同在 SQL 层，不引入 FTS5。

## 数据目录

`ASSET_DATA_DIR`（缺省 `./data`，Web 侧相对 `process.cwd()` 解析）下三样东西：`asset-store.db`（SQLite）、`files/`（copy 模式复制入库的媒体与工作流 JSON，按内容哈希命名）、`uploads/`（入库暂存）。缩略图目录与回收站尚未实现：前端经 `/api/files/**` 直接读原文件，删除功能本身未落地。整目录可拷贝即备份，指到新位置即恢复。

## 批量与归属约定

一条生成记录可携带 N 个产物（ComfyUI 批跑一批算一条记录）；只有生成配方、尚无生成记录的"纯收藏"（含仅收藏一段提示词模板）是合法状态。工作流文件形态的配方允许先建档、后补挂文件。所有条目带 `owner` 字段，MVP 恒为 `local`（ADR-0005）。

## 界面侧约定

中英双语（`zh` 默认，词典在 `apps/web/lib/locale.ts`）与明暗主题（自研 ThemeProvider，localStorage 持久化 + `next/script` 首屏前上色）都在 Web 壳内实现，core 不感知；i18n 只覆盖展示文案，数据字段名不翻译。

## 技术清单

TypeScript 7、pnpm workspaces、Drizzle ORM + better-sqlite3、Next.js 16 + React 19、Tailwind v4 + shadcn/ui（radix 原语）+ sonner、@modelcontextprotocol/sdk + zod、Vitest 5。sharp（缩略图）与 ffmpeg/ffprobe（视频元数据与抽帧）为规划中依赖，未引入。

## 演进留白（非承诺）

局域网多人访问时以反向代理 + 最简 token 过渡，仍不做应用内登录；数据量或并发触及 SQLite 上限时再评估 Postgres 迁移，schema 保持可迁移写法。
