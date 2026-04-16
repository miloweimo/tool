# GitHub Pages 子路径改为 `/tool/`

**日期**：2026-04-16

**类型**：构建 / 部署

## 改动说明

- [`vite.config.ts`](../../vite.config.ts)：`base` 由 `/tools/` 改为 `/tool/`，与仓库名及 GitHub Pages 地址一致。
- [`package.json`](../../package.json)：包名 `tool`；E2E 脚本等待 URL 改为 `http://localhost:4173/tool`。
- [`cypress.config.ts`](../../cypress.config.ts)：`baseUrl` 同步为上述路径。
- [`src/router/index.ts`](../../src/router/index.ts)：注释中的示例线上 URL 更新。
- [`src/utils/theme.ts`](../../src/utils/theme.ts)：`localStorage` 主键改为 `tool-theme`，仍可读旧键 `tools-theme`；写入新主题时移除旧键。
- [`src/views/tools/GanttChartView.vue`](../../src/views/tools/GanttChartView.vue)：持久化主键改为 `tool-gantt-v1`，若仅有旧键 `tools-gantt-v1` 则在加载成功后迁移并删除旧键。
- [`README.md`](../../README.md)、[`ai/guides/project-context.md`](../../ai/guides/project-context.md)、[`ai/guides/dev-tasks.md`](../../ai/guides/dev-tasks.md)：文档中的路径与说明对齐。
- 执行 `pnpm gh` 重新生成 [`docs/`](../../docs/) 下的静态资源路径前缀。
- [`vitest.config.ts`](../../vitest.config.ts) 增加 [`src/test/vitest.setup.ts`](../../src/test/vitest.setup.ts)：在单元测试里提供可用的内存 `localStorage`（避免 Node 实验性 API 与 jsdom 冲突导致 `theme` 用例失败）。
