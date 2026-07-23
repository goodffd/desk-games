import { describe, it, expect } from 'vitest';
import { createDeal, play, pass, isDealOver, settle } from '../../src/games/gandengyan/engine/game';
import { makeDeck, dealHands } from '../../src/games/gandengyan/engine/cards';
import { chooseGandengyanPlay } from '../../src/games/gandengyan/ai/choose';
import { seededShuffle } from '../helpers/rng';
import type { Seat } from '../../src/games/gandengyan/engine/types';

/**
 * #16：settle 逐座明细（剩牌张数/王数/2数/春天/个人倍数/赔付）要能撑起结算表逐项展开。
 * 不硬钉具体数字（那是 golden 表的活、且钉中间字段会把测试焊在实现上），而是驱真实终局、
 * 逐座核对明细分量**自洽且乘得出 pay**、gain=各输家赔付之和——展开摆出来的每一乘都对得上。
 */
function playToEnd(seed: number): ReturnType<typeof createDeal> {
  const seatCount = 2 + (seed % 4);
  const dealer: Seat = seed % seatCount;
  const { hands, deck } = dealHands(makeDeck(), seatCount, dealer, seededShuffle(seed));
  let s = createDeal({ hands, deck, dealer });
  let guard = 0;
  while (!isDealOver(s) && guard++ < 2000) {
    const seat = s.turn;
    const pick = chooseGandengyanPlay({ hand: s.hands[seat]!, current: s.current?.combo ?? null, played: s.played, seatCount });
    s = pick === null ? pass(s, seat) : play(s, seat, pick.cards, pick.assign);
  }
  return s;
}

describe('#16 settle 逐座明细自洽', () => {
  it('多局终局：明细分量对得上、乘得出 pay、gain=输家赔付之和', () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = playToEnd(seed);
      const base = 1 + (seed % 3);               // 底分也换换，验它进不进乘法链
      const r = settle(s, base);

      expect(r.bombMultiplier, `seed=${seed} 炸弹倍数≠2^炸数`).toBe(2 ** r.bombsPlayed);
      expect(r.seats, `seed=${seed} 明细座数不对`).toHaveLength(s.hands.length);

      for (const d of r.seats) {
        const hand = s.hands[d.seat]!;
        const wild = hand.filter((c) => c.kind === 'joker').length;
        const two = hand.filter((c) => c.kind === 'normal' && c.rank === 2).length;
        const spring = !s.hasPlayed[d.seat];
        expect(d.handCount, `seed=${seed} 座${d.seat} 剩牌张数`).toBe(hand.length);
        expect(d.wildCount, `seed=${seed} 座${d.seat} 王数`).toBe(wild);
        expect(d.twoCount, `seed=${seed} 座${d.seat} 2 数`).toBe(two);
        expect(d.spring, `seed=${seed} 座${d.seat} 春天`).toBe(spring);
        // 个人倍数 = 每张王/2 各 ×2 · 春天 ×2，逐张相乘
        expect(d.personalMultiplier, `seed=${seed} 座${d.seat} 个人倍数`).toBe(2 ** (wild + two) * (spring ? 2 : 1));
        // 赔付：输家 = 底 × 剩张 × 炸弹倍 × 个人倍；赢家/僵局 = 0
        const isLoser = r.winner !== null && d.seat !== r.winner;
        expect(d.pay, `seed=${seed} 座${d.seat} 赔付乘不出来`)
          .toBe(isLoser ? base * d.handCount * r.bombMultiplier * d.personalMultiplier : 0);
      }

      expect(r.pay, `seed=${seed} pay 与明细不一致`).toEqual(r.seats.map((d) => d.pay));
      expect(r.gain, `seed=${seed} gain≠各输家赔付之和`).toBe(r.pay.reduce((a, b) => a + b, 0));
    }
  });
});
