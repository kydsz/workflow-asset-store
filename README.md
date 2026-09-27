# Workflow Asset Store（AI 工作流资产库）

管理 AI 生成产物的溯源资产库：每张图、每条视频都记录它由什么工具、什么生成配方、什么提示词和参数生成，供人在 Web 上浏览检索，也供 AI 经 MCP / CLI 读写。

本地自托管，单人单库，无登录。

## 文档地图

| 文件 | 内容 |
| --- | --- |
| `CONTEXT.md` | 领域词汇表（生成配方 / 生成记录 / 产物 / 入库 / 归属人），**命名以它为准** |
| `docs/adr/` | 决策依据：两实体模型、TS 单仓、SQLite、copy+reference 双模式、owner 预留、检索与参数存储口径（0006）、配方身份=模板哈希（0007） |
| `docs/architecture.md` | 目录结构与数据流形状 |
| `docs/user-workflows.md` | MVP 完整操作流程与「明确不做」边界（带实现状态标注） |
| `docs/agents/` | Agent 技能如何消费本仓库的 issue 跟踪与领域文档 |

## 当前状态

MVP 主链路已可日常使用（2026-09-26）：

- **`@was/core`**：领域模型 + Drizzle/better-sqlite3 仓库；ComfyUI PNG（tEXt 块）/JSON 自动解析；入库管线（内容哈希去重、一批输出合成 1 条记录 + N 个产物、解析缺失字段标 `needs_manual`、配方按**模板哈希**归并）；copy / reference 双模式存储；SQL 级检索、过滤、排序与配方使用统计。
- **`apps/web`**（Next.js 16 App Router + Turbopack）：瀑布流首页与筛选栏、记录详情、配方列表/详情（新建、补挂工作流、复制、带参导出）、待补录队列 `/incomplete`、拖拽入库与手动补录对话框、文件读取 API。中英双语、明暗主题。
- **`apps/mcp`**：stdio server，六个工具——`search_generations`、`get_generation`、`list_recipes`、`get_recipe`、`record_stats`、`ingest`。

尚未实现：

- `apps/cli` 只有 `package.json` 占位，`scan` / `doctor` / `export` 未开工。
- 缩略图与视频首帧（sharp / ffmpeg 未引入，前端直接取原文件）。
- 删除与回收站（无 DELETE 路由，记录只可编辑）。
- 待补录的「忽略该字段」（补全后仍缺会持续留在队列）。

## 环境要求

- Node.js >= 24
- pnpm 11（`packageManager` 已 pin 到 `pnpm@11.7.0`，可用 `corepack enable` 获取）
- TypeScript 7（原生编译器，项目引用 + `tsc -b`）、Vitest 5
- Next.js 16 / React 19 / Tailwind v4 + shadcn(ui radix 原语)
- 原生依赖 `better-sqlite3` v13 随包附带 win32-x64 / win32-arm64 / darwin / linux 预编译二进制，本机实测直接加载，无需编译工具链

MVP 阶段不需要 ffmpeg / ffprobe（视频按原样存取，不抽帧）。

## 快速开始

```bash
pnpm install
pnpm dev          # apps/web → http://localhost:3000
pnpm test         # vitest run，覆盖 core / web 适配层 / mcp
pnpm typecheck    # 各包 tsc
pnpm build        # core 编译 + next build
node apps/mcp/dist/server.js   # MCP stdio（先 pnpm build）
```

运行时数据（SQLite 库、复制入库的媒体与工作流 JSON、入库暂存文件）全部落在数据目录，按 `ASSET_DATA_DIR` 环境变量 > `was-storage.json` 配置文件 > 缺省 `./data` 的顺序解析；环境变量相对 `process.cwd()`，配置文件相对自身所在目录，本地开发缺省即 `apps/web/data/`。配置文件由设置页「存储」卡片写入，改地址只影响下一次启动（Web 与 MCP 走同一套解析）。该目录含真实资产，已被 `.gitignore` 排除，永不入库。备份 = 整目录拷贝，恢复 = 把数据目录指向新位置。

改 `packages/core` 后须在包内跑一次 `pnpm build` 重建 `dist/`：vitest 通过 alias 直接读 `src` 会全绿，而 web 与 MCP 运行时加载的是 `dist`。

## 目录结构

```
/
├── CONTEXT.md
├── docs/{adr,agents}/
├── packages/
│   └── core/                  # 领域模型 + 数据访问 + 入库解析（唯一的"重"模块）
│       └── src/{domain,db,ingest,extractors,recipes,storage}/
├── apps/
│   ├── web/                   # Next.js（App Router）：页面 + app/api 路由 + Server Actions
│   ├── mcp/                   # MCP stdio server（六工具，薄封装 core）
│   └── cli/                   # 占位，未实现
└── data/                      # 运行时生成，不入库
```

## 技术栈

TypeScript、pnpm workspaces、Drizzle ORM + better-sqlite3、Next.js + React、Tailwind v4 + shadcn/ui、@modelcontextprotocol/sdk + zod、Vitest。sharp（缩略图）与 ffmpeg（视频元数据/抽帧）为规划中依赖，尚未声明。

## 开发约定

- 术语沿用 `CONTEXT.md`，不漂移到它标记为 _Avoid_ 的同义词。
- 与既有 ADR 冲突时显式提出，不静默覆盖。
- 任何读文件的路径都必须经 core 的存储抽象，不得假设文件在 `data/` 下（ADR-0004）。
- 新能力按垂直切片推进，RED（先写失败测试）→ GREEN（最小实现）→ 清理。
- `.agents/skills/` 是技能内容的权威位置；`.qoder/`、`.claude/` 只是指向它的机器本地软链，已 gitignore。

## License

MIT — 见 `LICENSE`。
