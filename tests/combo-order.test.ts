/**
 * 出牌区展示排序 sortComboCards 单测。
 * 重点：① 顺子含级牌时级牌归自然位（打7时 56789 不再显示成 56897）；
 *       ② 同点数按花色 D→C→H→S；③ 三带二三同在前。
 */
import { describe, it, expect } from 'vitest';
import { sortComboCards } from '../src/games/guandan/ui/combo-order';
import type { Card, Rank, Suit } from '../src/games/guandan/engine/types';

let idc = 0;
const n = (rank: Rank, suit: Suit): Card => ({ kind: 'normal', suit, rank, id: idc++ });
const ranks = (out: Card[]): number[] => out.map(c => (c.kind === 'normal' ? c.rank : (c.big ? 99 : 98)));
const suits = (out: Card[]): string[] => out.map(c => (c.kind === 'normal' ? c.suit : 'JOKER'));

describe('sortComboCards', () => {
  it('打 7：顺子 5-6-7-8-9 级牌 7 归自然位（非 5-6-8-9-7）', () => {
    const shuffled = [n(9, 'S'), n(5, 'S'), n(7, 'D'), n(8, 'C'), n(6, 'H')]; // 乱序含级牌7
    const out = sortComboCards(shuffled, 7 as Rank);
    expect(ranks(out)).toEqual([5, 6, 7, 8, 9]);
  });

  it('打 2：顺子 5-6-7-8-9 正常升序', () => {
    const shuffled = [n(8, 'S'), n(5, 'D'), n(9, 'H'), n(6, 'C'), n(7, 'S')];
    expect(ranks(sortComboCards(shuffled, 2 as Rank))).toEqual([5, 6, 7, 8, 9]);
  });

  it('同点数按花色 S→H→C→D（左→右，同手牌区自下而上）', () => {
    const bomb = [n(8, 'D'), n(8, 'C'), n(8, 'S'), n(8, 'H')]; // 四个8乱序
    expect(suits(sortComboCards(bomb, 2 as Rank))).toEqual(['S', 'H', 'C', 'D']);
  });

  it('三带二：三同在前、对子在后', () => {
    const out = sortComboCards([n(5, 'S'), n(9, 'H'), n(5, 'D'), n(9, 'S'), n(5, 'C')], 2 as Rank);
    // 三个5(大组)在前，两个9在后
    expect(ranks(out)).toEqual([5, 5, 5, 9, 9]);
  });

  it('连对 5-5-6-6-7-7 按点数升序 + 同点花色升序', () => {
    const out = sortComboCards([n(7, 'H'), n(5, 'C'), n(6, 'S'), n(5, 'D'), n(7, 'D'), n(6, 'H')], 2 as Rank);
    expect(ranks(out)).toEqual([5, 5, 6, 6, 7, 7]);
    expect(suits(out.slice(0, 2))).toEqual(['C', 'D']); // 两个5：S→H→C→D，5C 在 5D 前
  });
});
