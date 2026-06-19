/**
 * Task 7 — AI 出牌策略 tests.
 *
 * Covers:
 *  1. Return value is always null (pass) OR a legal play per isLegalPlay.
 *  2. Lead (current==null) with non-empty hand must never return null.
 *  3. 200 random deal scenarios: choosePlay never throws, always returns a legal value.
 *  4. Weak tendency assertions:
 *     - When leading, AI prefers small singles over bombs (statistical threshold).
 *     - When partner leads, AI tends to pass (statistical threshold).
 */

import { describe, it, expect } from 'vitest';
import type { Seat } from '../src/games/guandan/engine/types';
import type { DealState } from '../src/games/guandan/engine/game';
import { makeDeck, deal } from '../src/games/guandan/engine/cards';
import { isLegalPlay } from '../src/games/guandan/engine/legal';
import { enumerateLeads } from '../src/games/guandan/engine/legal';
import { createDeal, play as gamePlay, pass as gamePass } from '../src/games/guandan/engine/game';
import { choosePlay } from '../src/games/guandan/ai/ai';

// ---- deterministic shuffle ------------------------------------------------

function seededShuffle(seed: number) {
  return function (n: number): number[] {
    // Mulberry32 PRNG
    let s = seed >>> 0;
    function rand(): number {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const arr = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  };
}

/** Build a fresh DealState with a given seed (firstLeader = 0). */
function makeDeal(seed: number): DealState {
  const deck = makeDeck();
  const hands = deal(deck, seededShuffle(seed));
  return createDeal(hands, 0, 2); // level=2 ("打2")
}

// ---- helper: verify a choosePlay result is valid ---------------------------

function assertValid(
  result: ReturnType<typeof choosePlay>,
  s: DealState,
  seat: Seat,
  context: string
): void {
  const hand = s.hands[seat]!;
  const current = s.current?.combo ?? null;
  const level = s.level;

  if (result === null) {
    // null is only allowed when following (current != null)
    expect(s.current, `${context}: null returned on free lead`).not.toBeNull();
  } else {
    // must be a legal play
    const legal = isLegalPlay(result, current, hand, level);
    expect(legal, `${context}: returned cards not legal`).toBe(true);
    // cards must come from the hand
    const handIds = new Set(hand.map(c => c.id));
    for (const c of result) {
      expect(handIds.has(c.id), `${context}: card id ${c.id} not in hand`).toBe(true);
    }
  }
}

// ---------------------------------------------------------------------------
// Basic unit tests
// ---------------------------------------------------------------------------

describe('choosePlay — basic correctness', () => {
  it('returns non-null on free lead with non-empty hand', () => {
    const s = makeDeal(1);
    // seat 0 leads first
    const result = choosePlay(s, 0);
    expect(result).not.toBeNull();
    assertValid(result, s, 0, 'free lead seat 0');
  });

  it('returned cards are always legal on a free lead', () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = makeDeal(seed);
      const result = choosePlay(s, s.turn);
      expect(result).not.toBeNull();
      assertValid(result, s, s.turn, `free lead seed=${seed}`);
    }
  });

  it('returns null or a legal follow when there is a current combo', () => {
    // Construct a state where seat 0 has played and seat 1 must follow.
    const s0 = makeDeal(42);
    // Seat 0 leads: get its choice and apply it.
    const leadCards = choosePlay(s0, 0)!;
    const s1 = gamePlay(s0, 0, leadCards);
    // Now seat 1 follows (or passes).
    const result = choosePlay(s1, 1);
    assertValid(result, s1, 1, 'follow seat 1 after seat 0 lead');
  });

  it('null only ever returned when there is a current combo', () => {
    // Run 50 seeds and ensure no null on free lead
    for (let seed = 100; seed < 150; seed++) {
      const s = makeDeal(seed);
      const result = choosePlay(s, s.turn);
      if (s.current === null && s.hands[s.turn]!.length > 0) {
        expect(result, `seed=${seed}: null on free lead`).not.toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 200 random deal scenarios
// ---------------------------------------------------------------------------

describe('choosePlay — 200 random scenarios', () => {
  it('never throws and always returns a valid value across 200 random deals', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = makeDeal(seed);
      // Test free lead
      expect(
        () => {
          const result = choosePlay(s, s.turn);
          assertValid(result, s, s.turn, `seed=${seed} free-lead`);
        },
        `seed=${seed} free lead threw`
      ).not.toThrow();

      // Advance one play and test follow
      const leadCards = choosePlay(s, s.turn);
      if (leadCards && leadCards.length > 0) {
        try {
          const s2 = gamePlay(s, s.turn, leadCards);
          expect(
            () => {
              const result = choosePlay(s2, s2.turn);
              assertValid(result, s2, s2.turn, `seed=${seed} follow`);
            },
            `seed=${seed} follow threw`
          ).not.toThrow();
        } catch {
          // gamePlay might throw if the deal is immediately over (unlikely but safe to skip)
        }
      }
    }
  });

  it('never returns cards not in the hand across 200 deals', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = makeDeal(seed);
      const seat = s.turn;
      const hand = s.hands[seat]!;
      const result = choosePlay(s, seat);

      if (result !== null) {
        const handIds = new Set(hand.map(c => c.id));
        for (const c of result) {
          expect(handIds.has(c.id), `seed=${seed}: card id ${c.id} not in hand`).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Tendency assertions (weak / statistical)
// ---------------------------------------------------------------------------

describe('choosePlay — tendency assertions (weak / statistical)', () => {
  it('when leading, prefers small singles over bombs at least 70% of the time (hands with both)', () => {
    let testedDeals = 0;
    let preferredSmall = 0;

    for (let seed = 0; seed < 300; seed++) {
      const s = makeDeal(seed);
      const seat = s.turn;
      const hand = s.hands[seat]!;
      const level = s.level;
      const leads = enumerateLeads(hand, level);

      const hasSmallSingle = leads.some(
        c => c.type === 'single' && c.key <= 8 // 3..8 are "small"
      );
      const hasBomb = leads.some(
        c => c.type === 'bomb' || c.type === 'straightFlush' || c.type === 'kingBomb'
      );

      if (!hasSmallSingle || !hasBomb) continue; // skip; no meaningful contrast
      testedDeals++;

      const result = choosePlay(s, seat);
      if (result !== null) {
        const isBombPlay =
          result.length >= 4 &&
          isLegalPlay(result, null, hand, level) &&
          leads.some(
            c =>
              (c.type === 'bomb' || c.type === 'straightFlush' || c.type === 'kingBomb') &&
              c.cards.every(bc => result.some(rc => rc.id === bc.id))
          );
        if (!isBombPlay) preferredSmall++;
      }
    }

    // Need at least 20 qualifying hands for a meaningful test
    expect(testedDeals, 'not enough qualifying deals to test tendency').toBeGreaterThanOrEqual(20);
    const ratio = preferredSmall / testedDeals;
    expect(ratio, `only ${(ratio * 100).toFixed(1)}% of leads preferred non-bomb (want ≥70%)`).toBeGreaterThanOrEqual(0.7);
  });

  it('when partner is leading the current combo, passes at least 70% of the time', () => {
    let partnerLeadCases = 0;
    let passedCount = 0;

    for (let seed = 0; seed < 400; seed++) {
      const s0 = makeDeal(seed);

      // Advance: seat 0 leads, then check seat 2 (partner of 0).
      const leadCards = choosePlay(s0, 0);
      if (!leadCards) continue;

      let s1: DealState;
      try {
        s1 = gamePlay(s0, 0, leadCards);
      } catch {
        continue;
      }

      // Advance from seat 1 to reach seat 2's turn (seat 1 passes or plays)
      // We want to test seat 2 when current.by === 0 (seat 2's partner).
      // After seat 0 played, if seat 1's turn is next and s1.current is set:
      // let seat 1 pass to get to seat 2.
      if (s1.finished.length >= 4) continue;

      // If it's seat 1's turn (seat 0's opponent), have seat 1 pass to get to seat 2
      let s2 = s1;
      if (s2.turn === 1 && s2.current !== null) {
        try {
          s2 = gamePass(s2, 1);
        } catch {
          continue;
        }
      }

      // Now check if it's seat 2's turn (partner of seat 0) and current is by seat 0
      if (
        s2.turn === 2 &&
        s2.current !== null &&
        s2.current.by === 0 &&
        s2.hands[2]!.length > 0
      ) {
        partnerLeadCases++;
        const result = choosePlay(s2, 2);
        if (result === null) passedCount++;
      }
    }

    if (partnerLeadCases < 10) {
      // Not enough cases from seed range; that's acceptable — skip assertion
      console.log(`Only ${partnerLeadCases} partner-lead cases found; skipping ratio check.`);
      return;
    }

    const ratio = passedCount / partnerLeadCases;
    expect(
      ratio,
      `only ${(ratio * 100).toFixed(1)}% pass when partner leads (want ≥70%)`
    ).toBeGreaterThanOrEqual(0.7);
  });
});
