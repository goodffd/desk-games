import type { Card, Rank, Suit, Combo, ComboType } from './types';
import { rankValue, isWild } from './cards';
import { identify, beats } from './combos';

/**
 * Legal-play enumeration for Guandan (Task 5). Pure functions, NEVER imports DOM.
 *
 * Three public entry points:
 * - `enumerateLeads(hand, level)`       — all legal combos a hand can lead with (de-duped).
 * - `enumerateFollows(hand, cur, level)` — all combos that BEAT `cur` (same-type/length
 *   bigger key, PLUS every bomb-class combo that beats it).
 * - `isLegalPlay(cards, cur, hand, level)` — UI gate: `cards ⊆ hand` AND some legal reading
 *   of `cards` is (a lead when cur==null) / (beats cur otherwise).
 *
 * KEY CROSS-TASK RULING (from the coordinator): `identifyWithWild(cards)` only returns the
 * SINGLE strongest reading of a fixed group. That is insufficient here for two reasons:
 *   1. A group containing wildcards can have several legal readings; when following we need
 *      "the reading that can beat `cur`", which is not necessarily the strongest one.
 *   2. Finding playable combos from a hand must be STRUCTURALLY generated (rank counts +
 *      wildcard placement), never by enumerating all 2^27 subsets.
 * So this module provides `allReadings(cards, level)` returning EVERY legal reading of a
 * fixed group (deduped), used by `isLegalPlay`; and it generates hand combos structurally.
 */

// ---------------------------------------------------------------------------
// wildcard helpers
// ---------------------------------------------------------------------------

/** 逢人配判定收敛在 cards.ts；此处再导出，供 ai/decompose 沿用 `from './legal'` 的既有引用。 */
export { isWild };

const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
// Natural ranks a wildcard / structural slot may take: 2..14.
const NAT_RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

// ---------------------------------------------------------------------------
// canonical key for de-duplication
// ---------------------------------------------------------------------------

/**
 * Canonical signature for a combo, used to de-dup the enumerated lists. Two combos
 * that are interchangeable for the rules (same type, length, key, and same multiset
 * of natural points among their cards) collapse to one entry — we keep the first
 * concrete card set found. Joker presence is encoded too (kingBomb).
 */
function comboKey(c: Combo): string {
  const pts: number[] = c.cards
    .map(card => (card.kind === 'joker' ? (card.big ? 117 : 116) : card.rank))
    .sort((a, b) => a - b);
  return `${c.type}|${c.length}|${c.key}|${pts.join(',')}`;
}

// ---------------------------------------------------------------------------
// allReadings — every legal reading of a FIXED card group (0~2 wildcards)
// ---------------------------------------------------------------------------

/**
 * Return ALL legal combo readings of a fixed card group, allowing its 0~2 red-heart
 * level cards to act as wildcards. De-duplicated by canonical key. Unlike
 * `identifyWithWild` (which returns only the strongest reading) this keeps every
 * distinct legal reading, so callers can ask "is there ANY reading that beats X?".
 *
 * The returned combos carry the ORIGINAL cards (including the wildcard cards), so the
 * combo's `cards` is always a faithful subset of the input group. Only the combo's
 * `type/length/key/power` reflect the chosen wildcard assignment.
 */
export function allReadings(cards: Card[], level: Rank): Combo[] {
  if (cards.length === 0) return [];

  const reals: Card[] = [];
  const wilds: Card[] = [];
  for (const c of cards) {
    if (isWild(c, level)) wilds.push(c);
    else reals.push(c);
  }
  const wildN = wilds.length;

  // SPEC caps wildcards per combo at 2 (only 2 red-heart level cards exist).
  if (wildN > 2) return [];

  const out = new Map<string, Combo>();
  let synthId = -1;

  // Helper: identify a substitute group; if legal & not a fabricated kingBomb,
  // re-wrap with the ORIGINAL cards and record it.
  const consider = (substitutes: Card[]): void => {
    const group = [...reals, ...substitutes];
    const combo = identify(group, level);
    if (!combo) return;
    // Wildcards may never fabricate a 四大天王 (only real jokers qualify). Substitutes
    // are normal cards so identify can't return kingBomb from them, but guard anyway.
    if (combo.type === 'kingBomb' && wildN > 0) return;
    // Re-attach the real input cards (with the actual wildcard cards) so `combo.cards`
    // is a genuine subset of the input group, not synthetic substitutes.
    const reading: Combo = {
      type: combo.type,
      cards,
      length: cards.length,
      key: combo.key,
      power: combo.power,
    };
    const k = comboKey(reading);
    if (!out.has(k)) out.set(k, reading);
  };

  if (wildN === 0) {
    consider([]);
  } else if (wildN === 1) {
    for (const rank of NAT_RANKS) {
      for (const suit of SUITS) {
        consider([{ kind: 'normal', suit, rank, id: synthId-- }]);
      }
    }
  } else {
    // wildN === 2
    for (const r1 of NAT_RANKS) {
      for (const s1 of SUITS) {
        const sub1: Card = { kind: 'normal', suit: s1, rank: r1, id: synthId-- };
        for (const r2 of NAT_RANKS) {
          for (const s2 of SUITS) {
            const sub2: Card = { kind: 'normal', suit: s2, rank: r2, id: synthId-- };
            consider([sub1, sub2]);
          }
        }
      }
    }
  }

  return [...out.values()];
}

// ---------------------------------------------------------------------------
// structured generation primitives
// ---------------------------------------------------------------------------

interface HandIndex {
  /** real (non-wildcard) cards grouped by natural rank → list of cards */
  byRank: Map<number, Card[]>;
  /** real cards grouped by suit → (natural rank → list of cards) */
  bySuitRank: Map<Suit, Map<number, Card[]>>;
  /** the wildcard cards (red-heart level), at most 2 */
  wilds: Card[];
  /** all jokers, split */
  bigJokers: Card[];
  smallJokers: Card[];
  /** the natural rank of the current level (red-heart cards of this rank are the wilds) */
  levelPoint: number;
}

function indexHand(hand: Card[], level: Rank): HandIndex {
  const byRank = new Map<number, Card[]>();
  const bySuitRank = new Map<Suit, Map<number, Card[]>>();
  const wilds: Card[] = [];
  const bigJokers: Card[] = [];
  const smallJokers: Card[] = [];

  for (const c of hand) {
    if (c.kind === 'joker') {
      if (c.big) bigJokers.push(c);
      else smallJokers.push(c);
      continue;
    }
    if (isWild(c, level)) {
      wilds.push(c);
      continue;
    }
    // real normal card
    const ra = byRank.get(c.rank);
    if (ra) ra.push(c);
    else byRank.set(c.rank, [c]);

    let sm = bySuitRank.get(c.suit);
    if (!sm) {
      sm = new Map<number, Card[]>();
      bySuitRank.set(c.suit, sm);
    }
    const sa = sm.get(c.rank);
    if (sa) sa.push(c);
    else sm.set(c.rank, [c]);
  }

  return { byRank, bySuitRank, wilds, bigJokers, smallJokers, levelPoint: level };
}

/** Pick `count` cards of natural `rank` from the index (real cards only). */
function takeReal(idx: HandIndex, rank: number, count: number): Card[] | null {
  const arr = idx.byRank.get(rank);
  if (!arr || arr.length < count) return null;
  return arr.slice(0, count);
}

/**
 * Candidate combo-component points for a hand: every distinct REAL natural rank, PLUS
 * the LEVEL point itself whenever wildcards are present. Red-heart-2 wildcards may play
 * as their own level rank (e.g. two wilds = a level pair), so the level point is a valid
 * component point even when the hand holds no real level card. (When a real level card
 * IS present, the level point already appears as a real rank; we de-dup with a Set.)
 */
function candidatePoints(idx: HandIndex): number[] {
  const s = new Set<number>(idx.byRank.keys());
  if (idx.wilds.length > 0) s.add(idx.levelPoint);
  return [...s].sort((a, b) => a - b);
}

/**
 * Take `count` cards forming a single-point group at natural `rank`, drawing REAL cards
 * of that rank first and filling any deficit from the wildcard pool, given a per-call
 * wild budget. Wilds fill the deficit by acting AS rank `rank` (a substitute, or — when
 * `rank` is the level point — their own literal level card; either way the concrete group
 * is later validated by `allReadings`). Returns the chosen cards and how many wilds it
 * consumed, or null if it cannot be formed within `wildBudget`.
 */
function takeAtPoint(
  idx: HandIndex,
  rank: number,
  count: number,
  wildBudget: number,
  wildOffset: number
): { cards: Card[]; wildsUsed: number } | null {
  const real = idx.byRank.get(rank);
  const realN = real ? Math.min(real.length, count) : 0;
  const deficit = count - realN;
  if (deficit > wildBudget) return null;
  if (deficit + wildOffset > idx.wilds.length) return null;
  const out: Card[] = [];
  if (realN > 0) out.push(...real!.slice(0, realN));
  for (let i = 0; i < deficit; i++) out.push(idx.wilds[wildOffset + i]!);
  return { cards: out, wildsUsed: deficit };
}

/**
 * Build & validate a combo from a concrete card list using the wildcard-aware reader,
 * then push the strongest legal reading whose type matches `wantType` into `out`.
 * Returns the recorded combo or null. We use `allReadings` so wildcard placements that
 * yield the intended structure are honoured; we then pick the reading matching wantType
 * (there is at most one per (type,length,key,points) signature).
 */
function record(out: Map<string, Combo>, cards: Card[], wantType: ComboType, level: Rank): void {
  for (const reading of allReadings(cards, level)) {
    if (reading.type !== wantType) continue;
    const k = comboKey(reading);
    if (!out.has(k)) out.set(k, reading);
  }
}

// ---------------------------------------------------------------------------
// enumerateLeads — structured generation of all legal leads
// ---------------------------------------------------------------------------

/**
 * All legal combos a hand can LEAD with (current == null), de-duplicated.
 * Generated structurally per combo type with wildcard placement; never by 2^27 subsets.
 */
export function enumerateLeads(hand: Card[], level: Rank): Combo[] {
  const idx = indexHand(hand, level);
  const W = idx.wilds.length; // 0..2
  const out = new Map<string, Combo>();

  const realRanks = [...idx.byRank.keys()].sort((a, b) => a - b);
  // count helper (real cards only)
  const cnt = (r: number): number => idx.byRank.get(r)?.length ?? 0;

  // ----- singles -----
  // every distinct real point, every joker, and the level wildcard played alone.
  for (const r of realRanks) {
    record(out, takeReal(idx, r, 1)!, 'single', level);
  }
  for (const j of [...idx.bigJokers, ...idx.smallJokers]) {
    record(out, [j], 'single', level);
  }
  for (const w of idx.wilds) {
    record(out, [w], 'single', level);
  }

  // ----- pairs (2 same point) -----
  // Candidate points include the level point: two red-heart-2 wilds form a level pair
  // (key 15) even with no real level card. `takeAtPoint` draws reals first then wilds.
  for (const r of candidatePoints(idx)) {
    const got = takeAtPoint(idx, r, 2, W, 0);
    if (got) record(out, got.cards, 'pair', level);
  }
  // 对王(双小王/双大王)：两张同种真王成对(owner ruling 2026-06-21)；一大一小不算对，逢人配不可凑王对。
  if (idx.bigJokers.length >= 2) record(out, [idx.bigJokers[0]!, idx.bigJokers[1]!], 'pair', level);
  if (idx.smallJokers.length >= 2) record(out, [idx.smallJokers[0]!, idx.smallJokers[1]!], 'pair', level);

  // ----- triples (3 same point) -----
  // Same candidate-point treatment; a level triple needs ≥1 real level card since only
  // two wilds exist, which `takeAtPoint`'s wild-budget check enforces naturally.
  for (const r of candidatePoints(idx)) {
    const got = takeAtPoint(idx, r, 3, W, 0);
    if (got) record(out, got.cards, 'triple', level);
  }

  // ----- tripleWithPair (3 of point A + 2 of point B, A != B) -----
  // We need a triple structure and a pair structure on DISTINCT points that share the
  // wildcard budget. Candidate points include every real rank PLUS the LEVEL point (which
  // red-heart-2 wilds can fill as their own level rank) — that is the root-cause fix: e.g.
  // {S5,H5,D5,红2,红2} = triple-5 + a level pair built from the two wilds. `takeAtPoint`
  // draws real cards first then wilds; we allocate the triple's wilds at offset 0 and the
  // pair's at the offset following them so no wild is double-spent.
  {
    const pts = candidatePoints(idx);
    for (const t of pts) {
      const tri = takeAtPoint(idx, t, 3, W, 0);
      if (!tri) continue;
      const remW = W - tri.wildsUsed;
      for (const p of pts) {
        if (t === p) continue;
        const pair = takeAtPoint(idx, p, 2, remW, tri.wildsUsed);
        if (!pair) continue;
        const group = [...tri.cards, ...pair.cards];
        if (group.length !== 5) continue;
        record(out, group, 'tripleWithPair', level);
      }
    }
  }

  // ----- straight (5 distinct consecutive natural ranks; A high or low) -----
  enumerateRuns(idx, out, level, 5, 1, 'straight');

  // ----- consecPairs (3 consecutive ranks x2) -----
  enumerateRuns(idx, out, level, 3, 2, 'consecPairs');

  // ----- consecTriples (2 consecutive ranks x3) -----
  enumerateRuns(idx, out, level, 2, 3, 'consecTriples');

  // ----- straightFlush (5 consecutive, same suit) -----
  enumerateStraightFlush(idx, out, level);

  // ----- bombs (>=4 same point, lengths 4..8) -----
  for (const r of realRanks) {
    const c = cnt(r);
    for (let len = 4; len <= 8; len++) {
      const needWild = len - c;
      if (needWild < 0) {
        // we have MORE than `len` of this rank → take exactly `len` (a shorter bomb).
        record(out, takeReal(idx, r, len)!, 'bomb', level);
      } else if (needWild <= W && c >= 1) {
        // need wildcards to reach `len`; must have at least 1 real card of the rank
        // (otherwise it's an all-wild "bomb" which can't define a point).
        const group = [...takeReal(idx, r, c)!];
        for (let i = 0; i < needWild; i++) group.push(idx.wilds[i]!);
        if (group.length === len) record(out, group, 'bomb', level);
      }
    }
  }

  // ----- kingBomb (2 big + 2 small REAL jokers; wildcards NOT allowed) -----
  if (idx.bigJokers.length >= 2 && idx.smallJokers.length >= 2) {
    record(
      out,
      [idx.bigJokers[0]!, idx.bigJokers[1]!, idx.smallJokers[0]!, idx.smallJokers[1]!],
      'kingBomb',
      level
    );
  }

  return [...out.values()];
}

/**
 * Enumerate runs (straight / consecPairs / consecTriples) of `count` consecutive
 * natural ranks, each rank with multiplicity `mult`, allowing wildcards to fill
 * per-rank deficits. Records each found combo under `wantType`.
 *
 * A-low handling: only straights (count=5, mult=1) allow Ace as low (A2345). For
 * connected pairs/triples the natural run must not wrap (matches combos.ts).
 */
function enumerateRuns(
  idx: HandIndex,
  out: Map<string, Combo>,
  level: Rank,
  count: number,
  mult: number,
  wantType: ComboType
): void {
  const W = idx.wilds.length;
  const cnt = (r: number): number => idx.byRank.get(r)?.length ?? 0;

  // Candidate top ranks. Natural straights: lowest run is A-2-3-4-5 (top=5, using A as 1),
  // highest is 10-J-Q-K-A (top=14). For pairs/triples we forbid A-low, so the lowest run
  // starts at 2 (top = 2 + count - 1) and the highest tops at A (14).
  const allowAceLow = wantType === 'straight';

  // We model runs by their list of natural ranks. For A-high, ranks are consecutive
  // integers ending at top in [count..14]? We just iterate over start ranks.
  type Run = number[];
  const runs: Run[] = [];

  // A-high (and mid) runs: start s from 2.. so that s+count-1 <= 14, ranks = [s..s+count-1]
  for (let s = 2; s + count - 1 <= 14; s++) {
    const r: Run = [];
    for (let i = 0; i < count; i++) r.push(s + i);
    runs.push(r);
  }
  // A-low run (straights only): A(=14) acts as 1, run = [1..count] but represented with A.
  if (allowAceLow) {
    // ranks 1..count where 1 means Ace. e.g. count=5 → A,2,3,4,5
    const r: Run = [];
    for (let i = 1; i <= count; i++) r.push(i === 1 ? 14 : i); // store A as natural 14
    // ensure it's actually a wrap-using run (contains the Ace acting low)
    runs.push(r);
  }

  for (const run of runs) {
    // For each rank in the run we need `mult` copies; deficits filled by wilds.
    // First compute total wild deficit and per-rank picks. An entirely missing rank
    // (have===0) is still fillable by wildcards, so we keep going either way.
    let totalDeficit = 0;
    const picks: Array<{ rank: number; real: number }> = [];
    for (const rank of run) {
      const have = cnt(rank);
      const use = Math.min(have, mult);
      totalDeficit += mult - use;
      picks.push({ rank, real: use });
    }
    if (totalDeficit > W) continue; // not enough wildcards
    // Build the group.
    const group: Card[] = [];
    let ok = true;
    for (const pk of picks) {
      if (pk.real > 0) {
        const got = takeReal(idx, pk.rank, pk.real);
        if (!got) {
          ok = false;
          break;
        }
        group.push(...got);
      }
    }
    if (!ok) continue;
    for (let i = 0; i < totalDeficit; i++) group.push(idx.wilds[i]!);
    if (group.length !== count * mult) continue;
    record(out, group, wantType, level);
  }
}

/**
 * Enumerate same-suit 5-card straights (straightFlush), allowing wildcards to fill gaps.
 * Wildcards are suitless stand-ins, so a flush only needs the REAL cards to share a suit;
 * the wild fills the missing rank in that suit. (combos.ts checks same-suit on the concrete
 * substitute suit, which `allReadings` will try, so we hand it real-same-suit + wild.)
 */
function enumerateStraightFlush(idx: HandIndex, out: Map<string, Combo>, level: Rank): void {
  const W = idx.wilds.length;
  const count = 5;

  for (const rankMap of idx.bySuitRank.values()) {
    const cntS = (r: number): number => rankMap.get(r)?.length ?? 0;

    // candidate runs of 5 consecutive natural ranks, A-high or A-low
    type Run = number[];
    const runs: Run[] = [];
    for (let s = 2; s + count - 1 <= 14; s++) {
      const r: Run = [];
      for (let i = 0; i < count; i++) r.push(s + i);
      runs.push(r);
    }
    // A-low: A 2 3 4 5
    runs.push([14, 2, 3, 4, 5]);

    for (const run of runs) {
      let deficit = 0;
      const group: Card[] = [];
      for (const rank of run) {
        if (cntS(rank) >= 1) {
          group.push(rankMap.get(rank)![0]!);
        } else {
          deficit++;
        }
      }
      if (deficit > W) continue;
      if (group.length === 0) continue; // need at least 1 real suited card
      for (let i = 0; i < deficit; i++) group.push(idx.wilds[i]!);
      if (group.length !== count) continue;
      record(out, group, 'straightFlush', level);
    }
  }
}

// ---------------------------------------------------------------------------
// enumerateFollows — combos that beat `current`
// ---------------------------------------------------------------------------

/**
 * All combos in `hand` that BEAT `current`, de-duplicated:
 * - same-type same-length combos with a bigger key (via `beats`), AND
 * - every bomb-class combo (bomb / straightFlush / kingBomb) that beats `current`.
 *
 * We enumerate all leads then filter by `beats(lead, current)`. `beats` already
 * encodes "bomb beats any non-bomb" and the cross-bomb power order, so bombs are
 * included automatically whenever they out-power `current`. Because `enumerateLeads`
 * structurally generates EVERY bomb (incl. wild-completed ones, straightFlush, and the
 * 四大天王), no bomb that legally beats `current` is ever missed.
 */
export function enumerateFollows(hand: Card[], current: Combo, level: Rank): Combo[] {
  const leads = enumerateLeads(hand, level);
  const out = new Map<string, Combo>();
  for (const c of leads) {
    if (beats(c, current)) {
      out.set(comboKey(c), c);
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// isLegalPlay — UI validation gate
// ---------------------------------------------------------------------------

/**
 * Is playing `cards` legal given the table `current` and the player's `hand`?
 *   1. `cards` must be a (multiset) subset of `hand` (matched by card id).
 *   2. Some legal reading of `cards` must be:
 *        - any legal combo, if `current == null` (a lead), OR
 *        - a combo that `beats(current)` otherwise.
 *
 * Uses `allReadings` (NOT just `identifyWithWild`) so a wildcard-assisted reading that
 * beats `current` validates even when it is not the group's strongest reading.
 */
export function isLegalPlay(
  cards: Card[],
  current: Combo | null,
  hand: Card[],
  level: Rank
): boolean {
  if (cards.length === 0) return false;

  // 1. subset check by id.
  const handIds = new Set(hand.map(c => c.id));
  const seen = new Set<number>();
  for (const c of cards) {
    if (!handIds.has(c.id)) return false; // not in hand
    if (seen.has(c.id)) return false; // duplicate id within the play
    seen.add(c.id);
  }

  // 2. some legal reading lead/beats.
  const readings = allReadings(cards, level);
  if (readings.length === 0) return false;
  if (current === null) return true; // any legal combo is a valid lead
  return readings.some(r => beats(r, current));
}
