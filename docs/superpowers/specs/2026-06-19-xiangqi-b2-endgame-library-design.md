> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 子项目 B2：残局库 设计

日期：2026-06-19
状态：设计已锁定，待写实现计划
范围：B2 残局库。B1 整本竞赛规则细分裁决另立 spec。

## 问题
让用户既能**载入经典残局自己实战练杀法**，又能**逐手看标准解法**。

## 谁用 / 何时用
封福东及家人朋友：想练残局功夫时选一个经典残局，自己打（对电脑/双人）；想学时看解法步进。

## 决策（brainstorm 已定）
- **两者都要**：载入残局自己下 + 解法步进展示。
- 数据：~8 个经典残局，手写嵌入（FEN + 解法中文记谱），守零依赖。
- 复用 B3/A1 已有：`fromFen`、`Game.fromPosition`、`controller.loadGame`、浏览面板/步进 UI、render、notation。

## 架构

### 数据层 `src/engine/endgames.ts`（纯逻辑，可单测）
```ts
interface Endgame { id: string; name: string; fen: string; goal: '红胜' | '和'; solution: string[]; }
export const ENDGAMES: Endgame[];        // ~8 个经典残局
```
- `fen`：A1 通行象棋 FEN，经 `fromFen` 加载。
- `solution`：中文记谱，从 FEN 局面起逐手 `chineseToMove`+`applyMove` 重放——写错/非法即失败（合法性测试自动兜底，同开局库）。
- `EndgameLine`：轻量线性步进器（从 FEN 起、无分支），`position(): {board,turn}` / `moves(): string[]` / `next()` / `prev()` / `canNext()` / `canPrev()`。供"看解法"。

### 界面·残局库模式（独立模式，复用 B3 浏览面板布局）
- 模式区加「残局库」。进入后：
  - 残局下拉（`ENDGAMES`）+ 目标标注（红胜/和）。
  - 棋盘显示所选残局起始局面（由 `fromFen` 载入渲染）。
  - 两个动作：
    - **「打这盘」**：`controller.loadGame(Game.fromPosition(fromFen(eg.fen).board, fromFen(eg.fen).turn))` 载入对弈，退出残局模式进入正常对弈（当前双人/人机模式适用，AI 当防守方）；显示**「重摆残局」**按钮（记住当前残局 FEN，一键回到起始）。
    - **「看解法」**：`EndgameLine(eg)` 从 FEN 起逐手步进标准解法（上一步/下一步 + 中文解法列表当前手高亮），复用浏览面板。

## 非目标（B2 内）
- 不做"判定你是否走出最优解/胜负评估"（载入自己下，胜负由现有终局判定自然得出）。
- 不做用户自定义/导入残局（只读内置库）。
- 不做排局类超长江湖残局（收录实用短残局为主）。
- 规则裁决（B1）。

## 验收标准
- **endgames 单测**：每个残局 `fromFen(fen)` 可加载且 `Game.fromPosition` 不抛；`solution` 从 FEN 逐手重放全合法（自动抓手写错）；ENDGAMES ≥6。
- **EndgameLine 单测**：从 FEN 起始局面、next/prev 推进回退正确、moves 与解法一致。
- **残局库模式**：选残局→棋盘显示该局面+目标；「打这盘」载入后可正常对弈、「重摆残局」回起始；「看解法」步进/回退局面与解法列表同步；退出回对弈。切残局模式不影响 engine 判定。
- `npm test` + `npm run typecheck` 全绿；`npm run build` 单文件。
- 真机冒烟 + 残局库界面截图 owner 点头。

## 实现顺序
1. `engine/endgames.ts`：类型 + 数据 + `EndgameLine` + 测试（合法性兜底）
2. 残局库模式接线（选单/目标标注/打这盘+重摆/看解法）→ 冒烟 + 截图

## 已知限制（写入注释）
- AI 防守强度有限（α-β 深度 3），高难残局电脑未必走最优；练杀法/双人摆弈足够。
- 解法为单一主线（不含所有应法分支）。
