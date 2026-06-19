import { describe, it, expect } from 'vitest';
import { makeDeck, deal, rankValue, sortHand, cardStr } from '../src/games/guandan/engine/cards';
import type { Card, Rank } from '../src/games/guandan/engine/types';
import { LEVEL } from '../src/games/guandan/engine/types';

describe('makeDeck', () => {
  it('produces exactly 108 cards', () => {
    expect(makeDeck().length).toBe(108);
  });

  it('all ids are unique 0..107', () => {
    const deck = makeDeck();
    const ids = deck.map(c => c.id);
    expect(new Set(ids).size).toBe(108);
    expect(Math.min(...ids)).toBe(0);
    expect(Math.max(...ids)).toBe(107);
  });

  it('each normal suit+rank combination appears exactly 2 times', () => {
    const deck = makeDeck();
    const suits = ['S', 'H', 'D', 'C'] as const;
    const ranks: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    for (const suit of suits) {
      for (const rank of ranks) {
        const count = deck.filter(
          c => c.kind === 'normal' && c.suit === suit && c.rank === rank
        ).length;
        expect(count).toBe(2);
      }
    }
  });

  it('contains exactly 2 big jokers and 2 small jokers', () => {
    const deck = makeDeck();
    const bigJokers = deck.filter(c => c.kind === 'joker' && c.big === true);
    const smallJokers = deck.filter(c => c.kind === 'joker' && c.big === false);
    expect(bigJokers.length).toBe(2);
    expect(smallJokers.length).toBe(2);
  });
});

describe('deal', () => {
  // identity shuffle: returns [0,1,2,...,n-1]
  const identityShuffle = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

  it('deals 4 hands of 27 cards each', () => {
    const deck = makeDeck();
    const hands = deal(deck, identityShuffle);
    expect(hands.length).toBe(4);
    for (const hand of hands) {
      expect(hand.length).toBe(27);
    }
  });

  it('union of all 4 hands equals the full deck (all 108 card ids present)', () => {
    const deck = makeDeck();
    const hands = deal(deck, identityShuffle);
    const allIds = new Set(hands.flat().map(c => c.id));
    expect(allIds.size).toBe(108);
    for (let id = 0; id < 108; id++) {
      expect(allIds.has(id)).toBe(true);
    }
  });

  it('no card appears in more than one hand', () => {
    const deck = makeDeck();
    const hands = deal(deck, identityShuffle);
    const allIds = hands.flat().map(c => c.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe('rankValue', () => {
  const level: Rank = LEVEL; // 2

  it('returns 3..14 for normal ranks', () => {
    const ranks: Rank[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
    for (const rank of ranks) {
      const card: Card = { kind: 'normal', suit: 'S', rank, id: 0 };
      expect(rankValue(card, level)).toBe(rank);
    }
  });

  it('级牌(2) returns 15, greater than A(14)', () => {
    const levelCard: Card = { kind: 'normal', suit: 'S', rank: 2, id: 0 };
    const aceCard: Card = { kind: 'normal', suit: 'S', rank: 14, id: 1 };
    expect(rankValue(levelCard, level)).toBe(15);
    expect(rankValue(levelCard, level)).toBeGreaterThan(rankValue(aceCard, level));
  });

  it('小王 returns 16', () => {
    const smallJoker: Card = { kind: 'joker', big: false, id: 0 };
    expect(rankValue(smallJoker, level)).toBe(16);
  });

  it('大王 returns 17', () => {
    const bigJoker: Card = { kind: 'joker', big: true, id: 0 };
    expect(rankValue(bigJoker, level)).toBe(17);
  });

  it('ordering: 大王 > 小王 > 级牌 > A', () => {
    const bigJoker: Card = { kind: 'joker', big: true, id: 0 };
    const smallJoker: Card = { kind: 'joker', big: false, id: 1 };
    const levelCard: Card = { kind: 'normal', suit: 'S', rank: 2, id: 2 };
    const ace: Card = { kind: 'normal', suit: 'S', rank: 14, id: 3 };
    expect(rankValue(bigJoker, level)).toBeGreaterThan(rankValue(smallJoker, level));
    expect(rankValue(smallJoker, level)).toBeGreaterThan(rankValue(levelCard, level));
    expect(rankValue(levelCard, level)).toBeGreaterThan(rankValue(ace, level));
  });
});

describe('sortHand', () => {
  const level: Rank = LEVEL; // 2

  it('sorts cards in ascending order by rankValue', () => {
    const cards: Card[] = [
      { kind: 'joker', big: true, id: 0 },
      { kind: 'normal', suit: 'S', rank: 5, id: 1 },
      { kind: 'joker', big: false, id: 2 },
      { kind: 'normal', suit: 'H', rank: 2, id: 3 }, // level card
      { kind: 'normal', suit: 'S', rank: 14, id: 4 }, // A
    ];
    const sorted = sortHand(cards, level);
    const values = sorted.map(c => rankValue(c, level));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]!);
    }
  });

  it('returns a new array (does not mutate input)', () => {
    const cards: Card[] = [
      { kind: 'normal', suit: 'S', rank: 10, id: 0 },
      { kind: 'normal', suit: 'H', rank: 3, id: 1 },
    ];
    const original = [...cards];
    sortHand(cards, level);
    expect(cards[0]!.id).toBe(original[0]!.id);
  });
});

describe('cardStr', () => {
  it('formats normal cards as SuitRank (e.g. S2, HA, DJ)', () => {
    const c1: Card = { kind: 'normal', suit: 'S', rank: 2, id: 0 };
    expect(cardStr(c1)).toBe('S2');

    const c2: Card = { kind: 'normal', suit: 'H', rank: 14, id: 1 };
    expect(cardStr(c2)).toBe('HA');

    const c3: Card = { kind: 'normal', suit: 'D', rank: 11, id: 2 };
    expect(cardStr(c3)).toBe('DJ');

    const c4: Card = { kind: 'normal', suit: 'C', rank: 12, id: 3 };
    expect(cardStr(c4)).toBe('CQ');

    const c5: Card = { kind: 'normal', suit: 'S', rank: 13, id: 4 };
    expect(cardStr(c5)).toBe('SK');
  });

  it('formats jokers as jB (big) and jS (small)', () => {
    const bigJoker: Card = { kind: 'joker', big: true, id: 0 };
    expect(cardStr(bigJoker)).toBe('jB');

    const smallJoker: Card = { kind: 'joker', big: false, id: 1 };
    expect(cardStr(smallJoker)).toBe('jS');
  });
});
