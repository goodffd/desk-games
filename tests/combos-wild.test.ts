import { describe, it, expect } from 'vitest';
import { identify } from '../src/games/guandan/engine/combos';
import { wildCount, identifyWithWild } from '../src/games/guandan/engine/wild';
import type { Card, Rank, Suit } from '../src/games/guandan/engine/types';
import { LEVEL } from '../src/games/guandan/engine/types';

const L: Rank = LEVEL; // 2

// --- card construction helpers (ids must be unique within a combo) ---
let _id = 0;
function n(suit: Suit, rank: Rank): Card {
  return { kind: 'normal', suit, rank, id: _id++ };
}
function jb(): Card { return { kind: 'joker', big: true, id: _id++ }; }
function js(): Card { return { kind: 'joker', big: false, id: _id++ }; }
/** one red-heart level card = a wildcard (逢人配) */
function w(): Card { return { kind: 'normal', suit: 'H', rank: L, id: _id++ }; }

function cards(...specs: Array<[Suit, Rank]>): Card[] {
  return specs.map(([s, r]) => n(s, r));
}

// ---------------------------------------------------------------------------
// wildCount
// ---------------------------------------------------------------------------
describe('wildCount', () => {
  it('counts red-heart level cards only', () => {
    expect(wildCount([w()], L)).toBe(1);
    expect(wildCount([w(), w()], L)).toBe(2);
  });

  it('a black 2 (S2/D2/C2) is NOT a wildcard', () => {
    expect(wildCount([n('S', 2), n('D', 2), n('C', 2)], L)).toBe(0);
  });

  it('a red heart that is not the level rank is NOT a wildcard', () => {
    expect(wildCount([n('H', 5), n('H', 14)], L)).toBe(0);
  });

  it('jokers are not wildcards', () => {
    expect(wildCount([jb(), js()], L)).toBe(0);
  });

  it('mixed hand counts only the H2s', () => {
    expect(wildCount([w(), n('S', 2), n('H', 5), w(), jb()], L)).toBe(2);
  });

  it('no wilds → 0', () => {
    expect(wildCount(cards(['S', 5], ['H', 5]), L)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// identifyWithWild — equivalence with identify when 0 wilds
// ---------------------------------------------------------------------------
describe('identifyWithWild: 0 wilds matches identify exactly', () => {
  const samples: Card[][] = [
    [n('S', 5)],
    cards(['S', 5], ['H', 5]),
    cards(['S', 7], ['H', 7], ['D', 7]),
    cards(['S', 3], ['H', 3], ['D', 3], ['S', 4], ['H', 4]),     // tripleWithPair
    cards(['S', 3], ['H', 4], ['D', 5], ['C', 6], ['S', 7]),     // straight
    cards(['S', 3], ['H', 3], ['S', 4], ['H', 4], ['S', 5], ['H', 5]), // consecPairs
    cards(['S', 3], ['H', 3], ['D', 3], ['S', 4], ['H', 4], ['D', 4]), // consecTriples
    cards(['S', 5], ['H', 5], ['D', 5], ['C', 5]),               // bomb
    cards(['S', 3], ['S', 4], ['S', 5], ['S', 6], ['S', 7]),     // straightFlush
    [jb(), jb(), js(), js()],                                    // kingBomb
    cards(['S', 5], ['H', 6]),                                   // garbage → null
  ];

  it('produces same type/key/length/power as identify for every sample', () => {
    for (const s of samples) {
      const a = identifyWithWild(s, L);
      const b = identify(s, L);
      if (b === null) {
        expect(a).toBeNull();
      } else {
        expect(a).not.toBeNull();
        expect(a!.type).toBe(b.type);
        expect(a!.key).toBe(b.key);
        expect(a!.length).toBe(b.length);
        expect(a!.power).toBe(b.power);
      }
    }
  });

  it('a lone wildcard [H2] → single key=15 (plays as the level card)', () => {
    const c = identifyWithWild([w()], L)!;
    expect(c).not.toBeNull();
    expect(c.type).toBe('single');
    expect(c.length).toBe(1);
    expect(c.key).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// pair / triple
// ---------------------------------------------------------------------------
describe('identifyWithWild: pair & triple', () => {
  it('H2(wild) + S5 → pair key=5', () => {
    const c = identifyWithWild([w(), n('S', 5)], L)!;
    expect(c.type).toBe('pair');
    expect(c.length).toBe(2);
    expect(c.key).toBe(5);
  });

  it('wild + wild → pair (best key = level card 15)', () => {
    // two wilds alone, no real card → most natural pairing is the level pair (15),
    // which is the maximum-key pair achievable.
    const c = identifyWithWild([w(), w()], L)!;
    expect(c.type).toBe('pair');
    expect(c.key).toBe(15);
  });

  it('wild + wild + S5 → triple key=5', () => {
    const c = identifyWithWild([w(), w(), n('S', 5)], L)!;
    expect(c.type).toBe('triple');
    expect(c.length).toBe(3);
    expect(c.key).toBe(5);
  });

  it('wild + S5 + H5 → triple key=5', () => {
    const c = identifyWithWild([w(), n('S', 5), n('H', 5)], L)!;
    expect(c.type).toBe('triple');
    expect(c.key).toBe(5);
  });

  it('wild + SA → pair of aces key=14', () => {
    const c = identifyWithWild([w(), n('S', 14)], L)!;
    expect(c.type).toBe('pair');
    expect(c.key).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// tripleWithPair
// ---------------------------------------------------------------------------
describe('identifyWithWild: tripleWithPair (三带二)', () => {
  it('55 + 99 + wild → tripleWithPair, wild maximizes the triple to 999 → key=9', () => {
    // S5 H5 wild S9 H9 can be read two ways:
    //   wild→5 : 555 + 99  → tripleWithPair key=5
    //   wild→9 : 999 + 55  → tripleWithPair key=9   ← stronger (higher key)
    // identifyWithWild returns the maximal reading, so key=9 (triple of 9s).
    const c = identifyWithWild([n('S', 5), n('H', 5), w(), n('S', 9), n('H', 9)], L)!;
    expect(c.type).toBe('tripleWithPair');
    expect(c.length).toBe(5);
    expect(c.key).toBe(9);
  });

  it('999 + S5 + wild → triple 9s + pair 5s, key=9', () => {
    const c = identifyWithWild([n('S', 9), n('H', 9), n('D', 9), n('S', 5), w()], L)!;
    expect(c.type).toBe('tripleWithPair');
    expect(c.key).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// straight (顺子缺张)
// ---------------------------------------------------------------------------
describe('identifyWithWild: straight with a gap filled', () => {
  it('3 4 _ 6 7 with one wild → straight key=7', () => {
    const c = identifyWithWild([n('S', 3), n('H', 4), w(), n('C', 6), n('S', 7)], L)!;
    expect(c.type).toBe('straight');
    expect(c.length).toBe(5);
    expect(c.key).toBe(7);
  });

  it('3 4 5 6 + wild → straight, wild extends to 7 (best key=7) not low 2', () => {
    const c = identifyWithWild([n('S', 3), n('H', 4), n('D', 5), n('C', 6), w()], L)!;
    expect(c.type).toBe('straight');
    expect(c.key).toBe(7);
  });

  it('two wilds fill two gaps: 3 _ 5 _ 7 → straight key=7', () => {
    const c = identifyWithWild([n('S', 3), w(), n('D', 5), w(), n('S', 7)], L)!;
    expect(c.type).toBe('straight');
    expect(c.key).toBe(7);
  });

  it('A 2 3 4 + wild → straight A2345 key=5 (A low) is achievable', () => {
    // best key here: wild can become S6 → 23456 (key 6) using A as... no, A breaks run.
    // cards are A,2,3,4,wild. Best straight: 2345 + wild=6 → key 6 (A unused? no, all 5 must be used)
    // All 5 cards must participate. A2345? need a 5: wild=5 → A2345 key 5.
    // Or wild used elsewhere — A,2,3,4 are fixed reals. To form a 5-run we need {A,2,3,4,X}.
    // Consecutive 5-set containing A,2,3,4: only A2345 (X=5). key=5.
    const c = identifyWithWild([n('S', 14), n('H', 2), n('D', 3), n('C', 4), w()], L)!;
    expect(c.type).toBe('straight');
    expect(c.key).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// consecPairs (连对) with wild
// ---------------------------------------------------------------------------
describe('identifyWithWild: consecPairs with wild', () => {
  it('33 44 + wild + wild → 33 44 55 key=5', () => {
    const c = identifyWithWild(
      [n('S', 3), n('H', 3), n('S', 4), n('H', 4), w(), w()],
      L,
    )!;
    expect(c.type).toBe('consecPairs');
    expect(c.length).toBe(6);
    expect(c.key).toBe(5);
  });

  it('33 4_ 55 (one wild completes the middle pair) → 33 44 55 key=5', () => {
    const c = identifyWithWild(
      [n('S', 3), n('H', 3), n('S', 4), w(), n('S', 5), n('H', 5)],
      L,
    )!;
    expect(c.type).toBe('consecPairs');
    expect(c.key).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// consecTriples (钢板) with wild
// ---------------------------------------------------------------------------
describe('identifyWithWild: consecTriples (钢板) with wild', () => {
  it('333 44 + wild → 333 444 key=4', () => {
    const c = identifyWithWild(
      [n('S', 3), n('H', 3), n('D', 3), n('S', 4), n('C', 4), w()],
      L,
    )!;
    expect(c.type).toBe('consecTriples');
    expect(c.length).toBe(6);
    expect(c.key).toBe(4);
  });

  it('333 44 4 + wild → second wild-free triple already; 1 wild completes 444 → key=4', () => {
    // 333 + 44 + wild: wild→4 gives 333 444 (consecTriples key=4). With only ONE
    // wild and three 3s + two 4s, no 3-pair consecPairs reading exists (we have a
    // triple of 3s, not a pair), so consecTriples is forced — unambiguous.
    const c = identifyWithWild(
      [n('S', 3), n('H', 3), n('D', 3), n('S', 4), n('H', 4), w()],
      L,
    )!;
    expect(c.type).toBe('consecTriples');
    expect(c.key).toBe(4);
  });

  it('33 44 + wild + wild can also read as consecPairs 33 44 55 → max key=5', () => {
    // DOCUMENTED AMBIGUITY: S3 H3 S4 H4 + 2 wilds has TWO legal 6-card readings:
    //   wilds→3,4 (i.e. 333 444) → consecTriples key=4
    //   wilds→5,5 (i.e. 33 44 55) → consecPairs   key=5  ← higher key, wins
    // Per SPEC「返回最大可行牌型 (按 key/power 取最优)」the engine returns consecPairs key=5
    // (matches brief Step 1's `3 3 4 4 H2 H2 → consecPairs 334455 key=5`).
    const c = identifyWithWild(
      [n('S', 3), n('H', 3), w(), n('S', 4), n('H', 4), w()],
      L,
    )!;
    expect(c.type).toBe('consecPairs');
    expect(c.key).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// bomb with wild(s)
// ---------------------------------------------------------------------------
describe('identifyWithWild: bomb with wild(s)', () => {
  it('5 5 5 + wild → 4-card bomb key=5', () => {
    const c = identifyWithWild([n('S', 5), n('H', 5), n('D', 5), w()], L)!;
    expect(c.type).toBe('bomb');
    expect(c.length).toBe(4);
    expect(c.key).toBe(5);
  });

  it('5 5 5 + wild + wild → 5-card bomb key=5', () => {
    const c = identifyWithWild([n('S', 5), n('H', 5), n('D', 5), w(), w()], L)!;
    expect(c.type).toBe('bomb');
    expect(c.length).toBe(5);
    expect(c.key).toBe(5);
  });

  it('a bomb is preferred over a lesser interpretation (5 5 5 + wild ≠ triple+single)', () => {
    // both [555 wild] could in theory be read as nothing else legal of len 4;
    // confirm it lands on the 4-bomb, the strongest reading.
    const c = identifyWithWild([n('S', 5), n('H', 5), n('D', 5), w()], L)!;
    expect(c.type).toBe('bomb');
    expect(c.power).toBeGreaterThan(0);
  });

  it('2 2 2 + wild → bomb of level cards key=15', () => {
    const c = identifyWithWild([n('S', 2), n('D', 2), n('C', 2), w()], L)!;
    expect(c.type).toBe('bomb');
    expect(c.key).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// straightFlush with wild
// ---------------------------------------------------------------------------
describe('identifyWithWild: straightFlush with wild', () => {
  it('♠3 4 5 6 + wild → straightFlush, wild as ♠7 (best key=7)', () => {
    const c = identifyWithWild([n('S', 3), n('S', 4), n('S', 5), n('S', 6), w()], L)!;
    expect(c.type).toBe('straightFlush');
    expect(c.length).toBe(5);
    expect(c.key).toBe(7);
    expect(c.power).toBeGreaterThan(0);
  });

  it('♠3 4 _ 6 7 with wild as ♠5 → straightFlush key=7', () => {
    const c = identifyWithWild([n('S', 3), n('S', 4), w(), n('S', 6), n('S', 7)], L)!;
    expect(c.type).toBe('straightFlush');
    expect(c.key).toBe(7);
  });

  it('straightFlush (power) preferred over plain straight reading', () => {
    // ♠3 4 5 6 + wild: a same-suit completion (♠7) gives straightFlush which
    // outranks any plain-straight reading; assert we pick the flush.
    const c = identifyWithWild([n('S', 3), n('S', 4), n('S', 5), n('S', 6), w()], L)!;
    expect(c.type).toBe('straightFlush');
  });
});

// ---------------------------------------------------------------------------
// prohibited: wild cannot make a kingBomb
// ---------------------------------------------------------------------------
describe('identifyWithWild: wild can NOT form 四大天王 (kingBomb)', () => {
  it('大 大 小 + wild → null (3 jokers + wild is not a kingBomb)', () => {
    expect(identifyWithWild([jb(), jb(), js(), w()], L)).toBeNull();
  });

  it('大 小 + wild + wild → null (jokers + wilds never a kingBomb)', () => {
    expect(identifyWithWild([jb(), js(), w(), w()], L)).toBeNull();
  });

  it('a real kingBomb (no wild) still identifies as kingBomb', () => {
    const c = identifyWithWild([jb(), jb(), js(), js()], L)!;
    expect(c.type).toBe('kingBomb');
  });
});

// ---------------------------------------------------------------------------
// no legal combo → null
// ---------------------------------------------------------------------------
describe('identifyWithWild: no legal assignment → null', () => {
  it('S5 H6 + wild → some pair/triple is impossible to beat... actually 556 is a pair+1', () => {
    // S5 H6 wild = 3 cards; best legal reading: wild=5 → 5 5 6? not a triple (mixed),
    // wild=6 → 5 6 6? also mixed. No triple, no straight(len3 invalid). → null.
    expect(identifyWithWild([n('S', 5), n('H', 6), w()], L)).toBeNull();
  });

  it('four mismatched ranks + wild (3 5 8 J + wild) → null (no legal 5-combo)', () => {
    expect(
      identifyWithWild([n('S', 3), n('H', 5), n('D', 8), n('C', 11), w()], L),
    ).toBeNull();
  });

  it('a single joker + wild → null (joker cannot pair, wild cannot become a joker)', () => {
    expect(identifyWithWild([jb(), w()], L)).toBeNull();
  });
});
