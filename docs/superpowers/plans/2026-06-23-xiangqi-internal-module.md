# 象棋接成 desk-games 内置联机模块 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把中国象棋从"外链独立 SPA"迁进 `desk-games/src/games/xiangqi/`，做成内置 `GameModule`，大厅内无刷新 mount，功能/联机/字体全保留不变。

**Architecture:** 象棋整体迁入 `src/games/xiangqi/`；核心是把 `ui/main.ts` 的"整页初始化"重构成 `mount(root): () => void`——DOM 查询全部相对 `root`、所有全局事件/定时器/WebSocket/sessionStorage 收进一个 `cleanup` 闭包做到回大厅零残留；象棋 HTML 骨架由模块在 mount 时注入 `root`；样式加 `.xq-root` 作用域防污染。大厅侧只改 registry/大厅 main.ts/server.mjs 三处，home/router/nav 自动适配。联机服务端 `/ws` 哑中转不动。

**Tech Stack:** TypeScript + Vite + vite-plugin-singlefile（单文件 SPA）+ vitest + canvas 渲染 + 原生 WebSocket。

## Global Constraints

- 象棋功能**全搬不裁**：联机对弈/单机AI/开局库/残局/棋谱(PGN)/主题/音效，一个不少（spec 非目标）。
- **不**重写象棋成 desk-games 风格、**不**统一昵称/大厅、**不**改联机架构（哑中转）。
- 字体**保留霞鹜文楷**子集（`xiangqi-kai.woff2`，@font-face `XiangqiKai`），与掼蛋思源黑体并存。
- 样式**作用域隔离**：象棋全部 CSS 限定在 `.xq-root` 容器内，含原 `body`/`:root`/`*` 全局选择器要收进作用域。
- **零残留**是硬验收：离开象棋回大厅，WebSocket 断、所有定时器停、全局事件解绑、sessionStorage 重连凭据清、`root` 子树清空。
- 联机连 `/ws`（同源，http→ws / https→wss），服务端 `server/rooms.mjs` 不动。
- 部署到生产是红线，须 owner 单独授权（计划末任务标明）。
- **类型检查严格度（执行时决定，owner 已认可）**：desk-games 根 `tsconfig.json` 开了 `noUncheckedIndexedAccess`（比象棋源工程严），象棋代码**原样**迁入会报 ~131+ 类型警告（非 bug，是严格度差异）。**决策：不改象棋一行源码（保持"原样不变"），给象棋单独放宽**——新建 `tsconfig.xiangqi.json`（`extends "./tsconfig.json"`、`compilerOptions.noUncheckedIndexedAccess:false`、`include ["src/games/xiangqi","tests/xiangqi"]`）；根 `tsconfig.json` 加 `exclude ["src/games/xiangqi","tests/xiangqi"]`；`package.json` 的 `typecheck` 改 `tsc --noEmit && tsc --noEmit -p tsconfig.xiangqi.json`、`build` 改 `tsc --noEmit && tsc --noEmit -p tsconfig.xiangqi.json && vite build`。掼蛋保持严格不受影响。这一步在 Task 1 里、迁完 engine 后、typecheck 前完成。 **[Task 7 接入后修订]** Task 7 让 `registry.ts` import 了 `xiangqiModule`，TypeScript import 链把整个 `src/games/xiangqi` 拉进根 tsc 程序，原「根 exclude 象棋目录」无法阻止 import 链拉入 → 86 个 noUncheckedIndexedAccess 报错。修订为：根 `tsconfig.json` 额外 exclude 两个桥接文件 `src/shell/registry.ts` + `src/main.ts`（它们连同象棋归 `tsconfig.xiangqi.json` 宽松检查），`guandan/**` 及 shell 其余文件（router/home/nav/types）仍由根 tsc 严格检查，掼蛋严格不受影响。
- 每个任务结束跑 `npm run typecheck` + `npm test` 必须绿。

**源工程**：`$HOME/code/projects/xiangqi-game`（待迁移，迁完归档）。
**目标**：`$HOME/code/projects/desk-games`。

---

### Task 0: 核对象棋服务端一致 + 建分支

**Files:**
- 核对: `desk-games/server/rooms.mjs` ↔ `xiangqi-game/server/rooms.mjs`

**Deliverable:** 确认 desk-games 已 vendored 的象棋哑中转 `rooms.mjs` 与源工程最新版一致；在分支上开工。

- [ ] **Step 1: 建工作分支**
```bash
cd $HOME/code/projects/desk-games
git checkout -b feat/xiangqi-internal-module
```

- [ ] **Step 2: diff 两个 rooms.mjs**
```bash
diff $HOME/code/projects/desk-games/server/rooms.mjs $HOME/code/projects/xiangqi-game/server/rooms.mjs
```
Expected: 无差异，或仅注释差异。若 xiangqi-game 版更新（有实质逻辑差异），以 xiangqi-game 为准覆盖 desk-games 的，并在 commit 说明。

- [ ] **Step 3: commit（仅当有更新）**
```bash
git add server/rooms.mjs && git commit -m "chore(xiangqi): 同步象棋哑中转 rooms.mjs 到最新"
```
（无差异则跳过此 commit）

---

### Task 1: 迁移引擎层 + 引擎单测

**Files:**
- Create: `src/games/xiangqi/engine/*`（自 `xiangqi-game/src/engine/` 全部 14 个文件：types/board/moves/rules/game/repetition/ai/fen/notation/pgn/clock/openings/browse/endgames）
- Create: `tests/xiangqi/engine/*`（自 `xiangqi-game/tests/` 中引擎相关单测：board/moves/rules/game/repetition/ai/fen/notation/pgn/clock/clock-byoyomi-overflow/openings/browse/endgames/chase/position-key/controller-ai 等纯逻辑测试）

**Deliverable:** 象棋规则引擎（纯逻辑，零 DOM）迁入并通过全部引擎单测。

- [ ] **Step 1: 复制 engine 源码**
```bash
mkdir -p $HOME/code/projects/desk-games/src/games/xiangqi/engine
cp $HOME/code/projects/xiangqi-game/src/engine/*.ts $HOME/code/projects/desk-games/src/games/xiangqi/engine/
```

- [ ] **Step 2: 复制引擎单测，修正 import 路径**
```bash
mkdir -p $HOME/code/projects/desk-games/tests/xiangqi/engine
cp $HOME/code/projects/xiangqi-game/tests/{board,moves,rules,game,repetition,ai,fen,notation,pgn,clock,clock-byoyomi-overflow,openings,browse,endgames,chase,position-key,controller-ai}.test.ts $HOME/code/projects/desk-games/tests/xiangqi/engine/ 2>/dev/null || echo "逐个确认存在的测试文件名"
```
然后把测试里的 `import ... from '../src/engine/xxx'` 改为 `from '../../../src/games/xiangqi/engine/xxx'`（相对新位置）。引擎之间的 `import` 是相对同目录，复制后不变。

- [ ] **Step 3: 跑引擎单测**
```bash
cd $HOME/code/projects/desk-games && npx vitest run tests/xiangqi/engine
```
Expected: 全绿。失败多半是 import 路径，逐个修。

- [ ] **Step 4: typecheck + 全量测试不回归**
```bash
npm run typecheck && npm test 2>&1 | grep -E "Tests "
```
Expected: typecheck 干净；掼蛋原有测试 + 象棋引擎测试全绿。

- [ ] **Step 5: commit**
```bash
git add src/games/xiangqi/engine tests/xiangqi/engine
git commit -m "feat(xiangqi): 迁入象棋规则引擎层 + 引擎单测"
```

---

### Task 2: 迁移 UI 非入口模块 + 其单测

**Files:**
- Create: `src/games/xiangqi/ui/{render,controller,online,sound,themes,persist,anim}.ts`（自 `xiangqi-game/src/ui/`，**不含 main.ts**）
- Create: `tests/xiangqi/ui/*`（controller/anim/themes/ui-coords/game-history/game-repetition/online/online-url/persist-nick 等）

**Deliverable:** 象棋 UI 的非入口模块（渲染/交互状态机/WS客户端/音效/主题/持久化/动画）迁入，相关单测绿。这些模块改动小（render 适配 root 容器在 Task 5 做，这里先原样迁入跑测）。

- [ ] **Step 1: 复制 UI 模块（除 main.ts）**
```bash
mkdir -p $HOME/code/projects/desk-games/src/games/xiangqi/ui
cd $HOME/code/projects/xiangqi-game/src/ui
cp render.ts controller.ts online.ts sound.ts themes.ts persist.ts anim.ts $HOME/code/projects/desk-games/src/games/xiangqi/ui/
```

- [ ] **Step 2: 复制 UI 单测，修 import 路径**
```bash
mkdir -p $HOME/code/projects/desk-games/tests/xiangqi/ui
cp $HOME/code/projects/xiangqi-game/tests/{controller,anim,themes,ui-coords,game-history,game-repetition,online,online-url,persist-nick}.test.ts $HOME/code/projects/desk-games/tests/xiangqi/ui/ 2>/dev/null || true
```
修测试里的 `from '../src/ui/xxx'` → `from '../../../src/games/xiangqi/ui/xxx'`、`from '../src/engine/xxx'` → `from '../../../src/games/xiangqi/engine/xxx'`。

- [ ] **Step 3: 跑 UI 单测**
```bash
cd $HOME/code/projects/desk-games && npx vitest run tests/xiangqi/ui
```
Expected: 全绿（这些模块多数不直接依赖全局单例 DOM；online-url 测的是 `deriveWsUrl` 纯函数）。

- [ ] **Step 4: typecheck + 全量测试**
```bash
npm run typecheck && npm test 2>&1 | grep -E "Tests "
```
Expected: 干净 + 全绿。

- [ ] **Step 5: commit**
```bash
git add src/games/xiangqi/ui tests/xiangqi/ui
git commit -m "feat(xiangqi): 迁入象棋 UI 非入口模块(render/controller/online/sound/themes/persist/anim) + 单测"
```

---

### Task 3: 迁移样式 + 字体 + 作用域隔离

**Files:**
- Create: `src/games/xiangqi/ui/style.css`（自 `xiangqi-game/src/ui/style.css`，~409 行）
- Create: `src/games/xiangqi/ui/fonts/xiangqi-kai.woff2` + `LICENSE-LXGWWenKai-OFL.txt`

**Deliverable:** 象棋样式与字体迁入，且所有选择器收进 `.xq-root` 作用域，`@font-face` 字体引用相对路径正确（vite 会内联）。

**Interfaces:**
- Produces: 象棋模块的根容器 class 约定 = `.xq-root`（Task 4/5 给 mount 的 root 内层加这个 class）。

- [ ] **Step 1: 复制样式与字体**
```bash
mkdir -p $HOME/code/projects/desk-games/src/games/xiangqi/ui/fonts
cp $HOME/code/projects/xiangqi-game/src/ui/style.css $HOME/code/projects/desk-games/src/games/xiangqi/ui/
cp $HOME/code/projects/xiangqi-game/src/ui/fonts/* $HOME/code/projects/desk-games/src/games/xiangqi/ui/fonts/
```

- [ ] **Step 2: 把全局选择器收进 `.xq-root` 作用域**

象棋 style.css 里凡是会污染大厅/掼蛋的全局选择器，前缀到 `.xq-root`：
- `:root { --ink: ...; ... }`（设计 token）→ 改成 `.xq-root { --ink: ...; ... }`（CSS 变量定义在容器上，子元素照常继承）。
- `body { ... }` → 把其中布局/背景类规则挪到 `.xq-root { ... }`；纯页面级(如 `margin:0`)若大厅已处理则删。
- `* { box-sizing: border-box }` → `.xq-root, .xq-root * { box-sizing: border-box }`。
- 其余 `.stage`/`.masthead`/`.board-wrap`/`.controls`/`.btn`/`.o-*`/`.clocks` 等类选择器，统一前缀祖先 `.xq-root`（如 `.xq-root .board-wrap { ... }`），或确认这些类只在象棋骨架里出现、加 `.xq-root` 前缀最稳。
- `@font-face { font-family:"XiangqiKai"; src:url("./fonts/xiangqi-kai.woff2") ... }` 保持（路径相对 css 文件，vite 构建内联为 data URI）。

- [ ] **Step 3: 验证 css 被 vite 接受（构建象棋样式不报错）**

此步无独立运行入口，留到 Task 8 整体构建验证。本步只做人工核对：grep 确认没有遗漏的裸全局选择器。
```bash
grep -nE '^\s*(body|html|\*|:root)\s*[{,]' src/games/xiangqi/ui/style.css
```
Expected: 输出为空（都已收进 `.xq-root`）。

- [ ] **Step 4: commit**
```bash
git add src/games/xiangqi/ui/style.css src/games/xiangqi/ui/fonts
git commit -m "feat(xiangqi): 迁入象棋样式+霞鹜文楷字体，全局选择器收进 .xq-root 作用域"
```

---

### Task 4: 象棋 HTML 骨架模板

**Files:**
- Create: `src/games/xiangqi/ui/template.ts`（导出象棋 DOM 骨架 HTML 字符串）
- 参考: `xiangqi-game/index.html`（`<main id="app"><section class="stage">...</section></main>` 内的 .stage 内容）

**Deliverable:** 象棋整页 DOM 骨架（masthead/clocks/book-line/board canvas/controls/各 panel）抽成一个 HTML 模板字符串，供 mount 注入 `root`。原 index.html 里 `#app`/`script` 等壳层不要，只取 `.stage` 内部结构。

**Interfaces:**
- Produces: `export const XIANGQI_HTML: string`（`.stage` 内部的完整 HTML，含所有 `#board #status #mode #online #online-panel ...` 元素）。

- [ ] **Step 1: 抽取骨架**

把 `xiangqi-game/index.html` 中 `<section class="stage"> ... </section>` 的**内部** HTML 原样拷成模板字符串：
```typescript
// src/games/xiangqi/ui/template.ts
export const XIANGQI_HTML = `
<header class="masthead"> ... </header>
<div class="clocks" id="clocks" hidden> ... </div>
<div class="book-line" id="book-line" hidden> ... </div>
<div class="board-wrap"><canvas id="board" width="540" height="600"></canvas></div>
<div class="controls"> ...对战/本局/棋库/设置四组... </div>
<div class="browse-panel" id="browse-panel" hidden> ... </div>
<div id="endgame-panel" hidden> ... </div>
<div class="online-panel" id="online-panel" hidden> ...5个互斥视图... </div>
<div id="online-actions" hidden> ... </div>
<div id="online-offer" hidden> ... </div>
`;
```
（内容从源 index.html 逐行搬，保证所有 id 齐全——main.ts 靠这些 id 查询。）

- [ ] **Step 2: typecheck**
```bash
npm run typecheck
```
Expected: 干净。

- [ ] **Step 3: commit**
```bash
git add src/games/xiangqi/ui/template.ts
git commit -m "feat(xiangqi): 抽出象棋 DOM 骨架模板 XIANGQI_HTML"
```

---

### Task 5a: main.ts → mount(root)：容器隔离 DOM 查询 + 注入骨架（能渲染棋盘）

**Files:**
- Create: `src/games/xiangqi/ui/main.ts`（自 `xiangqi-game/src/ui/main.ts` 862 行迁入并改造）

**Deliverable:** main.ts 从"模块顶层立即执行 + `document.getElementById`"改成 `export function mountXiangqi(root): cleanup`：在 root 内注入 `.xq-root` 容器 + `XIANGQI_HTML`，所有 DOM 查询改 `root.querySelector`。此步先让棋盘能渲染、单机走子可用（联机/事件清理在 5b-5d）。

**Interfaces:**
- Consumes: `XIANGQI_HTML`（Task 4）；engine/ui 模块（Task 1/2）；`.xq-root` 作用域（Task 3）。
- Produces: `export function mountXiangqi(root: HTMLElement): () => void`。

- [ ] **Step 1: 复制 main.ts 并改入口结构**
```bash
cp $HOME/code/projects/xiangqi-game/src/ui/main.ts $HOME/code/projects/desk-games/src/games/xiangqi/ui/main.ts
```
把原来"模块顶层直接执行"的整段，包进函数：
```typescript
import { XIANGQI_HTML } from './template';
import './style.css';
export function mountXiangqi(root: HTMLElement): () => void {
  const host = document.createElement('div');
  host.className = 'xq-root';
  host.innerHTML = XIANGQI_HTML;
  root.appendChild(host);
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => host.querySelector(sel) as T;
  // ...原 main.ts 主体搬进来...
  return cleanup; // 5b-5d 逐步填充
}
```

- [ ] **Step 2: DOM 查询全部改 host 作用域**

原 main.ts 的 ~50 个 `document.getElementById('board')` / `document.querySelector('.turn-text')` 全部改成 `host.querySelector('#board')` / `$('#board')`。原"动态注入 hub-back 返回大厅链接"那段（仅 /xiangqi/ 独立页用）删除——大厅自己有返回入口。

- [ ] **Step 3: 删掉模块顶层自启动**

原文件末尾若有 `init()` / 顶层立即调用，删除（改由 `mountXiangqi` 驱动）。

- [ ] **Step 4: 临时返回空 cleanup 占位**
```typescript
return () => { host.remove(); }; // 5b-5d 补全 ws/定时器/事件清理
```

- [ ] **Step 5: typecheck**
```bash
npm run typecheck
```
Expected: 干净（DOM 类型/null 处理可能要补 `!` 或判空）。

- [ ] **Step 6: commit**
```bash
git add src/games/xiangqi/ui/main.ts
git commit -m "feat(xiangqi): main.ts 改 mountXiangqi(root)，DOM 查询容器隔离+注入骨架"
```

---

### Task 5b: cleanup — 全局事件解绑

**Files:**
- Modify: `src/games/xiangqi/ui/main.ts`

**Deliverable:** main.ts 里 30+ 个 `addEventListener` 全部经一个记录器登记，cleanup 时统一 `removeEventListener`，回大厅不残留监听。

- [ ] **Step 1: 加事件登记器**
```typescript
const listeners: Array<{ t: EventTarget; type: string; fn: EventListenerOrEventListenerObject }> = [];
const on = (t: EventTarget, type: string, fn: any) => { t.addEventListener(type, fn); listeners.push({ t, type, fn }); };
```

- [ ] **Step 2: 把所有 addEventListener 改走 on(...)**

逐个替换（canvas click、各按钮 click、select change、oNickInput keydown、`.fold-head` click 等，探索清单：main.ts 行 671-844 共 30+ 处）。挂在 `window`/`document` 上的（若有 resize/visibilitychange）也走 `on`。

- [ ] **Step 3: cleanup 里解绑**
```typescript
const cleanup = () => {
  listeners.forEach(({ t, type, fn }) => t.removeEventListener(type, fn));
  host.remove();
};
```

- [ ] **Step 4: typecheck**
```bash
npm run typecheck
```
Expected: 干净。

- [ ] **Step 5: commit**
```bash
git add src/games/xiangqi/ui/main.ts
git commit -m "feat(xiangqi): cleanup 统一解绑全局事件监听"
```

---

### Task 5c: cleanup — 定时器与动画

**Files:**
- Modify: `src/games/xiangqi/ui/main.ts`

**Deliverable:** 棋钟 `clockTimer`(setInterval 100ms)、AI 思考(setTimeout 650ms)、重连退避(setTimeout)、RAF 动画 全部能在 cleanup 时停掉。

- [ ] **Step 1: 集中管理定时器**

`clockTimer` 已有变量——确保 cleanup 调 `stopClockTimer()`（clearInterval）。AI 的 `setTimeout` 存到变量 `aiTimer`，cleanup `clearTimeout(aiTimer)`。重连 `setTimeout` 存 `reconnectTimer`，cleanup `clearTimeout`。RAF 动画用 `animating` 标志 + 存 `rafId`，cleanup `cancelAnimationFrame(rafId)`。

- [ ] **Step 2: cleanup 增补**
```typescript
const cleanup = () => {
  stopClockTimer();
  if (aiTimer) clearTimeout(aiTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (rafId) cancelAnimationFrame(rafId);
  animating = false;
  listeners.forEach(({ t, type, fn }) => t.removeEventListener(type, fn));
  host.remove();
};
```

- [ ] **Step 3: typecheck**
```bash
npm run typecheck
```
Expected: 干净。

- [ ] **Step 4: commit**
```bash
git add src/games/xiangqi/ui/main.ts
git commit -m "feat(xiangqi): cleanup 停掉棋钟/AI/重连/RAF 定时器"
```

---

### Task 5d: cleanup — WebSocket + 联机状态

**Files:**
- Modify: `src/games/xiangqi/ui/main.ts`

**Deliverable:** cleanup 时主动关闭象棋 WebSocket（`online.close()`，置 `intentionalClose=true` 拦住重连）、清理 sessionStorage 重连凭据，回大厅不会偷偷重连死房。

- [ ] **Step 1: cleanup 收尾联机**
```typescript
const cleanup = () => {
  intentionalClose = true;          // 拦住 attemptReconnect 的 setTimeout 续命
  online?.close();                  // 关 WS
  // 离开象棋视为退出当前在线会话：清掉重连凭据(与 exitOnline 的 clearOnlineSession 一致)
  // 注意：象棋用 sessionStorage ONLINE_SKEY 记 {code,nick,spectate}
  try { sessionStorage.removeItem(/* ONLINE_SKEY 常量 */); } catch {}
  stopClockTimer();
  if (aiTimer) clearTimeout(aiTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (rafId) cancelAnimationFrame(rafId);
  animating = false;
  listeners.forEach(({ t, type, fn }) => t.removeEventListener(type, fn));
  host.remove();
};
```
（`ONLINE_SKEY` 用 main.ts 里既有的常量名。是否清 sessionStorage 取决于产品语义：离开象棋=主动退出当前对局，清掉更干净；保留则下次进象棋会自动重连——按"零残留"取清掉。）

- [ ] **Step 2: typecheck**
```bash
npm run typecheck
```
Expected: 干净。

- [ ] **Step 3: commit**
```bash
git add src/games/xiangqi/ui/main.ts
git commit -m "feat(xiangqi): cleanup 关闭 WebSocket + 清联机重连凭据(零残留)"
```

---

### Task 6: 模块入口 index.ts

**Files:**
- Create: `src/games/xiangqi/index.ts`

**Deliverable:** 导出符合 `GameModule` 的 `xiangqiModule`，`mount` 委托给 `mountXiangqi`。

**Interfaces:**
- Consumes: `mountXiangqi`（Task 5a）；`GameModule`（`src/shell/types.ts`）。
- Produces: `export const xiangqiModule: GameModule`。

- [ ] **Step 1: 写 index.ts**
```typescript
import type { GameModule } from '../../shell/types';
import { mountXiangqi } from './ui/main';

export const xiangqiModule: GameModule = {
  id: 'xiangqi',
  name: '象棋',
  desc: '中国象棋，2 人联机对弈 / 单机对 AI',
  mount: (root) => mountXiangqi(root),
};
```

- [ ] **Step 2: typecheck**
```bash
npm run typecheck
```
Expected: 干净。

- [ ] **Step 3: commit**
```bash
git add src/games/xiangqi/index.ts
git commit -m "feat(xiangqi): 导出 xiangqiModule(GameModule)"
```

---

### Task 7: 接入大厅 + 服务端路由

**Files:**
- Modify: `src/shell/registry.ts`
- Modify: `src/main.ts`（大厅入口）
- Modify: `server/server.mjs`
- Delete: `src/shell/links.ts`、`src/shell/links.example.ts`（若存在；先确认无其它引用）

**Deliverable:** 象棋从 external 改 internal，大厅点象棋无刷新 mount；server 不再服务 `xiangqi-dist`、`/xiangqi` 回大厅 SPA；删除外链注入。

**Interfaces:**
- Consumes: `xiangqiModule`（Task 6）。

- [ ] **Step 1: registry.ts 改两个 internal**
```typescript
import { guandanModule } from '../games/guandan/index';
import { xiangqiModule } from '../games/xiangqi/index';
export function buildRegistry(): GameEntry[] {
  return [
    { kind: 'internal', module: guandanModule },
    { kind: 'internal', module: xiangqiModule },
  ];
}
```
（删掉 external 象棋项和 `xiangqiUrl` 参数。）

- [ ] **Step 2: 大厅 src/main.ts 去掉外链注入**

删 `loadXiangqiUrl()` 整个函数及其 `import.meta.glob('./shell/links.ts')`，`init` 改同步，`buildRegistry()` 无参调用（其余 popstate/render 不变）。

- [ ] **Step 3: server/server.mjs 简化路由**

删 `const XQ_INDEX = ...`；handler 里删 `/xiangqi` 分支，所有 HTTP 请求都 `readFileSync(HUB_INDEX)`。WebSocket upgrade（`/ws` 象棋 + `/ws-guandan` 掼蛋）**不动**。

- [ ] **Step 4: 删 links 文件（确认无引用后）**
```bash
grep -rn "links" src/ server/ | grep -v node_modules   # 确认只剩已删的引用
rm -f src/shell/links.ts src/shell/links.example.ts
```

- [ ] **Step 5: typecheck**
```bash
npm run typecheck
```
Expected: 干净（大厅 main.ts 不再引用 links）。

- [ ] **Step 6: commit**
```bash
git add src/shell/registry.ts src/main.ts server/server.mjs
git rm -f src/shell/links.ts src/shell/links.example.ts 2>/dev/null || true
git commit -m "feat(xiangqi): 象棋接入大厅(registry internal + /xiangqi 大厅内 mount + server 回 HUB)，废弃外链注入"
```

---

### Task 8: 整体构建 + 全量验证

**Files:** 无新文件，验证集成。

**Deliverable:** `npm run build` 出单个含象棋的 `dist/index.html`；typecheck 干净；全量单测（掼蛋 + 象棋引擎/UI）全绿。

- [ ] **Step 1: 构建**
```bash
npm run build 2>&1 | tail -3
```
Expected: `dist/index.html` 生成；体积明显变大（~1MB 量级，含象棋+字体）。无构建错误（字体内联、css 作用域、模块解析都过）。

- [ ] **Step 2: 全量 typecheck + 测试**
```bash
npm run typecheck && npm test 2>&1 | grep -E "Test Files|Tests "
```
Expected: 干净 + 全绿（掼蛋原有 + 象棋全部）。

- [ ] **Step 3: commit（若构建产物 dist 不入库则只记验证通过，无需 commit）**

dist 在 .gitignore，本步无源码改动；若前序有微调（如 import 修正）一并 commit。

---

### Task 9: 真机冒烟（零残留是重点）

**Files:**
- Create: `sandbox/2026-06-23-xiangqi-internal-smoke/smoke.mjs`（Playwright + 系统 Chrome）

**Deliverable:** 本地起 server，Playwright 真机验证：大厅无刷新进象棋、联机对弈、单机AI、**来回切换零残留**。

- [ ] **Step 1: 写冒烟脚本**

脚本要点（参考 `sandbox/2026-06-21-guandan-online-smoke/` 打法，`channel:'chrome'`）：起 `server/server.mjs`（本地 PORT）→ 打 `http://127.0.0.1:PORT/` 大厅 → 点象棋卡片 → 断言无刷新进象棋（`.xq-root` + `#board` 存在、URL=/xiangqi）→ 单机走一步（点 canvas 起手+落点）断言棋子动→ 开两个 context 联机：建房/加入/走子互通/认输 → **来回切换**：从象棋 `navigate('/')` 回大厅，断言 `.xq-root` 已移除、再 evaluate 检查无残留 WebSocket（断开）/无 setInterval 残留（可在 cleanup 打点）→ 进掼蛋再回象棋，功能正常。捕获 console error，断言为空。

- [ ] **Step 2: 跑冒烟**
```bash
node sandbox/2026-06-23-xiangqi-internal-smoke/smoke.mjs 2>&1 | tail -20
```
Expected: 无刷新进象棋 ✓ / 单机走子 ✓ / 联机互通 ✓ / 来回切换零残留(无 .xq-root 残留、无前端错误) ✓。

- [ ] **Step 3: 修复冒烟暴露的残留/报错**

常见：某个 addEventListener 漏走 `on()`、某定时器漏清、sessionStorage 残留导致再进象棋误重连。逐个补到 cleanup。每修一处重跑冒烟。

- [ ] **Step 4: commit**
```bash
git add src/games/xiangqi/ui/main.ts   # 若有 cleanup 补漏
git commit -m "fix(xiangqi): 冒烟补齐 cleanup 残留(事件/定时器/ws)"
```

---

### Task 10: 归档旧项目 + 文档/部署

**Files:**
- Move: `xiangqi-game/` → `archive/xiangqi-game/`（在 code 工作区层面，非 desk-games 仓库内）
- Modify: `desk-games/DEPLOY.md`、`desk-games/CLAUDE.md`、`desk-games/SPEC.md`（象棋从"外链"改为"内置模块"的描述）

**Deliverable:** 旧 xiangqi-game 归档；文档更新；生产部署（红线，须 owner 授权）。

- [ ] **Step 1: 更新文档**

`CLAUDE.md`/`SPEC.md`：象棋由"外链项"改为"内置联机模块"；`DEPLOY.md`：删 `xiangqi-dist` 相关，部署只推 `dist` + `server/server.mjs`（`/ws` 不变）。

- [ ] **Step 2: commit 文档**
```bash
git add DEPLOY.md CLAUDE.md SPEC.md
git commit -m "docs(xiangqi): 象棋改内置模块，更新部署/规范文档"
```

- [ ] **Step 3: 归档旧项目（red line：移动/废弃项目，先问 owner）**
```bash
# owner 授权后：
mkdir -p $HOME/code/archive
git -C $HOME/code/projects/xiangqi-game status   # 确认无未提交
mv $HOME/code/projects/xiangqi-game $HOME/code/archive/xiangqi-game
```

- [ ] **Step 4: 合并分支（用 finishing-a-development-branch skill）**

验证全绿后按 superpowers:finishing-a-development-branch 合并 `feat/xiangqi-internal-module` 到 main。

- [ ] **Step 5: 部署（red line：部署到生产，须 owner 单独授权）**

授权后：本地 `npm run build` → 备份生产 `dist` → scp `dist/index.html` + `server/server.mjs`（删了 xiangqi-dist 分支）到 `/opt/desk-games` → server readFileSync 即时生效（HTTP 无需重启；但 server.mjs 改了路由**需要 restart**）：`ssh $DEPLOY_HOST systemctl restart desk-games`（真实主机脱敏，见 owner 私记/DEPLOY.md 占位约定）。生产服务器上 `xiangqi-dist` 目录可留可删（不再被引用）。然后公网真路径冒烟：大厅点象棋→联机一盘→来回切换零残留。

---

## 自检（写完计划回看）

- **Spec 覆盖**：迁移源码(T1/T2/T3)、HTML骨架(T4)、mount/cleanup 容器隔离(T5a-d)、模块入口(T6)、大厅接入+server路由(T7)、构建(T8)、零残留冒烟(T9)、归档+文档+部署(T10)——spec 每条都有对应任务。✓
- **零残留**这条硬验收贯穿 T5b/c/d + T9。✓
- **类型一致**：`mountXiangqi(root): ()=>void`(T5a) ← `xiangqiModule.mount`(T6) ← registry(T7)；`XIANGQI_HTML`(T4)←main(T5a)；`.xq-root`(T3)←main(T5a)。一致。✓
- **红线**：归档(T10S3)、部署(T10S5) 都标了须 owner 授权。✓
