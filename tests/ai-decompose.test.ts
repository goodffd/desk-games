import { describe, it, expect } from 'vitest';
import { decompose } from '../src/games/guandan/ai/decompose';
import type { Card, Rank, Suit } from '../src/games/guandan/engine/types';

let nextId = 1;
// Adapted: Card is a union type; normal cards need `kind: 'normal'`
function card(rank: number, suit: Suit): Card {
  return { kind: 'normal', id: nextId++, rank: rank as Rank, suit };
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
