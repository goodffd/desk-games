# 象棋接成 desk-games 内置联机模块 — 设计

## 问题 / 目标

中国象棋当前以**外链独立 SPA** 接入 desk-games：大厅点象棋卡片 → 浏览器跳转到 `/xiangqi/`（服务端直接服务独立项目 `xiangqi-game` 的单文件构建产物 `xiangqi-dist/`）。体验上是"跳到另一个网页"，跟掼蛋（大厅内无刷新打开的内置模块）割裂。

把象棋源码迁进 `desk-games/src/games/xiangqi/`，做成像掼蛋一样的**内置 `GameModule`**：大厅点象棋在**同一页面无刷新 mount**，不再跳转。象棋自己的界面、联机、单机 AI **全部保留不变**。

## 谁用 / 什么时候用

desk-games 大厅的玩家。点象棋卡片即在大厅页内打开象棋（联机对弈或单机对 AI），跟点掼蛋一致的无刷新体验。

## 范围

### 做（全搬，不裁剪）
象棋整个 `xiangqi-game` 迁入，所有功能原样保留：联机对弈（红/黑配对、观战、掉线重连、求和/认输/悔棋）、单机对 AI、开局库浏览、残局练习、棋谱(PGN)导入导出、主题、音效。

### 非目标（明确不做）
- **不**把象棋联机/UI 重写成 desk-games 风格（不抽 controller/session/driver 三层）；象棋保持它原有的 `main.ts`/`controller.ts`/`online.ts` 那套。
- **不**统一昵称/大厅（象棋继续用它自己的昵称输入和大厅房列表；不与掼蛋共用一套昵称/大厅）。
- **不**改象棋联机架构：服务端 `rooms.mjs` 仍是**哑中转**（互信、规则在前端），不做服务端权威化。
- **不**裁剪象棋功能。

## 架构

### 1. 内置模块入口
- 新建 `src/games/xiangqi/index.ts`，导出 `xiangqiModule: GameModule`（与掼蛋同一接口 `{ id, name, desc, mount(root): () => void }`，见 `src/shell/types.ts`）。
- `mount(root)`：在传入的 `root` 容器内创建象棋的全部 DOM 并启动，返回 `cleanup` 函数。
- 象棋原 `ui/main.ts` 的"整页初始化"（绑事件、建棋盘、起联机）改为在 `root` 作用域内执行；所有 `document.querySelector('#xxx')` → `root.querySelector('.xxx')`（容器内查询）。

### 2. 卸载清理（cleanup）
`mount` 返回的 `cleanup` 必须做到回大厅时**零残留**：
- 关闭象棋的 WebSocket（`OnlineSession`）。
- 停掉所有定时器：棋钟（`clock`）、AI 思考、自动重连退避、动画。
- 解绑挂在 `window`/`document` 上的全局事件监听（键盘/resize/visibilitychange 等）。
- 清空 `root` 子树。

### 3. 大厅注册与路由
- `src/shell/registry.ts`：象棋从 `external`（外链 URL）改为 `internal`（`module: xiangqiModule`）。`buildRegistry` 不再需要象棋 URL 注入。
- `src/shell/home.ts`：象棋卡片从 `<a href>` 改为内置卡片（`<div role=button>` → `navigate('/xiangqi')`），与掼蛋一致。
- `src/shell/router.ts`：`/xiangqi` 不再"外链回退首页"，改为在大厅 SPA 内 mount `xiangqiModule`（与 `/guandan` 同机制）。
- `src/shell/nav.ts` 的 `navigate()`（pushState + popstate）不变。

### 4. 联机（不变）
- 象棋客户端继续连 `/ws`（`location.host` 同源，http→ws / https→wss），协议不变（`move/resign/draw-offer/undo-request/rejoin/spectate` 等）。
- 服务端 `server/rooms.mjs`（象棋哑中转 `RoomRegistry`，已 vendored 在 desk-games server，`/ws` upgrade 已接）**不动**；迁移时核对它与 `xiangqi-game/server/rooms.mjs` 最新版一致（以 desk-games 内为准）。

### 5. 打包 / 部署
- 象棋随 desk-games 一起 `vite build`（`vite-plugin-singlefile`），打进同一个 `dist/index.html`（大厅 + 掼蛋 + 象棋）。象棋的 canvas 资源/图片/字体内联。单文件体积预计从 ~350KB 增至 ~1MB 量级（含象棋引擎/AI/开局残局库/霞鹜文楷字体）。
- `server/server.mjs`：`/xiangqi` 与 `/xiangqi/*` 不再服务 `xiangqi-dist`，改为返回大厅 `dist/index.html`（大厅 SPA 自行 mount 象棋），与 `/guandan` 一致。`XQ_INDEX` 及 `xiangqi-dist` 相关逻辑删除。
- `xiangqi-dist/` 独立产物**废弃**：部署只推 desk-games 一个 `dist`，不再单独构建/上传象棋。
- `/ws`（象棋联机）保持。

### 6. 样式 / 字体隔离
- 象棋全部 CSS 限定在象棋容器作用域内（统一加 `.xq-` 前缀或包一层根 class），保证：进象棋不污染大厅/掼蛋；回大厅不残留象棋样式。
- 字体：象棋**保留霞鹜文楷**子集（迁入 `src/games/xiangqi/` 或 `src/ui/fonts/`，base64 内联）；与掼蛋的思源黑体并存（dist 因此更大，已接受）。

### 7. 旧项目归档
- `xiangqi-game` 整个项目迁移后移入 `archive/`（只读留参考）。象棋以 desk-games 为唯一代码家，往后在 `src/games/xiangqi/` 内迭代。

## 文件结构（迁移后）

```
desk-games/src/games/xiangqi/
├── index.ts            # 新建：GameModule 入口，mount(root)→cleanup
├── engine/             # 自 xiangqi-game/src/engine/ 迁入（规则/AI/FEN/PGN/clock/开局残局）
├── ui/                 # 自 xiangqi-game/src/ui/ 迁入
│   ├── main.ts         # 改造：整页初始化 → mount(root) 容器隔离 + cleanup
│   ├── controller.ts   # 交互状态机（不依赖 DOM，基本不动）
│   ├── online.ts       # WS 客户端（不动或仅路径/容器适配）
│   ├── render.ts       # canvas 渲染（适配 root 容器）
│   ├── sound.ts / themes.ts / persist.ts
│   └── *.css           # 加 .xq- 作用域
└── fonts/              # 霞鹜文楷子集（base64 内联）
tests/                  # 象棋引擎单测迁入，继续跑
server/rooms.mjs        # 象棋哑中转（已在，核对一致，不动）
archive/xiangqi-game/   # 旧项目归档
```

## 数据流

象棋自身数据流不变：用户操作 → `controller`（选子/合法目标/走子）→ `engine`（规则）→ `render`（canvas）；联机时走子等消息经 `online`(`OnlineSession`) → `/ws` 哑中转 → 对手。desk-games 只负责把象棋 mount 进大厅容器、并在离开时调 cleanup。

## 错误处理 / 边界

- **卸载残留**（最高风险）：来回切换"大厅↔象棋↔掼蛋"必须零残留——靠 cleanup 严格关闭 ws/定时器/事件。
- 样式/全局变量与大厅、掼蛋冲突：靠 `.xq-` 作用域 + 避免全局污染。
- 象棋深链/刷新：`/xiangqi` 深链与刷新可用（服务端对非已知路径回大厅 SPA，SPA 路由 mount 象棋）。

## 测试

- **单测**：象棋引擎单测（走子规则、AI、FEN/PGN 等，vitest）迁入 `tests/` 继续跑；掼蛋单测不受影响；`npm test` 全绿。
- **真机冒烟**（Playwright + 系统 Chrome，`channel:'chrome'`）：
  1. 大厅点象棋 → 无刷新打开象棋。
  2. 两端联机走一盘：走子、认输、求和、悔棋、掉线重连、观战。
  3. 单机对 AI 走几步。
  4. **来回切换零残留**：进象棋→出来回大厅→进掼蛋→再回象棋，确认 ws 已断、定时器停、样式/DOM 清干净、功能正常。

## 验收标准

- 大厅点象棋在同一页**无刷新**打开象棋（不再跳转 `/xiangqi/` 独立页）。
- 象棋联机对弈（走子/认输/求和/悔棋/掉线重连/观战）与单机对 AI **行为与原独立 SPA 一致**。
- 离开象棋回大厅**零残留**，再进掼蛋/再回象棋均正常。
- `npm test` 全绿（含迁入的象棋引擎单测）、`npm run typecheck` 干净。
- `npm run build` 出单个 `dist/index.html`（含大厅+掼蛋+象棋）。
- 部署只推 desk-games `dist`（+ 改后的 `server.mjs`）；`xiangqi-dist` 不再需要。
- `xiangqi-game` 已归档至 `archive/`。

## 特殊约束

- 公网信息脱敏（沿用红线）：不在公开仓库暴露象棋公网域名/端口/内网 IP。
- 象棋字体子集化流程沿用（新增固定汉字要重跑子集）。
- 服务端 `/ws` 哑中转互信模型保持（象棋本就如此）。
