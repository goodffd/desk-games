import { describe, it, expect } from 'vitest';
import {
  createDeal,
  play,
  pass,
  isDealOver,
  ranking,
  type DealState,
} from '../src/games/guandan/engine/game';
import type { Card, Rank, Seat } from '../src/games/guandan/engine/types';
import { makeDeck } from '../src/games/guandan/engine/cards';

const LEVEL: Rank = 2;

// ---------------------------------------------------------------------------
// card-construction helpers (explicit ids → no collisions, full control)
// ---------------------------------------------------------------------------

type Suit = 'S' | 'H' | 'D' | 'C';
let idCounter = 0;
function freshId(): number {
  return idCounter++;
}
function n(suit: Suit, rank: Rank): Card {
  return { kind: 'normal', suit, rank, id: freshId() };
}
/** Convenience by-suit single-card builders. */
const S = (r: Rank): Card => n('S', r);
const D = (r: Rank): Card => n('D', r);

/** Collect all ids currently held across the 4 hands. */
function liveIds(s: DealState): Set<number> {
  const set = new Set<number>();
  for (const hand of s.hands) for (const c of hand) set.add(c.id);
  return set;
}

/**
 * Conservation invariant: the union of (cards still in hands) ∪ (cards already played)
 * must equal the original deal's id set exactly, with NO duplicates and NO conjured ids.
 * We reconstruct "already played" by diffing against the known full id set.
 */
function assertConservation(s: DealState, allIds: Set<number>): void {
  const live = liveIds(s);
  // Every live id was part of the original deal.
  for (const id of live) expect(allIds.has(id)).toBe(true);
  // No duplicate ids across hands (count distinct equals total count).
  let total = 0;
  for (const hand of s.hands) total += hand.length;
  expect(total).toBe(live.size); // no dup ids across hands
  // live ⊆ allIds and |live| <= |allIds|; played = allIds \ live (never negative).
  expect(live.size).toBeLessThanOrEqual(allIds.size);
}

/** All ids dealt into a state's hands at creation time. */
function allIdsOf(hands: Card[][]): Set<number> {
  const set = new Set<number>();
  for (const hand of hands) for (const c of hand) set.add(c.id);
  return set;
}

// ---------------------------------------------------------------------------
// createDeal
// ---------------------------------------------------------------------------

describe('createDeal', () => {
  it('initializes a free lead for firstLeader with empty current/finished', () => {
    const hands: Card[][] = [[S(3)], [S(4)], [S(5)], [S(6)]];
    const s = createDeal(hands, 2, LEVEL);
    expect(s.turn).toBe(2);
    expect(s.current).toBeNull();
    expect(s.passesInRow).toBe(0);
    expect(s.finished).toEqual([]);
    expect(s.level).toBe(LEVEL);
  });

  it('does not alias the caller hand arrays', () => {
    const hands: Card[][] = [[S(3)], [S(4)], [S(5)], [S(6)]];
    const s = createDeal(hands, 0, LEVEL);
    hands[0]!.push(S(7));
    expect(s.hands[0]!.length).toBe(1); // unaffected by external mutation
  });
});

// ---------------------------------------------------------------------------
// play — basic legality + immutability
// ---------------------------------------------------------------------------

describe('play — legality and immutability', () => {
  it('lead removes the played cards and sets current/by', () => {
    const c3 = S(3);
    const hands: Card[][] = [[c3, S(5)], [S(4)], [S(6)], [S(7)]];
    const s0 = createDeal(hands, 0, LEVEL);
    const s1 = play(s0, 0, [c3]);

    // immutable: original untouched
    expect(s0.hands[0]!.length).toBe(2);
    expect(s0.current).toBeNull();

    expect(s1.hands[0]!.map(c => c.id)).not.toContain(c3.id);
    expect(s1.current!.by).toBe(0);
    expect(s1.current!.combo.type).toBe('single');
    expect(s1.turn).toBe(1); // counter-clockwise
    expect(s1.passesInRow).toBe(0);
  });

  it('throws when it is not the seat\'s turn (state unchanged)', () => {
    const hands: Card[][] = [[S(3)], [S(4)], [S(5)], [S(6)]];
    const s0 = createDeal(hands, 0, LEVEL);
    expect(() => play(s0, 1, [hands[1]![0]!])).toThrow();
    expect(s0.turn).toBe(0); // unchanged
  });

  it('throws when cards are not a subset of the hand', () => {
    const foreign = S(9); // never dealt to seat 0
    const hands: Card[][] = [[S(3)], [S(4)], [S(5)], [S(6)]];
    const s0 = createDeal(hands, 0, LEVEL);
    expect(() => play(s0, 0, [foreign])).toThrow();
    expect(s0.hands[0]!.length).toBe(1);
  });

  it('throws when a follow does not beat the current combo', () => {
    const lead = S(7);
    const weak = S(5);
    const hands: Card[][] = [[lead], [weak], [S(6)], [S(8)]];
    const s0 = createDeal(hands, 0, LEVEL);
    const s1 = play(s0, 0, [lead]); // single 7 on the table, turn → 1
    expect(() => play(s1, 1, [weak])).toThrow(); // single 5 cannot beat single 7
    // s1 unchanged
    expect(s1.turn).toBe(1);
    expect(s1.current!.combo.key).toBe(7);
  });

  it('allows a follow that beats the current combo', () => {
    const lead = S(7);
    const big = S(9);
    const hands: Card[][] = [[lead], [big], [S(6)], [S(8)]];
    const s0 = createDeal(hands, 0, LEVEL);
    const s1 = play(s0, 0, [lead]);
    const s2 = play(s1, 1, [big]);
    expect(s2.current!.by).toBe(1);
    expect(s2.current!.combo.key).toBe(9);
    expect(s2.turn).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// pass — three-pass lead return + free-lead pass forbidden
// ---------------------------------------------------------------------------

describe('pass', () => {
  it('cannot pass on a free lead', () => {
    const hands: Card[][] = [[S(3)], [S(4)], [S(5)], [S(6)]];
    const s0 = createDeal(hands, 0, LEVEL);
    expect(() => pass(s0, 0)).toThrow();
  });

  it('three consecutive passes return the lead to the last player, current cleared', () => {
    const lead = S(10);
    const hands: Card[][] = [[lead, S(3)], [S(4)], [S(5)], [S(6)]];
    const s0 = createDeal(hands, 0, LEVEL);
    const s1 = play(s0, 0, [lead]); // seat 0 leads single 10, turn → 1
    expect(s1.turn).toBe(1);
    const s2 = pass(s1, 1); // turn → 2
    expect(s2.turn).toBe(2);
    expect(s2.passesInRow).toBe(1);
    const s3 = pass(s2, 2); // turn → 3
    expect(s3.passesInRow).toBe(2);
    const s4 = pass(s3, 3); // 3rd pass → lead returns to seat 0
    expect(s4.current).toBeNull();
    expect(s4.turn).toBe(0);
    expect(s4.passesInRow).toBe(0);
  });

  it('a non-final pass just advances the turn keeping current', () => {
    const lead = S(10);
    const hands: Card[][] = [[lead, S(3)], [S(4)], [S(5)], [S(6)]];
    const s0 = createDeal(hands, 0, LEVEL);
    const s1 = play(s0, 0, [lead]);
    const s2 = pass(s1, 1);
    expect(s2.current).not.toBeNull();
    expect(s2.current!.by).toBe(0);
    expect(s2.turn).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 接风 (relay) — lead won by a finished player goes to their partner
// ---------------------------------------------------------------------------

describe('接风 (relay)', () => {
  it('after head finishes and no one beats the next combo, lead goes to head\'s partner with current cleared', () => {
    // Seat 0 (head, partner=2) will empty its hand, then seats 1,2,3 all pass on the
    // last winning combo → lead must relay to seat 2 (0's partner), current cleared.
    const a = S(9);
    const b = S(10); // seat 0's two cards; plays both as singles across two leads
    const hands: Card[][] = [
      [a, b], // seat 0
      [S(3), S(4)], // seat 1
      [S(5), S(6)], // seat 2
      [S(7), S(8)], // seat 3
    ];
    const s0 = createDeal(hands, 0, LEVEL);

    // Round 1: seat 0 leads single 9.
    let s = play(s0, 0, [a]); // turn → 1
    s = pass(s, 1); // turn → 2
    s = pass(s, 2); // turn → 3
    s = pass(s, 3); // all passed → lead back to seat 0, current cleared
    expect(s.current).toBeNull();
    expect(s.turn).toBe(0);

    // Round 2: seat 0 leads its last card (single 10) → seat 0 finishes (头游).
    s = play(s, 0, [b]);
    expect(s.finished).toEqual([0]);
    // seat 0 is now finished; turn should skip to next live seat (1).
    expect(s.turn).toBe(1);
    expect(s.current!.by).toBe(0);

    // Seats 1,2,3 all pass on seat 0's winning single 10. The combo owner (0) is
    // finished → lead relays to partner seat 2 (接风), current cleared, free lead.
    s = pass(s, 1); // turn → 2
    s = pass(s, 2); // turn → 3
    s = pass(s, 3); // 3 others passed → owner 0 wins but is finished → relay to seat 2
    expect(s.current).toBeNull();
    expect(s.turn).toBe(2); // 接风: head's partner
  });

  it('relay falls through to next live seat when partner is also finished', () => {
    // Seats 0 and 2 (same team) both finish; then a combo owned by seat 0 wins after
    // passes → partner (2) is also out → relay counter-clockwise to next live seat.
    const h0a = S(13);
    const h0b = S(14);
    const h2a = D(13);
    const h2b = D(14);
    const hands: Card[][] = [
      [h0a, h0b], // seat 0
      [S(3), S(4), S(5)], // seat 1 (stays in longest)
      [h2a, h2b], // seat 2
      [S(6), S(7), S(8)], // seat 3
    ];
    let s = createDeal(hands, 0, LEVEL);

    // seat 0 leads K, others pass → back to 0; 0 leads A → finishes (头游).
    s = play(s, 0, [h0a]); // single K, turn→1
    s = pass(s, 1);
    s = pass(s, 2);
    s = pass(s, 3); // back to 0
    s = play(s, 0, [h0b]); // single A → seat 0 finishes
    expect(s.finished).toEqual([0]);
    expect(s.turn).toBe(1);

    // Owner 0 (finished) wins after 1,2,3 pass → relay to partner 2 (still in).
    s = pass(s, 1);
    s = pass(s, 2);
    s = pass(s, 3);
    expect(s.turn).toBe(2); // 接风 to partner first
    expect(s.current).toBeNull();

    // seat 2 leads K, then A → seat 2 finishes (二游). Now seats 0 & 2 both out.
    s = play(s, 2, [h2a]); // single K; live = {1,2,3} → turn 3
    expect(s.turn).toBe(3);
    s = pass(s, 3); // live others of owner 2 = {1,3}; one pass not enough → turn 1
    expect(s.turn).toBe(1);
    s = pass(s, 1); // 2nd of 2 live others passes → owner 2 wins → 2 leads again
    expect(s.turn).toBe(2);
    expect(s.current).toBeNull();
    s = play(s, 2, [h2b]); // single A → seat 2 finishes (二游)
    expect(s.finished).toEqual([0, 2]);
    // Now only seats 1 and 3 remain → turn to next live seat (3).
    expect(s.turn).toBe(3);

    // seat 2's winning single A sits on the table (owner now finished). Both live
    // seats must pass for it to be unbeatable. Owner 2 finished, partner 0 finished →
    // relay falls through counter-clockwise from 2 to the next live seat → seat 3.
    s = pass(s, 3); // turn → 1
    expect(s.turn).toBe(1);
    s = pass(s, 1); // both live others passed → owner 2 wins but is finished
    expect(s.current).toBeNull();
    expect(s.turn).toBe(3); // partner 0 also out → fall-through to next live seat (3)
  });
});

// ---------------------------------------------------------------------------
// full deal to 4 finishers + ranking + conservation invariant every step
// ---------------------------------------------------------------------------

describe('full deal → ranking + conservation', () => {
  it('plays out a scripted small deal to a unique 4-seat ranking, conservation holds each step', () => {
    // Each seat has 2 ascending singles. Scripted finish order: 0, 1, 2, 3.
    const hands: Card[][] = [
      [S(3), S(7)], // seat 0
      [S(4), S(8)], // seat 1
      [S(5), S(9)], // seat 2
      [S(6), S(10)], // seat 3
    ];
    const allIds = allIdsOf(hands);
    let s = createDeal(hands, 0, LEVEL);
    assertConservation(s, allIds);

    // --- Round 1: seat 0 leads small singles, everyone follows up the chain ---
    s = play(s, 0, [hands[0]![0]!]); // 3
    assertConservation(s, allIds);
    s = play(s, 1, [hands[1]![0]!]); // 4 beats 3
    assertConservation(s, allIds);
    s = play(s, 2, [hands[2]![0]!]); // 5 beats 4
    assertConservation(s, allIds);
    s = play(s, 3, [hands[3]![0]!]); // 6 beats 5; turn → 0
    assertConservation(s, allIds);
    expect(s.turn).toBe(0);

    // Seat 0 cannot beat single 6 with its 7? 7 > 6 → it can. Continue chain.
    s = play(s, 0, [hands[0]![1]!]); // 7 beats 6 → seat 0 EMPTIES → 头游
    assertConservation(s, allIds);
    expect(s.finished).toEqual([0]);
    expect(s.turn).toBe(1);

    // seats 1,2,3 follow up: 8,9,10.
    s = play(s, 1, [hands[1]![1]!]); // 8 beats 7 → seat 1 EMPTIES → 二游
    assertConservation(s, allIds);
    expect(s.finished).toEqual([0, 1]);
    expect(s.turn).toBe(2);

    s = play(s, 2, [hands[2]![1]!]); // 9 beats 8 → seat 2 EMPTIES → 三游
    // Now only seat 3 remains → auto 末游, deal over.
    assertConservation(s, allIds);
    expect(isDealOver(s)).toBe(true);
    expect(s.finished).toEqual([0, 1, 2, 3]);

    const r = ranking(s);
    expect(r).toEqual([0, 1, 2, 3]);
    // unique permutation of 0..3
    expect(new Set(r).size).toBe(4);
    expect([...r].sort()).toEqual([0, 1, 2, 3]);
  });

  it('auto-records the last remaining seat as 末游 without an explicit final play', () => {
    const hands: Card[][] = [
      [S(3)], // seat 0
      [S(4)], // seat 1
      [S(5)], // seat 2
      [S(6)], // seat 3 — will be left holding when 0,1,2 are out
    ];
    let s = createDeal(hands, 0, LEVEL);
    s = play(s, 0, [hands[0]![0]!]); // 头游
    s = play(s, 1, [hands[1]![0]!]); // 二游 (beats 3 with 4)
    s = play(s, 2, [hands[2]![0]!]); // 三游 (beats 4 with 5) → seat 3 auto 末游
    expect(isDealOver(s)).toBe(true);
    expect(s.finished).toEqual([0, 1, 2, 3]);
    expect(s.hands[3]!.length).toBe(1); // last seat keeps its card; never forced to play
  });
});

// levelGain 已删（一期遗留死代码，整盘升级由 match.ts settleDeal 计算）。

// ---------------------------------------------------------------------------
// conservation across a FULL 108-card deal (sanity: ids stay 0..107, no dup/conjure)
// ---------------------------------------------------------------------------

describe('conservation on a full 108-card deal', () => {
  it('every id stays within 0..107, no duplicates, after an arbitrary opening play', () => {
    const deck = makeDeck();
    // deterministic deal: 27 per seat in dealt order
    const hands: Card[][] = [[], [], [], []];
    for (let i = 0; i < 108; i++) hands[i % 4]!.push(deck[i]!);
    const allIds = new Set(deck.map(c => c.id));
    expect(allIds.size).toBe(108);

    const s0 = createDeal(hands, 0, LEVEL);
    assertConservation(s0, allIds);

    // Find a legal single lead for seat 0 (its lowest card by id is fine as a single).
    const lead = s0.hands[0]![0]!;
    const s1 = play(s0, 0, [lead]);
    assertConservation(s1, allIds);
    // exactly one card left the table
    expect(s1.hands[0]!.length).toBe(26);
  });
});
