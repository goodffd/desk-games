import type { Card, Rank, Combo, ComboType } from './types';
import { rankValue } from './cards';

/**
 * Combo identification + comparison for Guandan (淮安掼蛋), WITHOUT wildcards.
 *
 * Hard rules (see SPEC「掼蛋规则」):
 * - Combo set is exactly: single / pair / triple / tripleWithPair(5) /
 *   straight(5, natural run, A high or low, no cycle, no jokers) /
 *   consecPairs(3 consecutive pairs = 6) / consecTriples(2 consecutive triples = 6) /
 *   bomb(>=4 of a kind) / straightFlush(5 same-suit natural run) /
 *   kingBomb(exactly 2 big + 2 small jokers).
 * - SEQUENCE NATURAL ORDER TRAP: in straight / consecPairs / consecTriples /
 *   straightFlush the cards participate by their *natural* rank (2→2, A→14),
 *   NOT by rankValue (where the level card 2 would be 15). So A2345 and 23456
 *   are valid; the level card 2 inside a run counts as 2.
 * - key for single/pair/triple = rankValue of the point (level→15, jokers 16/17).
 * - key for straight/consecPairs/consecTriples = highest natural rank in the run.
 * - key for tripleWithPair = rankValue of the triple point.
 * - bomb/straightFlush/kingBomb key follows the same per-type rule; power>0 only
 *   for these (tier formula in `bombPower`).
 *
 * This module NEVER imports DOM.
 */

// --- power tier constants (Global Constraints / 类型契约) ---------------------
// 4炸=1e6+key, 5炸=2e6+key, 同花顺=3e6+key, 6炸=4e6+key, 7炸=5e6+key, 8炸=6e6+key, 四大天王=9e6
const POWER_BOMB4 = 1_000_000;
const POWER_BOMB5 = 2_000_000;
const POWER_STRAIGHT_FLUSH = 3_000_000;
const POWER_BOMB6 = 4_000_000;
const POWER_BOMB7 = 5_000_000;
const POWER_BOMB8 = 6_000_000;
const POWER_KING_BOMB = 9_000_000;

const BOMB_TYPES: ReadonlySet<ComboType> = new Set<ComboType>([
  'bomb',
  'straightFlush',
  'kingBomb',
]);

function isBombType(t: ComboType): boolean {
  return BOMB_TYPES.has(t);
}

/**
 * Cross-type total order power for a bomb-class combo (bomb / straightFlush / kingBomb).
 * Non-bomb combos return 0. Used both for bomb-vs-bomb comparison and for
 * "bomb beats any non-bomb".
 */
export function bombPower(combo: Combo): number {
  switch (combo.type) {
    case 'kingBomb':
      return POWER_KING_BOMB;
    case 'straightFlush':
      return POWER_STRAIGHT_FLUSH + combo.key;
    case 'bomb':
      switch (combo.length) {
        case 4:
          return POWER_BOMB4 + combo.key;
        case 5:
          return POWER_BOMB5 + combo.key;
        case 6:
          return POWER_BOMB6 + combo.key;
        case 7:
          return POWER_BOMB7 + combo.key;
        case 8:
          return POWER_BOMB8 + combo.key;
        default:
          return POWER_BOMB8 + combo.key; // >=8 of a kind (only 8 possible w/ two decks); guard
      }
    default:
      return 0;
  }
}

// --- helpers -----------------------------------------------------------------

/** All cards are normal (no jokers)? */
function allNormal(cards: Card[]): boolean {
  return cards.every(c => c.kind === 'normal');
}

/** Group normal cards by natural rank; returns Map<naturalRank, Card[]>. Jokers ignored here. */
function groupByNaturalRank(cards: Card[]): Map<number, Card[]> {
  const m = new Map<number, Card[]>();
  for (const c of cards) {
    if (c.kind !== 'normal') continue;
    const arr = m.get(c.rank);
    if (arr) arr.push(c);
    else m.set(c.rank, [c]);
  }
  return m;
}

/**
 * Check that a set of distinct natural ranks forms a contiguous ascending run
 * with NO cross-cycle wrap (A high or A low handled by caller via rank list).
 * Input must already be the sorted, de-duplicated list of natural ranks.
 * Returns the highest rank of the run if contiguous, otherwise null.
 */
function contiguousRunTop(sortedRanks: number[]): number | null {
  for (let i = 1; i < sortedRanks.length; i++) {
    if (sortedRanks[i]! !== sortedRanks[i - 1]! + 1) return null;
  }
  return sortedRanks[sortedRanks.length - 1] ?? null;
}

/**
 * For a sequence of normal cards, derive the run-top using natural rank, trying
 * both A-high (A=14) and A-low (A=1) interpretations. Each natural rank must be
 * represented exactly `multiplicity` times and there must be `count` distinct
 * consecutive ranks. Returns the top natural rank (A-low → run with top<=5) or null.
 *
 * @param count       number of distinct ranks required (5 straight, 3 consecPairs, 2 consecTriples)
 * @param mult        multiplicity per rank (1 / 2 / 3)
 * @param allowAceLow whether the Ace may act as low=1 (true only for straights:
 *                    A2345 is a valid straight, but A-low is forbidden for
 *                    连对/钢板 — `AA2233` 跨循环 → null per SPEC/brief).
 */
function sequenceTop(
  cards: Card[],
  count: number,
  mult: number,
  allowAceLow: boolean
): number | null {
  if (!allNormal(cards)) return null;
  if (cards.length !== count * mult) return null;
  const groups = groupByNaturalRank(cards);
  if (groups.size !== count) return null;
  for (const arr of groups.values()) {
    if (arr.length !== mult) return null;
  }
  const ranks = [...groups.keys()].sort((a, b) => a - b);

  // A-high interpretation: use natural ranks as-is (2..14).
  const topHigh = contiguousRunTop(ranks);
  if (topHigh !== null) return topHigh;

  // A-low interpretation: only for straights, and only if an Ace (14) is present.
  // Remap 14→1 and retry. This lets A 2 3 4 5 work (top=5) but NOT J Q K A 2
  // (2 stays 2, no wrap) and NOT AA 22 33 (allowAceLow=false for pairs/triples).
  if (allowAceLow && groups.has(14)) {
    const lowRanks = ranks.map(r => (r === 14 ? 1 : r)).sort((a, b) => a - b);
    const topLow = contiguousRunTop(lowRanks);
    if (topLow !== null) return topLow;
  }

  return null;
}

/** Build a Combo, computing power for bomb-class types. */
function makeCombo(type: ComboType, cards: Card[], key: number): Combo {
  const combo: Combo = { type, cards, length: cards.length, key, power: 0 };
  if (isBombType(type)) {
    combo.power = bombPower(combo);
  }
  return combo;
}

// --- identify ----------------------------------------------------------------

/**
 * Identify the unique combo type of a card group, or null if it is not a legal
 * Guandan combo. Does NOT handle wildcards (red-heart level cards) — that is
 * Task 4 (`wild.ts`).
 */
export function identify(cards: Card[], level: Rank): Combo | null {
  const n = cards.length;
  if (n === 0) return null;

  // --- kingBomb: exactly 2 big + 2 small jokers ---
  if (n === 4 && cards.every(c => c.kind === 'joker')) {
    const big = cards.filter(c => c.kind === 'joker' && c.big).length;
    const small = cards.filter(c => c.kind === 'joker' && !c.big).length;
    if (big === 2 && small === 2) {
      return makeCombo('kingBomb', cards, 17); // key unused for cross-type; keep big-joker value
    }
    return null; // any other 4-joker mix is illegal
  }

  // --- single ---
  if (n === 1) {
    const c0 = cards[0]!;
    return makeCombo('single', cards, rankValue(c0, level));
  }

  // From here on, jokers may only appear inside a bomb-of-a-kind... which is
  // impossible (jokers have no rank). So any combo containing a joker (other
  // than the kingBomb handled above) is illegal.
  if (!allNormal(cards)) return null;

  const groups = groupByNaturalRank(cards);

  // --- pair ---
  if (n === 2) {
    if (groups.size === 1) {
      const c0 = cards[0]!;
      return makeCombo('pair', cards, rankValue(c0, level));
    }
    return null;
  }

  // --- triple ---
  if (n === 3) {
    if (groups.size === 1) {
      const c0 = cards[0]!;
      return makeCombo('triple', cards, rankValue(c0, level));
    }
    return null;
  }

  // --- bomb: all same natural rank, length >= 4 ---
  if (groups.size === 1) {
    // n >= 4 here (n===1/2/3 handled above)
    const c0 = cards[0]!;
    return makeCombo('bomb', cards, rankValue(c0, level));
  }

  // --- 4-card combos: only bomb (handled) ; tripleWithPair needs 5 ---
  if (n === 4) {
    // groups.size > 1 and not all-same → no legal 4-card non-bomb combo
    return null;
  }

  // --- 5-card combos: tripleWithPair, straight, straightFlush ---
  if (n === 5) {
    // tripleWithPair: one rank x3 + another rank x2
    if (groups.size === 2) {
      const sizes = [...groups.values()].map(a => a.length).sort((a, b) => a - b);
      if (sizes[0] === 2 && sizes[1] === 3) {
        let tripleRank = 0;
        for (const [rank, arr] of groups) {
          if (arr.length === 3) tripleRank = rank;
        }
        const key = rankValue(
          { kind: 'normal', suit: 'S', rank: tripleRank as Rank, id: -1 },
          level
        );
        return makeCombo('tripleWithPair', cards, key);
      }
      return null;
    }

    // straight / straightFlush: 5 distinct consecutive natural ranks
    if (groups.size === 5) {
      const top = sequenceTop(cards, 5, 1, true); // straights: A may be low (A2345)
      if (top !== null) {
        const sameSuit =
          cards.every(c => c.kind === 'normal' && c.suit === (cards[0] as { suit: unknown }).suit);
        return makeCombo(sameSuit ? 'straightFlush' : 'straight', cards, top);
      }
      return null;
    }

    return null;
  }

  // --- 6-card combos: consecPairs, consecTriples ---
  if (n === 6) {
    // consecPairs: 3 ranks x2 each, consecutive
    if (groups.size === 3) {
      const top = sequenceTop(cards, 3, 2, false); // 连对: no A-low wrap (AA2233 → null)
      if (top !== null) return makeCombo('consecPairs', cards, top);
      return null;
    }
    // consecTriples: 2 ranks x3 each, consecutive
    if (groups.size === 2) {
      const top = sequenceTop(cards, 2, 3, false); // 钢板: no A-low wrap (AAA222 → null)
      if (top !== null) return makeCombo('consecTriples', cards, top);
      return null;
    }
    return null;
  }

  // --- length 7+: only bombs (all same rank) qualify, handled by groups.size===1 above ---
  return null;
}

// --- beats -------------------------------------------------------------------

/**
 * Can combo `a` beat combo `b`?
 * - Bomb-class (bomb/straightFlush/kingBomb) beats any non-bomb.
 * - Bomb vs bomb: higher `power` wins (cross-type total order).
 * - Non-bomb vs non-bomb: must be same type AND same length, then higher key wins.
 * - Equal does NOT beat.
 */
export function beats(a: Combo, b: Combo): boolean {
  const aBomb = isBombType(a.type);
  const bBomb = isBombType(b.type);

  if (aBomb && bBomb) {
    return bombPower(a) > bombPower(b);
  }
  if (aBomb && !bBomb) {
    return true; // any bomb beats any non-bomb
  }
  if (!aBomb && bBomb) {
    return false; // non-bomb cannot beat a bomb
  }

  // both non-bombs: must match type and length
  if (a.type !== b.type) return false;
  if (a.length !== b.length) return false;
  return a.key > b.key;
}
