import type { Card, Rank, Suit } from '../../src/games/gandengyan/engine/types';

/**
 * 干瞪眼测试的造牌工具。
 * 每张牌拿一个自增 id，保证同一组里 id 不撞（引擎按 id 认牌）。
 */
let nextId = 0;

const SUITS: Record<string, Suit> = { S: 'S', H: 'H', D: 'D', C: 'C' };
const RANKS: Record<string, Rank> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
};

/** 一张普通牌：`n('S', 5)` */
export function n(suit: Suit, rank: Rank): Card {
  return { kind: 'normal', suit, rank, id: nextId++ };
}

/** 大王 / 小王 */
export function jokerBig(): Card { return { kind: 'joker', big: true, id: nextId++ }; }
export function jokerSmall(): Card { return { kind: 'joker', big: false, id: nextId++ }; }

/**
 * 牌串 DSL —— 让测试读起来像牌桌上的话。
 *
 *   cards('S5 H5')      → 一对 5
 *   cards('S3 H4 D5')   → 顺子 345
 *   cards('SQ SK SA')   → 顶格顺子
 *   cards('jB jS')      → 大王 + 小王
 *
 * 花色 S/H/D/C，点数 2..9 + T(10) J Q K A；`jB` `jS` 是大小王。
 */
export function cards(spec: string): Card[] {
  return spec.trim().split(/\s+/).filter(Boolean).map((tok) => {
    if (tok === 'jB') return jokerBig();
    if (tok === 'jS') return jokerSmall();
    const suit = SUITS[tok[0]!];
    const rank = RANKS[tok.slice(1)!];
    if (!suit || !rank) throw new Error(`看不懂的牌：${tok}`);
    return n(suit, rank);
  });
}

/** 调试用：把一手牌印成 'S5 H5' 这样 */
export function show(cs: readonly Card[]): string {
  const R: Record<number, string> = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  return cs.map((c) => (c.kind === 'joker' ? (c.big ? 'jB' : 'jS') : `${c.suit}${R[c.rank] ?? c.rank}`)).join(' ');
}
