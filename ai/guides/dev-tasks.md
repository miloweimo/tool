# 开发任务计划

本文档记录与「小工具集」站点相关的里程碑与任务勾选，便于 AI 或人工迭代时对齐进度。

## 里程碑：工具导航主页（2026-03-25）

**目标**：首页提供工具导航与搜索；路由与展示数据来自同一注册表；顶栏简化为工具集品牌。

### 任务清单

- [x] 数据层：在 `src/tools/` 定义 `ToolDefinition`、工具列表 `tools.ts`、`filterTools` 筛选逻辑
- [x] 路由：`src/router/index.ts` 由 `tools` 数组展开子路由，避免重复维护
- [x] 首页 UI：`src/views/HomeView.vue` 搜索框、卡片网格、`RouterLink` 跳转
- [x] 应用壳：`src/App.vue` 精简为顶栏品牌 + `RouterView`
- [x] 示例工具：关于页、占位工具页（`src/views/tools/PlaceholderToolView.vue`）
- [x] 测试：`src/tools/__tests__/filterTools.spec.ts` 覆盖筛选行为
- [x] 验收：`pnpm run type-check`、`pnpm exec vitest run` 通过；本地可访问 `/`、`/about`、`/placeholder`

### 后续待办（接入新工具）

1. 在 `src/views/tools/`（或 `src/views/`）新增工具页面组件。
2. 在 [`src/tools/tools.ts`](../../src/tools/tools.ts) 中追加一项：`name`、`path`、`title`、`description`、`tags`、`component`（懒加载）。
3. 无需再改路由：子路由由注册表自动生成。
4. 可选：为复杂逻辑补充单元测试，并在此文档或 changelog 中记一笔。

---

## 里程碑：摄像头镜子（2026-03-25）

**目标**：调用设备摄像头（优先前置），在页面镜像显示，用作「镜子」；离开页面时释放摄像头。

### 任务清单

- [x] 新增页面 `src/views/tools/CameraMirrorView.vue`：`getUserMedia`、`<video>` 展示、`scaleX(-1)` 镜像、关闭/卸载时 `stop()` 轨道
- [x] 在 [`src/tools/tools.ts`](../../src/tools/tools.ts) 注册工具：`/camera-mirror`，标题、描述、标签便于首页搜索
- [x] 权限与错误提示：拒绝权限、无设备等文案
- [x] 记录：本文件 + [`changelog/2026-03-25-camera-mirror.md`](../changelog/2026-03-25-camera-mirror.md)

### 说明

- 需 **HTTPS** 或 `localhost` 下浏览器才允许摄像头（与站点部署环境一致）。
- 首次使用需用户点击「开启摄像头」以满足用户手势策略。

---

## 里程碑：人形进度环（2026-03-25）

**目标**：摄像头或本地图片作为源，用 Canvas 将人像裁入环形进度扇区；本机处理、不上传；离开页面释放摄像头与 `ObjectURL`。

### 任务清单

- [x] 页面 [`src/views/tools/FaceLoadingRingView.vue`](../../src/views/tools/FaceLoadingRingView.vue)：`getUserMedia`、文件上传、`drawImage` cover、环形扇区 `clip`、`requestAnimationFrame` 刷新、卸载时 `stop()` 与 `revokeObjectURL`
- [x] [`src/tools/tools.ts`](../../src/tools/tools.ts) 注册 `/face-loading-ring`
- [x] [`changelog/2026-03-25-face-loading-ring.md`](../changelog/2026-03-25-face-loading-ring.md) + 本段记录

### 说明

- 与「摄像头镜子」相同，摄像头需 **HTTPS** 或 **localhost**；页内已说明数据不上传。

---

## 里程碑：哈希路由与移动端布局（2026-03-25）

**目标**：GitHub Pages 子路径下使用哈希路由（`/tool/#/…`）；修正模板遗留断点导致的窄屏布局问题；E2E 与 `base: '/tool/'` 对齐。

### 任务清单

- [x] [`src/router/index.ts`](../../src/router/index.ts)：`createWebHashHistory(import.meta.env.BASE_URL)`
- [x] [`src/assets/main.css`](../../src/assets/main.css)：去掉 `min-width: 1024px` 下 `body`/`#app` 双栏网格；采用 640px / 1024px 渐进式 `#app` 内边距
- [x] 各页面容器：水平留白交给 `#app`，避免与组件内 `padding` 重复
- [x] [`cypress.config.ts`](../../cypress.config.ts) 与 [`package.json`](../../package.json) 中 e2e 等待地址改为 `http://localhost:4173/tool`
- [x] 文档：`project-context`、本文件、[`changelog/2026-03-25-hash-router-layout.md`](../changelog/2026-03-25-hash-router-layout.md)

---

## 里程碑：掷筊（圣杯模拟 + 摇一摇）（2026-03-25）

**目标**：模拟两片筊杯落地结果（圣杯 / 笑杯 / 阴杯）；可选 `devicemotion` 摇晃触发投掷；娱乐向免责说明。

### 任务清单

- [x] 页面 [`src/views/tools/JiaobeiView.vue`](../../src/views/tools/JiaobeiView.vue)：随机两面、结果文案、投掷动画、防抖
- [x] iOS 等环境：`DeviceMotionEvent.requestPermission` 在用户点击「启用摇一摇」后调用
- [x] [`src/tools/tools.ts`](../../src/tools/tools.ts) 注册 `/jiaobei`
- [x] [`changelog/2026-03-25-jiaobei.md`](../changelog/2026-03-25-jiaobei.md) + 本段记录

### 说明

- 摇一摇阈值因设备而异，若过于灵敏或迟钝可在组件内调整 `shakeStrength` 判定与 `TOSS_DEBOUNCE_MS`。
- 需 **HTTPS** 或 **localhost** 时，部分浏览器才暴露运动传感器。

---

## 里程碑：甘特图（2026-03-25）

**目标**：横轴日期、纵轴任务；增删改任务名；拖拽条调整起止日；自定义日期范围；新任务随机色；可选显示星期；本地持久化。

### 任务清单

- [x] 页面 [`src/views/tools/GanttChartView.vue`](../../src/views/tools/GanttChartView.vue)
- [x] 日期工具 [`src/utils/ganttDates.ts`](../../src/utils/ganttDates.ts) + Vitest
- [x] [`src/tools/tools.ts`](../../src/tools/tools.ts) 注册 `/gantt`
- [x] [`changelog/2026-03-25-gantt.md`](../changelog/2026-03-25-gantt.md) + 本段

### 说明

- 数据存 `localStorage` 键 `tool-gantt-v1`（首次加载会自 `tools-gantt-v1` 迁移）；清除站点数据会丢失。
- 色块拖拽依赖 Pointer Events；窄屏可横向滚动时间轴。
- 导出/导入：CSV（UTF-8 BOM）与 Excel（`xlsx`）；见 [`src/utils/ganttIo.ts`](../../src/utils/ganttIo.ts)。
- 任务行左侧拖动手柄：HTML5 拖放调整顺序（左侧行与右侧轨道均可作为释放目标）。

---

## 里程碑：主题切换（2026-03-25）

**目标**：顶栏手动浅色/深色；与系统偏好协作；持久化。

### 任务清单

- [x] [`src/assets/base.css`](../../src/assets/base.css)：`data-theme` + 系统暗色媒体查询
- [x] [`src/utils/theme.ts`](../../src/utils/theme.ts) + [`src/main.ts`](../../src/main.ts) 防闪烁
- [x] [`src/App.vue`](../../src/App.vue) 切换按钮
- [x] [`changelog/2026-03-25-theme-toggle.md`](../changelog/2026-03-25-theme-toggle.md)

---

## 里程碑：浏览器指纹查看器（2026-03-26）

**目标**：本机展示 Navigator、UA-CH、屏幕、时区、特性与 WebGL 等可读指纹信息；计划全文归档于 `PLAN.md` 与 changelog。

### 任务清单

- [x] [`src/utils/browserFingerprint.ts`](../../src/utils/browserFingerprint.ts)：`collectBrowserFingerprint`、`formatDisplayValue`
- [x] [`src/views/tools/BrowserFingerprintView.vue`](../../src/views/tools/BrowserFingerprintView.vue) 分组展示与复制 JSON
- [x] [`src/tools/tools.ts`](../../src/tools/tools.ts) 注册 `/browser-fingerprint`
- [x] [`src/utils/__tests__/browserFingerprint.spec.ts`](../../src/utils/__tests__/browserFingerprint.spec.ts) + `pnpm run type-check` / `vitest run`
- [x] [`changelog/2026-03-26-browser-fingerprint-viewer.md`](../changelog/2026-03-26-browser-fingerprint-viewer.md)、根目录 [`PLAN.md`](../../PLAN.md)、[`guides/browser-fingerprint-viewer-plan.md`](browser-fingerprint-viewer-plan.md)
