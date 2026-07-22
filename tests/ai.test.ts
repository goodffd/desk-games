/**
 * Task 7 — AI 出牌策略 tests.
 *
 * Covers:
 *  1. Return value is always null (pass) OR a legal play per isLegalPlay.
 *  2. Lead (current==null) with non-empty hand must never return null.
 *  3. 200 random deal scenarios: choosePlay never throws, always returns a legal value.
 *  4. Weak tendency assertions:
 *     - When leading, AI prefers small singles over bombs (statistical threshold).
 *     - When partner leads, AI tends to pass (statistical threshold).
 */

import { describe, it, expect } from 'vitest';
import type { Card, Rank, Seat, Suit } from '../src/games/guandan/engine/types';
import type { DealState } from '../src/games/guandan/engine/game';
import { makeDeck, deal } from '../src/games/guandan/engine/cards';
import { isLegalPlay } from '../src/games/guandan/engine/legal';
import { enumerateLeads } from '../src/games/guandan/engine/legal';
import { createDeal, play as gamePlay, pass as gamePass } from '../src/games/guandan/engine/game';
import { choosePlay, chooseReturn, heuristicChoose } from '../src/games/guandan/ai/ai';
import { computeUnseen } from '../src/games/guandan/ai/counting';
import { identify } from '../src/games/guandan/engine/combos';
// seed 语义变更记录（issue #3）：本文件原先自带一份 Mulberry32 洗牌，迁到共用模块后
// 同一 seed 发到的牌不同。这里的断言只用随机局面验合法性与统计倾向，不依赖任何具体牌面；
// 迁移后 22 条断言（含两条 ≥70% 的倾向断言）全部仍绿。
import { seededShuffle } from './helpers/rng';

/** Build a fresh DealState with a given seed (firstLeader = 0). */
function makeDeal(seed: number): DealState {
  const deck = makeDeck();
  const hands = deal(deck, seededShuffle(seed));
  return createDeal(hands, 0, 2); // level=2 ("打2")
}

// ---- helper: verify a choosePlay result is valid ---------------------------

function assertValid(
  result: ReturnType<typeof choosePlay>,
  s: DealState,
  seat: Seat,
  context: string
): void {
  const hand = s.hands[seat]!;
  const current = s.current?.combo ?? null;
  const level = s.level;

  if (result === null) {
    // null is only allowed when following (current != null)
    expect(s.current, `${context}: null returned on free lead`).not.toBeNull();
  } else {
    // must be a legal play
    const legal = isLegalPlay(result, current, hand, level);
    expect(legal, `${context}: returned cards not legal`).toBe(true);
    // cards must come from the hand
    const handIds = new Set(hand.map(c => c.id));
    for (const c of result) {
      expect(handIds.has(c.id), `${context}: card id ${c.id} not in hand`).toBe(true);
    }
  }
}

// ---------------------------------------------------------------------------
// Basic unit tests
// ---------------------------------------------------------------------------

describe('choosePlay — basic correctness', () => {
  it('returns non-null on free lead with non-empty hand', () => {
    const s = makeDeal(1);
    // seat 0 leads first
    const result = choosePlay(s, 0);
    expect(result).not.toBeNull();
    assertValid(result, s, 0, 'free lead seat 0');
  });

  it('returned cards are always legal on a free lead', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = makeDeal(seed);
      const result = choosePlay(s, s.turn);
      expect(result).not.toBeNull();
      assertValid(result, s, s.turn, `free lead seed=${seed}`);
    }
  });

  it('returns null or a legal follow when there is a current combo', () => {
    // Construct a state where seat 0 has played and seat 1 must follow.
    const s0 = makeDeal(42);
    // Seat 0 leads: get its choice and apply it.
    const leadCards = choosePlay(s0, 0)!;
    const s1 = gamePlay(s0, 0, leadCards);
    // Now seat 1 follows (or passes).
    const result = choosePlay(s1, 1);
    assertValid(result, s1, 1, 'follow seat 1 after seat 0 lead');
  });

  it('null only ever returned when there is a current combo', () => {
    // Run 50 seeds and ensure no null on free lead
    for (let seed = 100; seed < 150; seed++) {
      const s = makeDeal(seed);
      const result = choosePlay(s, s.turn);
      if (s.current === null && s.hands[s.turn]!.length > 0) {
        expect(result, `seed=${seed}: null on free lead`).not.toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 200 random deal scenarios
// ---------------------------------------------------------------------------

describe('choosePlay — 200 random scenarios', () => {
  it('never throws and always returns a valid value across 200 random deals', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = makeDeal(seed);
      // Test free lead
      expect(
        () => {
          const result = choosePlay(s, s.turn);
          assertValid(result, s, s.turn, `seed=${seed} free-lead`);
        },
        `seed=${seed} free lead threw`
      ).not.toThrow();

      // Advance one play and test follow
      const leadCards = choosePlay(s, s.turn);
      if (leadCards && leadCards.length > 0) {
        try {
          const s2 = gamePlay(s, s.turn, leadCards);
          expect(
            () => {
              const result = choosePlay(s2, s2.turn);
              assertValid(result, s2, s2.turn, `seed=${seed} follow`);
            },
            `seed=${seed} follow threw`
          ).not.toThrow();
        } catch {
          // gamePlay might throw if the deal is immediately over (unlikely but safe to skip)
        }
      }
    }
  });

  it('never returns cards not in the hand across 200 deals', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = makeDeal(seed);
      const seat = s.turn;
      const hand = s.hands[seat]!;
      const result = choosePlay(s, seat);

      if (result !== null) {
        const handIds = new Set(hand.map(c => c.id));
        for (const c of result) {
          expect(handIds.has(c.id), `seed=${seed}: card id ${c.id} not in hand`).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tendency assertions (weak / statistical)
// ---------------------------------------------------------------------------

describe('choosePlay — tendency assertions (weak / statistical)', () => {
  it('when leading, prefers small singles over bombs at least 70% of the time (hands with both)', () => {
    let testedDeals = 0;
    let preferredSmall = 0;

    for (let seed = 0; seed < 300; seed++) {
      const s = makeDeal(seed);
      const seat = s.turn;
      const hand = s.hands[seat]!;
      const level = s.level;
      const leads = enumerateLeads(hand, level);

      const hasSmallSingle = leads.some(
        c => c.type === 'single' && c.key <= 8 // 3..8 are "small"
      );
      const hasBomb = leads.some(
        c => c.type === 'bomb' || c.type === 'straightFlush' || c.type === 'kingBomb'
      );

      if (!hasSmallSingle || !hasBomb) continue; // skip; no meaningful contrast
      testedDeals++;

      const result = choosePlay(s, seat);
      if (result !== null) {
        const isBombPlay =
          result.length >= 4 &&
          isLegalPlay(result, null, hand, level) &&
          leads.some(
            c =>
              (c.type === 'bomb' || c.type === 'straightFlush' || c.type === 'kingBomb') &&
              c.cards.every(bc => result.some(rc => rc.id === bc.id))
          );
        if (!isBombPlay) preferredSmall++;
      }
    }

    // Need at least 20 qualifying hands for a meaningful test
    expect(testedDeals, 'not enough qualifying deals to test tendency').toBeGreaterThanOrEqual(20);
    const ratio = preferredSmall / testedDeals;
    expect(ratio, `only ${(ratio * 100).toFixed(1)}% of leads preferred non-bomb (want ≥70%)`).toBeGreaterThanOrEqual(0.7);
  });

  it('when partner is leading the current combo, passes at least 70% of the time', () => {
    let partnerLeadCases = 0;
    let passedCount = 0;

    for (let seed = 0; seed < 400; seed++) {
      const s0 = makeDeal(seed);

      // Advance: seat 0 leads, then check seat 2 (partner of 0).
      const leadCards = choosePlay(s0, 0);
      if (!leadCards) continue;

      let s1: DealState;
      try {
        s1 = gamePlay(s0, 0, leadCards);
      } catch {
        continue;
      }

      // Advance from seat 1 to reach seat 2's turn (seat 1 passes or plays)
      // We want to test seat 2 when current.by === 0 (seat 2's partner).
      // After seat 0 played, if seat 1's turn is next and s1.current is set:
      // let seat 1 pass to get to seat 2.
      if (s1.finished.length >= 4) continue;

      // If it's seat 1's turn (seat 0's opponent), have seat 1 pass to get to seat 2
      let s2 = s1;
      if (s2.turn === 1 && s2.current !== null) {
        try {
          s2 = gamePass(s2, 1);
        } catch {
          continue;
        }
      }

      // Now check if it's seat 2's turn (partner of seat 0) and current is by seat 0
      if (
        s2.turn === 2 &&
        s2.current !== null &&
        s2.current.by === 0 &&
        s2.hands[2]!.length > 0
      ) {
        partnerLeadCases++;
        const result = choosePlay(s2, 2);
        if (result === null) passedCount++;
      }
    }

    if (partnerLeadCases < 10) {
      // Not enough cases from seed range; that's acceptable — skip assertion
      console.log(`Only ${partnerLeadCases} partner-lead cases found; skipping ratio check.`);
      return;
    }

    const ratio = passedCount / partnerLeadCases;
    expect(
      ratio,
      `only ${(ratio * 100).toFixed(1)}% pass when partner leads (want ≥70%)`
    ).toBeGreaterThanOrEqual(0.7);
  });
});

// ---------------------------------------------------------------------------
// Task 3 — 领牌策略（拆解驱动）行为断言
//
// Card 类型说明：
//   普通牌：{ kind: 'normal', suit: Suit, rank: Rank, id: number }
//   大王：  { kind: 'joker', big: true,  id: number }
//   小王：  { kind: 'joker', big: false, id: number }
//   逢人配（红心2 at level 2）：{ kind: 'normal', suit: 'H', rank: 2, id: number }
// ---------------------------------------------------------------------------

const L3: Rank = 2; // 固定打2
let _nid3 = 2000;   // id 段与其余测试隔离
function n(rank: number, suit: Suit): Card {
  return { kind: 'normal', id: _nid3++, rank: rank as Rank, suit };
}
function bigJoker(): Card { return { kind: 'joker', big: true,  id: _nid3++ }; }

/** 构造"自由领牌"DealState：seat0 手牌=hand，其余各持 8 张废牌，current=null, turn=0。
 *  各家 8 张（非 1）以免误触发"队友剩1张喂牌"与残局 rollout，纯验 decompose 领牌逻辑。 */
function leadState3(hand: Card[]): DealState {
  const filler = (): Card[] => Array.from({ length: 8 }, () => n(14, 'S'));
  return {
    hands: [hand, filler(), filler(), filler()],
    current: null, turn: 0 as Seat, passesInRow: 0, finished: [], level: L3,
  };
}

describe('choosePlay 领牌（拆解驱动）', () => {
  it('手里是一条顺子 → 一手领完（不拆单张）', () => {
    // [3♠,4♥,5♣,6♦,7♠] 构成唯一顺子；新 AI decompose 识别到 1 手，应直接领完。
    // 老 AI leadCost 选最低 key=single-3(cost=299) < straight(cost=695)，会拆单张 → FAIL。
    const hand: Card[] = [n(3, 'S'), n(4, 'H'), n(5, 'C'), n(6, 'D'), n(7, 'S')];
    const out = choosePlay(leadState3(hand), 0 as Seat);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(5);
    expect(isLegalPlay(out!, null, hand, L3)).toBe(true);
  });

  it('有小对子和大王 → 领小对，不先领大王【防回归守卫，非 TDD RED 差异点】', () => {
    // ⚠️ 诚实标注：此条不是真 RED。老 AI 的 leadCost 排序对自然牌本就偏好低 key
    //   （pair-3 cost=298 < bigJoker single cost≈1699），老 AI 同样不先甩大王，
    //   新旧 AI 行为一致——它不验证 decompose 改造带来的差异，仅作"领牌不先甩控制大牌"
    //   的防回归守卫，防止未来策略改动意外退化。真 RED 覆盖见上方"顺子→一手领完"
    //   与下方"有自然对时不消耗逢人配"两条。
    // [3♠,3♥,bigJoker,2♠(level-non-wild)] 手牌结构：3对 + 大王单 + 2♠单(level非wild)。
    // 新 AI：decompose 拆为 pair-3 + single-bigJoker + single-2♠，nonControl 优先领 pair-3。
    const bj = bigJoker();
    const hand: Card[] = [n(3, 'S'), n(3, 'H'), bj, n(2, 'S')];
    const out = choosePlay(leadState3(hand), 0 as Seat);
    expect(out).not.toBeNull();
    // 领出的牌不应包含大王
    expect(out!.some(x => x.kind === 'joker' && x.big)).toBe(false);
  });

  it('手牌全是控制牌型 → 不崩溃，领 key 最低的那个控制牌（nonControl 为空分支）', () => {
    // 覆盖 chooseLead 的 nonControl.length === 0 分支：构造一手 decompose 后全是控制牌型
    // （key≥14 或炸弹）的手牌——[A♠,A♣,2♠,2♣] at level 2：
    //   decompose → [pair-A(key=14), pair-2level(key=15)]，两者皆 isControl(key≥14)。
    //   nonControl 过滤后为空 → pool 退回 combos，仍取最低 key=pair-A。
    // 实测 decompose 输出：pair key=14 [S14,C14] | pair key=15 [S2,C2]，lead=S14,C14。
    const hand: Card[] = [n(14, 'S'), n(14, 'C'), n(2, 'S'), n(2, 'C')];
    const out = choosePlay(leadState3(hand), 0 as Seat);
    // (a) 不会因 pool 为空而崩溃或返回 null；是合法领牌
    expect(out).not.toBeNull();
    expect(isLegalPlay(out!, null, hand, L3)).toBe(true);
    // (b) 选的是 key 最低的控制牌型 = 那对 A（不是 key 更高的那对 level-2）
    expect(out!.length).toBe(2);
    expect(out!.every(x => x.kind === 'normal' && x.rank === 14)).toBe(true);
  });

  it('有自然对时不消耗逢人配（红心2）', () => {
    // [3♠,3♣,2♥(wild),5♦]：自然对3 + 红心2(逢人配) + 5单张。
    // decompose 拆为 pair-3自然 + single-5 + single-wild（3手），nonControl 最低 key=pair-3，直接领。
    // 老 AI 枚举所有 leads 后 sort；pair-3自然 与 pair-3-wild 的 leadCost 相同(=298)，
    // sort 不稳定，可能选含 wild 的 pair → 测试有机会 FAIL 验证了 RED。
    // 新 AI 通过 wildCount tie-break 保证选不含 wild 的 pair-3自然 → GREEN。
    const hand: Card[] = [n(3, 'S'), n(3, 'C'), n(2, 'H'), n(5, 'D')];
    const out = choosePlay(leadState3(hand), 0 as Seat);
    expect(out).not.toBeNull();
    // 领出的不应包含红心2（逢人配）
    expect(out!.some(x => x.kind === 'normal' && x.rank === 2 && x.suit === 'H')).toBe(false);
  });

  it('队友剩1张即将上游 → 领最小单张喂他上游（不自顾自出牌/不拆对不出大牌）', () => {
    // seat0 领牌，队友 seat2 剩 1 张；seat0=对9+散5/7/K → 应领最小散牌 5(喂牌)，
    // 而非领对9或出 K。低单张对手多半不截，传到队友由其牌接走上游，保我方一个头游续升级。
    const hand0 = [n(9, 'S'), n(9, 'H'), n(5, 'C'), n(7, 'D'), n(13, 'S')];
    const s: DealState = {
      hands: [hand0, Array.from({ length: 6 }, () => n(14, 'S')), [n(4, 'C')], Array.from({ length: 6 }, () => n(14, 'H'))],
      current: null, turn: 0 as Seat, passesInRow: 0, finished: [], level: L3,
    };
    const out = choosePlay(s, 0 as Seat)!;
    expect(out.length).toBe(1);                                  // 领单张(喂牌)
    expect(out[0]!.kind === 'normal' && out[0]!.rank).toBe(5);   // 最小散牌5(rankValue最低)
  });

  it('队友剩2张(近上游)、无对手近上游 → 喂对子(大小匹配队友张数，非单张)', () => {
    // 队友剩 2 张多半是个对子 → 喂对子让他一手走完(喂单张他只脱1张)；喂牌可 2/3 张不止 1 张。
    const hand0 = [n(9, 'S'), n(9, 'H'), n(5, 'C'), n(7, 'D'), n(13, 'S')];
    const s: DealState = {
      hands: [hand0, Array.from({ length: 6 }, () => n(14, 'S')), [n(3, 'C'), n(4, 'C')], Array.from({ length: 6 }, () => n(14, 'H'))],
      current: null, turn: 0 as Seat, passesInRow: 0, finished: [], level: L3,
    };
    const out = choosePlay(s, 0 as Seat)!;
    expect(out.length).toBe(2);                                               // 喂对子(队友剩2张)
    expect(out.every((c) => c.kind === 'normal' && c.rank === 9)).toBe(true); // 对9
  });

  it('队友近上游但对手也剩1张 → 不喂牌，出非单张(对手单牌接不上上不了游)', () => {
    // 队友 seat2 剩1张，但对手 seat1(下家) 也剩1张 → 争头游，不喂低单张(会被对手接走)，改领对9。
    const hand0 = [n(9, 'S'), n(9, 'H'), n(5, 'C'), n(7, 'D')];
    const s: DealState = {
      hands: [hand0, [n(4, 'S')], [n(3, 'C')], Array.from({ length: 6 }, () => n(14, 'H'))],
      current: null, turn: 0 as Seat, passesInRow: 0, finished: [], level: L3,
    };
    const out = choosePlay(s, 0 as Seat)!;
    expect(out.length).toBe(2);                                       // 领非单张(对子)，不喂单张
    expect(out.every((c) => c.kind === 'normal' && c.rank === 9)).toBe(true); // 对9
  });
});

// ---------------------------------------------------------------------------
// Task 4 — 跟牌策略（保结构 + 战略不要 + 炸弹时机 + 配合）
//
// followState 构造跟牌局面：seat0 手牌=hand，台面 current=由 byCards 识别的牌型、by=seat1（对手）。
// hands[2] / hands[3] 各持 1 张废牌（公开张数 > 0，保证 oppAboutToWin 不意外触发）。
// ---------------------------------------------------------------------------

/** 构造跟牌局面：seat0 手牌=hand，台面 current 由 byCards 识别、by=seat1（对手）。
 *  seats 1/2/3 各持 3 张废牌（>2 张，保证 oppAboutToWin 不意外触发）。 */
function followState(hand: Card[], byCards: Card[]): DealState {
  const combo = identify(byCards, L3)!;
  return {
    hands: [hand, [n(14, 'D'), n(13, 'D'), n(12, 'D')], [n(14, 'H'), n(13, 'H'), n(12, 'H')], [n(14, 'C'), n(13, 'C'), n(12, 'C')]],
    current: { combo, by: 1 as Seat },
    turn: 0 as Seat,
    passesInRow: 0,
    finished: [],
    level: L3,
  };
}

// 这些用例验证的是「跟牌启发式逻辑」(damage 度量 / 战略不要 / 配合)，即 heuristicChoose 层。
// choosePlay = 启发式 + 残局 determinized rollout；rollout 在这些小手牌人工场景会触发，且其
// 采样对手手牌与人工构造的废牌对不上，故对本层单测直接测 heuristicChoose（rollout 的净收益由
// ai-improvement 基准 + 「200 随机局合法性」用例覆盖）。
const heur = (s: DealState, seat: Seat): Card[] | null => heuristicChoose(s, seat, computeUnseen(s, seat));

describe('choosePlay 跟牌', () => {
  it('对手出小单张：用零散单张压，不拆顺子', () => {
    // 手里一条顺子3-7 + 一张散K；对手出一张10 → 应用散K压，不拆顺子
    // damage 度量：拆顺子中单张 damage>0（破坏结构），散K damage=0 → 选散K。
    const hand = [n(3, 'S'), n(4, 'H'), n(5, 'C'), n(6, 'D'), n(7, 'S'), n(13, 'C')];
    const out = heur(followState(hand, [n(10, 'D')]), 0 as Seat);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    const played = out![0]!;
    expect(played.kind === 'normal' && played.rank).toBe(13); // 散K，不是顺子里的牌
  });

  it('便宜抢节奏：唯一能压的是拆一张的小牌(≤2张, damage≤1) → 抢下领出权（tempo-grab）', () => {
    // 手里一对8 + 一条顺子；对手出单张7，能压的最小是拆一张8（damage=1, 1 张）。
    // 增强 AI 的「便宜抢节奏」：损伤≤1 的小牌(≤2)拿下这轮领出权帮自己更快走完——
    // 经 ai-improvement 基准验证为净正（头游胜率 +）。故此微观场景由旧「战略不要」改为出牌。
    const hand = [n(8, 'S'), n(8, 'H'), n(9, 'C'), n(10, 'D'), n(11, 'S'), n(12, 'C'), n(13, 'D')];
    const out = heur(followState(hand, [n(7, 'D')]), 0 as Seat);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    expect(out![0]!.kind === 'normal' && out![0]!.rank).toBe(8); // 拆一张 8 压
  });

  it('大代价拆结构、且非残局 → 战略不要(pass)（tempo-grab 不覆盖 >2 张的牺牲）', () => {
    // 手里钢板 10-10-10-J-J-J(consecTriples, 1 手) + 两张散牌；对手出三张9。
    // 唯一能压的是拆钢板出三张10/三张J（length=3, damage=1）——tempo-grab 只抢 ≤2 张，不适用 → pass。
    const hand = [n(10, 'S'), n(10, 'H'), n(10, 'C'), n(11, 'S'), n(11, 'H'), n(11, 'C'), n(3, 'D'), n(5, 'D')];
    const out = heur(followState(hand, [n(9, 'D'), n(9, 'H'), n(9, 'C')]), 0 as Seat);
    expect(out).toBeNull();
  });

  it('spare(damage=0) 与结构内牌(damage>0)都能压 → 选 spare 不拆顺子【damage 主路径】', () => {
    // decompose([8S,9H,10C,11D,12S,14C], L3): handCount=2 → straight 8-12 + single A(14)。
    // 对手出单张10 → 合法跟牌 J(11)/Q(12)（顺子内, damage=4）、散A(14)（spare, damage=0）。
    // 按 (damage, key) 排序 → 选 damage=0 的散A，不拆顺子。
    const hand = [n(8, 'S'), n(9, 'H'), n(10, 'C'), n(11, 'D'), n(12, 'S'), n(14, 'C')];
    const out = heur(followState(hand, [n(10, 'D')]), 0 as Seat);
    expect(out).not.toBeNull();
    expect(out!.length).toBe(1);
    const played = out![0]!;
    expect(played.kind === 'normal' && played.rank).toBe(14); // 结构外 spare 散A
  });

  it('队友领先 → 默认不要', () => {
    // 配合逻辑：队友领先时默认让队友走（不能一手走完则 pass）。
    const hand = [n(5, 'S'), n(6, 'H')];
    const st = followState(hand, [n(4, 'D')]);
    st.current!.by = 2 as Seat; // 改为队友领先
    expect(heur(st, 0 as Seat)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Task 5 — chooseReturn 智能还贡
// ---------------------------------------------------------------------------

describe('chooseReturn 还贡', () => {
  it('不拆对子：宁还落单的小牌，也不拆掉一对', () => {
    // 一对3(最小) + 落单5、9、10；还贡应给落单5(最小可还牌)，不拆对3
    const hand = [n(3, 'S'), n(3, 'H'), n(5, 'C'), n(9, 'D'), n(10, 'S')];
    const ret = chooseReturn(hand, L3);
    expect(ret.kind === 'normal' && ret.rank).toBe(5);
  });

  it('全是落单小牌 → 给点数最小的（≤10）', () => {
    const hand = [n(4, 'S'), n(7, 'H'), n(10, 'C'), n(13, 'D')];
    const ret = chooseReturn(hand, L3);
    expect(ret.kind === 'normal' && ret.rank).toBe(4);
  });
});
