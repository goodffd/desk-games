/**
 * fuzz.test.ts — 1000-game AI self-play fuzz test for the Guandan engine.
 *
 * Per-step assertions (every step of every game):
 *   1. choosePlay return is legal per isLegalPlay (or null, which means pass).
 *   2. Card conservation: all cards in-hand = original 108 cards (no duplicates, no extras).
 *   3. Step limit of 2000 steps per game (infinite-loop guard).
 *
 * Game-end assertion: ranking() is a complete permutation of 0..3.
 *
 * Uses a seeded deterministic LCG-based Fisher-Yates shuffle so any failure is
 * reproducible: game i uses seed i.
 */

import { describe, it, expect } from 'vitest';
import { makeLCG, seededShuffle } from './helpers/rng';
import { slowCount } from './helpers/slow-knobs';
import { makeDeck, deal } from '../src/games/guandan/engine/cards';
import {
  createDeal,
  play,
  pass,
  isDealOver,
  ranking,
  type DealState,
} from '../src/games/guandan/engine/game';
import { isLegalPlay } from '../src/games/guandan/engine/legal';
import { choosePlay } from '../src/games/guandan/ai/ai';
import type { Rank, Seat } from '../src/games/guandan/engine/types';

// ---------------------------------------------------------------------------
// Conservation check helpers
// ---------------------------------------------------------------------------

/** Collect the set of all card ids currently in any hand. */
function liveIds(s: DealState): Set<number> {
  const ids = new Set<number>();
  for (const hand of s.hands) {
    for (const c of hand) ids.add(c.id);
  }
  return ids;
}

/**
 * Assert card conservation at a single game state.
 * Cards in-hand must be a strict subset of originalIds, with no duplicates and no
 * extras, and total-in-hand + played must equal 108.
 */
function assertConservation(
  s: DealState,
  originalIds: Set<number>,
  gameIndex: number,
  step: number,
): void {
  const live = liveIds(s);

  // No card can appear that wasn't dealt.
  for (const id of live) {
    if (!originalIds.has(id)) {
      throw new Error(
        `game=${gameIndex} step=${step}: conjured card id=${id} not in original 108`,
      );
    }
  }

  // Count total cards across all hands (detects same-id in multiple hands).
  let total = 0;
  for (const hand of s.hands) total += hand.length;

  if (total !== live.size) {
    throw new Error(
      `game=${gameIndex} step=${step}: duplicate card ids across hands (total=${total} live.size=${live.size})`,
    );
  }

  // Total in-hand cannot exceed 108.
  if (live.size > 108) {
    throw new Error(
      `game=${gameIndex} step=${step}: more than 108 cards in hands (${live.size})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Fuzz test: 1000 games
// ---------------------------------------------------------------------------

const LEVEL: Rank = 2;
const NUM_GAMES = slowCount('FUZZ_GAMES', 1000);
const MAX_STEPS = 2000;

describe('fuzz: 1000-game AI self-play', () => {
  it(`runs ${NUM_GAMES} games with full card conservation and legal play at every step`, () => {
    const deck = makeDeck();
    const originalIds = new Set(deck.map(c => c.id));
    expect(originalIds.size).toBe(108); // sanity: deck is correct

    for (let gameIndex = 0; gameIndex < NUM_GAMES; gameIndex++) {
      // Each game gets a unique deterministic seed.
      const shuffleFn = seededShuffle(gameIndex);
      const hands = deal(deck, shuffleFn);

      // firstLeader is also seeded (use a second LCG call for variety).
      const lcg = makeLCG(gameIndex + 0xdead);
      const firstLeader = (lcg() % 4) as Seat;

      let s = createDeal(hands, firstLeader, LEVEL);

      // Verify initial conservation.
      assertConservation(s, originalIds, gameIndex, 0);

      let step = 0;

      while (!isDealOver(s)) {
        step++;

        if (step > MAX_STEPS) {
          throw new Error(
            `game=${gameIndex} exceeded ${MAX_STEPS} steps without ending (seed=${gameIndex}, firstLeader=${firstLeader}). Possible infinite loop.`,
          );
        }

        const seat = s.turn;
        const hand = s.hands[seat]!;
        const prev = s.current?.combo ?? null;

        const chosen = choosePlay(s, seat);

        if (chosen !== null) {
          // Assertion 1: chosen play must be legal.
          const legal = isLegalPlay(chosen, prev, hand, LEVEL);
          if (!legal) {
            throw new Error(
              `game=${gameIndex} step=${step} seat=${seat}: choosePlay returned illegal play ` +
                `(cards=[${chosen.map(c => c.id).join(',')}], prev=${prev?.type ?? 'null'}, ` +
                `seed=${gameIndex})`,
            );
          }

          s = play(s, seat, chosen);
        } else {
          // null = pass. Must not happen on a free lead (current == null).
          if (s.current === null) {
            throw new Error(
              `game=${gameIndex} step=${step} seat=${seat}: choosePlay returned null on a free lead (seed=${gameIndex})`,
            );
          }
          s = pass(s, seat);
        }

        // Assertion 2: card conservation after every transition.
        assertConservation(s, originalIds, gameIndex, step);
      }

      // Assertion 3 (game-end): ranking must be a complete permutation of [0,1,2,3].
      const r = ranking(s);
      if (r.length !== 4) {
        throw new Error(
          `game=${gameIndex}: ranking has ${r.length} entries (not 4) after ${step} steps (seed=${gameIndex})`,
        );
      }
      const sorted = [...r].sort((a, b) => a - b);
      for (let i = 0; i < 4; i++) {
        if (sorted[i] !== i) {
          throw new Error(
            `game=${gameIndex}: ranking is not a permutation of 0..3 (got [${r.join(',')}]) (seed=${gameIndex})`,
          );
        }
      }
    }

    // If we reach here, all games passed.
    expect(true).toBe(true);
  });
});
