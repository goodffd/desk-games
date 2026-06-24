> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 子项目 A2：棋钟 实现计划

**Goal:** 加可选棋钟：包干制 + 读秒制，红黑双钟，到点判负，悔棋回退时间，重开归零。

**Architecture:** `engine/clock.ts` 纯状态机（无 DOM，可 vitest 穷举单测）；UI 用 `setInterval` 驱动 `tick`，到点 → UI 层判负覆盖（超时不是棋盘规则，engine 状态不变）；悔棋用 per-ply 时间快照栈回退。默认「不计时」，casual 友好。

**Tech Stack:** TS + Canvas + Vite。无新增依赖。**分支：** `v3-a2-clock`。

---

## clock.ts API（纯函数 / 不可变更新）

```ts
import type { Color } from './types';
export type ClockMode = 'banker' | 'byoyomi';           // 包干 / 读秒
export interface ClockConfig { mode: ClockMode; mainMs: number; byoyomiMs: number; }
export interface SideClock { mainMs: number; inByoyomi: boolean; periodMs: number; }
export interface ClockState { config: ClockConfig; red: SideClock; black: SideClock; running: Color | null; flagged: Color | null; }

export function createClock(config: ClockConfig): ClockState;   // 双方 main 满、未读秒、running/flagged=null
export function startTurn(s: ClockState, side: Color): ClockState; // running=side；该方在读秒则 period 重置为 byoyomiMs（新一手）
export function tick(s: ClockState, elapsedMs: number): ClockState; // 扣 running 方：未读秒扣 main（banker 到 0=flag；byoyomi 到 0→inByoyomi,period=byoyomiMs）；读秒扣 period（到 0=flag）
export function fmt(ms: number): string;                         // mm:ss（向上取整、min 0）
export function display(side: SideClock): string;               // 读秒态 "读秒 ss"，否则 mm:ss
```

**语义要点**
- 包干：仅 main 倒计时，归 0 → `flagged=该方`。永不进读秒。
- 读秒：main 倒计时；main 归 0 → `inByoyomi=true, period=byoyomiMs`（尚未判负）；之后每步在 `period` 内走完，`startTurn` 在该方新一手重置 period；period 归 0 → `flagged=该方`。
- 非 running 方不受 tick 影响；`flagged` 后 tick/startTurn 幂等不变。
- 越界 sub-tick 不精确补偿（tick 间隔小，忽略）。

## UI 接线

- index.html：`.controls` 加「计时」select：`不计时(默认)/包干/读秒`；+ 「分钟」number 输入（main，timed 时显示）；+「读秒秒」number 输入（读秒时显示）。棋盘上方加红黑双钟读数 `#clock-red` `#clock-black`。
- main.ts：
  - `let clock: ClockState | null = null`（null=不计时）；`let clockStack: ClockState[] = []`（per-ply 快照，悔棋回退）。
  - 计时 select change：按 mode+inputs `createClock` → `startTurn(当前走方)` → 起 `setInterval(100ms)` tick；选「不计时」→ 停 interval、clock=null、隐藏钟。
  - tick interval：`clock = tick(clock, 100)`；刷新钟读数；若 `clock.flagged` → 停 interval、设 UI 层 `timeoutLoser`、updateStatus 显示「X方超时负」、阻断后续点击与 AI。
  - 落子成功后：push 旧快照入 clockStack，`clock = startTurn(clock, 新走方)`（切钟 + 读秒重置）。
  - 悔棋：`clock = clockStack.pop()`（回退时间），重启 interval。
  - 重开：clock 重新 createClock+startTurn 或归「不计时」当前态。
  - 点击/AI 闸：`busy()` 或 `timeoutLoser` 时不接受点击；timeout 后 maybeRunAi 不触发。
- 超时判负是 UI 层（engine `status` 不动，棋盘规则未变）；updateStatus 增 `timeoutLoser` 分支。

## 验证

1. **clock.ts 单测**（`tests/clock.test.ts`）：createClock 初值；startTurn 设 running；tick 扣 running 方、非 running 不变；**包干耗尽 flagged**；**读秒切换**（main→0 进 inByoyomi 不判负，period→0 才 flagged）；**startTurn 读秒重置 period**；flagged 后幂等；fmt/display 格式。
2. typecheck + 全量 test 绿；build 单文件。
3. **真机冒烟**（Playwright + 系统 Chrome）：设极短包干（如 2 秒）→ 不走子 → 到点显示「红方超时负」且点击被阻断；设读秒 → main 耗尽进读秒态显示「读秒 N」；走子切钟（轮走方的钟在跑）；悔棋时间回退；不计时无钟。
4. 视觉：钟读数样式贴合现有水墨 UI（可截图给 owner 看一眼）。

## 实现顺序
1. `clock.ts` + `tests/clock.test.ts` → 测试绿
2. index.html 控件 + 钟读数；main.ts 接线（interval/切钟/超时/悔棋/重开）→ typecheck/build
3. 真机冒烟（含极短超时强制判负）→ 截图给 owner → commit → 合并 main
