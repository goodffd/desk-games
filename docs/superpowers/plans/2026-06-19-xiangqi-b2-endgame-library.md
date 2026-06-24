> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 子项目 B2：残局库 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`).

**Goal:** 残局库——内置经典残局（FEN + 解法），可「打这盘」实战练习（载入对弈 + 重摆）与「看解法」逐手步进。

**Architecture:** `engine/endgames.ts` 存残局数据（FEN + 中文解法）+ `EndgameLine` 线性步进器（从 FEN 起重放解法，纯逻辑可单测）。残局库模式 UI 复用 B3 浏览面板布局，「打这盘」用 `controller.loadGame(Game.fromPosition(...))` 载入对弈。

**Tech Stack:** TS + Canvas + Vite。无新增依赖。**分支：** `v3-b2-endgames`。

**复用 API**：`fromFen(fen):{board,turn}`(fen.ts)、`Game.fromPosition(board,turn)`+`applyMove`(game.ts)、`chineseToMove(board,turn,zh)`(notation.ts)、`opponent`(types)、`controller.loadGame(game)`(controller.ts)、`render(...,bookHints?)`。

---

## Task 1：残局数据 + 线性步进器（engine/endgames.ts）

**Files:** Create `src/engine/endgames.ts`; Create `tests/endgames.test.ts`

数据与测试解耦：测试**数据无关**（校验"无论有哪些残局，FEN 都可加载、解法都从 FEN 合法重放"），故无论作者填几个残局，测试都把关合法性。残局数据由实现者构造并以「合法性测试 + 板面 dump 核验」三重把关（红线：写错的 FEN 会被合法性测试或 dump 抓出，禁止删测试绕过）。

- [ ] **Step 1: 写测试** — `tests/endgames.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ENDGAMES, EndgameLine } from '../src/engine/endgames';
import { fromFen } from '../src/engine/fen';
import { Game } from '../src/engine/game';
import { applyMove } from '../src/engine/game';
import { chineseToMove } from '../src/engine/notation';
import { opponent } from '../src/engine/types';

describe('残局库数据', () => {
  it('至少 6 个残局', () => {
    expect(ENDGAMES.length).toBeGreaterThanOrEqual(6);
  });

  it('每个残局 FEN 可加载、Game.fromPosition 不抛、目标合法', () => {
    for (const eg of ENDGAMES) {
      const { board, turn } = fromFen(eg.fen);
      expect(() => Game.fromPosition(board, turn)).not.toThrow();
      expect(['红胜', '和']).toContain(eg.goal);
      expect(eg.name).toBeTruthy();
    }
  });

  it('每个残局的解法从 FEN 起逐手合法重放', () => {
    for (const eg of ENDGAMES) {
      let { board, turn } = fromFen(eg.fen);
      for (const zh of eg.solution) {
        // chineseToMove 非法/无法解析会抛 → 暴露数据错误
        const m = chineseToMove(board, turn, zh);
        board = applyMove(board, m);
        turn = opponent(turn);
      }
    }
  });
});

describe('EndgameLine 步进', () => {
  const eg = ENDGAMES[0];
  it('起始停在残局 FEN 局面', () => {
    const line = new EndgameLine(eg);
    const start = fromFen(eg.fen);
    expect(line.position().board).toEqual(start.board);
    expect(line.position().turn).toBe(start.turn);
    expect(line.moves()).toEqual([]);
    expect(line.canPrev()).toBe(false);
    expect(line.canNext()).toBe(eg.solution.length > 0);
  });

  it('next/prev 推进回退，moves 与解法前缀一致', () => {
    const line = new EndgameLine(eg);
    if (eg.solution.length === 0) return;
    line.next();
    expect(line.moves()).toEqual(eg.solution.slice(0, 1));
    expect(line.canPrev()).toBe(true);
    line.prev();
    expect(line.moves()).toEqual([]);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/endgames.test.ts` → FAIL（模块不存在）

- [ ] **Step 3: 写 endgames.ts**（`EndgameLine` 用此代码；`ENDGAMES` 数据由实现者构造，见 Step 3b）:
```ts
import type { Board, Color } from './types';
import { opponent } from './types';
import { applyMove } from './game';
import { chineseToMove } from './notation';
import { fromFen } from './fen';

export interface Endgame {
  id: string;
  name: string;
  fen: string; // A1 通行象棋 FEN
  goal: '红胜' | '和';
  solution: string[]; // 中文记谱，从 fen 局面起
}

// 由实现者构造（见 Step 3b）。先放占位以跑通编译，再于 Step 3b 替换为 ≥6 个核验过的残局。
export const ENDGAMES: Endgame[] = [];

// 线性步进器：从残局 FEN 起逐手走解法（无分支），纯逻辑可单测
export class EndgameLine {
  private idx = 0;
  constructor(public readonly eg: Endgame) {}

  position(): { board: Board; turn: Color } {
    const start = fromFen(this.eg.fen);
    let board: Board = start.board;
    let turn: Color = start.turn;
    for (let i = 0; i < this.idx; i++) {
      const m = chineseToMove(board, turn, this.eg.solution[i]);
      board = applyMove(board, m);
      turn = opponent(turn);
    }
    return { board, turn };
  }

  moves(): string[] { return this.eg.solution.slice(0, this.idx); }
  canNext(): boolean { return this.idx < this.eg.solution.length; }
  canPrev(): boolean { return this.idx > 0; }
  next(): void { if (this.canNext()) this.idx++; }
  prev(): void { if (this.canPrev()) this.idx--; }
  reset(): void { this.idx = 0; }
}
```

- [ ] **Step 3b: 构造 ≥6 个经典残局数据**（实现者执行，逐个核验）：
  填充 `ENDGAMES`，每个 `{id,name,fen,goal,solution}`。构造方法与核验（每个残局都做）：
  1. 在纸面/脑中确定棋子摆放（少子、实用短残局：如「马后炮」「单马擒孤士」「炮兵巧胜」「车胜士象」等）。
  2. 按 A1 FEN 约定写 `fen`（row0→row9，大写红小写黑，r/n/b/a/k/c/p，数字空位，尾 ` w`/` b`）。**注意红黑将不可照面、不可有一方已被将的非法起始。**
  3. **板面 dump 核验**：临时 `node` 脚本或在 `tests/endgames.test.ts` 加一次性 `console.log(fromFen(eg.fen).board)` 比对摆放是否如预期；确认后删除该调试行。
  4. `solution` 用中文记谱从 FEN 起逐手写；跑合法性测试（Step 1 的第三个用例）会抓非法/记错的着。
  红线：FEN 或解法错 → 测试 FAIL，按报错局面逐手修正，**禁止删用例绕过**。

- [ ] **Step 4:** `npm test` 全绿（含 endgames 6+ 合法性 + EndgameLine）；`npm run typecheck`。

- [ ] **Step 5: 提交**
```bash
git add src/engine/endgames.ts tests/endgames.test.ts
git commit -m "feat(engine): 残局库数据 + EndgameLine 解法步进（FEN 加载 + 合法性测试兜底）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：残局库模式 UI（独立模式，复用浏览面板布局）

**Files:** Modify `index.html`、`src/ui/style.css`、`src/ui/main.ts`

残局库模式：选残局→棋盘显示该局面+目标；「打这盘」载入对弈（退出残局模式，显「重摆残局」）；「看解法」用 EndgameLine 步进。

- [ ] **Step 1: index.html**
  (a) `.controls` 加按钮：`<button id="endgame" class="btn">残局库</button>`，以及「重摆残局」（默认隐藏）：`<button id="reset-eg" class="btn" hidden>重摆残局</button>`
  (b) `.stage` 内、`.browse-panel` 之后加残局面板（默认隐藏）：
```html
        <div class="endgame-panel" id="endgame-panel" hidden>
          <div class="level-field">
            <label for="eg-sel">残局</label>
            <select id="eg-sel" class="select"></select>
            <span class="eg-goal" id="eg-goal"></span>
          </div>
          <div class="browse-step">
            <button id="eg-play" class="btn btn-primary">打这盘</button>
            <button id="eg-solve" class="btn">看解法</button>
            <button id="eg-prev" class="btn" hidden>上一步</button>
            <button id="eg-next" class="btn" hidden>下一步</button>
            <button id="eg-exit" class="btn">退出</button>
          </div>
          <div class="book-moves-list" id="eg-moves" hidden></div>
        </div>
```

- [ ] **Step 2: style.css 追加**:
```css
/* ===== 残局库面板 ===== */
.endgame-panel { margin-top: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.endgame-panel[hidden] { display: none; }
.eg-goal { font-size: 13px; color: var(--gold); font-weight: 600; margin-left: 6px; }
```
（`.browse-step`、`.book-moves-list` 已存在，复用。）

- [ ] **Step 3: main.ts 接线**
  - imports：`import { ENDGAMES, EndgameLine } from '../engine/endgames';` `import { fromFen } from '../engine/fen';`（若未引入）`import { Game } from '../engine/game';`（若未引入则加）。
  - refs + 状态：
```ts
const endgameBtn = document.getElementById('endgame') as HTMLButtonElement;
const resetEgBtn = document.getElementById('reset-eg') as HTMLButtonElement;
const endgamePanel = document.getElementById('endgame-panel') as HTMLDivElement;
const egSel = document.getElementById('eg-sel') as HTMLSelectElement;
const egGoal = document.getElementById('eg-goal') as HTMLSpanElement;
const egPlay = document.getElementById('eg-play') as HTMLButtonElement;
const egSolve = document.getElementById('eg-solve') as HTMLButtonElement;
const egPrev = document.getElementById('eg-prev') as HTMLButtonElement;
const egNext = document.getElementById('eg-next') as HTMLButtonElement;
const egExit = document.getElementById('eg-exit') as HTMLButtonElement;
const egMoves = document.getElementById('eg-moves') as HTMLDivElement;
let inEndgame = false;
let egLine: EndgameLine | null = null;     // 看解法步进器（null=未在看解法）
let currentEgFen: string | null = null;    // 当前练习的残局（供重摆），null=非残局对局
ENDGAMES.forEach((e) => { const o = document.createElement('option'); o.value = e.id; o.textContent = e.name; egSel.appendChild(o); });
```
  - `function curEg() { return ENDGAMES.find((e) => e.id === egSel.value) || ENDGAMES[0]; }`
  - `function renderEndgame()`：
```ts
if (!inEndgame) return;
const eg = curEg();
egGoal.textContent = '目标：' + eg.goal;
if (egLine) {
  const pos = egLine.position();
  render(ctx, pos.board, null, [], null, null, theme, []);
  egMoves.hidden = false;
  const zhs = egLine.moves();
  egMoves.innerHTML = zhs.length ? zhs.map((z, i) => `<span class="m${i === zhs.length - 1 ? ' on' : ''}">${z}</span>`).join(' ') : '（残局起始，点「下一步」看解法）';
  egPrev.hidden = false; egNext.hidden = false; egPrev.disabled = !egLine.canPrev(); egNext.disabled = !egLine.canNext();
} else {
  const { board } = fromFen(eg.fen);
  render(ctx, board, null, [], null, null, theme, []);
  egMoves.hidden = true; egPrev.hidden = true; egNext.hidden = true;
}
```
  - `function enterEndgame()`：
```ts
inEndgame = true; egLine = null;
endgamePanel.hidden = false;
(document.querySelector('.controls') as HTMLElement).hidden = true;
bookLine.hidden = true; clocksEl.hidden = true; stopClockTimer();
renderEndgame();
```
  - `function exitEndgame()`：
```ts
inEndgame = false; egLine = null;
endgamePanel.hidden = true;
(document.querySelector('.controls') as HTMLElement).hidden = false;
if (clock) { clocksEl.hidden = false; renderClocks(); startClockTimer(); }
refresh();
```
  - `function playEndgame()`（打这盘：载入对弈）：
```ts
const eg = curEg();
const { board, turn } = fromFen(eg.fen);
controller.loadGame(Game.fromPosition(board, turn));
currentEgFen = eg.fen;
resetEgBtn.hidden = false;
inEndgame = false; egLine = null; endgamePanel.hidden = true;
(document.querySelector('.controls') as HTMLElement).hidden = false;
refresh();
```
  - 监听：
```ts
endgameBtn.addEventListener('click', () => { if (busy()) return; if (inEndgame) exitEndgame(); else enterEndgame(); });
egSel.addEventListener('change', () => { if (!inEndgame) return; egLine = null; renderEndgame(); });
egPlay.addEventListener('click', playEndgame);
egSolve.addEventListener('click', () => { egLine = new EndgameLine(curEg()); renderEndgame(); });
egPrev.addEventListener('click', () => { if (egLine) { egLine.prev(); renderEndgame(); } });
egNext.addEventListener('click', () => { if (egLine) { egLine.next(); renderEndgame(); } });
egExit.addEventListener('click', exitEndgame);
resetEgBtn.addEventListener('click', () => {
  if (!currentEgFen) return;
  const { board, turn } = fromFen(currentEgFen);
  controller.loadGame(Game.fromPosition(board, turn));
  refresh();
});
```
  - 普通「重新开局」清残局上下文：在 `restartBtn` 监听里、`controller.reset()` 之后加 `currentEgFen = null; resetEgBtn.hidden = true;`
  - canvas click 守卫：在点击处理最前面（已有 `if (browsing) return;` 处）改为 `if (browsing || inEndgame) return;`

- [ ] **Step 4:** `npm run typecheck` + `npm test`（engine 不受影响）+ `npm run build` 单文件。

- [ ] **Step 5: 提交**
```bash
git add index.html src/ui/style.css src/ui/main.ts
git commit -m "feat(ui): 残局库模式（选残局/打这盘+重摆/看解法步进）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完成判据（B2）
- `npm test` 全绿（endgames ≥6 合法性 + EndgameLine 步进）；`npm run typecheck`；`npm run build` 单文件。
- 真机冒烟：进残局库→选残局→棋盘显该局面+目标；「看解法」步进/回退；「打这盘」载入对弈、「重摆残局」回起始、「重新开局」清残局上下文；退出回对弈；切残局模式不影响 engine。
- 残局库界面截图 → owner 点头。

## 已知限制（写入注释）
- AI 防守强度有限（α-β 深度 3）；练杀法/双人足够。
- 解法为单一主线（不含所有应法分支）。
