> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 子项目 A3：音效 实现计划

**Goal:** Web Audio 合成四类事件音（落子/吃子/将军/胜负），一键静音并持久化，零音频文件。

**Architecture:** `ui/sound.ts` 用 `OscillatorNode + GainNode` 包络实时合成（无资源文件、`file://` 可用）；首次用户手势 resume AudioContext（合规自动播放策略）；静音状态存 localStorage。main.ts 在每步落子后按 `胜负 > 将军 > 吃子 > 落子` 优先级播一个音；controller 暴露 `lastCapture` 供判吃子。**分支：** `v3-a3-sound`。

**听感不可无头验证**：冒烟只验 wiring（无报错、AudioContext 在手势后 resume、静音持久化、四事件 play 不抛错）；实际声音由 owner 试听。

---

## 文件
| 文件 | 增/改 | 职责 |
|---|---|---|
| `src/ui/sound.ts` | 新 | AudioContext 懒加载 + resume；`play(name)` 合成四类音；`setMuted/isMuted/initSound` |
| `src/ui/persist.ts` | 改 | `saveMuted(b)/loadMuted(): boolean`（key `xiangqi:muted`） |
| `src/ui/controller.ts` | 改 | 加 `lastCapture: boolean`，在 click 走子 + maybeAiMove 落子前按 `pieceAt(board,to)!==null` 置位 |
| `index.html` | 改 | `.controls` 加静音切换按钮 `#mute` |
| `src/ui/main.ts` | 改 | 初始化静音态+按钮；首次手势 resume；每步落子 + 超时后播音；静音按钮切换+持久化 |

## sound.ts（完整实现见实现步骤）
- `play('move'|'capture'|'check'|'win')`：muted 时直接返回；否则按事件合成。
  - move：~240Hz triangle 80ms 轻脆
  - capture：~130Hz square + 低频叠加 160ms 较重
  - check：双音 700→940Hz 警示
  - win：523/659/784Hz 琶音和弦 终局
- resume：`resumeAudio()` 在首次 canvas 点击 / 按钮点击调用（重复调用幂等）。

## 触发（main.ts）
- helper `playMoveSound()`：`status!=='playing'→'win'` 否则 `isInCheck(board,turn)→'check'` 否则 `controller.lastCapture→'capture'` 否则 `'move'`。
- 人走子成功后、AI 落子成功后各调一次 `playMoveSound()`。
- 棋钟超时（clock flagged 分支）加 `play('win')`。
- canvas click 起始 + mute 按钮点击调 `resumeAudio()`。

## 验证
1. typecheck + 全量 test 绿；build 单文件。
2. 真机冒烟（Playwright + 系统 Chrome）：监听 console 无错；走子/吃子/将军/胜负路径不抛错；点静音按钮 → `localStorage['xiangqi:muted']` 翻转、按钮文字变、再 reload 记住；AudioContext 在交互后 state 非 suspended。
3. **owner 试听**：给一个 `npm run dev` 或 dist，戴耳机点几步听四类音、试静音。

## 顺序
1. sound.ts + persist 静音持久化
2. controller.lastCapture + index 静音按钮 + main 接线（resume/触发/静音）
3. typecheck/build + 冒烟 → 给 owner 试听 → commit → 合并 main
