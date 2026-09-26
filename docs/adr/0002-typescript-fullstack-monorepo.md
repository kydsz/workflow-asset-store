# TypeScript 全栈 monorepo

项目需要一个展示图片/视频的 Web 界面，同时要以 MCP Server 和 CLI 供 AI 读写同一套领域逻辑。我们决定采用 TypeScript 全栈、pnpm workspace 单仓：`packages/core` 持有领域模型与入库解析，`apps/web`（Next.js）、`apps/mcp`、`apps/cli` 都只做壳，复用 core。选 TS 而非 Python 的理由：MCP 官方 SDK 以 TS 为先，且 Web 前端本来就必须是 TS，单一语言降低个人维护成本。
