> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 子项目 A1：序列化地基 + 存档读档 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给象棋引擎加上局面 FEN、中文+ICCS 双轨记谱、PGN 整盘容器三层序列化，并接上 localStorage 自动续局与 `.pgn` 文件导入导出。

**Architecture:** 全部序列化逻辑放在 `src/engine/`（纯函数、可 vitest 穷举单测，engine 是唯一真相）；UI 仅薄薄一层接线调用。Game 先补「起始局面 + 着法列表」追踪，供 PGN 重放。存档以 PGN 文本为唯一载体，文件与 localStorage 共用，DRY。

**Tech Stack:** TypeScript（纯函数引擎）、vitest（单测）、Vite（构建/单文件）。无新增依赖。

**分支：** 在 `v3-subproject-a` 上实现（spec 提交已在此分支）。

**坐标约定（贯穿全计划，务必牢记）：**
- `row 0..9`：0 = 黑方底线（顶部），9 = 红方底线（底部）。`col 0..8`：红方视角左→右。
- 红方「前」= row 更小；黑方「前」= row 更大。红进 = row 减小，红退 = row 增大；黑反之。
- 纵线号 `fileNum = 9 - col`（两方数值相同，col8→1、col0→9）；红用汉字 `一..九`，黑用 ASCII `1..9`。

---

## Task 1：Game 追踪起始局面与着法列表

PGN 导出需要「从某起始局面重放整列着法」。当前 `Game` 只存 board 快照，不存所走的 `Move` 序列，也不留起始局面。本任务补齐。

**Files:**
- Modify: `src/engine/game.ts`
- Test: `tests/game-history.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `tests/game-history.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { Game } from '../src/engine/game';
import { initialBoard } from '../src/engine/board';

describe('Game 起始局面与着法列表', () => {
  it('新局起始局面=初始摆子、红先、着法列表空', () => {
    const g = new Game();
    expect(g.getMoves()).toEqual([]);
    const sp = g.startPosition;
    expect(sp.turn).toBe('red');
    expect(sp.board).toEqual(initialBoard());
  });

  it('走子后 getMoves 记录着法，undo 弹出', () => {
    const g = new Game();
    const m = { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } }; // 炮二平五
    expect(g.move(m)).toBe(true);
    expect(g.getMoves()).toEqual([m]);
    g.undo();
    expect(g.getMoves()).toEqual([]);
  });

  it('startPosition 返回深拷贝，外部改动不影响内部', () => {
    const g = new Game();
    const sp = g.startPosition;
    sp.board[0][0] = null;
    expect(g.startPosition.board[0][0]).not.toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/game-history.test.ts`
Expected: FAIL（`g.getMoves is not a function` / `startPosition` undefined）

- [ ] **Step 3: 改 game.ts**

在 `Game` 类里新增字段与方法，并在三处接线（构造、fromPosition、move、undo）。

字段区（紧跟 `private plies: PlyInfo[] = [];` 之后）新增：

```ts
  private startBoard: Board;
  private startTurn: Color;
  private moveList: Move[] = [];
```

构造函数 `constructor()` 末尾（`this.positions.push(...)` 之后）新增：

```ts
    this.startBoard = cloneBoard(this.board);
    this.startTurn = this.turn;
```

`static fromPosition(...)` 内（`g.plies = [];` 之后、`return g;` 之前）新增：

```ts
    g.startBoard = cloneBoard(board);
    g.startTurn = turn;
    g.moveList = [];
```

`move(m)` 内，在 `this.history.push(...)` 那一行**之后**新增（记录所走着法的深拷贝）：

```ts
    this.moveList.push({ from: { ...m.from }, to: { ...m.to } });
```

`undo()` 内，在 `this.plies.pop();` 之后新增：

```ts
    this.moveList.pop();
```

类内（`undo()` 之后）新增两个读取接口：

```ts
  // 起始局面（深拷贝），供 PGN 重放
  get startPosition(): { board: Board; turn: Color } {
    return { board: cloneBoard(this.startBoard), turn: this.startTurn };
  }

  // 已走着法序列（深拷贝）
  getMoves(): Move[] {
    return this.moveList.map((m) => ({ from: { ...m.from }, to: { ...m.to } }));
  }
```

（`Board`/`Color`/`Move` 类型与 `cloneBoard` 当前文件已 import，无需新增。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/game-history.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: 回归 + 类型检查 + 提交**

Run: `npm test && npm run typecheck`
Expected: 全绿（既有用例不受影响）

```bash
git add src/engine/game.ts tests/game-history.test.ts
git commit -m "feat(engine): Game 追踪起始局面与着法列表，供 PGN 重放

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：局面 ↔ FEN（`engine/fen.ts`）

采用通行象棋 FEN：10 行以 `/` 分隔（row 0 在前），大写=红、小写=黑，字母 `r`车 `n`马 `b`象 `a`士 `k`将 `c`炮 `p`兵，数字表连续空位，尾部空格 + 轮走方（`w`=红、`b`=黑）。

**Files:**
- Create: `src/engine/fen.ts`
- Test: `tests/fen.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `tests/fen.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { toFen, fromFen } from '../src/engine/fen';
import { initialBoard, emptyBoard } from '../src/engine/board';

const INIT_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

describe('FEN', () => {
  it('初始局面 → 标准 FEN', () => {
    expect(toFen(initialBoard(), 'red')).toBe(INIT_FEN);
  });

  it('FEN → 局面往返一致（初始）', () => {
    const { board, turn } = fromFen(INIT_FEN);
    expect(board).toEqual(initialBoard());
    expect(turn).toBe('red');
  });

  it('自定义残局往返一致', () => {
    const b = emptyBoard();
    b[0][4] = { type: 'general', color: 'black' };
    b[9][4] = { type: 'general', color: 'red' };
    b[5][0] = { type: 'chariot', color: 'red' };
    const fen = toFen(b, 'black');
    const back = fromFen(fen);
    expect(back.board).toEqual(b);
    expect(back.turn).toBe('black');
  });

  it('非法 FEN 抛错', () => {
    expect(() => fromFen('rnbakabnr/9/9 w')).toThrow(); // 行数不足
    expect(() => fromFen(INIT_FEN.replace(' w', ''))).toThrow(); // 缺轮走方
    expect(() => fromFen('xnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w')).toThrow(); // 非法字符
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/fen.test.ts`
Expected: FAIL（`Cannot find module '../src/engine/fen'`）

- [ ] **Step 3: 写 fen.ts**

新建 `src/engine/fen.ts`：

```ts
import type { Board, Color, Piece, PieceType } from './types';
import { ROWS, COLS } from './types';
import { emptyBoard } from './board';

// 棋子类型 ↔ FEN 字母（通行象棋 FEN）
const TYPE_TO_LETTER: Record<PieceType, string> = {
  chariot: 'r', horse: 'n', elephant: 'b', advisor: 'a',
  general: 'k', cannon: 'c', soldier: 'p',
};
const LETTER_TO_TYPE: Record<string, PieceType> = {
  r: 'chariot', n: 'horse', b: 'elephant', a: 'advisor',
  k: 'general', c: 'cannon', p: 'soldier',
};

function pieceLetter(p: Piece): string {
  const l = TYPE_TO_LETTER[p.type];
  return p.color === 'red' ? l.toUpperCase() : l;
}

// 局面 → FEN（大写红、小写黑；尾部 w=红 / b=黑）
export function toFen(board: Board, turn: Color): string {
  const rows: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    let line = '';
    let empties = 0;
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (!p) { empties++; continue; }
      if (empties > 0) { line += String(empties); empties = 0; }
      line += pieceLetter(p);
    }
    if (empties > 0) line += String(empties);
    rows.push(line);
  }
  return rows.join('/') + ' ' + (turn === 'red' ? 'w' : 'b');
}

// FEN → 局面。行数≠10 / 列数≠9 / 非法字符 / 缺轮走方 均抛错。
export function fromFen(fen: string): { board: Board; turn: Color } {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) throw new Error('FEN 缺少轮走方: ' + fen);
  const placement = parts[0];
  const side = parts[1];
  if (side !== 'w' && side !== 'b') throw new Error('FEN 轮走方非法: ' + side);

  const rowStrs = placement.split('/');
  if (rowStrs.length !== ROWS) throw new Error('FEN 行数必须为 10，实得 ' + rowStrs.length);

  const board = emptyBoard();
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    for (const ch of rowStrs[r]) {
      if (ch >= '1' && ch <= '9') {
        c += Number(ch);
      } else {
        const lower = ch.toLowerCase();
        const type = LETTER_TO_TYPE[lower];
        if (!type) throw new Error('FEN 非法字符: ' + ch);
        if (c >= COLS) throw new Error('FEN 第 ' + r + ' 行超出 9 列');
        board[r][c] = { type, color: ch === lower ? 'black' : 'red' };
        c++;
      }
    }
    if (c !== COLS) throw new Error('FEN 第 ' + r + ' 行列数必须为 9，实得 ' + c);
  }
  return { board, turn: side === 'w' ? 'red' : 'black' };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/fen.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: 类型检查 + 提交**

Run: `npm run typecheck`
Expected: 无错

```bash
git add src/engine/fen.ts tests/fen.test.ts
git commit -m "feat(engine): 局面 ↔ 象棋 FEN（通行约定，含非法拒绝）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：ICCS 坐标记法（`engine/notation.ts` 第一部分）

ICCS 用本项目内部一致约定：纵线 `col 0..8 → 'a'..'i'`，横线用 `row 0..9`。着法 = `起点-落点`（如红右炮 `h7-e7`）。往返一致是硬性质（B/C 复用）。

**Files:**
- Create: `src/engine/notation.ts`
- Test: `tests/notation.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `tests/notation.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { moveToIccs, iccsToMove } from '../src/engine/notation';

describe('ICCS 记法', () => {
  it('着法 → ICCS', () => {
    expect(moveToIccs({ from: { row: 7, col: 7 }, to: { row: 7, col: 4 } })).toBe('h7-e7');
    expect(moveToIccs({ from: { row: 0, col: 0 }, to: { row: 1, col: 0 } })).toBe('a0-a1');
  });

  it('ICCS → 着法往返一致', () => {
    const m = { from: { row: 9, col: 1 }, to: { row: 7, col: 2 } };
    expect(iccsToMove(moveToIccs(m))).toEqual(m);
  });

  it('非法 ICCS 抛错', () => {
    expect(() => iccsToMove('z9-a1')).toThrow();
    expect(() => iccsToMove('h7e7')).toThrow();
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/notation.test.ts`
Expected: FAIL（`Cannot find module '../src/engine/notation'`）

- [ ] **Step 3: 写 notation.ts（ICCS 部分）**

新建 `src/engine/notation.ts`：

```ts
import type { Board, Color, Move, PieceType } from './types';
import { ROWS, COLS } from './types';

/* ============ ICCS 坐标记法（项目内部一致约定） ============ */
// 纵线 col 0..8 → 'a'..'i'（红方视角左→右）；横线用 row 0..9（0=黑方底线）。
const FILES = 'abcdefghi';

export function moveToIccs(move: Move): string {
  return FILES[move.from.col] + move.from.row + '-' + FILES[move.to.col] + move.to.row;
}

export function iccsToMove(s: string): Move {
  const m = /^([a-i])(\d)-([a-i])(\d)$/.exec(s.trim());
  if (!m) throw new Error('非法 ICCS 着法: ' + s);
  return {
    from: { col: FILES.indexOf(m[1]), row: Number(m[2]) },
    to: { col: FILES.indexOf(m[3]), row: Number(m[4]) },
  };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/notation.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

Run: `npm run typecheck`
Expected: 无错

```bash
git add src/engine/notation.ts tests/notation.test.ts
git commit -m "feat(engine): ICCS 坐标记法（着法 ↔ 坐标，往返一致）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：中文记谱 — 生成（`moveToChinese`）

把 `Move`（配着法前的 board）渲染成中文记谱：`<子名><起纵线><进/退/平><目标>`。
- 直行子（车/炮/将/兵卒）：进/退后接**步数**；平后接**目标纵线**。
- 斜行/田字子（马/象/士）：进/退后接**目标纵线**。
- 消歧：同色同类在同一纵线，2 子用「前/后」+ 子名（省略起纵线）；≥3 子（兵卒）用「一二三四五」（前→后）+ 子名。

**Files:**
- Modify: `src/engine/notation.ts`
- Test: `tests/notation.test.ts`（追加 describe）

- [ ] **Step 1: 追加失败测试**

在 `tests/notation.test.ts` 顶部 import 改为：

```ts
import { describe, it, expect } from 'vitest';
import { moveToIccs, iccsToMove, moveToChinese } from '../src/engine/notation';
import { initialBoard, emptyBoard } from '../src/engine/board';
```

并追加：

```ts
describe('中文记谱 — 生成', () => {
  const b = initialBoard();

  it('红方常规着法', () => {
    expect(moveToChinese(b, { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } })).toBe('炮二平五');
    expect(moveToChinese(b, { from: { row: 9, col: 7 }, to: { row: 7, col: 6 } })).toBe('马二进三');
    expect(moveToChinese(b, { from: { row: 9, col: 1 }, to: { row: 7, col: 2 } })).toBe('马八进七');
    expect(moveToChinese(b, { from: { row: 6, col: 0 }, to: { row: 5, col: 0 } })).toBe('兵九进一');
    expect(moveToChinese(b, { from: { row: 9, col: 0 }, to: { row: 8, col: 0 } })).toBe('车九进一');
  });

  it('黑方用阿拉伯数字', () => {
    expect(moveToChinese(b, { from: { row: 2, col: 7 }, to: { row: 2, col: 4 } })).toBe('炮2平5');
    expect(moveToChinese(b, { from: { row: 0, col: 7 }, to: { row: 2, col: 6 } })).toBe('马2进3');
  });

  it('同纵线 2 子用前/后', () => {
    const t = emptyBoard();
    t[9][4] = { type: 'general', color: 'red' };
    t[0][4] = { type: 'general', color: 'black' };
    t[3][2] = { type: 'cannon', color: 'red' }; // 前炮（红 row 小为前）
    t[5][2] = { type: 'cannon', color: 'red' }; // 后炮
    expect(moveToChinese(t, { from: { row: 3, col: 2 }, to: { row: 1, col: 2 } })).toBe('前炮进二');
    expect(moveToChinese(t, { from: { row: 5, col: 2 }, to: { row: 4, col: 2 } })).toBe('后炮进一');
  });

  it('同纵线 3 兵用一二三（前→后）', () => {
    const t = emptyBoard();
    t[9][4] = { type: 'general', color: 'red' };
    t[0][4] = { type: 'general', color: 'black' };
    t[3][4] = { type: 'soldier', color: 'red' }; // 一（最前）
    t[5][4] = { type: 'soldier', color: 'red' }; // 二
    t[6][4] = { type: 'soldier', color: 'red' }; // 三
    expect(moveToChinese(t, { from: { row: 5, col: 4 }, to: { row: 4, col: 4 } })).toBe('二兵进一');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/notation.test.ts`
Expected: FAIL（`moveToChinese is not a function`）

- [ ] **Step 3: 在 notation.ts 追加中文生成**

在 `notation.ts` 末尾追加：

```ts
/* ============ 中文记谱 ============ */
const PIECE_CHAR: Record<PieceType, [string, string]> = {
  general: ['帅', '将'], advisor: ['仕', '士'], elephant: ['相', '象'],
  horse: ['马', '马'], chariot: ['车', '车'], cannon: ['炮', '炮'], soldier: ['兵', '卒'],
};
const RED_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const BLACK_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
// 进/退后接「步数」的直行子；其余（马象士）接「目标纵线」
const STEP_PIECES = new Set<PieceType>(['chariot', 'cannon', 'general', 'soldier']);

function charToType(ch: string): PieceType | null {
  for (const t of Object.keys(PIECE_CHAR) as PieceType[]) {
    if (PIECE_CHAR[t][0] === ch || PIECE_CHAR[t][1] === ch) return t;
  }
  return null;
}
// 数字（1基）→ 该方数字串
function numStr(n: number, color: Color): string {
  return (color === 'red' ? RED_DIGITS : BLACK_DIGITS)[n - 1];
}
// 该方数字串 → 数字（1基）；非法返回 0
function parseNum(s: string, color: Color): number {
  const i = (color === 'red' ? RED_DIGITS : BLACK_DIGITS).indexOf(s);
  return i < 0 ? 0 : i + 1;
}
// 纵线号（1基）：两方同值，col8→1、col0→9
function fileNum(col: number): number { return COLS - col; }
function colFromFileNum(n: number): number { return COLS - n; }
// 同色同类、同一纵线(col)的全部子的 row（升序）
function sameFileRows(board: Board, type: PieceType, color: Color, col: number): number[] {
  const rs: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    const p = board[r][col];
    if (p && p.type === type && p.color === color) rs.push(r);
  }
  return rs;
}

// 着法前局面 board + move → 中文记谱
export function moveToChinese(board: Board, move: Move): string {
  const p = board[move.from.row][move.from.col];
  if (!p) throw new Error('起点无子: ' + JSON.stringify(move));
  const { color, type } = p;
  const ch = PIECE_CHAR[type][color === 'red' ? 0 : 1];
  const dr = move.to.row - move.from.row;
  const forward = color === 'red' ? dr < 0 : dr > 0;

  // 动向 + 目标数
  let verb: string;
  let target: string;
  if (dr === 0) {
    verb = '平';
    target = numStr(fileNum(move.to.col), color);
  } else {
    verb = forward ? '进' : '退';
    target = STEP_PIECES.has(type)
      ? numStr(Math.abs(dr), color) // 步数
      : numStr(fileNum(move.to.col), color); // 目标纵线
  }

  // 消歧前缀
  const onFile = sameFileRows(board, type, color, move.from.col);
  if (onFile.length >= 2) {
    const frontToBack = color === 'red' ? onFile : [...onFile].reverse();
    const idx = frontToBack.indexOf(move.from.row);
    const prefix = onFile.length === 2 ? (idx === 0 ? '前' : '后') : numStr(idx + 1, color);
    return prefix + ch + verb + target;
  }
  return ch + numStr(fileNum(move.from.col), color) + verb + target;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/notation.test.ts`
Expected: PASS（含新增 4 个 describe 用例）

- [ ] **Step 5: 提交**

Run: `npm run typecheck`
Expected: 无错

```bash
git add src/engine/notation.ts tests/notation.test.ts
git commit -m "feat(engine): 中文记谱生成（含前/后、一二三 同线消歧）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：中文记谱 — 解析（`chineseToMove`）+ 往返性质

解析为生成的逆：给「着法前局面 + 走方 + 记谱串」还原 `Move`。
- `c0` 是子名 → 常规式（`c1` 是起纵线）；否则位置式（`c0` ∈ 前/后/序数，`c1` 是子名）。
- 位置式定位：扫描含该类 ≥2 子的纵线（真实对局几乎必然唯一，多于一条则抛错，属已知限制）。

**Files:**
- Modify: `src/engine/notation.ts`
- Test: `tests/notation.test.ts`（追加）

- [ ] **Step 1: 追加失败测试**

import 行追加 `chineseToMove`：

```ts
import { moveToIccs, iccsToMove, moveToChinese, chineseToMove } from '../src/engine/notation';
```

追加：

```ts
describe('中文记谱 — 解析与往返', () => {
  const b = initialBoard();

  it('常规式解析', () => {
    expect(chineseToMove(b, 'red', '炮二平五')).toEqual({ from: { row: 7, col: 7 }, to: { row: 7, col: 4 } });
    expect(chineseToMove(b, 'red', '马二进三')).toEqual({ from: { row: 9, col: 7 }, to: { row: 7, col: 6 } });
    expect(chineseToMove(b, 'black', '炮2平5')).toEqual({ from: { row: 2, col: 7 }, to: { row: 2, col: 4 } });
    expect(chineseToMove(b, 'black', '马2进3')).toEqual({ from: { row: 0, col: 7 }, to: { row: 2, col: 6 } });
  });

  it('开局四着 生成→解析 往返一致', () => {
    const moves = [
      { mv: { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } }, color: 'red' as const },
      { mv: { from: { row: 0, col: 1 }, to: { row: 2, col: 2 } }, color: 'black' as const },
      { mv: { from: { row: 9, col: 1 }, to: { row: 7, col: 2 } }, color: 'red' as const },
      { mv: { from: { row: 0, col: 7 }, to: { row: 2, col: 6 } }, color: 'black' as const },
    ];
    for (const { mv, color } of moves) {
      const zh = moveToChinese(b, mv);
      expect(chineseToMove(b, color, zh)).toEqual(mv);
    }
  });

  it('前/后 与 序数 解析', () => {
    const t = emptyBoard();
    t[9][4] = { type: 'general', color: 'red' };
    t[0][4] = { type: 'general', color: 'black' };
    t[3][2] = { type: 'cannon', color: 'red' };
    t[5][2] = { type: 'cannon', color: 'red' };
    expect(chineseToMove(t, 'red', '前炮进二')).toEqual({ from: { row: 3, col: 2 }, to: { row: 1, col: 2 } });
    expect(chineseToMove(t, 'red', '后炮进一')).toEqual({ from: { row: 5, col: 2 }, to: { row: 4, col: 2 } });
  });

  it('马/象/士 进退接目标纵线 解析正确', () => {
    const t = emptyBoard();
    t[9][4] = { type: 'general', color: 'red' };
    t[0][4] = { type: 'general', color: 'black' };
    t[4][2] = { type: 'elephant', color: 'red' }; // 相七
    // 相七进五：col2→col4(田字纵2)，红进 row 减 2 → row2
    expect(chineseToMove(t, 'red', '相七进五')).toEqual({ from: { row: 4, col: 2 }, to: { row: 2, col: 4 } });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/notation.test.ts`
Expected: FAIL（`chineseToMove is not a function`）

- [ ] **Step 3: 在 notation.ts 追加解析**

在 `notation.ts` 末尾追加：

```ts
// 中文记谱 + 着法前局面 + 走方 → Move
export function chineseToMove(board: Board, color: Color, s: string): Move {
  const str = s.trim();
  if (str.length < 4) throw new Error('中文记谱过短: ' + s);
  const c0 = str[0], c1 = str[1], verbCh = str[2], numCh = str[3];

  let type: PieceType;
  let from: { row: number; col: number };

  if (charToType(c0) !== null) {
    // 常规式：子名 + 起纵线
    type = charToType(c0)!;
    const fnum = parseNum(c1, color);
    if (fnum === 0) throw new Error('无法解析起纵线: ' + s);
    const col = colFromFileNum(fnum);
    const rows = sameFileRows(board, type, color, col);
    if (rows.length === 0) throw new Error('该纵线无对应子: ' + s);
    from = { row: rows[0], col };
  } else {
    // 位置式：前/后/序数 + 子名
    const t = charToType(c1);
    if (!t) throw new Error('无法解析子名: ' + s);
    type = t;
    let col = -1, rows: number[] = [];
    for (let cc = 0; cc < COLS; cc++) {
      const rs = sameFileRows(board, type, color, cc);
      if (rs.length >= 2) { col = cc; rows = rs; break; }
    }
    if (col < 0) throw new Error('无可消歧的同纵线多子: ' + s);
    const frontToBack = color === 'red' ? rows : [...rows].reverse();
    let idx: number;
    if (c0 === '前') idx = 0;
    else if (c0 === '后') idx = frontToBack.length - 1;
    else {
      const n = parseNum(c0, color);
      if (n === 0) throw new Error('非法序数: ' + s);
      idx = n - 1;
    }
    if (idx < 0 || idx >= frontToBack.length) throw new Error('序数越界: ' + s);
    from = { row: frontToBack[idx], col };
  }

  // 红进=row减、红退=row增；黑反之
  const sign = (verbCh === '进') === (color === 'red') ? -1 : 1;
  let to: { row: number; col: number };
  if (verbCh === '平') {
    const fnum = parseNum(numCh, color);
    if (fnum === 0) throw new Error('非法目标纵线: ' + s);
    to = { row: from.row, col: colFromFileNum(fnum) };
  } else if (verbCh === '进' || verbCh === '退') {
    if (STEP_PIECES.has(type)) {
      const steps = parseNum(numCh, color);
      if (steps === 0) throw new Error('非法步数: ' + s);
      to = { row: from.row + sign * steps, col: from.col };
    } else {
      const fnum = parseNum(numCh, color);
      if (fnum === 0) throw new Error('非法目标纵线: ' + s);
      const toCol = colFromFileNum(fnum);
      const dc = Math.abs(toCol - from.col);
      const dr = type === 'horse' ? (dc === 1 ? 2 : 1) : type === 'elephant' ? 2 : 1;
      to = { row: from.row + sign * dr, col: toCol };
    }
  } else {
    throw new Error('非法动向: ' + s);
  }
  return { from, to };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/notation.test.ts`
Expected: PASS（全部中文用例）

- [ ] **Step 5: 回归 + 提交**

Run: `npm test && npm run typecheck`
Expected: 全绿

```bash
git add src/engine/notation.ts tests/notation.test.ts
git commit -m "feat(engine): 中文记谱解析 + 生成解析往返性质

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：PGN 整盘容器（`engine/pgn.ts`）

PGN 式文本：元信息 tags + 着法（ICCS 为主记法、`{中文}` 为注释，双轨可读可解析）。解析时读 ICCS、忽略注释与回合号。

**Files:**
- Create: `src/engine/pgn.ts`
- Test: `tests/pgn.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

新建 `tests/pgn.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { Game } from '../src/engine/game';
import { gameToPgn, pgnToGame } from '../src/engine/pgn';

function playOpening(): Game {
  const g = new Game();
  g.move({ from: { row: 7, col: 7 }, to: { row: 7, col: 4 } }); // 炮二平五
  g.move({ from: { row: 0, col: 1 }, to: { row: 2, col: 2 } }); // 马８进７
  g.move({ from: { row: 9, col: 1 }, to: { row: 7, col: 2 } }); // 马八进七
  return g;
}

describe('PGN', () => {
  it('导出含 tags 与双轨着法', () => {
    const pgn = gameToPgn(playOpening(), { red: '甲', black: '乙' });
    expect(pgn).toContain('[Red "甲"]');
    expect(pgn).toContain('[Black "乙"]');
    expect(pgn).toContain('h7-e7');
    expect(pgn).toContain('{炮二平五}');
    expect(pgn).toContain('1.');
  });

  it('导出→导入→局面逐手一致', () => {
    const g = playOpening();
    const back = pgnToGame(gameToPgn(g));
    expect(back.board).toEqual(g.board);
    expect(back.turn).toBe(g.turn);
    expect(back.getMoves()).toEqual(g.getMoves());
  });

  it('从残局起始局面（带 FEN tag）往返一致', () => {
    const g = playOpening();
    const pgn = gameToPgn(g);
    // 普通开局不应写 FEN tag（起始=初始局面）
    expect(pgn).not.toContain('[FEN');
    const back = pgnToGame(pgn);
    expect(back.board).toEqual(g.board);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run tests/pgn.test.ts`
Expected: FAIL（`Cannot find module '../src/engine/pgn'`）

- [ ] **Step 3: 写 pgn.ts**

新建 `src/engine/pgn.ts`：

```ts
import type { GameStatus } from './types';
import { Game, applyMove } from './game';
import { toFen, fromFen } from './fen';
import { moveToIccs, iccsToMove, moveToChinese } from './notation';
import { initialBoard, cloneBoard } from './board';

export interface GameMeta {
  event?: string;
  date?: string;
  red?: string;
  black?: string;
}

function resultTag(status: GameStatus): string {
  return status === 'red_win' ? '1-0'
    : status === 'black_win' ? '0-1'
    : status === 'draw' ? '1/2-1/2'
    : '*';
}

// Game → PGN 式文本
export function gameToPgn(game: Game, meta: GameMeta = {}): string {
  const start = game.startPosition;
  const moves = game.getMoves();
  const lines: string[] = [];
  lines.push(`[Event "${meta.event ?? '中国象棋对局'}"]`);
  if (meta.date) lines.push(`[Date "${meta.date}"]`);
  lines.push(`[Red "${meta.red ?? '红方'}"]`);
  lines.push(`[Black "${meta.black ?? '黑方'}"]`);
  lines.push(`[Result "${resultTag(game.status)}"]`);

  const startFen = toFen(start.board, start.turn);
  if (startFen !== toFen(initialBoard(), 'red')) lines.push(`[FEN "${startFen}"]`);
  lines.push('');

  let board = cloneBoard(start.board);
  const tokens: string[] = [];
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) tokens.push(`${i / 2 + 1}.`);
    tokens.push(`${moveToIccs(moves[i])} {${moveToChinese(board, moves[i])}}`);
    board = applyMove(board, moves[i]);
  }
  tokens.push(resultTag(game.status));
  lines.push(tokens.join(' '));
  return lines.join('\n');
}

// PGN 式文本 → Game（读 FEN + ICCS 逐手重放）
export function pgnToGame(text: string): Game {
  const fenMatch = /\[FEN\s+"([^"]+)"\]/.exec(text);
  let game: Game;
  if (fenMatch) {
    const { board, turn } = fromFen(fenMatch[1]);
    game = Game.fromPosition(board, turn);
  } else {
    game = new Game();
  }
  const cleaned = text
    .replace(/\[[^\]]*\]/g, ' ') // 去 tag
    .replace(/\{[^}]*\}/g, ' ')  // 去中文注释
    .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, ' ') // 去结果
    .replace(/\d+\./g, ' ');     // 去回合号
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  for (const tk of tokens) {
    if (!/^[a-i]\d-[a-i]\d$/.test(tk)) continue;
    if (!game.move(iccsToMove(tk))) throw new Error('PGN 重放遇非法着法: ' + tk);
  }
  return game;
}
```

（注：`applyMove` 与 `Game` 同在 `game.ts` 导出；`cloneBoard`/`initialBoard` 在 `board.ts` 导出，均已存在。）

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/pgn.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: 回归 + 提交**

Run: `npm test && npm run typecheck`
Expected: 全绿

```bash
git add src/engine/pgn.ts tests/pgn.test.ts
git commit -m "feat(engine): PGN 式整盘容器（ICCS+中文双轨，导出→导入往返一致）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7：存档读档接线（localStorage 续局 + `.pgn` 文件导入导出）

UI 薄接线：以 PGN 文本为唯一存档载体；localStorage 自动续局，文件按钮导入导出。localStorage / 文件 IO 由浏览器真机验收（PGN 往返已在 Task 6 单测覆盖）。

**Files:**
- Create: `src/ui/persist.ts`
- Modify: `src/ui/controller.ts`、`src/ui/main.ts`、`index.html`

- [ ] **Step 1: 写 persist.ts**

新建 `src/ui/persist.ts`：

```ts
import { Game } from '../engine/game';
import { gameToPgn, pgnToGame } from '../engine/pgn';

const KEY = 'xiangqi:lastgame';

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

// 自动续局：把当前对局写入 localStorage（失败静默，如隐私模式）
export function saveGame(game: Game): void {
  try {
    localStorage.setItem(KEY, gameToPgn(game, { date: today() }));
  } catch { /* 忽略：localStorage 不可用 */ }
}

// 读取上次对局；无存档或损坏返回 null
export function loadGame(): Game | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    return pgnToGame(text);
  } catch {
    return null;
  }
}

export function clearSaved(): void {
  try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
}
```

- [ ] **Step 2: 给 controller.ts 加载入/取出 Game 的能力**

在 `GameController` 类内（`reset()` 之后）追加两个方法：

```ts
  // 供存档：取当前 Game
  getGame(): Game {
    return this.game;
  }

  // 供读档：换上一个 Game（来自 PGN 重放）
  loadGame(game: Game): void {
    this.game = game;
    this.lastMove = null;
    this.clearSelection();
  }
```

（`Game` 已在 controller.ts 顶部 import。）

- [ ] **Step 3: index.html 加导出/导入控件**

把 `index.html` 里 `restart` 按钮那一行之后（`</div>` 收 `.controls` 之前）改为：

```html
        <button id="undo" class="btn">悔棋</button>
        <button id="restart" class="btn">重新开局</button>
        <button id="export-pgn" class="btn">导出棋谱</button>
        <button id="import-pgn" class="btn">导入棋谱</button>
        <input id="import-file" type="file" accept=".pgn,text/plain" hidden />
```

- [ ] **Step 4: main.ts 接线（续局 + 导出 + 导入）**

在 `main.ts` 顶部 import 区追加：

```ts
import { saveGame, loadGame, clearSaved } from './persist';
import { gameToPgn, pgnToGame } from '../engine/pgn';
```

在 `const controller = new GameController();` 之后追加控件引用：

```ts
const exportBtn = document.getElementById('export-pgn') as HTMLButtonElement;
const importBtn = document.getElementById('import-pgn') as HTMLButtonElement;
const importFile = document.getElementById('import-file') as HTMLInputElement;
```

在 canvas 的 click 处理里，把走子成功分支改为走子后自动存档——将：

```ts
  if (moved) {
    playMoveAnimation(controller.lastMove!, () => {
      refresh();
      maybeRunAi();
    });
  } else {
```

改为：

```ts
  if (moved) {
    saveGame(controller.getGame());
    playMoveAnimation(controller.lastMove!, () => {
      refresh();
      maybeRunAi();
      saveGame(controller.getGame()); // 含电脑应着后再存
    });
  } else {
```

在 `undoBtn` 与 `restartBtn` 处理里补存档：`undo` 分支末尾（`refresh();` 前）加 `saveGame(controller.getGame());`；`restart` 分支开头加 `clearSaved();`。

文件末尾 `setupCanvas();` 之前，追加导出/导入/续局接线：

```ts
// 导出棋谱：下载 .pgn 文件
exportBtn.addEventListener('click', () => {
  const text = gameToPgn(controller.getGame(), { date: new Date().toISOString().slice(0, 10).replace(/-/g, '.') });
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `xiangqi-${Date.now()}.pgn`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// 导入棋谱：选文件 → 重放
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const f = importFile.files?.[0];
  if (!f) return;
  try {
    const g = pgnToGame(await f.text());
    controller.setAi(null); // 导入的谱按双人复盘
    controller.loadGame(g);
    saveGame(controller.getGame());
    refresh();
  } catch (e) {
    alert('棋谱解析失败：' + (e as Error).message);
  } finally {
    importFile.value = ''; // 允许重复导入同一文件
  }
});

// 启动时若有上次对局，自动续局
const restored = loadGame();
if (restored) controller.loadGame(restored);
```

- [ ] **Step 5: 类型检查 + 构建**

Run: `npm run typecheck && npm run build`
Expected: 无类型错误；`dist/index.html` 生成成功

- [ ] **Step 6: 浏览器真机验收（必须真路径跑一次）**

Run: `npm run dev`，浏览器打开提示的地址，逐项确认：
- [ ] 走几步 → 刷新页面 → 局面与轮走方原样恢复（续局生效）
- [ ] 点「导出棋谱」→ 下载 `.pgn`，文本含 tags、`h7-e7` 与 `{炮二平五}` 双轨
- [ ] 点「导入棋谱」选刚导出的文件 → 局面正确重放
- [ ] 点「重新开局」→ 刷新页面不再续上旧局（存档已清）
- [ ] 直接双击 `dist/index.html`（`file://`）重复上述：续局、导出、导入均正常

- [ ] **Step 7: 提交**

```bash
git add src/ui/persist.ts src/ui/controller.ts src/ui/main.ts index.html
git commit -m "feat(ui): 存档读档接线（localStorage 续局 + .pgn 导入导出）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完成判据（A1）

- `npm test` 全绿，新增 `fen` / `notation` / `pgn` / `game-history` 四组单测覆盖：FEN 往返+非法拒绝、中文与 ICCS 双向往返、同线前/后与一二三消歧、PGN 整盘导出→导入逐手一致。
- `npm run typecheck` 无错；`npm run build` 出单文件。
- 浏览器真机：续局、`.pgn` 导出/导入在 `dev` 与 `file://` 双环境均通过。
- A1 完成后，A4 主题、A2 棋钟、A3 音效各自再写独立计划。

## 已知限制（写入代码注释，不假装完整）

- ICCS 为项目内部一致约定（纵线 a–i、横线 = row），保证往返与 B/C 复用；未对齐某具体棋server的横线朝向。
- 中文记谱位置式（前/后/序数）解析假定同类多子仅占一条纵线——真实对局几乎必然成立，多于一条时抛错，留待需要时再扩展跨纵线兵卒消歧。
