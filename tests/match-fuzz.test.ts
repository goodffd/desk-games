/**
 * match-fuzz.test.ts — 整盘自对局模糊测试（二期）。
 *
 * 每盘：从 startMatch 开打，逐局发牌 → 进贡/还贡(autoReturn) → AI 自对局打完单局 →
 * settleDeal 升级/打A过A → 直到某队过A收盘。断言：
 *   1. 进贡后 108 守恒、各家仍 27 张。
 *   2. 单局名次是 0..3 的排列、不超步数(无死循环)。
 *   3. 两队级别恒在 2..14。
 *   4. 整盘在上限局数内收盘、winner ∈ {0,1}。
 *
 * 种子化确定性 shuffle，失败可复现。
 */

import { describe, it, expect } from 'vitest';
import { makeDeck, deal } from '../src/games/guandan/engine/cards';
import { createDeal, play, pass, isDealOver, ranking } from '../src/games/guandan/engine/game';
import { isLegalPlay } from '../src/games/guandan/engine/legal';
import { choosePlay } from '../src/games/guandan/ai/ai';
import {
  startMatch, settleDeal, planTribute, autoReturn, applyTribute, dealLevel,
} from '../src/games/guandan/engine/match';
import { makeLCG, seededShuffle } from './helpers/rng';
import type { Card, Rank, Seat } from '../src/games/guandan/engine/types';

/** AI 自对局把一局打完，返回名次（头→末）。带合法性 + 步数守卫。 */
function playDealToEnd(hands: Card[][], firstLeader: Seat, level: Rank, label: string): Seat[] {
  let s = createDeal(hands, firstLeader, level);
  let step = 0;
  while (!isDealOver(s)) {
    if (++step > 3000) throw new Error(`${label}: 单局超 3000 步未结束(疑死循环)`);
    const seat = s.turn;
    const prev = s.current?.combo ?? null;
    const chosen = choosePlay(s, seat);
    if (chosen !== null) {
      if (!isLegalPlay(chosen, prev, s.hands[seat]!, level)) throw new Error(`${label} step=${step}: AI 出非法牌`);
      s = play(s, seat, chosen);
    } else {
      if (s.current === null) throw new Error(`${label} step=${step}: 自由领出却 pass`);
      s = pass(s, seat);
    }
  }
  return ranking(s);
}

const NUM_MATCHES = 50;
const MAX_DEALS = 400;

describe('match fuzz: 整盘自对局', () => {
  it(`打完 ${NUM_MATCHES} 整盘，全程守恒/收敛`, () => {
    for (let seed = 0; seed < NUM_MATCHES; seed++) {
      let m = startMatch();
      let lastFinished: Seat[] | null = null;
      let dealCount = 0;

      while (!m.over) {
        if (++dealCount > MAX_DEALS) {
          throw new Error(`整盘 seed=${seed} ${MAX_DEALS} 局未收盘(疑卡死)；levels=${m.levels}`);
        }
        const level = dealLevel(m);
        let hands = deal(makeDeck(), seededShuffle(seed * 10007 + dealCount));
        let firstLeader: Seat;

        if (lastFinished === null) {
          firstLeader = (makeLCG(seed + 0xbeef)() % 4) as Seat; // 首局随机首攻
        } else {
          const plan = planTribute(lastFinished, hands, level);
          const returns = plan.exchanges.map(ex => autoReturn(hands[ex.receiver]!, level));
          hands = applyTribute(hands, plan, returns);
          firstLeader = plan.firstLeader;
        }

        // 守恒：进贡后仍 108 张、各家 27、id 不重不漏
        const flat = hands.flat();
        expect(flat.length).toBe(108);
        for (const h of hands) expect(h.length).toBe(27);
        expect(new Set(flat.map(c => c.id)).size).toBe(108);

        const finished = playDealToEnd(hands, firstLeader, level, `seed=${seed} deal=${dealCount}`);
        expect([...finished].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);

        const r = settleDeal(m, finished);
        m = r.match;
        for (const lv of m.levels) {
          expect(lv).toBeGreaterThanOrEqual(2);
          expect(lv).toBeLessThanOrEqual(14);
        }
        lastFinished = finished;
      }

      expect(m.over).toBe(true);
      expect(m.winner === 0 || m.winner === 1).toBe(true);
    }
  });
});
