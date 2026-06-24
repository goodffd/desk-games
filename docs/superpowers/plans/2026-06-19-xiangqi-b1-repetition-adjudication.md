> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 子项目 B1：循环裁决原则化核心 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`)。

**Goal:** 把循环重复裁决从「长将/粗略长捉」升级为原则化核心：将/捉/闲三分类 + 攻击等级层次（长将2>长打1>闲0，高等级方必变判负、同级和），覆盖一将一捉/一将一闲/长将vs长捉等组合。

**Architecture:** 纯 engine。重写 `repetition.ts` 的 `adjudicateRepetition`（按每方"攻击等级"裁决；`PlyInfo` 结构不变，kind 在裁决里由 gaveCheck/chaseThreat 派生）。`game.ts` 精炼"捉"判定（排除"举棋者自身挂着"的献/兑）。结果喂 `Game.status`，无新 UI。

**Tech Stack:** TS + vitest。无新增依赖。**分支：** `v3-b1-rules`。

**复用**：`PlyInfo{mover,gaveCheck,chaseThreat}`、`adjudicateRepetition(cycle)`（game.ts 三次重复触发后调用）、`isDefended`/`isSquareAttacked`/`hasUndefendedCaptureThreat`（game.ts）。

---

## Task 1：重写裁决——攻击等级层次（repetition.ts）

**Files:** Modify `src/engine/repetition.ts`; Modify `tests/repetition.test.ts`

- [ ] **Step 1: 写/补失败测试** — 在 `tests/repetition.test.ts` 追加（构造 PlyInfo 序列直测裁决，覆盖全表）:
```ts
import { describe, it, expect } from 'vitest';
import { adjudicateRepetition } from '../src/engine/repetition';
import type { PlyInfo } from '../src/engine/repetition';
import type { Color } from '../src/engine/types';

const chk = (m: Color): PlyInfo => ({ mover: m, gaveCheck: true, chaseThreat: false });
const cha = (m: Color): PlyInfo => ({ mover: m, gaveCheck: false, chaseThreat: true });
const idl = (m: Color): PlyInfo => ({ mover: m, gaveCheck: false, chaseThreat: false });

describe('裁决·攻击等级层次', () => {
  it('单方长将 vs 闲 → 长将方负', () => {
    expect(adjudicateRepetition([chk('red'), idl('black'), chk('red'), idl('black')])).toBe('black_win');
    expect(adjudicateRepetition([chk('black'), idl('red'), chk('black'), idl('red')])).toBe('red_win');
  });
  it('双方长将 → 和', () => {
    expect(adjudicateRepetition([chk('red'), chk('black'), chk('red'), chk('black')])).toBe('draw');
  });
  it('单方长捉 vs 闲 → 长捉方负', () => {
    expect(adjudicateRepetition([cha('red'), idl('black'), cha('red'), idl('black')])).toBe('black_win');
  });
  it('一将一捉(全打) vs 闲 → 该方负', () => {
    expect(adjudicateRepetition([chk('red'), idl('black'), cha('red'), idl('black')])).toBe('black_win');
  });
  it('一将一闲(含闲) → 和', () => {
    expect(adjudicateRepetition([chk('red'), idl('black'), idl('red'), idl('black')])).toBe('draw');
  });
  it('长将 vs 长捉 → 长将方负（将更严重）', () => {
    expect(adjudicateRepetition([chk('red'), cha('black'), chk('red'), cha('black')])).toBe('black_win');
    expect(adjudicateRepetition([cha('red'), chk('black'), cha('red'), chk('black')])).toBe('red_win');
  });
  it('双方长捉 → 和', () => {
    expect(adjudicateRepetition([cha('red'), cha('black'), cha('red'), cha('black')])).toBe('draw');
  });
  it('消极循环 → 和', () => {
    expect(adjudicateRepetition([idl('red'), idl('black'), idl('red'), idl('black')])).toBe('draw');
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/repetition.test.ts` → 新用例中「一将一捉」「长将vs长捉」会 FAIL（旧逻辑不分层）。

- [ ] **Step 3: 重写 repetition.ts**（整文件替换为）:
```ts
import type { Color, GameStatus } from './types';

// 一步着法在循环裁决中关心的属性
export interface PlyInfo {
  mover: Color;
  gaveCheck: boolean; // 走后是否将对方军（将）
  chaseThreat: boolean; // 走后是否（非将地）威胁吃一枚无根非将敌子且非献/兑（捉）
}

type Level = 0 | 1 | 2; // 0 闲 / 1 长打 / 2 长将

// 某方在一个循环里的攻击等级：全将=2；全打(将|捉)非全将=1；含任一闲步=0
function offenseLevel(plies: PlyInfo[]): Level {
  if (plies.length === 0) return 0;
  const kinds = plies.map((p) => (p.gaveCheck ? 'check' : p.chaseThreat ? 'chase' : 'idle'));
  if (kinds.some((k) => k === 'idle')) return 0;
  return kinds.every((k) => k === 'check') ? 2 : 1;
}

/**
 * 对一个已确认的重复循环（红黑交替若干步）裁决。
 * 攻击等级：长将2 > 长打1 > 闲0。等级相同→和；不同→高等级方必变、判负。
 * 覆盖长将/长捉/一将一捉/一将一闲/长将vs长捉/双方长打/消极循环。
 * 诚实边界：原则化核心，不等于官方整本「棋例」。
 */
export function adjudicateRepetition(cycle: PlyInfo[]): GameStatus {
  const rl = offenseLevel(cycle.filter((p) => p.mover === 'red'));
  const bl = offenseLevel(cycle.filter((p) => p.mover === 'black'));
  if (rl === bl) return 'draw';
  return rl > bl ? 'black_win' : 'red_win'; // 高等级方判负
}
```

- [ ] **Step 4:** `npx vitest run tests/repetition.test.ts` → PASS（全表）。`npm test` → 既有 repetition/game-repetition 用例不回归（长将判负/双方长将和/长捉判负/消极和 在新逻辑下结果一致）。

- [ ] **Step 5: 提交**
```bash
git add src/engine/repetition.ts tests/repetition.test.ts
git commit -m "feat(engine): 循环裁决重写为攻击等级层次（将/捉/闲 + 组合裁决）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：精炼"捉"——排除献/兑（game.ts）

把"捉"从「威胁吃无根非将敌子」精炼为「威胁吃无根非将敌子，且举棋的捉子本身不挂着」（捉子若被攻击且无根=自身挂着→实为献/兑，非捉）。拦/跟本不构成吃子威胁，已自然归"闲"。

**Files:** Modify `src/engine/game.ts`; Modify `tests/game-repetition.test.ts`（或新增 `tests/chase.test.ts`）

- [ ] **Step 1: 写失败测试** — 新增 `tests/chase.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { emptyBoard } from '../src/engine/board';
import { hasUndefendedCaptureThreat } from '../src/engine/game';
import type { Board, Color, PieceType } from '../src/engine/types';

function place(b: Board, r: number, c: number, t: PieceType, color: Color) { b[r][c] = { type: t, color }; }

describe('捉判定·排除献/兑（捉子自身挂着不算捉）', () => {
  it('安全的车捉无根马 → 算捉', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red'); // 红将放 col3，避开照面，使吃子着法合法不暴露己方将
    place(b, 0, 4, 'general', 'black');
    place(b, 5, 0, 'chariot', 'red'); // 红车安全（无黑子攻击）
    place(b, 5, 4, 'horse', 'black'); // 黑马无根，红车同横线威胁吃（车五... 实际车走到马处）
    expect(hasUndefendedCaptureThreat(b, 'red')).toBe(true);
  });

  it('挂着的捉子（车捉马但车自身被无根攻击）→ 不算捉（献/兑）', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red'); // 红将放 col3，避开照面，使吃子着法合法不暴露己方将
    place(b, 0, 4, 'general', 'black');
    place(b, 5, 4, 'chariot', 'red'); // 红车
    place(b, 5, 6, 'horse', 'black'); // 黑马无根，红车横线可吃
    place(b, 3, 4, 'chariot', 'black'); // 黑车攻击红车(5,4) 且红车无根 → 红车挂着
    expect(hasUndefendedCaptureThreat(b, 'red')).toBe(false); // 红车挂着，捉马实为送/兑，不算捉
  });
});
```
（注：具体坐标在实现时按引擎实际着法核验；目标是"安全捉子=捉、挂着捉子=非捉"两条性质。）

- [ ] **Step 2:** `npx vitest run tests/chase.test.ts` → 第二条 FAIL（当前不排除挂着捉子）。

- [ ] **Step 3: 改 game.ts**——在 `hasUndefendedCaptureThreat` 里，找到「P 威胁吃无根非将敌子 T」后，追加"捉子 P 自身不挂着"的条件：P 当前所在格若被敌方攻击且 P 无根（自身挂着）→ 跳过（献/兑），不计为捉。即把现有：
```ts
        if (target && target.color === enemy && target.type !== 'general' && !isDefended(board, to)) {
          return true;
        }
```
改为：
```ts
        if (target && target.color === enemy && target.type !== 'general' && !isDefended(board, to)) {
          // 排除献/兑：举棋的捉子 (row,col) 自身挂着（被敌攻击且无根）则非真捉
          const attacker = { row, col };
          const hanging = isSquareAttacked(board, attacker, enemy) && !isDefended(board, attacker);
          if (!hanging) return true;
        }
```
（`isSquareAttacked`、`isDefended` 已在 game.ts；`isDefended` 现为模块私有函数——确认其在文件内可见即可，无需导出。）

- [ ] **Step 4:** `npx vitest run tests/chase.test.ts` → PASS。`npm test` → 全绿（既有 game-repetition 长将/长捉集成测试不回归）。`npm run typecheck`。

- [ ] **Step 5: 提交**
```bash
git add src/engine/game.ts tests/chase.test.ts
git commit -m "feat(engine): 精炼捉判定——排除自身挂着的捉子（献/兑不算捉）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 完成判据（B1）
- `npm test` 全绿：repetition 攻击等级层次全表 + 捉精炼两性质 + 既有 game-repetition 集成不回归。
- `npm run typecheck` 无错。
- 覆盖：长将判负 / 双方长将和 / 长捉判负 / 一将一捉判负 / 一将一闲和 / 长将vs长捉(长将负) / 双方长捉和 / 消极和 / 兑献不误判为捉。

## 已知限制（已在 repetition.ts 注释 + SPEC）
- 原则化核心：将/捉/闲三类 + 攻击等级层次；不覆盖官方整本「棋例」全部例位。
- "捉"用「无根目标 + 捉子不挂着」近似，复杂得子/兑献场景可能与官方裁决有出入。
