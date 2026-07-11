import type { Card, Rank, Suit, Combo } from './types';
import { identify } from './combos';
import { isWild } from './cards';

/**
 * 逢人配 (red-heart level card wildcards) layer for Guandan.
 *
 * A wildcard is exactly the RED-HEART card whose natural rank equals the current
 * level — i.e. `{ kind:'normal', suit:'H', rank:level }`. There are two of them in
 * a double deck. A wildcard may stand in for ANY non-joker card to help form
 * pair / triple / tripleWithPair / straight / consecPairs / consecTriples / bomb /
 * straightFlush. It may NOT be used to build the 四大天王 (kingBomb), which only
 * accepts real jokers (see SPEC「逢人配」).
 *
 * Design (avoids re-implementing the rules — `identify` stays the single source of
 * truth): separate the wildcards from the real cards, then enumerate every
 * assignment of each wildcard to a concrete NORMAL card (rank 2..14 × suit S/H/D/C).
 * For each assignment, hand `realCards + substitutes` to `identify` and collect the
 * legal combos. Return the strongest one (max power, then max key). Because the
 * substitutes are always NORMAL cards, a wildcard can never become a joker, so a
 * kingBomb is structurally impossible to fabricate; we also defensively drop any
 * kingBomb result.
 *
 * With at most 2 wildcards the search is ≤ 52² assignments of cheap `identify`
 * calls — this is "identify a GIVEN group of cards", NOT a hand search (that is
 * Task 5). This module NEVER imports DOM.
 */

const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
// Natural ranks a wildcard may impersonate: 2..14 (2 == the level point too).
const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** Count the red-heart level cards (wildcards) in `cards`. */
export function wildCount(cards: Card[], level: Rank): number {
  let n = 0;
  for (const c of cards) {
    if (isWild(c, level)) n++;
  }
  return n;
}

/**
 * `a` ranks strictly above `b` as a candidate "best" combo for a given card group.
 * Bomb-class combos carry power > 0 and dominate non-bombs; within the same power
 * tier (or both non-bombs at power 0) the higher `key` wins. This matches the
 * cross-type ordering used by `bombPower` / `beats` in combos.ts.
 */
function better(a: Combo, b: Combo): boolean {
  if (a.power !== b.power) return a.power > b.power;
  return a.key > b.key;
}

/**
 * Identify the strongest legal combo a card group can form, allowing its 0~2
 * red-heart level cards to act as wildcards. Returns null if no legal combo exists.
 *
 * - 0 wildcards → identical to `identify(cards, level)`.
 * - A lone wildcard → single, key=15 (it simply plays as the level card; handled by
 *   the 0-substitution path, since `identify([H2])` already yields single key=15).
 * - Wildcards never form a kingBomb (they cannot become jokers; result also filtered).
 */
export function identifyWithWild(cards: Card[], level: Rank): Combo | null {
  const reals: Card[] = [];
  const wilds: Card[] = [];
  for (const c of cards) {
    if (isWild(c, level)) wilds.push(c);
    else reals.push(c);
  }

  const wildN = wilds.length;

  // No wildcards: delegate straight to identify (also covers a lone level single).
  if (wildN === 0) {
    return identify(cards, level);
  }

  // A double deck holds only 2 red-heart level cards, and SPEC caps wildcards per
  // combo at 2. >2 wilds cannot legally occur; refuse rather than mis-handle.
  if (wildN > 2) {
    return null;
  }

  // We need a base id for synthetic substitute cards that won't collide with the
  // real card ids inside a single identify() call (ids must be unique per combo).
  // identify groups by suit/rank, never by id for legality, but we keep ids unique
  // to stay faithful to the Card contract.
  let synthId = -1;

  let best: Combo | null = null;

  const consider = (group: Card[]): void => {
    const combo = identify(group, level);
    if (!combo) return;
    // Wildcards may not be used to build the 四大天王. (Structurally impossible here
    // since substitutes are normal cards, but filter defensively.)
    if (combo.type === 'kingBomb') return;
    if (best === null || better(combo, best)) best = combo;
  };

  if (wildN === 1) {
    for (const rank of RANKS) {
      for (const suit of SUITS) {
        const sub: Card = { kind: 'normal', suit, rank, id: synthId-- };
        consider([...reals, sub]);
      }
    }
  } else {
    // wildN === 2 (guaranteed: 0 and 1 handled above, >2 already returned null).
    for (const r1 of RANKS) {
      for (const s1 of SUITS) {
        const sub1: Card = { kind: 'normal', suit: s1, rank: r1, id: synthId-- };
        for (const r2 of RANKS) {
          for (const s2 of SUITS) {
            const sub2: Card = { kind: 'normal', suit: s2, rank: r2, id: synthId-- };
            consider([...reals, sub1, sub2]);
          }
        }
      }
    }
  }

  return best;
}
