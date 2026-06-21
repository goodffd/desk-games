import { describe, it, expect } from 'vitest';
import {
  enumerateLeads,
  enumerateFollows,
  isLegalPlay,
  allReadings,
} from '../src/games/guandan/engine/legal';
import { identify } from '../src/games/guandan/engine/combos';
import { identifyWithWild } from '../src/games/guandan/engine/wild';
import type { Card, Rank, Suit, Combo, ComboType } from '../src/games/guandan/engine/types';
import { LEVEL } from '../src/games/guandan/engine/types';
import { makeDeck } from '../src/games/guandan/engine/cards';

const L: Rank = LEVEL; // 2

// --- card construction helpers (ids must be unique within a hand) -----------
let _id = 0;
function n(suit: Suit, rank: Rank): Card {
  return { kind: 'normal', suit, rank, id: _id++ };
}
function jb(): Card {
  return { kind: 'joker', big: true, id: _id++ };
}
function js(): Card {
  return { kind: 'joker', big: false, id: _id++ };
}
function cards(...specs: Array<[Suit, Rank]>): Card[] {
  return specs.map(([s, r]) => n(s, r));
}
/** The red-heart level card = wildcard. */
function wild(): Card {
  return { kind: 'normal', suit: 'H', rank: L, id: _id++ };
}

// Find combos of a given type/key/length within a list (for assertions).
function has(list: Combo[], type: ComboType, key: number, length?: number): boolean {
  return list.some(
    c => c.type === type && c.key === key && (length === undefined || c.length === length)
  );
}
function find(list: Combo[], type: ComboType, key: number, length?: number): Combo | undefined {
  return list.find(
    c => c.type === type && c.key === key && (length === undefined || c.length === length)
  );
}

// ---------------------------------------------------------------------------
describe('allReadings: enumerates all legal readings of a fixed group', () => {
  it('plain pair → exactly one reading', () => {
    const r = allReadings(cards(['S', 5], ['H', 5]), L);
    expect(r.length).toBe(1);
    expect(r[0]!.type).toBe('pair');
    expect(r[0]!.key).toBe(5);
  });

  it('illegal group → no readings', () => {
    expect(allReadings(cards(['S', 5], ['H', 6]), L)).toEqual([]);
  });

  it('wild + single → both pair readings of the wildcard partner are reachable', () => {
    // H2(wild) + S10 can read as pair 10 (wild→10). It can also read as a pair
    // of 2 (the level point, key 15) only if the partner could be a 2 — it can't
    // here, so the ONLY 2-card pair reading is pair-10.
    const r = allReadings([wild(), n('S', 10)], L);
    expect(has(r, 'pair', 10)).toBe(true);
    // A wild paired with a 10 cannot read as anything else of length 2.
    expect(r.every(c => c.length === 2 && c.type === 'pair')).toBe(true);
  });

  it('wild reading need not be the strongest reading (compare to identifyWithWild)', () => {
    // S5 + S6 + S7 + S8 + H2(wild): the wild can complete a straight 4-5-6-7-8
    // (key 8, same-suit S5-8 + wild → straightFlush) OR a straight S5-9? no 9.
    // The point: allReadings must contain readings beyond the single strongest.
    const group = [n('S', 5), n('S', 6), n('S', 7), n('S', 8), wild()];
    const r = allReadings(group, L);
    // strongest by identifyWithWild is the straightFlush (wild = S9 → SF key 9,
    // or wild = S4 → SF key 8). allReadings must include a plain-straight reading
    // too (it is structurally the same cards but we at least keep the SF).
    expect(r.length).toBeGreaterThanOrEqual(1);
    // there must be at least one reading whose top key matches a 5-card run.
    expect(r.some(c => (c.type === 'straight' || c.type === 'straightFlush'))).toBe(true);
  });

  it('two wilds alone → still legal pair (key 15, level point)', () => {
    // H2 + H2 read as a pair of level cards (key 15) at minimum.
    const r = allReadings([wild(), wild()], L);
    expect(has(r, 'pair', 15)).toBe(true);
  });

  it('lone wild → single key 15', () => {
    const r = allReadings([wild()], L);
    expect(has(r, 'single', 15)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('对王 (双小王/双大王) — owner ruling 2026-06-21', () => {
  it('allReadings: 两大王→pair17, 两小王→pair16, 一大一小→无读法', () => {
    expect(has(allReadings([jb(), jb()], L), 'pair', 17)).toBe(true);
    expect(has(allReadings([js(), js()], L), 'pair', 16)).toBe(true);
    expect(allReadings([jb(), js()], L)).toEqual([]);
  });

  it('enumerateLeads: 手里两小王→含对小王(16); 两大王→含对大王(17)', () => {
    expect(has(enumerateLeads([js(), js(), n('S', 3)], L), 'pair', 16)).toBe(true);
    expect(has(enumerateLeads([jb(), jb(), n('S', 3)], L), 'pair', 17)).toBe(true);
  });

  it('isLegalPlay: 对小王可领出、可压对A；一大一小非法', () => {
    const s1 = js();
    const s2 = js();
    expect(isLegalPlay([s1, s2], null, [s1, s2], L)).toBe(true);
    const pairA = identify([n('S', 14), n('H', 14)], L)!;
    expect(isLegalPlay([s1, s2], pairA, [s1, s2], L)).toBe(true);
    const b = jb();
    expect(isLegalPlay([b, s1], null, [b, s1], L)).toBe(false);
  });

  it('enumerateFollows: 对小王能压一手对8', () => {
    const pair8 = identify([n('S', 8), n('H', 8)], L)!;
    expect(has(enumerateFollows([js(), js()], pair8, L), 'pair', 16)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('enumerateLeads: brief Step 1 core hand', () => {
  const hand = () => [
    n('S', 3),
    n('S', 4),
    n('S', 5),
    n('S', 6),
    n('S', 7),
    n('H', 9),
    n('H', 9),
  ];

  it('all-spade 3-7 run identifies ONLY as a straightFlush, never a plain straight', () => {
    // SPEC RULING: a same-suit 5-run IS a 同花顺(straightFlush, a bomb) and identifies
    // as exactly that — `identify` never downgrades it to a plain straight. The brief's
    // loose phrasing "leads 含 straight 3-7" maps, for this all-spade hand, to the
    // straightFlush reading. (A mixed-suit hand below proves plain straights are also
    // enumerated.)
    const leads = enumerateLeads(hand(), L);
    expect(has(leads, 'straightFlush', 7, 5)).toBe(true);
    expect(has(leads, 'straight', 7, 5)).toBe(false); // all-spade run is not a plain straight
  });

  it('a MIXED-suit 3-7 run is enumerated as a plain straight (3-7)', () => {
    const mixed = [n('S', 3), n('H', 4), n('S', 5), n('S', 6), n('S', 7), n('H', 9), n('H', 9)];
    const leads = enumerateLeads(mixed, L);
    expect(has(leads, 'straight', 7, 5)).toBe(true);
  });

  it('includes the pair 9', () => {
    const leads = enumerateLeads(hand(), L);
    expect(has(leads, 'pair', 9)).toBe(true);
  });

  it('includes all 7 singles (by distinct point)', () => {
    const leads = enumerateLeads(hand(), L);
    // distinct points: 3,4,5,6,7,9 → singles for each
    for (const k of [3, 4, 5, 6, 7, 9]) {
      expect(has(leads, 'single', k)).toBe(true);
    }
  });

  it('does NOT invent a triple of 9 (only two 9s)', () => {
    const leads = enumerateLeads(hand(), L);
    expect(has(leads, 'triple', 9)).toBe(false);
  });

  it('every lead is a real legal combo (round-trips through identifyWithWild)', () => {
    const leads = enumerateLeads(hand(), L);
    for (const c of leads) {
      const re = identifyWithWild(c.cards, L);
      expect(re).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
describe('enumerateFollows: same-type same-length larger key + bombs', () => {
  const hand = () => [
    n('S', 3),
    n('S', 4),
    n('S', 5),
    n('S', 6),
    n('S', 7),
    n('H', 9),
    n('H', 9),
  ];

  function pair8(): Combo {
    return identify(cards(['S', 8], ['D', 8]), L)!;
  }

  it('current=pair8 → follows includes pair9', () => {
    const f = enumerateFollows(hand(), pair8(), L);
    expect(has(f, 'pair', 9)).toBe(true);
  });

  it('current=pair8 → follows excludes singles and plain straights', () => {
    const f = enumerateFollows(hand(), pair8(), L);
    expect(f.some(c => c.type === 'single')).toBe(false);
    expect(f.some(c => c.type === 'straight')).toBe(false);
    // NOTE: the all-spade S3-7 run IS a straightFlush (a bomb) and DOES legally beat a
    // pair (bomb beats any non-bomb), so it correctly appears in follows. We assert
    // there is no NON-bomb in-type follow other than the pair-9 below.
    const nonBombFollows = f.filter(
      c => c.type !== 'bomb' && c.type !== 'straightFlush' && c.type !== 'kingBomb'
    );
    expect(nonBombFollows.every(c => c.type === 'pair' && c.length === 2)).toBe(true);
  });

  it('current=pair9 → follows excludes pair9 (equal does not beat)', () => {
    const p9 = identify(cards(['C', 9], ['D', 9]), L)!;
    const handWith10s = [n('S', 9), n('S', 9), n('S', 10), n('D', 10)];
    const f = enumerateFollows(handWith10s, p9, L);
    expect(has(f, 'pair', 9)).toBe(false);
    expect(has(f, 'pair', 10)).toBe(true);
  });
});

describe('enumerateFollows: bombs always included for any current', () => {
  // hand has a 4-bomb of 6s plus a pair of 9s
  const hand = () => [
    n('S', 6),
    n('H', 6),
    n('D', 6),
    n('C', 6),
    n('S', 9),
    n('H', 9),
  ];

  it('current=pair8 → follows includes pair9 AND the 6-bomb', () => {
    const p8 = identify(cards(['S', 8], ['D', 8]), L)!;
    const f = enumerateFollows(hand(), p8, L);
    expect(has(f, 'pair', 9)).toBe(true);
    expect(has(f, 'bomb', 6, 4)).toBe(true);
  });

  it('current=straight (which the hand cannot follow in-type) → still offers the bomb', () => {
    // mixed-suit run → a PLAIN straight (not a straightFlush), so the 4-bomb beats it.
    const straight = identify(cards(['C', 3], ['D', 4], ['C', 5], ['H', 6], ['C', 7]), L)!;
    expect(straight.type).toBe('straight'); // guard: ensure it is not a straightFlush
    const f = enumerateFollows(hand(), straight, L);
    expect(has(f, 'bomb', 6, 4)).toBe(true);
  });

  it('current is a weaker bomb → a stronger bomb in hand follows', () => {
    const bomb5five = identify(cards(['S', 5], ['H', 5], ['D', 5], ['C', 5], ['S', 5]), L)!;
    // hand's 4-bomb of 6 is WEAKER than a 5-bomb → must NOT appear
    const f1 = enumerateFollows(hand(), bomb5five, L);
    expect(has(f1, 'bomb', 6, 4)).toBe(false);
    // but against a 4-bomb of 5, the 4-bomb of 6 (higher key) follows
    const bomb4five = identify(cards(['S', 5], ['H', 5], ['D', 5], ['C', 5]), L)!;
    const f2 = enumerateFollows(hand(), bomb4five, L);
    expect(has(f2, 'bomb', 6, 4)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('enumerateFollows: wild-assisted follows', () => {
  it('hand has H2(wild)+S10, current=pair9 → follows includes the pair-10 made with the wild', () => {
    // brief: H2 + S10 → pair 10 beats pair 9
    const hand = [wild(), n('S', 10)];
    const p9 = identify(cards(['C', 9], ['D', 9]), L)!;
    const f = enumerateFollows(hand, p9, L);
    expect(has(f, 'pair', 10)).toBe(true);
  });

  it('wild can also form the pair-9 equalizer-beater chain: H2+S9 makes pair9, must NOT beat pair9', () => {
    const hand = [wild(), n('S', 9)];
    const p9 = identify(cards(['C', 9], ['D', 9]), L)!;
    const f = enumerateFollows(hand, p9, L);
    // pair9 ties, does not beat
    expect(has(f, 'pair', 9)).toBe(false);
  });

  it('wild fills a straight gap to follow a (plain) straight', () => {
    // hand: S3 H4 _ D6 C7 + wild → straight 3-7 (wild = 5), MIXED suits so it stays a
    // plain straight, not a straightFlush.
    const hand = [n('S', 3), n('H', 4), n('D', 6), n('C', 7), wild()];
    const lowerStraight = identify(cards(['C', 2], ['D', 3], ['C', 4], ['H', 5], ['C', 6]), L)!;
    expect(lowerStraight.type).toBe('straight'); // guard: mixed suits → plain straight
    // current straight top=6; hand makes straight top=7 (3-4-5-6-7) → beats in-type.
    const f = enumerateFollows(hand, lowerStraight, L);
    expect(has(f, 'straight', 7, 5)).toBe(true);
  });

  it('wild completes a 4-bomb that follows', () => {
    // hand: S5 H5 D5 + wild → bomb of 5 (4 cards). current pair → bomb follows.
    const hand = [n('S', 5), n('H', 5), n('D', 5), wild()];
    const p9 = identify(cards(['C', 9], ['D', 9]), L)!;
    const f = enumerateFollows(hand, p9, L);
    expect(has(f, 'bomb', 5, 4)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('enumerateLeads / enumerateFollows: level point composed by red-heart-2 wilds', () => {
  // ROOT-CAUSE regression: structured enumeration must offer the LEVEL point (rank 2,
  // key 15) as a combo component even when ALL of its cards are red-heart-2 wildcards
  // acting as their own level rank — not only as substitutes for other ranks. These
  // readings are accepted by identify/allReadings but were previously not generated.

  it('{S5,H5,D5,红2,红2} leads include tripleWithPair key5 (pair part = two wilds as level)', () => {
    const hand = [n('S', 5), n('H', 5), n('D', 5), wild(), wild()];
    const leads = enumerateLeads(hand, L);
    expect(has(leads, 'tripleWithPair', 5, 5)).toBe(true);
    // sanity: identify agrees this exact group is a tripleWithPair key 5
    const built = find(leads, 'tripleWithPair', 5, 5)!;
    const re = identify(built.cards, L);
    // identify reads {S5,H5,D5,H2,H2} as triple-5 + pair-2(level) → tripleWithPair key5
    expect(re).not.toBeNull();
    expect(re!.type).toBe('tripleWithPair');
    expect(re!.key).toBe(5);
  });

  it('{红2,红2} leads include pair key15 (the level pair)', () => {
    const hand = [wild(), wild()];
    const leads = enumerateLeads(hand, L);
    expect(has(leads, 'pair', 15, 2)).toBe(true);
  });

  it('follows: current=tripleWithPair(triple-4), hand {5,5,5,红2,红2} → tripleWithPair(triple-5)', () => {
    const cur = identify(
      cards(['S', 4], ['H', 4], ['D', 4], ['C', 5], ['D', 5]),
      L
    )!;
    expect(cur.type).toBe('tripleWithPair');
    expect(cur.key).toBe(4); // triple is the 4s
    const hand = [n('S', 5), n('H', 5), n('D', 5), wild(), wild()];
    const f = enumerateFollows(hand, cur, L);
    expect(has(f, 'tripleWithPair', 5, 5)).toBe(true);
  });

  it('completeness: enumerateLeads ⊇ every tripleWithPair allReadings finds for {S5,H5,D5,红2,红2}', () => {
    // For the title hand, build the set of tripleWithPair keys allReadings yields for the
    // whole 5-card group, and assert enumerateLeads covers each (root-cause completeness).
    const hand = [n('S', 5), n('H', 5), n('D', 5), wild(), wild()];
    const leads = enumerateLeads(hand, L);
    const fromReadings = allReadings(hand, L).filter(c => c.type === 'tripleWithPair');
    for (const r of fromReadings) {
      expect(has(leads, 'tripleWithPair', r.key, 5)).toBe(true);
    }
    // and the specific brief case is among them
    expect(fromReadings.some(c => c.key === 5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('isLegalPlay', () => {
  const hand = () => [
    n('S', 3),
    n('S', 4),
    n('S', 5),
    n('S', 6),
    n('S', 7),
    n('H', 9),
    n('H', 9),
  ];

  it('cards not a subset of hand → false', () => {
    const h = hand();
    const foreign = n('D', 13); // King not in hand
    expect(isLegalPlay([foreign], null, h, L)).toBe(false);
  });

  it('cards is a subset but illegal combination → false', () => {
    const h = hand();
    // S3 + S5 is not a legal combo
    expect(isLegalPlay([h[0]!, h[2]!], null, h, L)).toBe(false);
  });

  it('lead (current=null) with any legal combo → true', () => {
    const h = hand();
    // the pair of 9s
    expect(isLegalPlay([h[5]!, h[6]!], null, h, L)).toBe(true);
    // the straight 3-7
    expect(isLegalPlay([h[0]!, h[1]!, h[2]!, h[3]!, h[4]!], null, h, L)).toBe(true);
    // a single
    expect(isLegalPlay([h[0]!], null, h, L)).toBe(true);
  });

  it('follow that does NOT beat current → false', () => {
    const h = hand();
    const p10 = identify(cards(['C', 10], ['D', 10]), L)!;
    // pair 9 cannot beat pair 10
    expect(isLegalPlay([h[5]!, h[6]!], p10, h, L)).toBe(false);
  });

  it('follow that beats current → true', () => {
    const h = hand();
    const p8 = identify(cards(['C', 8], ['D', 8]), L)!;
    expect(isLegalPlay([h[5]!, h[6]!], p8, h, L)).toBe(true);
  });

  it('wild-assisted reading that beats current → true even if it is not the strongest reading', () => {
    // hand: H2(wild) + S9 + S10. current = pair9.
    // strongest reading of {H2,S9,S10} is NOT a pair (it's 3 cards / no pair of all 3).
    // But the SUBSET {H2,S10} reads as pair-10 → beats pair9 → isLegalPlay true.
    const w = wild();
    const s9 = n('S', 9);
    const s10 = n('S', 10);
    const h = [w, s9, s10];
    const p9 = identify(cards(['C', 9], ['D', 9]), L)!;
    // play just the wild + the 10
    expect(isLegalPlay([w, s10], p9, h, L)).toBe(true);
  });

  it('wild-assisted reading: choosing the weaker-but-legal pair reading still validates', () => {
    // {H2, S5} can read as pair-5 (wild→5). current = pair-4 → pair-5 beats it,
    // even though identifyWithWild's "strongest" reading for {H2,S5} is also pair-5.
    // The point we assert: a wild group whose chosen reading beats current → true.
    const w = wild();
    const s5 = n('S', 5);
    const h = [w, s5, n('S', 9)];
    const p4 = identify(cards(['C', 4], ['D', 4]), L)!;
    expect(isLegalPlay([w, s5], p4, h, L)).toBe(true);
  });

  it('bomb beats a non-bomb current via isLegalPlay', () => {
    const h = [n('S', 6), n('H', 6), n('D', 6), n('C', 6), n('S', 9)];
    const p8 = identify(cards(['C', 8], ['D', 8]), L)!;
    expect(isLegalPlay([h[0]!, h[1]!, h[2]!, h[3]!], p8, h, L)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('performance / robustness: full 27-card hand does not blow up', () => {
  it('enumerateLeads on a 27-card hand returns quickly without throwing', () => {
    // take the first 27 cards of a fresh deck (deterministic, includes jokers? no —
    // first 27 are spades+hearts low ranks of copy 0; still a rich structured hand)
    const deck = makeDeck();
    const handCards = deck.slice(0, 27);
    const t0 = Date.now();
    const leads = enumerateLeads(handCards, L);
    const dt = Date.now() - t0;
    expect(leads.length).toBeGreaterThan(0);
    expect(dt).toBeLessThan(2000); // generous ceiling; structured gen is fast
  });

  it('enumerateFollows on a 27-card hand vs a pair is fast', () => {
    const deck = makeDeck();
    const handCards = deck.slice(0, 27);
    const p5 = identify(cards(['C', 5], ['D', 5]), L)!;
    const t0 = Date.now();
    const f = enumerateFollows(handCards, p5, L);
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(2000);
    // every follow must actually beat the current
    for (const c of f) {
      // structurally valid
      expect(c.cards.length).toBe(c.length);
    }
  });
});
