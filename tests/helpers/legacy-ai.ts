/**
 * 老 AI 逻辑快照（迁移前的"每次出最小一手"基础版），仅供 tests/ai-headtohead 对打基线。
 * 不要在产品代码里引用。源 = ai/ai.ts @ 本任务前的版本。
 */

import type { Card, Combo, Seat } from '../../src/games/guandan/engine/types';
import type { DealState } from '../../src/games/guandan/engine/game';
import { enumerateLeads, enumerateFollows, isLegalPlay } from '../../src/games/guandan/engine/legal';

// Bomb-class types (power > 0)
const BOMB_TYPES = new Set(['bomb', 'straightFlush', 'kingBomb']);

function isBomb(c: Combo): boolean {
  return BOMB_TYPES.has(c.type);
}

/**
 * A heuristic "cost" for a lead combo — lower is better to play first.
 *
 * Priority (ascending cost = play sooner):
 *   1. Non-bomb combos by: smaller key first, then by length (longer = more cards burned = good)
 *   2. Bombs — always deferred: penalise heavily, then sort by power ascending (weakest first)
 */
function leadCost(combo: Combo, level: number): number {
  if (!isBomb(combo)) {
    // scale key and subtract length bonus so longer (same-key) combos are slightly cheaper
    return combo.key * 100 - combo.length;
  }
  // Bombs: base offset 1e9 so they always rank after non-bombs; within bombs, weakest first
  return 1_000_000_000 + combo.power;
}

/** Sort combos by leadCost ascending (in-place mutation of the provided copy). */
function sortByLeadCost(combos: Combo[], level: number): Combo[] {
  return [...combos].sort((a, b) => leadCost(a, level) - leadCost(b, level));
}

/**
 * Among follow combos, pick the "cheapest" one to play:
 *   - prefer non-bombs (cost = power ~ key ~ length)
 *   - among non-bombs: smallest key, then shortest
 *   - among bombs: smallest power (weakest bomb first)
 */
function pickCheapestFollow(combos: Combo[]): Combo {
  const nonBombs = combos.filter(c => !isBomb(c));
  const bombs = combos.filter(c => isBomb(c));

  if (nonBombs.length > 0) {
    // smallest key, tie-break by length ascending (use fewest cards)
    return nonBombs.reduce((best, c) =>
      c.key < best.key || (c.key === best.key && c.length < best.length) ? c : best
    );
  }
  // only bombs remain
  return bombs.reduce((best, c) => (c.power < best.power ? c : best));
}

/**
 * Main legacy AI entry point.
 *
 * @param s   The current DealState.
 * @param seat The seat whose turn it is (must equal s.turn in normal play, but AI doesn't
 *             enforce this — caller's responsibility).
 * @returns   Cards to play (non-empty array, always legal), or null to pass.
 *            null is ONLY returned when following (s.current != null).
 */
export function legacyChoosePlay(s: DealState, seat: Seat): Card[] | null {
  const hand = s.hands[seat]!;
  const level = s.level;

  // ---- LEAD (free play) --------------------------------------------------------
  if (s.current === null) {
    // Must play something when hand is non-empty (guaranteed by the caller, but guard anyway).
    if (hand.length === 0) return null;

    const leads = enumerateLeads(hand, level);
    if (leads.length === 0) {
      // Shouldn't happen with a non-empty hand, but be safe.
      return [hand[0]!];
    }

    const sorted = sortByLeadCost(leads, level);
    return sorted[0]!.cards;
  }

  // ---- FOLLOW ------------------------------------------------------------------
  const partner = ((seat + 2) % 4) as Seat;
  const partnerLeads = s.current.by === partner;

  if (partnerLeads) {
    // Partner is winning this trick. Strongly prefer to pass and let partner take it.
    // Only override if we have nothing else meaningful to do — in the basic AI, always pass
    // when partner leads (we never "help" by pressing). This satisfies the TDD weak assertion.
    return null;
  }

  const follows = enumerateFollows(hand, s.current.combo, level);

  if (follows.length === 0) {
    // Nothing can beat current — must pass.
    return null;
  }

  // Opponent leads — try to beat them.
  const best = pickCheapestFollow(follows);
  return best.cards;
}
