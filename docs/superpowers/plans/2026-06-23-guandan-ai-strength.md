# 掼蛋强 AI（拆牌规划诚实打法）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把掼蛋 AI（`choosePlay` + 还贡 `chooseReturn`）从"每次出最小一手"升级为拆牌规划战术版，新 AI 对老 AI 对打胜率 ≥ 60%，代打看着像会打的人。

**Architecture:** 新增纯函数 `ai/decompose.ts` 把手牌拆成近似最少手数的牌型组合（拿引擎 `enumerateLeads` 当积木，"cover 最低牌 + 记忆化"求解）；重写 `ai/ai.ts` 的 `choosePlay` 用拆解驱动领牌/跟牌/炸弹/红心2/配合，并加 `chooseReturn` 智能还贡。引擎规则不碰、`choosePlay` 签名不变、driver/server 仅把 AI 还贡从 `autoReturn` 改调 `chooseReturn`。

**Tech Stack:** TypeScript（纯函数引擎 + AI），vitest（穷举/行为/对打单测 + fuzz），esbuild（`build:server` 把 AI 打进服务端 bundle）。

## Global Constraints

- **诚实边界**：AI 只读自己那家**手牌内容**（`s.hands[seat]`）；可用各家**手牌张数**（`s.hands[i].length`，公开信息）。绝不读他家手牌内容、不记牌、不接出牌历史。
- **引擎是规则唯一真相**：AI/拆解**不复制**任何牌型判定，一律走 `enumerateLeads`/`enumerateFollows`/`isLegalPlay`/`identifyWithWild`。需要 `isWild` 就从 `engine/legal.ts` 导出，不在 AI 层重写。
- **`choosePlay` 合约不变**：`choosePlay(s: DealState, seat: Seat): Card[] | null`，返回**永远合法**的出牌，或 `null`（仅 `s.current !== null` 跟牌时可 `null`=不要）；空手返回 `null`。driver/server/UI 调用点零改动。
- **纯函数、确定性、无 DOM、无随机**（不用 `Math.random`）。
- **性能**：拆解有界（visited 上限 + 贪心兜底）+ 模块级有界记忆缓存；`tests/fuzz.test.ts` 不改且须仍全绿（合法 + 108 守恒），整套 `npm test` 墙钟目标 < 3 分钟。
- **验证命令**：`npm test`（vitest 全绿，含 fuzz + 新对打测试）+ `npm run typecheck`（`tsc --noEmit && tsc --noEmit -p tsconfig.xiangqi.json`）。改 AI 后须 `npm run build:server` 重打 `server/guandan-match-driver.bundle.mjs`，否则线上代打仍是老 AI。

---

### Task 1: 快照老 AI 作对打基线 + 导出 isWild

把当前 `choosePlay` 逻辑原样冻结成 `legacyChoosePlay`（重写 `ai.ts` 后用于对打测试的对照基线），并把 `isWild` 从引擎导出供拆解用。**纯搬运 + 导出，无行为变化。**

**Files:**
- Create: `tests/helpers/legacy-ai.ts`
- Modify: `src/games/guandan/engine/legal.ts:30`（`function isWild` → `export function isWild`）
- Test: `tests/helpers/legacy-ai.test.ts`

**Interfaces:**
- Produces: `legacyChoosePlay(s: DealState, seat: Seat): Card[] | null`（老逻辑快照，签名同 `choosePlay`）
- Produces: `export function isWild(c: Card, level: Rank): boolean`（engine/legal.ts）

- [ ] **Step 1: 导出 isWild**

`src/games/guandan/engine/legal.ts` 第 30 行：

```ts
/** Is `c` a 逢人配 wildcard (red-heart card of the current level rank)? */
export function isWild(c: Card, level: Rank): boolean {
```

（只在 `function` 前加 `export`，函数体不动。）

- [ ] **Step 2: 写老 AI 快照**

把当前 `src/games/guandan/ai/ai.ts` 的**全部内容**逐字拷到 `tests/helpers/legacy-ai.ts`，仅把导出函数名 `choosePlay` 改为 `legacyChoosePlay`（其余 `leadCost`/`pickCheapestFollow` 等内部 helper 原样保留）。文件顶部加注释：

```ts
/**
 * 老 AI 逻辑快照（迁移前的"每次出最小一手"基础版），仅供 tests/ai-headtohead 对打基线。
 * 不要在产品代码里引用。源 = ai/ai.ts @ 本任务前的版本。
 */
```

- [ ] **Step 3: 写快照自测**

`tests/helpers/legacy-ai.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { makeDeck, deal } from '../../src/games/guandan/engine/cards';
import { createDeal } from '../../src/games/guandan/engine/game';
import { isLegalPlay } from '../../src/games/guandan/engine/legal';
import { legacyChoosePlay } from './legacy-ai';
import type { Seat } from '../../src/games/guandan/engine/types';

describe('legacyChoosePlay 快照', () => {
  it('开局自由领牌返回合法非空出牌', () => {
    const deck = makeDeck();
    const hands = deal(deck, (n) => Array.from({ length: n }, (_, i) => i));
    const s = createDeal(hands, 0 as Seat, 2);
    const play = legacyChoosePlay(s, s.turn);
    expect(play).not.toBeNull();
    expect(isLegalPlay(play!, null, s.hands[s.turn]!, 2)).toBe(true);
  });
});
```

- [ ] **Step 4: 跑测试 + typecheck**

Run: `npm run typecheck && npx vitest run tests/helpers/legacy-ai.test.ts`
Expected: PASS（1 passed）

- [ ] **Step 5: Commit**

```bash
git add src/games/guandan/engine/legal.ts tests/helpers/legacy-ai.ts tests/helpers/legacy-ai.test.ts
git commit -m "test(guandan): 冻结老 AI 快照作对打基线 + 导出 isWild"
```

---

### Task 2: 拆牌模块 decompose.ts

把手牌拆成近似最少手数的牌型组合。算法：递归 cover **最低牌**（用包含它的合法牌型），最小化组合数，记忆化 + visited 上限 + 贪心兜底；模块级有界缓存（纯函数可缓存）。

**Files:**
- Create: `src/games/guandan/ai/decompose.ts`
- Test: `tests/ai-decompose.test.ts`

**Interfaces:**
- Consumes: `enumerateLeads(hand, level)`、`isWild(c, level)`（engine）、`rankValue(c, level)`（engine/cards）
- Produces:
  - `interface Decomposition { combos: Combo[]; handCount: number }`
  - `function decompose(hand: Card[], level: Rank): Decomposition`（combos 恰好覆盖 hand 各一次；handCount=combos.length）

- [ ] **Step 1: 写失败测试**

`tests/ai-decompose.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { decompose } from '../src/games/guandan/ai/decompose';
import type { Card, Rank, Suit } from '../src/games/guandan/engine/types';

let nextId = 1;
function card(rank: number, suit: Suit): Card {
  return { id: nextId++, rank: rank as Card['rank'], suit };
}
const L: Rank = 2;

/** 断言拆解恰好覆盖手牌（id 集合相等、无增无减无重复）。 */
function assertCovers(hand: Card[], combos: { cards: Card[] }[]): void {
  const handIds = [...hand.map(c => c.id)].sort((a, b) => a - b);
  const comboIds = combos.flatMap(c => c.cards.map(x => x.id)).sort((a, b) => a - b);
  expect(comboIds).toEqual(handIds);
}

describe('decompose 拆牌', () => {
  it('空手 → 0 手', () => {
    expect(decompose([], L)).toEqual({ combos: [], handCount: 0 });
  });

  it('恰好覆盖手牌（不增不减不重复）', () => {
    const hand = [card(3,'S'), card(3,'H'), card(5,'C'), card(7,'D'), card(7,'S')];
    const d = decompose(hand, L);
    assertCovers(hand, d.combos);
  });

  it('一对 + 一对 + 一单 → 3 手（对子不拆成单张）', () => {
    const hand = [card(3,'S'), card(3,'H'), card(7,'C'), card(7,'D'), card(9,'S')];
    const d = decompose(hand, L);
    expect(d.handCount).toBe(3);
    // 两个 pair 都应作为整体出现
    const pairs = d.combos.filter(c => c.cards.length === 2);
    expect(pairs.length).toBe(2);
  });

  it('五张顺子 → 1 手（不拆成 5 个单张）', () => {
    const hand = [card(3,'S'), card(4,'H'), card(5,'C'), card(6,'D'), card(7,'S')];
    const d = decompose(hand, L);
    expect(d.handCount).toBe(1);
  });

  it('炸弹保持完整、不被拆开（4 个同点 → 1 手）', () => {
    const hand = [card(8,'S'), card(8,'H'), card(8,'C'), card(8,'D')];
    const d = decompose(hand, L);
    expect(d.handCount).toBe(1);
    expect(d.combos[0]!.cards.length).toBe(4);
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `npx vitest run tests/ai-decompose.test.ts`
Expected: FAIL（`decompose` is not a function / 模块不存在）

- [ ] **Step 3: 实现 decompose.ts**

`src/games/guandan/ai/decompose.ts`：

```ts
/**
 * Guandan 拆牌（hand decomposition）— 纯函数，NEVER imports DOM。
 *
 * 把手牌拆成近似最少手数的合法牌型组合，作为 AI "还剩几手能走完"的骨架。
 * 牌型积木全部取自引擎 enumerateLeads（不在此重写任何规则）。
 *
 * 求解：递归 cover 当前**最低牌**（用包含它且 ⊆ 剩余手牌的合法牌型），
 * 最小化组合数；记忆化（剩余 id 签名）+ visited 上限；超限退化为贪心，保证快且确定。
 */
import type { Card, Combo, Rank } from '../engine/types';
import { enumerateLeads, isWild } from '../engine/legal';
import { rankValue } from '../engine/cards';

export interface Decomposition {
  combos: Combo[];
  handCount: number;
}

const VISIT_CAP = 60_000;          // 单次求解 visited 上限，超则贪心兜底
const CACHE_CAP = 4_000;           // 模块级结果缓存条数上限（纯函数，安全）
const cache = new Map<string, Decomposition>();

function handKey(hand: Card[], level: Rank): string {
  return level + '|' + hand.map(c => c.id).sort((a, b) => a - b).join(',');
}
function wildCount(combo: Combo, level: Rank): number {
  return combo.cards.reduce((n, c) => n + (isWild(c, level) ? 1 : 0), 0);
}
function comboWithin(combo: Combo, remaining: Set<number>): boolean {
  return combo.cards.every(c => remaining.has(c.id));
}
/** tie-break：同手数时更优的拆法（少用红心2 → 更优）。 */
function totalWild(combos: Combo[], level: Rank): number {
  return combos.reduce((n, c) => n + wildCount(c, level), 0);
}

export function decompose(hand: Card[], level: Rank): Decomposition {
  if (hand.length === 0) return { combos: [], handCount: 0 };

  const ck = handKey(hand, level);
  const hit = cache.get(ck);
  if (hit) return hit;

  const byId = new Map<number, Card>();
  for (const c of hand) byId.set(c.id, c);

  // 全部候选牌型；按"包含某 id"建索引（cover 最低牌时只看含该牌的牌型，限制分支）
  const allCombos = enumerateLeads(hand, level);
  const combosByCard = new Map<number, Combo[]>();
  for (const combo of allCombos) {
    for (const c of combo.cards) {
      const list = combosByCard.get(c.id);
      if (list) list.push(combo); else combosByCard.set(c.id, [combo]);
    }
  }

  const memo = new Map<string, Combo[]>();
  let visited = 0;
  let bailed = false;

  function lowestId(remaining: Set<number>): number {
    let anchor = -1, lo = Infinity;
    for (const id of remaining) {
      const rv = rankValue(byId.get(id)!, level);
      if (rv < lo || (rv === lo && id < anchor)) { lo = rv; anchor = id; }
    }
    return anchor;
  }

  function solve(remaining: Set<number>): Combo[] | null {
    if (remaining.size === 0) return [];
    if (++visited > VISIT_CAP) { bailed = true; return null; }
    const k = [...remaining].sort((a, b) => a - b).join(',');
    const cached = memo.get(k);
    if (cached) return cached;

    const anchor = lowestId(remaining);
    let best: Combo[] | null = null;

    for (const combo of combosByCard.get(anchor) ?? []) {
      if (!comboWithin(combo, remaining)) continue;
      const next = new Set(remaining);
      for (const c of combo.cards) next.delete(c.id);
      const sub = solve(next);
      if (sub === null) { if (bailed) return null; else continue; }
      const cand = [combo, ...sub];
      if (
        best === null ||
        cand.length < best.length ||
        (cand.length === best.length && totalWild(cand, level) < totalWild(best, level))
      ) best = cand;
    }

    if (best !== null) memo.set(k, best);
    return best;
  }

  const ids = new Set(hand.map(c => c.id));
  let combos = solve(ids);
  if (combos === null) combos = greedy(ids, combosByCard, byId, level);

  const result: Decomposition = { combos, handCount: combos.length };
  if (cache.size >= CACHE_CAP) cache.clear();   // 简单有界：满了清空
  cache.set(ck, result);
  return result;

  // 贪心兜底：每轮 cover 最低牌，取含它且 ⊆ 剩余的最大长度牌型（tie：少红心2）。
  function greedy(
    remaining: Set<number>,
    idx: Map<number, Combo[]>,
    cardOf: Map<number, Card>,
    lvl: Rank,
  ): Combo[] {
    const out: Combo[] = [];
    const rem = new Set(remaining);
    while (rem.size > 0) {
      let anchor = -1, lo = Infinity;
      for (const id of rem) {
        const rv = rankValue(cardOf.get(id)!, lvl);
        if (rv < lo || (rv === lo && id < anchor)) { lo = rv; anchor = id; }
      }
      let pick: Combo | null = null;
      for (const combo of idx.get(anchor) ?? []) {
        if (!comboWithin(combo, rem)) continue;
        if (
          pick === null ||
          combo.cards.length > pick.cards.length ||
          (combo.cards.length === pick.cards.length && wildCount(combo, lvl) < wildCount(pick, lvl))
        ) pick = combo;
      }
      if (pick === null) break; // 理论不会：单张总是合法牌型
      out.push(pick);
      for (const c of pick.cards) rem.delete(c.id);
    }
    return out;
  }
}
```

- [ ] **Step 4: 跑测试看通过**

Run: `npx vitest run tests/ai-decompose.test.ts`
Expected: PASS（5 passed）

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck`
Expected: 无错误

```bash
git add src/games/guandan/ai/decompose.ts tests/ai-decompose.test.ts
git commit -m "feat(guandan): 拆牌模块 decompose（最少手数 + 贪心兜底 + 有界缓存）"
```

---

### Task 3: choosePlay 领牌策略（拆解驱动）

重写 `ai.ts`：领牌时按拆解决策——能走完就走完，否则甩最低非控制牌、留控制牌、不拆结构、省红心2。跟牌暂保留老逻辑（下一任务替换），保证本任务可独立跑通。

**Files:**
- Modify: `src/games/guandan/ai/ai.ts`（整体重写，导出 `choosePlay` 不变）
- Test: `tests/ai.test.ts`（新增领牌行为断言；保留原有断言）

**Interfaces:**
- Consumes: `decompose(hand, level)`（Task 2）、`enumerateLeads`/`enumerateFollows`、`isWild`、`rankValue`
- Produces: `choosePlay(s, seat): Card[] | null`（签名不变）；内部 `chooseLead(s, seat): Card[]`

- [ ] **Step 1: 写失败测试**

`tests/ai.test.ts` 追加：

```ts
import { describe, it, expect } from 'vitest';
import { choosePlay } from '../src/games/guandan/ai/ai';
import { createDeal, play, type DealState } from '../src/games/guandan/engine/game';
import { isLegalPlay } from '../src/games/guandan/engine/legal';
import type { Card, Rank, Seat, Suit } from '../src/games/guandan/engine/types';

let nid = 1;
function c(rank: number, suit: Suit): Card { return { id: nid++, rank: rank as Card['rank'], suit }; }
const L: Rank = 2;

/** 构造一个"自由领牌"DealState：把 seat0 的手牌设为 hand，其余随便填，current=null,turn=0。 */
function leadState(hand: Card[]): DealState {
  return {
    hands: [hand, [c(14,'S')], [c(14,'H')], [c(14,'C')]],
    current: null, turn: 0 as Seat, passesInRow: 0, finished: [], level: L,
  };
}

describe('choosePlay 领牌', () => {
  it('手里是一条顺子 → 一手领完（不拆单张）', () => {
    const hand = [c(3,'S'), c(4,'H'), c(5,'C'), c(6,'D'), c(7,'S')];
    const out = choosePlay(leadState(hand), 0 as Seat);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(5);
    expect(isLegalPlay(out!, null, hand, L)).toBe(true);
  });

  it('有小对子和大单张 → 先甩小牌，不先扔大王/2', () => {
    const hand = [c(3,'S'), c(3,'H'), c(15,'J'), c(2,'S')]; // 3对 + 大王 + 一张2(level)
    const out = choosePlay(leadState(hand), 0 as Seat);
    expect(out).not.toBeNull();
    // 领出的不应包含大王(15)
    expect(out!.some(x => x.rank === 15)).toBe(false);
  });

  it('能不动红心2(逢人配)就不动：有等效自然牌时不消耗万能牌', () => {
    // 一对自然3 + 红心2(万能) + 一张5；领牌应优先出自然对3，不用万能牌拼小对
    const hand = [c(3,'S'), c(3,'C'), c(2,'H'), c(5,'D')]; // 红心2 = 2 of Hearts = 逢人配
    const out = choosePlay(leadState(hand), 0 as Seat);
    expect(out).not.toBeNull();
    expect(out!.some(x => x.rank === 2 && x.suit === 'H')).toBe(false);
  });
});
```

> 注：测试用的 rank 编码（11=J,12=Q,13=K,14=A,15/16=小/大王，2=level）须与 `engine/types.ts` 的 `Card['rank']` 实际取值一致；实现者按引擎实际编码调整字面量，断言意图不变。

- [ ] **Step 2: 跑测试看失败**

Run: `npx vitest run tests/ai.test.ts`
Expected: FAIL（领牌新断言不满足——老逻辑会甩最小单张/可能动大牌）

- [ ] **Step 3: 重写 ai.ts（领牌部分）**

`src/games/guandan/ai/ai.ts`：

```ts
/**
 * Guandan AI — 拆牌规划诚实打法。
 * Pure function; NEVER imports DOM. 诚实：只读自己手牌内容 + 各家手牌张数(公开)。
 */
import type { Card, Combo, Seat, Rank } from '../engine/types';
import type { DealState } from '../engine/game';
import { enumerateLeads, enumerateFollows, isWild } from '../engine/legal';
import { rankValue } from '../engine/cards';
import { decompose } from './decompose';

const BOMB_TYPES = new Set(['bomb', 'straightFlush', 'kingBomb']);
function isBomb(c: Combo): boolean { return BOMB_TYPES.has(c.type); }
function wildCount(combo: Combo, level: Rank): number {
  return combo.cards.reduce((n, c) => n + (isWild(c, level) ? 1 : 0), 0);
}

/** 控制牌：炸弹类，或 key ≥ A 的高张牌型（A=14；大牌留着管节奏，不先甩）。 */
const CONTROL_KEY = 14; // A
function isControl(combo: Combo, _level: Rank): boolean {
  return isBomb(combo) || combo.key >= CONTROL_KEY;
}

/** 自由领牌：拆解驱动。 */
function chooseLead(hand: Card[], level: Rank): Card[] {
  const { combos } = decompose(hand, level);
  if (combos.length <= 1) return combos.length === 1 ? combos[0]!.cards : [hand[0]!];

  // 优先甩非控制牌型；都为控制牌则退而求其次全集
  const nonControl = combos.filter(c => !isControl(c, level));
  const pool = nonControl.length > 0 ? nonControl : combos;

  // 选最低 key；tie：长度更长（多甩牌）优先；再 tie：少用红心2
  const pick = pool.reduce((best, c) => {
    if (c.key !== best.key) return c.key < best.key ? c : best;
    if (c.cards.length !== best.cards.length) return c.cards.length > best.cards.length ? c : best;
    return wildCount(c, level) < wildCount(best, level) ? c : best;
  });
  return pick.cards;
}

export function choosePlay(s: DealState, seat: Seat): Card[] | null {
  const hand = s.hands[seat]!;
  const level = s.level;

  // ---- LEAD ----
  if (s.current === null) {
    if (hand.length === 0) return null;
    return chooseLead(hand, level);
  }

  // ---- FOLLOW（本任务暂用基础逻辑，Task 4 替换）----
  const partner = ((seat + 2) % 4) as Seat;
  if (s.current.by === partner) return null;
  const follows = enumerateFollows(hand, s.current.combo, level);
  if (follows.length === 0) return null;
  const nonBombs = follows.filter(c => !isBomb(c));
  if (nonBombs.length > 0) {
    return nonBombs.reduce((b, c) =>
      c.key < b.key || (c.key === b.key && c.cards.length < b.cards.length) ? c : b).cards;
  }
  return follows.reduce((b, c) => (c.power < b.power ? c : b)).cards;
}
```

- [ ] **Step 4: 跑测试看通过 + fuzz 不回归**

Run: `npx vitest run tests/ai.test.ts tests/ai-decompose.test.ts && npx vitest run tests/fuzz.test.ts`
Expected: 全 PASS（领牌新断言满足；fuzz 合法+守恒仍过）

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck`

```bash
git add src/games/guandan/ai/ai.ts tests/ai.test.ts
git commit -m "feat(guandan): 领牌策略改拆解驱动（走完优先/甩废牌/留控制牌/省红心2）"
```

---

### Task 4: choosePlay 跟牌策略（保结构 + 战略不要 + 炸弹时机 + 配合）

跟牌用 delta 度量"结构损伤"：`delta = (1 + decompose(hand−cards).handCount) − decompose(hand).handCount`，0=本就是计划内的一手、>0=拆坏了结构。优先最小 delta 的最小够用牌；全是损伤牌且非残局/非危急 → 战略不要；炸弹按时机。

**Files:**
- Modify: `src/games/guandan/ai/ai.ts`（替换 FOLLOW 段 + 新增 helper）
- Test: `tests/ai.test.ts`（新增跟牌断言）

**Interfaces:**
- Consumes: `decompose`、`enumerateFollows`、各家 `s.hands[i].length`（公开张数）
- Produces: 内部 `chooseFollow(s, seat): Card[] | null`

- [ ] **Step 1: 写失败测试**

`tests/ai.test.ts` 追加（沿用上面的 `c`/`L` 工具）：

```ts
import { identify } from '../src/games/guandan/engine/combos'; // 用于构造 current.combo

/** 构造跟牌局面：seat0 手牌=hand，台面 current=由 byCards 读成的牌型、by=seat1（对手）。 */
function followState(hand: Card[], byCards: Card[]): DealState {
  const combo = identify(byCards, L)!;
  return {
    hands: [hand, [], [c(14,'D')], [c(14,'H')]],
    current: { combo, by: 1 as Seat }, turn: 0 as Seat, passesInRow: 0, finished: [], level: L,
  };
}

describe('choosePlay 跟牌', () => {
  it('对手出小单张：用零散单张压，不拆顺子', () => {
    // 手里一条顺子3-7 + 一张散K；对手出一张10 → 应用散K压，不拆顺子
    const hand = [c(3,'S'), c(4,'H'), c(5,'C'), c(6,'D'), c(7,'S'), c(13,'C')];
    const out = choosePlay(followState(hand, [c(10,'D')]), 0 as Seat);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    expect(out![0]!.rank).toBe(13); // 散K，不是顺子里的牌
  });

  it('唯一能压的牌会拆掉关键结构、且非残局 → 战略不要(pass)', () => {
    // 手里只有一对8(成对) + 一条顺子；对手出单张7，能压的最小是拆一张8，
    // 但拆8会破坏对子且非残局 → 期望 pass
    const hand = [c(8,'S'), c(8,'H'), c(9,'C'), c(10,'D'), c(11,'S'), c(12,'C'), c(13,'D')];
    const out = choosePlay(followState(hand, [c(7,'D')]), 0 as Seat);
    expect(out).toBeNull();
  });

  it('队友领先 → 默认不要', () => {
    const hand = [c(5,'S'), c(6,'H')];
    const st = followState(hand, [c(4,'D')]);
    st.current!.by = 2 as Seat; // 队友
    expect(choosePlay(st, 0 as Seat)).toBeNull();
  });
});
```

> 若 `identify` 实际导出名/签名不同（如 `identifyWithWild`），实现者改用引擎真实导出来构造 `current.combo`，断言意图不变。

- [ ] **Step 2: 跑测试看失败**

Run: `npx vitest run tests/ai.test.ts`
Expected: FAIL（战略不要 / 保结构 未实现）

- [ ] **Step 3: 替换 ai.ts 的 FOLLOW 段**

把 Task 3 里 `choosePlay` 的 `// ---- FOLLOW ----` 整段替换为调用 `chooseFollow`，并新增 helper：

```ts
/** 残局：自己或任一对手手牌很少（≤ 阈值）→ 放宽出牌、敢拆敢炸。 */
const ENDGAME_CARDS = 6;

/** 出 cards 对剩余手牌计划的"结构损伤"：0=计划内的一手；>0=多花了手数。 */
function damage(hand: Card[], cards: Card[], level: Rank): number {
  const ids = new Set(cards.map(c => c.id));
  const rest = hand.filter(c => !ids.has(c.id));
  const before = decompose(hand, level).handCount;
  const after = decompose(rest, level).handCount;
  return (1 + after) - before;
}

function chooseFollow(s: DealState, seat: Seat): Card[] | null {
  const hand = s.hands[seat]!;
  const level = s.level;
  const partner = ((seat + 2) % 4) as Seat;

  // 队友领先：默认不要；但本手能直接走完(出完=hand 全清)则出
  if (s.current!.by === partner) {
    const all = enumerateFollows(hand, s.current!.combo, level)
      .find(c => c.cards.length === hand.length);
    return all ? all.cards : null;
  }

  const follows = enumerateFollows(hand, s.current!.combo, level);
  if (follows.length === 0) return null;

  const nonBombs = follows.filter(c => !isBomb(c));
  const bombs = follows.filter(c => isBomb(c));

  // 各家公开张数：残局 / 对手即将走完
  const myLen = hand.length;
  const oppAboutToWin = ([0,1,2,3] as Seat[])
    .some(o => o !== seat && o !== partner && s.hands[o]!.length <= 2 && s.hands[o]!.length > 0);
  const endgame = myLen <= ENDGAME_CARDS || oppAboutToWin;

  // 非炸弹候选按 (损伤 delta, key, 长度) 排序，取最优
  if (nonBombs.length > 0) {
    const scored = nonBombs.map(c => ({ c, d: damage(hand, c.cards, level) }));
    scored.sort((a, b) =>
      a.d - b.d || a.c.key - b.c.key || a.c.cards.length - b.c.cards.length);
    const best = scored[0]!;
    // 全部候选都损伤结构(>0) 且非残局/对手没要走完 → 战略不要，保牌
    if (best.d > 0 && !endgame) return null;
    return best.c.cards;
  }

  // 只剩炸弹能压：仅在残局 / 对手要走完 / 自己也快走完时才炸；用最弱够用炸弹
  if (endgame) {
    return bombs.reduce((b, c) => (c.power < b.power ? c : b)).cards;
  }
  return null; // 否则忍住炸弹，pass
}
```

并把 `choosePlay` 末尾改为：

```ts
  // ---- FOLLOW ----
  return chooseFollow(s, seat);
```

- [ ] **Step 4: 跑测试 + fuzz**

Run: `npx vitest run tests/ai.test.ts && npx vitest run tests/fuzz.test.ts`
Expected: 全 PASS

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck`

```bash
git add src/games/guandan/ai/ai.ts tests/ai.test.ts
git commit -m "feat(guandan): 跟牌保结构/战略不要/炸弹时机/残局配合（delta 损伤度量）"
```

---

### Task 5: chooseReturn 智能还贡 + driver/server 接入 + 重打 bundle

新增 `chooseReturn`：在可还牌（≤10）里选移除后对计划损伤最小、再取点数最低的牌（不拆对子/结构）。AI 还贡调用点（local-driver 239/241、server 121/143）由 `autoReturn` 改 `chooseReturn`，并重打服务端 bundle。

**Files:**
- Modify: `src/games/guandan/ai/ai.ts`（导出 `chooseReturn`）
- Modify: `src/games/guandan/driver/local-driver.ts:23,239,241`
- Modify: `server/guandan-match-driver.ts:2,6,121,143`
- Modify(生成物): `server/guandan-match-driver.bundle.mjs`（`npm run build:server` 产出）
- Test: `tests/ai.test.ts`（还贡断言）

**Interfaces:**
- Consumes: `returnableCards(hand, level)`（engine/match）、`decompose`、`rankValue`
- Produces: `export function chooseReturn(hand: Card[], level: Rank): Card`

- [ ] **Step 1: 写失败测试**

`tests/ai.test.ts` 追加：

```ts
import { chooseReturn } from '../src/games/guandan/ai/ai';

describe('chooseReturn 还贡', () => {
  it('不拆对子：宁还落单的小牌，也不拆掉一对', () => {
    // 一对3(最小) + 一张落单5；还贡应给落单5，不拆对3
    const hand = [c(3,'S'), c(3,'H'), c(5,'C'), c(9,'D'), c(10,'S')];
    const ret = chooseReturn(hand, L);
    expect(ret.rank).toBe(5);
  });

  it('全是落单小牌 → 给点数最小的（≤10）', () => {
    const hand = [c(4,'S'), c(7,'H'), c(10,'C'), c(13,'D')];
    const ret = chooseReturn(hand, L);
    expect(ret.rank).toBe(4);
  });
});
```

- [ ] **Step 2: 跑测试看失败**

Run: `npx vitest run tests/ai.test.ts`
Expected: FAIL（`chooseReturn` 未导出）

- [ ] **Step 3: 实现 chooseReturn（ai.ts 追加导出）**

`src/games/guandan/ai/ai.ts` 顶部 import 追加 `returnableCards`：

```ts
import { returnableCards } from '../engine/match';
```

文件末尾追加：

```ts
/**
 * AI 还贡选牌：可还牌(≤10)中，移除后对剩余计划损伤最小、再取点数最低者。
 * 损伤=移除该牌后 handCount 相对 (base−1) 的增量：0=本是落单单张；>0=拆了对子/结构。
 */
export function chooseReturn(hand: Card[], level: Rank): Card {
  const cand = returnableCards(hand, level);
  const pool = cand.length > 0 ? cand : hand;
  const base = decompose(hand, level).handCount;
  let best = pool[0]!;
  let bestScore = Infinity;
  for (const card of pool) {
    const rest = hand.filter(c => c.id !== card.id);
    const after = decompose(rest, level).handCount;
    const delta = after - (base - 1);                 // 0=落单；>0=拆结构
    const score = delta * 100 + rankValue(card, level); // 先少损伤，再低点数
    if (score < bestScore) { bestScore = score; best = card; }
  }
  return best;
}
```

- [ ] **Step 4: 跑还贡测试通过**

Run: `npx vitest run tests/ai.test.ts`
Expected: PASS

- [ ] **Step 5: driver/server 接入 chooseReturn**

`src/games/guandan/driver/local-driver.ts`：
- 第 20 行附近 import 段后追加：`import { chooseReturn } from '../ai/ai';`
- 第 239 行 `?? autoReturn(dealt[ex.receiver]!, level)` → `?? chooseReturn(dealt[ex.receiver]!, level)`
- 第 241 行 `return autoReturn(dealt[ex.receiver]!, level);` → `return chooseReturn(dealt[ex.receiver]!, level);`

`server/guandan-match-driver.ts`：
- 第 6 行 `import { choosePlay } from '../src/games/guandan/ai/ai';` → `import { choosePlay, chooseReturn } from '../src/games/guandan/ai/ai';`
- 第 121 行 `autoReturn(hands[ex.receiver]!, dealLevel(this.match))` → `chooseReturn(hands[ex.receiver]!, dealLevel(this.match))`
- 第 143 行 `autoReturn(this.pendingDeal.hands[ex.receiver]!, dealLevel(this.match))` → `chooseReturn(this.pendingDeal.hands[ex.receiver]!, dealLevel(this.match))`
- 第 2 行 import 里的 `autoReturn` 若变为未使用则删除该名（保留 `returnableCards`/`applyTribute` 等仍用到的）。

- [ ] **Step 6: 重打 server bundle + 全量验证**

Run: `npm run build:server && npm run typecheck && npm test`
Expected: bundle 重建成功；typecheck 无错；`npm test` 全绿（含 fuzz）

- [ ] **Step 7: Commit**

```bash
git add src/games/guandan/ai/ai.ts src/games/guandan/driver/local-driver.ts server/guandan-match-driver.ts server/guandan-match-driver.bundle.mjs tests/ai.test.ts
git commit -m "feat(guandan): 智能还贡 chooseReturn（不拆结构）+ driver/server 接入 + 重打 bundle"
```

---

### Task 6: 对打模拟验收（新 vs 老 ≥60%）

新 AI 队 vs 老 AI 队跑 500 局确定性发牌，轮换座位消除位次偏置，断言新队胜率 ≥ 60% 且平均名次更优。

**Files:**
- Create: `tests/ai-headtohead.test.ts`

**Interfaces:**
- Consumes: `choosePlay`（新）、`legacyChoosePlay`（Task 1）、`createDeal`/`play`/`pass`/`isDealOver`/`ranking`、`makeDeck`/`deal`

- [ ] **Step 1: 写对打测试**

`tests/ai-headtohead.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { makeDeck, deal } from '../src/games/guandan/engine/cards';
import { createDeal, play, pass, isDealOver, ranking, type DealState } from '../src/games/guandan/engine/game';
import { choosePlay } from '../src/games/guandan/ai/ai';
import { legacyChoosePlay } from './helpers/legacy-ai';
import type { Rank, Seat } from '../src/games/guandan/engine/types';

const LEVEL: Rank = 2;
const GAMES = 500;
const MAX_STEPS = 2000;
type Policy = (s: DealState, seat: Seat) => ReturnType<typeof choosePlay>;

function makeLCG(seed: number): () => number {
  let st = seed >>> 0;
  return () => (st = (Math.imul(st, 1664525) + 1013904223) >>> 0);
}
function seededShuffle(seed: number) {
  return (n: number): number[] => {
    const next = makeLCG(seed);
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = next() % (i + 1); [p[i], p[j]] = [p[j]!, p[i]!]; }
    return p;
  };
}

/** 跑一整局，按座位策略出牌，返回 ranking（finish 顺序）。 */
function playDeal(seed: number, policyOf: (seat: Seat) => Policy): Seat[] {
  const deck = makeDeck();
  const hands = deal(deck, seededShuffle(seed));
  const firstLeader = (makeLCG(seed + 0xbeef)() % 4) as Seat;
  let s = createDeal(hands, firstLeader, LEVEL);
  let step = 0;
  while (!isDealOver(s)) {
    if (++step > MAX_STEPS) break;
    const seat = s.turn;
    const chosen = policyOf(seat)(s, seat);
    s = chosen === null ? pass(s, seat) : play(s, seat, chosen);
  }
  return ranking(s);
}

/** 名次→得分：头游3 二游2 三游1 末游0。 */
function teamPoints(rank: Seat[], teamSeats: Seat[]): number {
  const pts = [3, 2, 1, 0];
  return teamSeats.reduce((sum, seat) => sum + pts[rank.indexOf(seat)]!, 0);
}

describe('新 AI vs 老 AI 对打', () => {
  it(`新队胜率 ≥ 60%（${GAMES} 局，轮换座位）`, () => {
    let newWins = 0, ties = 0, newPointsTotal = 0;
    for (let g = 0; g < GAMES; g++) {
      // 偶数局：新队={0,2}；奇数局：新队={1,3}（消除位次偏置）
      const newSeats: Seat[] = g % 2 === 0 ? [0, 2] : [1, 3];
      const isNew = (seat: Seat) => newSeats.includes(seat);
      const rank = playDeal(g, (seat) => (isNew(seat) ? choosePlay : legacyChoosePlay));
      const np = teamPoints(rank, newSeats);
      const op = 6 - np; // 总分恒为 3+2+1+0=6
      newPointsTotal += np;
      if (np > op) newWins++; else if (np === op) ties++;
    }
    const winRate = newWins / GAMES;
    const avgNewPoints = newPointsTotal / GAMES;
    // eslint-disable-next-line no-console
    console.log(`新队胜率=${(winRate * 100).toFixed(1)}% 平局=${ties} 平均队分=${avgNewPoints.toFixed(2)}/6`);
    expect(winRate).toBeGreaterThanOrEqual(0.6);
    expect(avgNewPoints).toBeGreaterThan(3); // 平均强于均势(3)
  });
});
```

- [ ] **Step 2: 跑对打测试**

Run: `npx vitest run tests/ai-headtohead.test.ts`
Expected: PASS（控制台打印胜率，断言 ≥60%）

> 若未达 60%：按"系统化调试"复盘 console 打印的胜率与典型败局，回 Task 3/4 调启发式（控制牌阈值 `CONTROL_KEY`、残局阈值 `ENDGAME_CARDS`、损伤排序权重、炸弹时机），重跑直至达标。**不得**降低门槛或改对打规则糊弄。

- [ ] **Step 3: 全量验证 + commit**

Run: `npm test && npm run typecheck`
Expected: 全绿（fuzz + ai + decompose + headtohead 全过）

```bash
git add tests/ai-headtohead.test.ts
git commit -m "test(guandan): 新 AI vs 老 AI 对打验收（500 局，胜率≥60%）"
```

---

### Task 7: 真机代打冒烟（owner 眼验）+ 部署

复用掼蛋在线冒烟，逼一座回合超时触发服务端 AI 代打，截图给 owner 眼验"像会打"。通过后按 DEPLOY.md 推 `dist` + `server`（含新 bundle）。

**Files:**
- Create: `sandbox/2026-06-23-guandan-ai-smoke/NOTE.md` + 冒烟脚本（参考既有 guandan online smoke）
- 无源码改动

- [ ] **Step 1: 构建 + 起本地服务**

Run: `npm run build && npm run build:server`
Expected: `dist/index.html` + `server/guandan-match-driver.bundle.mjs` 重建

- [ ] **Step 2: 冒烟脚本**

`sandbox/2026-06-23-guandan-ai-smoke/`：参考 `sandbox/2026-06-21-guandan-online-smoke/` 起本地 server（Playwright + 系统 Chrome `channel:'chrome'`），开一局在线掼蛋，让一座**不操作**直到回合超时（可用 `GD_TURN_TIMEOUT` 环境变量调短便于冒烟），观察该座被服务端 `choosePlay` 代打、连续出牌。截多张图（代打前/中/走完）。`NOTE.md` 记目的+时间+是否有后续。

- [ ] **Step 3: owner 眼验**

把代打过程截图发给 owner，确认 AI "不拆好牌、会走、看着像会打"。owner 点头才进部署。

- [ ] **Step 4: 部署（红线，须 owner 授权后执行）**

按 `DEPLOY.md`：备份 → 推 `dist/index.html` + `server/guandan-match-driver.bundle.mjs`（**bundle 必须一起推**，否则线上代打仍老 AI）→ `systemctl restart desk-games` → 公网真路径复验。

- [ ] **Step 5: 清当次冒烟产物 + 收尾**

确认 owner 满意后，按 sandbox 规矩保留或清理 `sandbox/2026-06-23-guandan-ai-smoke/`；更新 `.superpowers/sdd/progress.md`（若用 SDD 执行）。

---

## Self-Review

**Spec coverage（逐条对 spec）：**
- 拆牌 decompose → Task 2 ✓
- 领牌（走完/甩废牌/留控制/省红心2/不拆结构）→ Task 3 ✓
- 跟牌（保结构/战略不要/最小够用）→ Task 4 ✓
- 炸弹时机 → Task 4（endgame/oppAboutToWin 门控）✓
- 红心2 节制 → decompose tie-break(Task2) + 领牌 wildCount tie(Task3) ✓
- 配合（队友领先不要、能走完则出；对手要走完敢炸）→ Task 4 ✓
- 还贡 chooseReturn → Task 5 ✓
- 诚实边界（只读自家内容 + 公开张数）→ 全程；跟牌用 `s.hands[o].length` 仅张数 ✓
- 验收 ≥60% + 平均手数 → Task 6 ✓
- fuzz 仍绿 + 性能 → Task 3/4/5 每步跑 fuzz；decompose 有界+缓存 ✓
- 真机代打眼验 → Task 7 ✓
- 重打 bundle/部署 bundle → Task 5 Step 6 + Task 7 Step 4 ✓

**Placeholder scan：** 无 TBD/TODO；每个改码步骤含完整代码或精确行号替换。测试 rank 字面量处已注明"按引擎实际编码调整"（因 `Card['rank']` 编码未在本计划锁定）——非占位，是实现者须核对的真实约束。

**Type consistency：** `decompose`→`{combos,handCount}` 全程一致；`choosePlay` 签名贯穿不变；`chooseReturn(hand,level):Card` 在 Task5 定义、driver/server 同签名调用；`legacyChoosePlay` 与 `choosePlay` 同签名（Task1 定义、Task6 消费）。

**已知实现期需核对项（非阻塞）：** ① `engine/types.ts` 的 `Card`/`Suit`/`Rank` 实际字段与 rank 编码 ② `engine/combos.ts` 构造 `current.combo` 的真实导出名（`identify` vs `identifyWithWild`）③ local-driver/server 的精确行号随前序改动可能微移——按符号搜索定位。
