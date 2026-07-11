import type { Card, Rank, Suit } from './types';

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** Build a fresh 108-card double deck (id 0..107). */
export function makeDeck(): Card[] {
  const cards: Card[] = [];
  let id = 0;

  // Two copies of the 52-card standard deck
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({ kind: 'normal', suit, rank, id: id++ });
      }
    }
  }

  // Two big jokers + two small jokers (last 4 ids: 104..107)
  cards.push({ kind: 'joker', big: false, id: id++ }); // 104 small
  cards.push({ kind: 'joker', big: true,  id: id++ }); // 105 big
  cards.push({ kind: 'joker', big: false, id: id++ }); // 106 small
  cards.push({ kind: 'joker', big: true,  id: id++ }); // 107 big

  return cards;
}

/**
 * Deal deck into 4 hands of 27.
 * @param shuffle injectable index permutation: given n, returns a permutation of [0..n-1]
 */
export function deal(deck: Card[], shuffle: (n: number) => number[]): Card[][] {
  const perm = shuffle(deck.length);
  const shuffled = perm.map(i => deck[i] as Card);

  const hands: Card[][] = [[], [], [], []];
  for (let i = 0; i < shuffled.length; i++) {   // 按实际牌数分发，不硬编码 108（防非 108 牌堆越界取 undefined）
    hands[i % 4]!.push(shuffled[i]!);
  }
  return hands;
}

/** 一张逢人配（红心级牌）？engine 唯一真相——wild/legal/match 统一 import 此处，勿各自复制。 */
export function isWild(c: Card, level: Rank): boolean {
  return c.kind === 'normal' && c.suit === 'H' && c.rank === level;
}

/**
 * Single-card rank value for ordering:
 * 3..14 (natural), level rank → 15, small joker → 16, big joker → 17.
 */
export function rankValue(c: Card, level: Rank): number {
  if (c.kind === 'joker') return c.big ? 17 : 16;
  if (c.rank === level) return 15;
  return c.rank;
}

/** Sort hand ascending by rankValue (stable, returns new array). */
export function sortHand(cards: Card[], level: Rank): Card[] {
  return [...cards].sort((a, b) => rankValue(a, level) - rankValue(b, level));
}

const RANK_STR: Record<number, string> = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
};

/** Debug string: e.g. S2 / HA / jB / jS */
export function cardStr(c: Card): string {
  if (c.kind === 'joker') return c.big ? 'jB' : 'jS';
  return `${c.suit}${RANK_STR[c.rank]}`;
}
