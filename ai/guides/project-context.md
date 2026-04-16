# 项目上下文说明

> 提供给 AI 的项目背景信息，便于快速理解项目结构和技术选型。

## 项目简介

本仓库（npm 包名 `tool`）是基于 Vue 3 + Vite 构建的前端工具集项目，通过 GitHub Pages（`docs/` 目录）进行部署。线上地址：<https://miloweimo.github.io/tool/>。路由为 **哈希模式**（`#/…`），与 `vite.config.ts` 中的 `base: '/tool/'` 配合，形如 `https://miloweimo.github.io/tool/#/camera-mirror`。

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue 3 | ^3.3.11 | 前端框架 |
| Vite | ^5.0.10 | 构建工具 |
| TypeScript | ~5.3.0 | 类型系统 |
| Pinia | ^2.1.7 | 状态管理 |
| Vue Router | ^4.2.5 | 路由管理 |
| Vitest | ^1.0.4 | 单元测试 |
| Cypress | ^13.6.1 | E2E 测试 |

## 目录结构

```
tool/
├── src/           # 源代码
│   └── tools/     # 小工具注册表与筛选（首页与路由共用）
├── public/        # 静态资源
├── docs/          # 构建产物（部署到 GitHub Pages）
├── cypress/       # E2E 测试
├── ai/            # AI 开发文档（本目录）
└── ...
```

## 常用命令

```bash
pnpm dev          # 启动开发服务器
pnpm build        # 构建
pnpm gh           # 构建并输出到 docs/ 目录（用于 GitHub Pages）
pnpm test:unit    # 运行单元测试
```

## 编码规范

- 使用 TypeScript，避免 `any`
- 组件使用 `<script setup>` 语法
- 样式优先使用 scoped CSS
- 遵循项目已有的 ESLint + Prettier 配置
