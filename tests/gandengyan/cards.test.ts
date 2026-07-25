import { describe, it, expect } from 'vitest';
import { makeDeck, dealHands, firstDealer, nextDealer, sortHand, sortForDisplay } from '../../src/games/gandengyan/engine/cards';
import { seededShuffle } from '../helpers/rng';
import { cards } from './mk';

describe('makeDeck — 一副 54 张', () => {
  it('54 张：52 张普通牌 + 大小王各一', () => {
    const deck = makeDeck();
    expect(deck).toHaveLength(54);
    expect(deck.filter((c) => c.kind === 'normal')).toHaveLength(52);
    expect(deck.filter((c) => c.kind === 'joker' && c.big)).toHaveLength(1);
    expect(deck.filter((c) => c.kind === 'joker' && !c.big)).toHaveLength(1);
  });

  it('id 唯一且是 0..53', () => {
    const ids = makeDeck().map((c) => c.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 54 }, (_, i) => i));
  });

  it('四门花色各 13 张，每个点数各 4 张', () => {
    const deck = makeDeck().filter((c) => c.kind === 'normal');
    for (const s of ['S', 'H', 'D', 'C']) {
      expect(deck.filter((c) => c.kind === 'normal' && c.suit === s)).toHaveLength(13);
    }
    for (let r = 2; r <= 14; r++) {
      expect(deck.filter((c) => c.kind === 'normal' && c.rank === r)).toHaveLength(4);
    }
  });
});

describe('dealHands — 庄 6 张、其余各 5 张，剩下的进牌堆', () => {
  it.each([2, 3, 4, 5])('%i 人局：庄 6 张、闲 5 张，牌堆吃掉余下的', (seatCount) => {
    const dealer = 1 % seatCount;
    const { hands, deck } = dealHands(makeDeck(), seatCount, dealer, seededShuffle(42));

    expect(hands).toHaveLength(seatCount);
    for (let s = 0; s < seatCount; s++) {
      expect(hands[s]).toHaveLength(s === dealer ? 6 : 5);
    }
    const dealt = 6 + 5 * (seatCount - 1);
    expect(deck).toHaveLength(54 - dealt);
  });

  it('发出去的牌 + 牌堆 = 原来那 54 张，不重不漏', () => {
    const { hands, deck } = dealHands(makeDeck(), 5, 0, seededShuffle(7));
    const ids = [...hands.flat(), ...deck].map((c) => c.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 54 }, (_, i) => i));
  });

  it('同一个种子发出同一副牌（可复现）', () => {
    const a = dealHands(makeDeck(), 4, 0, seededShuffle(99));
    const b = dealHands(makeDeck(), 4, 0, seededShuffle(99));
    expect(a.hands.map((h) => h.map((c) => c.id))).toEqual(b.hands.map((h) => h.map((c) => c.id)));
    expect(a.deck.map((c) => c.id)).toEqual(b.deck.map((c) => c.id));
  });

  it('人数越界直接抛错，不静默发出一副怪牌', () => {
    for (const bad of [0, 1, 6, 2.5]) {
      expect(() => dealHands(makeDeck(), bad, 0, seededShuffle(1))).toThrow(/人数/);
    }
  });

  it('庄的座位号越界也抛错', () => {
    expect(() => dealHands(makeDeck(), 3, 3, seededShuffle(1))).toThrow(/庄/);
    expect(() => dealHands(makeDeck(), 3, -1, seededShuffle(1))).toThrow(/庄/);
  });
});

describe('firstDealer — 首局庄随机（随机源注入，引擎自己不摇骰子）', () => {
  it('落在 0..seatCount-1 内', () => {
    for (const seatCount of [2, 3, 4, 5]) {
      for (let r = 0; r < 20; r++) {
        const seat = firstDealer(seatCount, () => r);
        expect(seat).toBeGreaterThanOrEqual(0);
        expect(seat).toBeLessThan(seatCount);
      }
    }
  });

  it('同一个随机源给出同一个庄（可复现）', () => {
    expect(firstDealer(5, () => 12345)).toBe(firstDealer(5, () => 12345));
  });

  it('随机源取遍时每个座位都可能当庄', () => {
    const seen = new Set(Array.from({ length: 50 }, (_, r) => firstDealer(4, () => r)));
    expect(seen.size).toBe(4);
  });
});

describe('nextDealer — 之后每局的庄是上一局的赢家', () => {
  it('上局谁赢谁当庄', () => {
    for (const winner of [0, 1, 2, 3, 4]) expect(nextDealer(winner)).toBe(winner);
  });
});

describe('sortHand — 手牌排序：2 排在 A 之上，王排最后', () => {
  it('按权重升序，2 在 A 之后', () => {
    const sorted = sortHand(cards('S2 H3 DA CK jB jS SJ'));
    expect(sorted.map((c) => (c.kind === 'joker' ? (c.big ? 'jB' : 'jS') : String(c.rank))))
      .toEqual(['3', '11', '13', '14', '2', 'jS', 'jB']);
  });

  it('不改原数组', () => {
    const hand = cards('SA H3');
    const before = hand.map((c) => c.id);
    sortHand(hand);
    expect(hand.map((c) => c.id)).toEqual(before);
  });

  it('同点数按 黑桃 → 红心 → 梅花 → 方块（左→右）', () => {
    // 故意打乱着传进去，出来必须是 S H C D
    const sorted = sortHand(cards('D7 C7 H7 S7'));
    expect(sorted.map((c) => (c.kind === 'joker' ? 'j' : c.suit))).toEqual(['S', 'H', 'C', 'D']);
  });

  it('点数优先于花色：方块 5 仍排在黑桃 7 前面', () => {
    const sorted = sortHand(cards('S7 D5'));
    expect(sorted.map((c) => (c.kind === 'joker' ? 'j' : `${c.suit}${c.rank}`))).toEqual(['D5', 'S7']);
  });
});

describe('sortForDisplay — 出牌区：王按被指派的点数入序', () => {
  it('当 6 使的王站进 5 与 7 中间，不被甩到末尾', () => {
    const hand = cards('S5 S7');
    const joker = cards('jB')[0]!;
    const play = [hand[1]!, joker, hand[0]!];   // 乱序传入：7、王、5
    const shown = sortForDisplay(play, (c) => (c.kind === 'joker' ? 6 : null));
    expect(shown.map((c) => (c.kind === 'joker' ? '王(=6)' : `${c.suit}${c.rank}`)))
      .toEqual(['S5', '王(=6)', 'S7']);
  });

  it('不传 assignOf 时王仍按"最大"排最后（手牌用法不变）', () => {
    const shown = sortForDisplay(cards('jB S5 S7'));
    expect(shown.map((c) => (c.kind === 'joker' ? '王' : `${c.suit}${c.rank}`)))
      .toEqual(['S5', 'S7', '王']);
  });
});
