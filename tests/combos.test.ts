import { describe, it, expect } from 'vitest';
import { identify, beats, bombPower } from '../src/games/guandan/engine/combos';
import type { Card, Rank, Suit, Combo } from '../src/games/guandan/engine/types';
import { LEVEL } from '../src/games/guandan/engine/types';

const L: Rank = LEVEL; // 2

// --- card construction helpers (ids must be unique within a combo) ---
let _id = 0;
function n(suit: Suit, rank: Rank): Card {
  return { kind: 'normal', suit, rank, id: _id++ };
}
function jb(): Card { return { kind: 'joker', big: true, id: _id++ }; }
function js(): Card { return { kind: 'joker', big: false, id: _id++ }; }

// Build a run of normal cards from a list of [suit, rank] pairs.
function cards(...specs: Array<[Suit, Rank]>): Card[] {
  return specs.map(([s, r]) => n(s, r));
}

// ---------------------------------------------------------------------------
describe('identify: single', () => {
  it('a lone card → single, key=rankValue', () => {
    const c = identify([n('S', 5)], L)!;
    expect(c).not.toBeNull();
    expect(c.type).toBe('single');
    expect(c.length).toBe(1);
    expect(c.key).toBe(5);
    expect(c.power).toBe(0);
  });

  it('lone level card (2) → single key=15', () => {
    const c = identify([n('S', 2)], L)!;
    expect(c.type).toBe('single');
    expect(c.key).toBe(15);
  });

  it('lone A → single key=14', () => {
    const c = identify([n('S', 14)], L)!;
    expect(c.type).toBe('single');
    expect(c.key).toBe(14);
  });

  it('lone small joker → single key=16', () => {
    const c = identify([js()], L)!;
    expect(c.type).toBe('single');
    expect(c.key).toBe(16);
  });

  it('lone big joker → single key=17', () => {
    const c = identify([jb()], L)!;
    expect(c.type).toBe('single');
    expect(c.key).toBe(17);
  });

  it('empty array → null', () => {
    expect(identify([], L)).toBeNull();
  });
});

describe('identify: pair', () => {
  it('two same-rank → pair key=5', () => {
    const c = identify([n('S', 5), n('H', 5)], L)!;
    expect(c.type).toBe('pair');
    expect(c.length).toBe(2);
    expect(c.key).toBe(5);
  });

  it('pair of level cards → key=15', () => {
    const c = identify([n('S', 2), n('H', 2)], L)!;
    expect(c.type).toBe('pair');
    expect(c.key).toBe(15);
  });

  it('two different ranks → null', () => {
    expect(identify([n('S', 5), n('H', 6)], L)).toBeNull();
  });

  it('two big jokers → pair key=17 (对大王，owner ruling 2026-06-21)', () => {
    const c = identify([jb(), jb()], L)!;
    expect(c.type).toBe('pair');
    expect(c.key).toBe(17);
  });

  it('two small jokers → pair key=16 (对小王)', () => {
    const c = identify([js(), js()], L)!;
    expect(c.type).toBe('pair');
    expect(c.key).toBe(16);
  });

  it('one joker + one normal → null', () => {
    expect(identify([jb(), n('S', 5)], L)).toBeNull();
  });

  it('big joker + small joker → null (一大一小不算对)', () => {
    expect(identify([jb(), js()], L)).toBeNull();
  });
});

describe('identify: triple', () => {
  it('three same-rank → triple key=7', () => {
    const c = identify(cards(['S', 7], ['H', 7], ['D', 7]), L)!;
    expect(c.type).toBe('triple');
    expect(c.length).toBe(3);
    expect(c.key).toBe(7);
  });

  it('three with one different → null', () => {
    expect(identify(cards(['S', 7], ['H', 7], ['D', 8]), L)).toBeNull();
  });
});

describe('identify: tripleWithPair (三带二)', () => {
  it('333 + 22 → tripleWithPair key=3', () => {
    const c = identify(cards(['S', 3], ['H', 3], ['D', 3], ['S', 2], ['H', 2]), L)!;
    expect(c.type).toBe('tripleWithPair');
    expect(c.length).toBe(5);
    expect(c.key).toBe(3); // triple's natural point rankValue is 3
  });

  it('333 + 44 (the pair part is a real pair) → OK key=3', () => {
    const c = identify(cards(['S', 3], ['H', 3], ['D', 3], ['S', 4], ['H', 4]), L)!;
    expect(c.type).toBe('tripleWithPair');
    expect(c.key).toBe(3);
  });

  it('333 + 2 (only 4 cards, no pair) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['D', 3], ['S', 2]), L)).toBeNull();
  });

  it('333 + 45 (kicker not a pair) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['D', 3], ['S', 4], ['H', 5]), L)).toBeNull();
  });

  it('33 + 444 → tripleWithPair key=4 (triple is the 444)', () => {
    const c = identify(cards(['S', 3], ['H', 3], ['S', 4], ['H', 4], ['D', 4]), L)!;
    expect(c.type).toBe('tripleWithPair');
    expect(c.key).toBe(4);
  });

  it('three pairs of same length but not 3+2 (22 333 vs ...) duplicate rank guard', () => {
    // 33333 is a bomb (5 of a kind), not a tripleWithPair
    const c = identify(cards(['S', 3], ['H', 3], ['D', 3], ['C', 3], ['S', 3]), L)!;
    expect(c.type).toBe('bomb');
  });
});

describe('identify: straight (顺子)', () => {
  it('3 4 5 6 7 → straight key=7', () => {
    const c = identify(cards(['S', 3], ['H', 4], ['D', 5], ['C', 6], ['S', 7]), L)!;
    expect(c.type).toBe('straight');
    expect(c.length).toBe(5);
    expect(c.key).toBe(7);
    expect(c.power).toBe(0);
  });

  it('A 2 3 4 5 → straight key=5 (A low, natural)', () => {
    const c = identify(cards(['S', 14], ['H', 2], ['D', 3], ['C', 4], ['S', 5]), L)!;
    expect(c.type).toBe('straight');
    expect(c.key).toBe(5);
  });

  it('10 J Q K A → straight key=14 (A high)', () => {
    const c = identify(cards(['S', 10], ['H', 11], ['D', 12], ['C', 13], ['S', 14]), L)!;
    expect(c.type).toBe('straight');
    expect(c.key).toBe(14);
  });

  it('level card 2 participates by NATURAL point (A2345 uses 2 as 2)', () => {
    // 2 3 4 5 6 → straight key=6 (the 2 here is natural rank 2, not 15)
    const c = identify(cards(['S', 2], ['H', 3], ['D', 4], ['C', 5], ['S', 6]), L)!;
    expect(c.type).toBe('straight');
    expect(c.key).toBe(6);
  });

  it('J Q K A 2 (2 not naturally consecutive after A) → null', () => {
    expect(identify(cards(['S', 11], ['H', 12], ['D', 13], ['C', 14], ['S', 2]), L)).toBeNull();
  });

  it('length 4 (3456) → null', () => {
    expect(identify(cards(['S', 3], ['H', 4], ['D', 5], ['C', 6]), L)).toBeNull();
  });

  it('length 6 (345678) → null (not a straight type)', () => {
    expect(identify(cards(['S', 3], ['H', 4], ['D', 5], ['C', 6], ['S', 7], ['H', 8]), L)).toBeNull();
  });

  it('with a duplicate rank (3 3 4 5 6) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['D', 4], ['C', 5], ['S', 6]), L)).toBeNull();
  });

  it('contains a joker → not a straight (null here, 4 normals + joker)', () => {
    expect(identify([n('S', 3), n('H', 4), n('D', 5), n('C', 6), jb()], L)).toBeNull();
  });

  it('non-flush mixed suits stays a plain straight, not straightFlush', () => {
    const c = identify(cards(['S', 3], ['H', 4], ['D', 5], ['C', 6], ['S', 7]), L)!;
    expect(c.type).toBe('straight');
  });
});

describe('identify: consecPairs (连对 / 木板)', () => {
  it('33 44 55 → consecPairs key=5', () => {
    const c = identify(cards(['S', 3], ['H', 3], ['S', 4], ['H', 4], ['S', 5], ['H', 5]), L)!;
    expect(c.type).toBe('consecPairs');
    expect(c.length).toBe(6);
    expect(c.key).toBe(5);
  });

  it('A 2 3 wrap-around (AA 22 33) → null (no cross-cycle)', () => {
    expect(identify(cards(['S', 14], ['H', 14], ['S', 2], ['H', 2], ['S', 3], ['H', 3]), L)).toBeNull();
  });

  it('QQ KK AA → consecPairs key=14', () => {
    const c = identify(cards(['S', 12], ['H', 12], ['S', 13], ['H', 13], ['S', 14], ['H', 14]), L)!;
    expect(c.type).toBe('consecPairs');
    expect(c.key).toBe(14);
  });

  it('33 44 5 (only 5 cards) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['S', 4], ['H', 4], ['S', 5]), L)).toBeNull();
  });

  it('33 44 66 (gap, not consecutive) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['S', 4], ['H', 4], ['S', 6], ['H', 6]), L)).toBeNull();
  });

  it('only 2 pairs (33 44, 4 cards) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['S', 4], ['H', 4]), L)).toBeNull();
  });

  it('22 33 44 → consecPairs key=4 (2 by natural point, no A-low wrap involved)', () => {
    const c = identify(cards(['S', 2], ['H', 2], ['S', 3], ['H', 3], ['S', 4], ['H', 4]), L)!;
    expect(c.type).toBe('consecPairs');
    expect(c.key).toBe(4);
  });

  it('KK AA 22 (K-A-2 wrap) → null', () => {
    expect(identify(cards(['S', 13], ['H', 13], ['S', 14], ['H', 14], ['S', 2], ['H', 2]), L)).toBeNull();
  });

  it('33 44 56 (not all pairs) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['S', 4], ['H', 4], ['S', 5], ['H', 6]), L)).toBeNull();
  });
});

describe('identify: consecTriples (钢板)', () => {
  it('333 444 → consecTriples key=4', () => {
    const c = identify(cards(['S', 3], ['H', 3], ['D', 3], ['S', 4], ['H', 4], ['D', 4]), L)!;
    expect(c.type).toBe('consecTriples');
    expect(c.length).toBe(6);
    expect(c.key).toBe(4);
  });

  it('KKK AAA → consecTriples key=14', () => {
    const c = identify(cards(['S', 13], ['H', 13], ['D', 13], ['S', 14], ['H', 14], ['D', 14]), L)!;
    expect(c.type).toBe('consecTriples');
    expect(c.key).toBe(14);
  });

  it('333 44 5 (not two triples) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['D', 3], ['S', 4], ['H', 4], ['D', 5]), L)).toBeNull();
  });

  it('AA 22 wrap (AAA 222) → null (no cross-cycle)', () => {
    expect(identify(cards(['S', 14], ['H', 14], ['D', 14], ['S', 2], ['H', 2], ['D', 2]), L)).toBeNull();
  });

  it('333 555 (gap) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['D', 3], ['S', 5], ['H', 5], ['D', 5]), L)).toBeNull();
  });
});

describe('identify: bomb (炸弹)', () => {
  it('5555 → bomb (4 of a kind) key=5', () => {
    const c = identify(cards(['S', 5], ['H', 5], ['D', 5], ['C', 5]), L)!;
    expect(c.type).toBe('bomb');
    expect(c.length).toBe(4);
    expect(c.key).toBe(5);
    expect(c.power).toBe(bombPower(c));
  });

  it('55555 → bomb (5 of a kind)', () => {
    const c = identify(cards(['S', 5], ['H', 5], ['D', 5], ['C', 5], ['S', 5]), L)!;
    expect(c.type).toBe('bomb');
    expect(c.length).toBe(5);
    expect(c.key).toBe(5);
  });

  it('6 of a kind, 7 of a kind, 8 of a kind all bombs', () => {
    const b6 = identify(cards(['S', 9], ['H', 9], ['D', 9], ['C', 9], ['S', 9], ['H', 9]), L)!;
    expect(b6.type).toBe('bomb');
    expect(b6.length).toBe(6);
    const b7 = identify(cards(['S', 9], ['H', 9], ['D', 9], ['C', 9], ['S', 9], ['H', 9], ['D', 9]), L)!;
    expect(b7.type).toBe('bomb');
    expect(b7.length).toBe(7);
    const b8 = identify(cards(['S', 9], ['H', 9], ['D', 9], ['C', 9], ['S', 9], ['H', 9], ['D', 9], ['C', 9]), L)!;
    expect(b8.type).toBe('bomb');
    expect(b8.length).toBe(8);
  });

  it('bomb of level cards (2222) key=15', () => {
    const c = identify(cards(['S', 2], ['H', 2], ['D', 2], ['C', 2]), L)!;
    expect(c.type).toBe('bomb');
    expect(c.key).toBe(15);
  });
});

describe('identify: straightFlush (同花顺)', () => {
  it('♠ 3 4 5 6 7 → straightFlush key=7', () => {
    const c = identify(cards(['S', 3], ['S', 4], ['S', 5], ['S', 6], ['S', 7]), L)!;
    expect(c.type).toBe('straightFlush');
    expect(c.length).toBe(5);
    expect(c.key).toBe(7);
    expect(c.power).toBe(bombPower(c));
  });

  it('♠ A 2 3 4 5 → straightFlush key=5 (A low)', () => {
    const c = identify(cards(['S', 14], ['S', 2], ['S', 3], ['S', 4], ['S', 5]), L)!;
    expect(c.type).toBe('straightFlush');
    expect(c.key).toBe(5);
  });

  it('♠ 10 J Q K A → straightFlush key=14', () => {
    const c = identify(cards(['S', 10], ['S', 11], ['S', 12], ['S', 13], ['S', 14]), L)!;
    expect(c.type).toBe('straightFlush');
    expect(c.key).toBe(14);
  });

  it('mixed suit consecutive (♠34567 but one is ♥) → plain straight not straightFlush', () => {
    const c = identify([n('S', 3), n('H', 4), n('S', 5), n('S', 6), n('S', 7)], L)!;
    expect(c.type).toBe('straight');
  });

  it('same suit but not consecutive (♠ 3 4 5 6 8) → null', () => {
    expect(identify(cards(['S', 3], ['S', 4], ['S', 5], ['S', 6], ['S', 8]), L)).toBeNull();
  });
});

describe('identify: kingBomb (四大天王)', () => {
  it('2 big + 2 small → kingBomb', () => {
    const c = identify([jb(), jb(), js(), js()], L)!;
    expect(c.type).toBe('kingBomb');
    expect(c.length).toBe(4);
    expect(c.power).toBe(bombPower(c));
  });

  it('4 big jokers → NOT a kingBomb (null)', () => {
    expect(identify([jb(), jb(), jb(), jb()], L)).toBeNull();
  });

  it('3 jokers (2 big 1 small) → null', () => {
    expect(identify([jb(), jb(), js()], L)).toBeNull();
  });

  it('2 big + 2 small + extra → null', () => {
    expect(identify([jb(), jb(), js(), js(), js()], L)).toBeNull();
  });

  it('1 big + 3 small → null', () => {
    expect(identify([jb(), js(), js(), js()], L)).toBeNull();
  });
});

describe('identify: garbage / illegal combinations → null', () => {
  it('two mismatched cards → null', () => {
    expect(identify([n('S', 5), n('H', 6)], L)).toBeNull();
  });
  it('mixed garbage of 5 cards → null', () => {
    expect(identify(cards(['S', 3], ['H', 5], ['D', 8], ['C', 11], ['S', 13]), L)).toBeNull();
  });
  it('triple + single (333 4) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['D', 3], ['S', 4]), L)).toBeNull();
  });
  it('two pairs that are not consecutive triples/pairs (33 44 of len 4) → null', () => {
    expect(identify(cards(['S', 3], ['H', 3], ['S', 4], ['H', 4]), L)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// beats
// ---------------------------------------------------------------------------
function id(cs: Card[]): Combo {
  const c = identify(cs, L);
  if (!c) throw new Error('expected a valid combo in test setup');
  return c;
}

describe('beats: same type / same length compares key', () => {
  it('66 beats 55', () => {
    const a = id([n('S', 6), n('H', 6)]);
    const b = id([n('S', 5), n('H', 5)]);
    expect(beats(a, b)).toBe(true);
    expect(beats(b, a)).toBe(false);
  });

  it('equal key does NOT beat (55 vs 55)', () => {
    const a = id([n('S', 5), n('H', 5)]);
    const b = id([n('D', 5), n('C', 5)]);
    expect(beats(a, b)).toBe(false);
  });

  it('straight 4-8 beats straight 3-7', () => {
    const a = id(cards(['S', 4], ['H', 5], ['D', 6], ['C', 7], ['S', 8]));
    const b = id(cards(['S', 3], ['H', 4], ['D', 5], ['C', 6], ['S', 7]));
    expect(beats(a, b)).toBe(true);
  });

  it('single A beats single K', () => {
    const a = id([n('S', 14)]);
    const b = id([n('H', 13)]);
    expect(beats(a, b)).toBe(true);
  });

  it('对大王(17) beats 对小王(16)', () => {
    expect(beats(id([jb(), jb()]), id([js(), js()]))).toBe(true);
    expect(beats(id([js(), js()]), id([jb(), jb()]))).toBe(false);
  });

  it('对小王(16) beats 对级牌(15) 与 对A(14)', () => {
    expect(beats(id([js(), js()]), id([n('S', 2), n('H', 2)]))).toBe(true);
    expect(beats(id([js(), js()]), id([n('S', 14), n('H', 14)]))).toBe(true);
  });
});

describe('beats: different type or length is incomparable (non-bombs)', () => {
  it('pair cannot beat single (different type)', () => {
    const a = id([n('S', 9), n('H', 9)]);
    const b = id([n('S', 5)]);
    expect(beats(a, b)).toBe(false);
  });

  it('straight cannot beat consecPairs (different type, both len) ', () => {
    const a = id(cards(['S', 3], ['H', 4], ['D', 5], ['C', 6], ['S', 7]));
    const b = id(cards(['S', 3], ['H', 3], ['S', 4], ['H', 4], ['S', 5], ['H', 5]));
    expect(beats(a, b)).toBe(false);
    expect(beats(b, a)).toBe(false);
  });

  it('triple cannot beat pair', () => {
    const a = id(cards(['S', 9], ['H', 9], ['D', 9]));
    const b = id([n('S', 5), n('H', 5)]);
    expect(beats(a, b)).toBe(false);
  });
});

describe('beats: bombs beat all non-bombs', () => {
  it('5555 (bomb) beats any pair', () => {
    const bomb = id(cards(['S', 5], ['H', 5], ['D', 5], ['C', 5]));
    const pair = id([n('S', 14), n('H', 14)]); // pair of aces
    expect(beats(bomb, pair)).toBe(true);
    expect(beats(pair, bomb)).toBe(false);
  });

  it('straightFlush beats a straight', () => {
    const sf = id(cards(['S', 3], ['S', 4], ['S', 5], ['S', 6], ['S', 7]));
    const straight = id(cards(['S', 10], ['H', 11], ['D', 12], ['C', 13], ['S', 14]));
    expect(beats(sf, straight)).toBe(true);
    expect(beats(straight, sf)).toBe(false);
  });

  it('kingBomb beats any non-bomb', () => {
    const kb = id([jb(), jb(), js(), js()]);
    const triple = id(cards(['S', 9], ['H', 9], ['D', 9]));
    expect(beats(kb, triple)).toBe(true);
  });

  it('4炸 与 四大天王 都能压 对大王 (对王是非炸弹对子)', () => {
    const pairKings = id([jb(), jb()]);
    const bomb = id(cards(['S', 7], ['H', 7], ['D', 7], ['C', 7]));
    const kb = id([jb(), jb(), js(), js()]);
    expect(beats(bomb, pairKings)).toBe(true);
    expect(beats(pairKings, bomb)).toBe(false);
    expect(beats(kb, pairKings)).toBe(true);
  });
});

describe('beats: bomb power chain (4炸 < 5炸 < 同花顺 < 6炸 < 7炸 < 8炸 < 四大天王)', () => {
  const b4 = id(cards(['S', 5], ['H', 5], ['D', 5], ['C', 5]));
  const b5 = id(cards(['S', 5], ['H', 5], ['D', 5], ['C', 5], ['S', 5]));
  const sf = id(cards(['S', 3], ['S', 4], ['S', 5], ['S', 6], ['S', 7]));
  const b6 = id(cards(['S', 9], ['H', 9], ['D', 9], ['C', 9], ['S', 9], ['H', 9]));
  const b7 = id(cards(['S', 9], ['H', 9], ['D', 9], ['C', 9], ['S', 9], ['H', 9], ['D', 9]));
  const b8 = id(cards(['S', 9], ['H', 9], ['D', 9], ['C', 9], ['S', 9], ['H', 9], ['D', 9], ['C', 9]));
  const kb = id([jb(), jb(), js(), js()]);

  // ordered weakest → strongest
  const chain = [b4, b5, sf, b6, b7, b8, kb];

  it('each higher link beats the lower link (and not vice-versa)', () => {
    for (let i = 0; i < chain.length; i++) {
      for (let j = 0; j < chain.length; j++) {
        const hi = chain[i]!;
        const lo = chain[j]!;
        if (i > j) {
          expect(beats(hi, lo)).toBe(true);
        } else if (i < j) {
          expect(beats(hi, lo)).toBe(false);
        }
      }
    }
  });

  it('explicit adjacent pairs', () => {
    expect(beats(b5, b4)).toBe(true);
    expect(beats(sf, b5)).toBe(true);
    expect(beats(b6, sf)).toBe(true);
    expect(beats(b7, b6)).toBe(true);
    expect(beats(b8, b7)).toBe(true);
    expect(beats(kb, b8)).toBe(true);
    // and reverse all false
    expect(beats(b4, b5)).toBe(false);
    expect(beats(b5, sf)).toBe(false);
    expect(beats(sf, b6)).toBe(false);
    expect(beats(b6, b7)).toBe(false);
    expect(beats(b7, b8)).toBe(false);
    expect(beats(b8, kb)).toBe(false);
  });

  it('same-length bombs compare by key (9999 > 5555)', () => {
    const b4hi = id(cards(['S', 9], ['H', 9], ['D', 9], ['C', 9]));
    expect(beats(b4hi, b4)).toBe(true);
    expect(beats(b4, b4hi)).toBe(false);
  });

  it('two straightFlush compare by key', () => {
    const sfHi = id(cards(['S', 10], ['S', 11], ['S', 12], ['S', 13], ['S', 14]));
    expect(beats(sfHi, sf)).toBe(true);
    expect(beats(sf, sfHi)).toBe(false);
  });

  it('equal bombs (5555 vs 5555) do not beat each other', () => {
    const other = id(cards(['S', 5], ['H', 5], ['D', 5], ['C', 5]));
    expect(beats(b4, other)).toBe(false);
  });
});

describe('bombPower: exact tier constants', () => {
  it('matches the spec tier formula', () => {
    const b4 = id(cards(['S', 5], ['H', 5], ['D', 5], ['C', 5]));         // key 5
    const b5 = id(cards(['S', 5], ['H', 5], ['D', 5], ['C', 5], ['S', 5]));
    const sf = id(cards(['S', 3], ['S', 4], ['S', 5], ['S', 6], ['S', 7])); // key 7
    const b6 = id(cards(['S', 9], ['H', 9], ['D', 9], ['C', 9], ['S', 9], ['H', 9]));
    const b7 = id(cards(['S', 9], ['H', 9], ['D', 9], ['C', 9], ['S', 9], ['H', 9], ['D', 9]));
    const b8 = id(cards(['S', 9], ['H', 9], ['D', 9], ['C', 9], ['S', 9], ['H', 9], ['D', 9], ['C', 9]));
    const kb = id([jb(), jb(), js(), js()]);
    expect(bombPower(b4)).toBe(1_000_000 + 5);
    expect(bombPower(b5)).toBe(2_000_000 + 5);
    expect(bombPower(sf)).toBe(3_000_000 + 7);
    expect(bombPower(b6)).toBe(4_000_000 + 9);
    expect(bombPower(b7)).toBe(5_000_000 + 9);
    expect(bombPower(b8)).toBe(6_000_000 + 9);
    expect(bombPower(kb)).toBe(9_000_000);
  });

  it('non-bomb combos have power 0', () => {
    expect(id([n('S', 5), n('H', 5)]).power).toBe(0);
    expect(id(cards(['S', 3], ['H', 4], ['D', 5], ['C', 6], ['S', 7])).power).toBe(0);
  });
});
