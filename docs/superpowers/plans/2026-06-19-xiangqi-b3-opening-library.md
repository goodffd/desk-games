> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 子项目 B3：开局库 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 开局库——中文记谱着法树数据 + FEN 索引，驱动「对局中谱着提示/出谱检测」与「独立浏览学习库」。

**Architecture:** `engine/openings.ts` 存命名开局（中文着法树）并构建 `Map<FEN, 续着+开局名>` 索引；`engine/browse.ts` 的 `BrowseSession` 纯逻辑导航谱树（两者经引擎重放校验合法性，可单测）。`render.ts` 加金色书签点层。main.ts 接「开局提示」开关（默认关）与「开局库」浏览模式。

**Tech Stack:** TS + Canvas + Vite。无新增依赖。**分支：** `v3-b3-openings`（spec 已提交于此）。

**坐标/记法**：复用 A1 `notation.chineseToMove(board,turn,zh)`、`fen.toFen(board,turn)`、`game.applyMove`、`board.initialBoard`、`types.opponent`。row0=黑顶 row9=红底，fileNum=9-col，红汉字黑 ASCII 数字。

---

## Task 1：开局数据 + 索引 + 查书（engine/openings.ts）

**Files:** Create `src/engine/openings.ts`; Create `tests/openings.test.ts`

- [ ] **Step 1: 写失败测试** — `tests/openings.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { OPENINGS, buildBookIndex, lookupBook } from '../src/engine/openings';
import { initialBoard, applyMove } from '../src/engine/game';
import { chineseToMove } from '../src/engine/notation';

describe('开局库索引', () => {
  it('全书每条谱线合法（重放无异常）', () => {
    expect(() => buildBookIndex()).not.toThrow();
  });

  it('初始局面命中红方首着（中炮/仙人指路）', () => {
    const idx = buildBookIndex();
    const e = lookupBook(idx, initialBoard(), 'red');
    expect(e).not.toBeNull();
    const zhs = e!.moves.map((m) => m.zh);
    expect(zhs).toContain('炮二平五');
    expect(zhs).toContain('兵七进一');
  });

  it('炮二平五后命中黑方应着', () => {
    const idx = buildBookIndex();
    const b1 = applyMove(initialBoard(), chineseToMove(initialBoard(), 'red', '炮二平五'));
    const e = lookupBook(idx, b1, 'black');
    expect(e).not.toBeNull();
    expect(e!.moves.map((m) => m.zh)).toContain('马８进７');
  });

  it('出谱局面返回 null', () => {
    const idx = buildBookIndex();
    // 红方非书着 兵三进一 → 黑方局面不在书内
    const off = applyMove(initialBoard(), chineseToMove(initialBoard(), 'red', '兵三进一'));
    expect(lookupBook(idx, off, 'black')).toBeNull();
  });

  it('OPENINGS 至少含 2 套（Task 6 再补足 10+）', () => {
    expect(OPENINGS.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/openings.test.ts` → FAIL（模块不存在）

- [ ] **Step 3: 写 openings.ts**:
```ts
import type { Board, Color, Move } from './types';
import { opponent } from './types';
import { initialBoard } from './board';
import { applyMove } from './game';
import { chineseToMove } from './notation';
import { toFen } from './fen';

export interface BookNode { zh: string; comment?: string; children: BookNode[]; }
export interface Opening { id: string; name: string; roots: BookNode[]; }

export interface BookEntry { moves: { move: Move; zh: string }[]; openings: string[]; }
export type BookIndex = Map<string, BookEntry>;

// 首批两套（跑通索引/查书）；Task 6 扩到 10+。每条谱线手写中文记谱、过引擎校验。
export const OPENINGS: Opening[] = [
  {
    id: 'zhongpao-pingfengma',
    name: '中炮对屏风马',
    roots: [
      { zh: '炮二平五', children: [
        { zh: '马８进７', children: [
          { zh: '马二进三', children: [
            { zh: '车９平８', comment: '屏风马正变', children: [] },
            { zh: '卒３进１', comment: '挺三卒变', children: [] },
          ] },
        ] },
      ] },
    ],
  },
  {
    id: 'xianrenzhilu',
    name: '仙人指路',
    roots: [
      { zh: '兵七进一', children: [
        { zh: '卒７进１', children: [] },
        { zh: '马８进７', children: [] },
      ] },
    ],
  },
];

function walk(board: Board, turn: Color, nodes: BookNode[], name: string, index: BookIndex): void {
  for (const node of nodes) {
    const move = chineseToMove(board, turn, node.zh); // 非法/无法解析 → 抛错（测试捕获）
    const key = toFen(board, turn);
    let entry = index.get(key);
    if (!entry) { entry = { moves: [], openings: [] }; index.set(key, entry); }
    if (!entry.moves.some((m) => m.zh === node.zh)) entry.moves.push({ move, zh: node.zh });
    if (!entry.openings.includes(name)) entry.openings.push(name);
    walk(applyMove(board, move), opponent(turn), node.children, name, index);
  }
}

// 重放全书构建 FEN→续着索引（异途同归自动按 FEN 合并）
export function buildBookIndex(): BookIndex {
  const index: BookIndex = new Map();
  for (const op of OPENINGS) walk(initialBoard(), 'red', op.roots, op.name, index);
  return index;
}

// 当前局面 → 续着+开局名；不在书内返回 null（出谱）
export function lookupBook(index: BookIndex, board: Board, turn: Color): BookEntry | null {
  return index.get(toFen(board, turn)) ?? null;
}
```

- [ ] **Step 4:** `npx vitest run tests/openings.test.ts` → PASS（5 例）

- [ ] **Step 5: 提交**
```bash
git add src/engine/openings.ts tests/openings.test.ts
git commit -m "feat(engine): 开局库数据 + FEN 索引 + 查书（中文着法树，重放校验）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：render.ts 金色书签点层

**Files:** Modify `src/ui/render.ts`

- [ ] **Step 1: 改 render.ts** — 在 `drawMoveHint` 之后新增：
```ts
// 开局谱着提示：金色书签点（描环 + 实心点），区别于青玉选中/着法点
function drawBookHints(ctx: CanvasRenderingContext2D, squares: Square[]) {
  for (const sq of squares) {
    const x = pointX(sq.col);
    const y = pointY(sq.row);
    ctx.beginPath();
    ctx.arc(x, y, PIECE_R + 1, 0, Math.PI * 2);
    ctx.strokeStyle = '#d8b777';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#d8b777';
    ctx.fill();
  }
}
```
将 `render` 签名末位加可选参数（`theme` 必填在前，可选参数在后合法）：
```ts
export function render(
  ctx: CanvasRenderingContext2D,
  board: Board,
  selected: Square | null,
  legalDests: Square[],
  lastMove: Move | null,
  anim: AnimState | null,
  theme: Theme,
  bookHints: Square[] = [],
) {
```
在 `render` 体内、绘制 `legalDests` 提示之后、`if (anim)` 之前，加：
```ts
  if (bookHints.length) drawBookHints(ctx, bookHints);
```

- [ ] **Step 2:** `npm run typecheck`（无错——既有 render 调用未传 bookHints 走默认 []，不破）。`npm run build` 出单文件。

- [ ] **Step 3: 提交**
```bash
git add src/ui/render.ts
git commit -m "feat(ui): render 加开局谱着金色书签点层（可选 bookHints）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：browse 导航纯逻辑（engine/browse.ts）

**Files:** Create `src/engine/browse.ts`; Create `tests/browse.test.ts`

- [ ] **Step 1: 写失败测试** — `tests/browse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { BrowseSession } from '../src/engine/browse';
import { OPENINGS } from '../src/engine/openings';
import { initialBoard } from '../src/engine/board';

const zhongpao = OPENINGS.find((o) => o.id === 'zhongpao-pingfengma')!;

describe('BrowseSession', () => {
  it('新会话停在初始局面、可进不可退', () => {
    const s = new BrowseSession(zhongpao);
    expect(s.position().board).toEqual(initialBoard());
    expect(s.position().turn).toBe('red');
    expect(s.canPrev()).toBe(false);
    expect(s.canNext()).toBe(true);
    expect(s.moves()).toEqual([]);
  });

  it('next 推进谱着、prev 回退', () => {
    const s = new BrowseSession(zhongpao);
    s.next(); // 炮二平五
    expect(s.moves()).toEqual(['炮二平五']);
    expect(s.position().turn).toBe('black');
    expect(s.canPrev()).toBe(true);
    s.prev();
    expect(s.moves()).toEqual([]);
    expect(s.position().turn).toBe('red');
  });

  it('分支节点 frontier 给多变着，next(idx) 选变着', () => {
    const s = new BrowseSession(zhongpao);
    s.next(); s.next(); s.next(); // 炮二平五 马8进7 马二进三 → frontier 有 2 变着
    expect(s.frontier().length).toBe(2);
    s.next(1); // 选第二变着 卒３进１
    expect(s.moves()[3]).toBe('卒３进１');
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/browse.test.ts` → FAIL（模块不存在）

- [ ] **Step 3: 写 browse.ts**:
```ts
import type { Board, Color } from './types';
import { opponent } from './types';
import { initialBoard } from './board';
import { applyMove } from './game';
import { chineseToMove } from './notation';
import type { BookNode, Opening } from './openings';

// 纯逻辑：沿一棵开局谱树前进/后退，按需选变着。无 DOM，可单测。
export class BrowseSession {
  private path: BookNode[] = [];
  constructor(public readonly opening: Opening) {}

  // 当前局面（从初始重放 path）
  position(): { board: Board; turn: Color } {
    let board = initialBoard();
    let turn: Color = 'red';
    for (const node of this.path) {
      const m = chineseToMove(board, turn, node.zh);
      board = applyMove(board, m);
      turn = opponent(turn);
    }
    return { board, turn };
  }

  moves(): string[] {
    return this.path.map((n) => n.zh);
  }

  // 可前进的分支：当前节点的 children（path 空时为 roots）
  frontier(): BookNode[] {
    return this.path.length === 0 ? this.opening.roots : this.path[this.path.length - 1].children;
  }

  canNext(): boolean { return this.frontier().length > 0; }
  canPrev(): boolean { return this.path.length > 0; }

  next(childIdx = 0): void {
    const f = this.frontier();
    if (f[childIdx]) this.path.push(f[childIdx]);
  }
  prev(): void { this.path.pop(); }
  reset(): void { this.path = []; }
}
```

- [ ] **Step 4:** `npx vitest run tests/browse.test.ts` → PASS（3 例）

- [ ] **Step 5: 回归 + 提交**
```bash
npm test && npm run typecheck
git add src/engine/browse.ts tests/browse.test.ts
git commit -m "feat(engine): BrowseSession 开局谱树导航（纯逻辑，可单测）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：对局中谱着提示接线（默认关开关）

**Files:** Modify `src/ui/persist.ts`、`index.html`、`src/ui/style.css`、`src/ui/main.ts`

- [ ] **Step 1: persist.ts 追加**:
```ts
const BKEY = 'xiangqi:bookhint';
export function saveBookHint(on: boolean): void { try { localStorage.setItem(BKEY, on ? '1' : '0'); } catch { /* 忽略 */ } }
export function loadBookHint(): boolean { try { return localStorage.getItem(BKEY) === '1'; } catch { return false; } }
```

- [ ] **Step 2: index.html** — `.controls` 加开关按钮（默认关）:
```html
          <button id="book-hint" class="btn">📖 开局提示</button>
```
并在棋盘上方（masthead 与 board-wrap 之间，或 clocks 旁）加提示行（默认隐藏）:
```html
        <div class="book-line" id="book-line" hidden>
          <span class="book-badge" id="book-badge">开局</span>
          <span class="book-moves" id="book-moves"></span>
        </div>
```

- [ ] **Step 3: style.css 追加**:
```css
/* ===== 开局提示行 ===== */
.book-line { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 10px; font-size: 13px; color: var(--paper-dim); }
.book-line[hidden] { display: none; }
.book-badge { background: var(--gold); color: #3a2a10; border-radius: 5px; padding: 2px 9px; font-weight: 600; }
.book-badge.off { background: #9c8d6e; color: #fff; }
.book-moves .k { color: var(--gold); font-weight: 600; }
```

- [ ] **Step 4: main.ts 接线**
  - imports 追加：`import { buildBookIndex, lookupBook } from '../engine/openings';` 和 `import { saveBookHint, loadBookHint } from './persist';`（并入既有 persist import）。
  - 顶部状态：
    ```ts
    const bookIndex = buildBookIndex();
    let bookHintOn = loadBookHint();
    let bookHints: Square[] = [];
    const bookBtn = document.getElementById('book-hint') as HTMLButtonElement;
    const bookLine = document.getElementById('book-line') as HTMLDivElement;
    const bookBadge = document.getElementById('book-badge') as HTMLSpanElement;
    const bookMovesEl = document.getElementById('book-moves') as HTMLSpanElement;
    bookBtn.textContent = bookHintOn ? '📖 开局提示·开' : '📖 开局提示';
    ```
    （`Square` 已在 main.ts 的 types import 内？若否，加入 `import type { Move, Color, Square } from '../engine/types';`。）
  - 新增 `updateBookHints()`（放在 `refresh` 之前定义）：
    ```ts
    function updateBookHints() {
      if (!bookHintOn) { bookHints = []; bookLine.hidden = true; return; }
      bookLine.hidden = false;
      const e = lookupBook(bookIndex, controller.board, controller.turn);
      if (e) {
        bookHints = e.moves.map((m) => m.move.to);
        bookBadge.className = 'book-badge';
        bookBadge.textContent = e.openings.join(' / ');
        bookMovesEl.innerHTML = '谱着：' + e.moves.map((m) => `<span class="k">${m.zh}</span>`).join(' / ');
      } else {
        bookHints = [];
        bookBadge.className = 'book-badge off';
        bookBadge.textContent = '已出谱';
        bookMovesEl.textContent = '';
      }
    }
    ```
  - `refresh()`：在 `render(...)` 前调 `updateBookHints();`，并把 `bookHints` 作为最后一参传入 render：`render(ctx, controller.board, controller.selected, controller.legalDests, controller.lastMove, null, theme, bookHints);`
  - 开关按钮监听：
    ```ts
    bookBtn.addEventListener('click', () => {
      bookHintOn = !bookHintOn;
      saveBookHint(bookHintOn);
      bookBtn.textContent = bookHintOn ? '📖 开局提示·开' : '📖 开局提示';
      refresh();
    });
    ```
  - 注：`refresh()` 已在每步落子/悔棋/重开后被调用，故 `updateBookHints` 随之刷新，无需额外在各处插桩。

- [ ] **Step 5:** `npm run typecheck` + `npm test`（132+ 仍绿，提示是 UI 不影响 engine）+ `npm run build`。

- [ ] **Step 6: 提交**
```bash
git add src/ui/persist.ts index.html src/ui/style.css src/ui/main.ts
git commit -m "feat(ui): 对局中开局谱着提示/出谱（默认关开关 + 金色书签点）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：开局库浏览模式（单列居中）

**Files:** Modify `index.html`、`src/ui/style.css`、`src/ui/main.ts`

实现一个独立「开局库」模式：进入后棋盘由 `BrowseSession` 驱动、不接受落子；退出回对弈。

- [ ] **Step 1: index.html** — `.controls` 加按钮；新增浏览面板（默认隐藏）:
```html
          <button id="browse" class="btn">开局库</button>
```
在 `.controls` 之后（`.stage` 内）加：
```html
        <div class="browse-panel" id="browse-panel" hidden>
          <div class="level-field">
            <label for="open-sel">开局</label>
            <select id="open-sel" class="select"></select>
          </div>
          <div class="browse-step">
            <button id="b-prev" class="btn">上一步</button>
            <button id="b-next" class="btn btn-primary">下一步</button>
            <div class="level-field" id="var-field" hidden>
              <label for="var-sel">变着</label>
              <select id="var-sel" class="select"></select>
            </div>
            <button id="b-exit" class="btn">退出</button>
          </div>
          <div class="book-moves-list" id="b-moves"></div>
        </div>
```

- [ ] **Step 2: style.css 追加**:
```css
/* ===== 开局库浏览面板 ===== */
.browse-panel { margin-top: 16px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.browse-panel[hidden] { display: none; }
.browse-step { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: center; }
.book-moves-list { background: rgba(236,226,200,0.06); border: 1px solid rgba(236,226,200,0.2); border-radius: 9px; padding: 10px 14px; max-width: 420px; line-height: 2; color: var(--paper-dim); }
.book-moves-list .m.on { background: var(--jade); color: #fff; padding: 0 5px; border-radius: 3px; }
```

- [ ] **Step 3: main.ts 接线**
  - imports：`import { OPENINGS } from '../engine/openings';` `import { BrowseSession } from '../engine/browse';` `import { moveToChinese } from '../engine/notation';`（moveToChinese 备用；谱着列表直接用 session.moves() 的 zh）。
  - refs + 状态：
    ```ts
    const browseBtn = document.getElementById('browse') as HTMLButtonElement;
    const browsePanel = document.getElementById('browse-panel') as HTMLDivElement;
    const openSel = document.getElementById('open-sel') as HTMLSelectElement;
    const bPrev = document.getElementById('b-prev') as HTMLButtonElement;
    const bNext = document.getElementById('b-next') as HTMLButtonElement;
    const bExit = document.getElementById('b-exit') as HTMLButtonElement;
    const varField = document.getElementById('var-field') as HTMLDivElement;
    const varSel = document.getElementById('var-sel') as HTMLSelectElement;
    const bMoves = document.getElementById('b-moves') as HTMLDivElement;
    let browsing = false;
    let session: BrowseSession | null = null;
    // 填开局下拉
    OPENINGS.forEach((o) => { const opt = document.createElement('option'); opt.value = o.id; opt.textContent = o.name; openSel.appendChild(opt); });
    ```
  - `function renderBrowse()`：
    ```ts
    if (!session) return;
    const pos = session.position();
    render(ctx, pos.board, null, [], null, null, theme, []);
    // 谱着列表（当前手高亮 = 最后一手）
    const zhs = session.moves();
    bMoves.innerHTML = zhs.length
      ? zhs.map((z, i) => `<span class="m${i === zhs.length - 1 ? ' on' : ''}">${i % 2 === 0 ? Math.floor(i / 2) + 1 + '.' : ''}${z}</span>`).join(' ')
      : '（开局起始局面，点「下一步」打谱）';
    bPrev.disabled = !session.canPrev();
    bNext.disabled = !session.canNext();
    // 变着：frontier>1 时显示
    const f = session.frontier();
    if (f.length > 1) {
      varField.hidden = false;
      varSel.innerHTML = f.map((n, i) => `<option value="${i}">${n.zh}${n.comment ? '（' + n.comment + '）' : ''}</option>`).join('');
    } else { varField.hidden = true; }
    ```
  - `function enterBrowse()`：`browsing = true; browsePanel.hidden = false; document.querySelector('.controls')!.setAttribute('hidden',''); session = new BrowseSession(OPENINGS.find((o) => o.id === openSel.value) || OPENINGS[0]); renderBrowse();`
    （进入时隐藏对弈控件 `.controls`；棋盘 canvas 共用。亦隐藏 book-line / clocks 若可见。）
  - `function exitBrowse()`：`browsing = false; browsePanel.hidden = true; document.querySelector('.controls')!.removeAttribute('hidden'); session = null; refresh();`（回对弈当前局面）
  - 监听：
    ```ts
    browseBtn.addEventListener('click', () => { if (busy()) return; if (browsing) exitBrowse(); else enterBrowse(); });
    openSel.addEventListener('change', () => { session = new BrowseSession(OPENINGS.find((o) => o.id === openSel.value)!); renderBrowse(); });
    bNext.addEventListener('click', () => { if (!session) return; session.next(Number(varSel.value) || 0); renderBrowse(); });
    bPrev.addEventListener('click', () => { if (!session) return; session.prev(); renderBrowse(); });
    bExit.addEventListener('click', exitBrowse);
    ```
  - canvas click 守卫：在点击处理最前面加 `if (browsing) return;`（浏览模式不接受落子）。

- [ ] **Step 4:** `npm run typecheck` + `npm test`（engine 不受影响）+ `npm run build`。

- [ ] **Step 5: 提交**
```bash
git add index.html src/ui/style.css src/ui/main.ts
git commit -m "feat(ui): 开局库浏览模式（单列居中，BrowseSession 驱动步进/变着）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：扩充开局至 10+ 套

**Files:** Modify `src/engine/openings.ts`

- [ ] **Step 1:** 在 `OPENINGS` 增至 ≥10 套主流开局，每套主线 + 1–2 变着，全部中文记谱。候选：中炮对屏风马、中炮对反宫马、中炮过河车对屏风马、仙人指路、飞相局、起马局、过宫炮、士角炮、列炮、顺炮直车对横车。每条谱线**逐手中文记谱**，确保红黑交替、记法正确。

- [ ] **Step 2: 合法性自动兜底** — `tests/openings.test.ts` 的「全书每条谱线合法」用例已覆盖：`npx vitest run tests/openings.test.ts`。若某谱线写错（非法/记法错），`buildBookIndex` 抛错→该用例 FAIL，**按报错的局面+记法逐手核对修正**，禁止删用例绕过。补一条断言 `OPENINGS.length >= 10`。

- [ ] **Step 3: 提交**
```bash
git add src/engine/openings.ts tests/openings.test.ts
git commit -m "feat(engine): 开局库扩至 10+ 套主流开局（合法性测试兜底）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完成判据（B3）
- `npm test` 全绿（新增 openings/browse 测）；`npm run typecheck`；`npm run build` 单文件。
- 真机冒烟：开局提示开关默认关、可开、持久化；开启后命中显金色书签点+开局名+中文续着、出谱显「已出谱」。浏览模式选开局→步进/回退/变着→局面与谱着列表同步；退出回对弈。
- 金色书签点观感截图 → owner 点头。
- `OPENINGS` ≥10 套，全书合法性测试绿。

## 已知限制（写入注释）
- 只读内置库，不支持用户导入/自定义开局。
- 出谱只提示「在不在书上」，不做改正建议/胜率评估。
- 浏览模式与对弈模式互斥（同一棋盘 canvas 复用）。
