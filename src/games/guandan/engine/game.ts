import type { Card, Rank, Combo, Seat } from './types';
import { identifyWithWild } from './wild';
import { allReadings, isLegalPlay } from './legal';
import { beats } from './combos';

/**
 * Single-deal state machine for Guandan (淮安掼蛋, 一期单局).
 *
 * PURE & IMMUTABLE: every transition returns a NEW `DealState`; the input is never
 * mutated. Illegal transitions THROW (leaving the caller's state untouched, since we
 * never mutate before validation completes).
 *
 * Rules consumed verbatim from the engine (this module re-implements NONE of them):
 * - `isLegalPlay` — UI/validation gate: `cards ⊆ hand` AND some reading leads/beats.
 * - `allReadings` / `beats` — to pick the concrete `Combo` that actually beats `current`.
 * - `identifyWithWild` — to resolve a lead's strongest reading.
 *
 * Turn / 名次 / 接风 rules (see SPEC「出牌流程与判负」「本局结果」):
 * - 4 seats play counter-clockwise: next = `(i+1) % 4`, skipping any already-finished seat.
 * - 0&2 are one team, 1&3 the other (partner = `(seat+2) % 4`).
 * - First lead seat is given (random in production).
 * - Following: a player must play a strictly-stronger same-type combo / a bomb, or 「不要」(pass).
 *   Three consecutive passes (the other 3 live seats all pass) → the last player who
 *   played wins the lead again, `current` is cleared, free lead.
 * - 走 (finish): when a player empties their hand they are recorded into `finished` in
 *   order (头游→末游). Finished seats are skipped thereafter.
 * - 接风 (relay): when the lead would fall to a player who is ALREADY FINISHED, their
 *   PARTNER `(by+2)%4` takes the lead (free lead, `current` cleared) if the partner is
 *   still in; otherwise the lead passes counter-clockwise to the next still-in seat.
 * - When only one seat still holds cards, that seat is auto-recorded as 末游 and the deal
 *   ends, so `finished` always reaches a full length-4 ranking.
 * - 升级数 (display only): the head team rises by partner's finish rank — partner 二游→3,
 *   三游→2, 末游→1.
 *
 * This module NEVER imports DOM.
 */

export interface DealState {
  /** hands[seat] = that seat's remaining cards (immutable per transition). */
  hands: Card[][];
  /** The combo currently on the table and who played it, or null for a free lead. */
  current: { combo: Combo; by: Seat } | null;
  /** Whose turn it is to act (play or pass). */
  turn: Seat;
  /** Consecutive passes since `current` was last set (0 right after a play/lead). */
  passesInRow: number;
  /** Seats that have emptied their hand, in finish order (头游 first). */
  finished: Seat[];
  /** The level rank ("打 2" → 2). */
  level: Rank;
  /**
   * 本局已打出的所有牌（累计，出牌顺序）。AI 记牌用：仅含公开出过的牌，不含任何手牌信息。
   * 引擎 createDeal/play/pass 全程维护；可选以兼容旧的 DealState 字面量构造（缺省视作空）。
   */
  played?: Card[];
}

const SEATS: Seat[] = [0, 1, 2, 3];

/** Partner of a seat: opposite chair, same team (0↔2, 1↔3). */
function partnerOf(seat: Seat): Seat {
  return ((seat + 2) % 4) as Seat;
}

/** The team a seat belongs to: seats 0&2 → team 0, seats 1&3 → team 1. */
function teamOf(seat: Seat): 0 | 1 {
  return (seat % 2) as 0 | 1;
}

/** Has this seat already finished (emptied its hand)? */
function isFinished(s: DealState, seat: Seat): boolean {
  return s.finished.includes(seat);
}

/** How many seats still hold cards. */
function liveCount(s: DealState): number {
  return SEATS.filter(seat => !isFinished(s, seat)).length;
}

/**
 * Next still-live seat counter-clockwise from `seat` (exclusive), i.e. the first of
 * `(seat+1)%4, (seat+2)%4, (seat+3)%4` that has not finished. Returns null only if no
 * other seat is live (caller guards against that).
 */
function nextLive(s: DealState, seat: Seat): Seat | null {
  for (let step = 1; step <= 4; step++) {
    const cand = ((seat + step) % 4) as Seat;
    if (!isFinished(s, cand)) return cand;
  }
  return null;
}

/**
 * Resolve who leads next when the lead has been WON by `winner` (either by playing a
 * combo the rest of the table could not beat, or by being the last player after three
 * passes). Implements 接风:
 * - If `winner` is still live → they lead.
 * - Else (winner already finished) → their partner leads if still live (接风).
 * - Else → next still-live seat counter-clockwise from the winner.
 *
 * Assumes at least one seat is still live (the deal is not over).
 */
function resolveLeader(s: DealState, winner: Seat): Seat {
  if (!isFinished(s, winner)) return winner;
  const partner = partnerOf(winner);
  if (!isFinished(s, partner)) return partner; // 接风: partner takes the free lead
  // Both winner and partner are out → counter-clockwise to the next live seat.
  const fallback = nextLive(s, winner);
  // Guard: deal-over is handled before calling this, so a live seat always exists.
  return fallback ?? winner;
}

// ---------------------------------------------------------------------------
// createDeal
// ---------------------------------------------------------------------------

/**
 * Start a deal. `hands[seat]` are the 4 dealt hands, `firstLeader` leads first (free
 * lead → `current = null`), `level` is the level rank. Hands are shallow-copied so the
 * returned state does not alias the caller's arrays.
 */
export function createDeal(hands: Card[][], firstLeader: Seat, level: Rank): DealState {
  return {
    hands: hands.map(h => [...h]),
    current: null,
    turn: firstLeader,
    passesInRow: 0,
    finished: [],
    level,
    played: [],
  };
}

// ---------------------------------------------------------------------------
// play
// ---------------------------------------------------------------------------

/**
 * Pick the concrete `Combo` a played group represents for storing as the new `current`.
 * - Lead (`prev == null`): the group's strongest reading (`identifyWithWild`).
 * - Following: the STRONGEST reading among `allReadings` that beats `prev`. (Validation
 *   already guaranteed at least one such reading exists.)
 */
function choosePlayedCombo(cards: Card[], prev: Combo | null, level: Rank): Combo {
  if (prev === null) {
    const lead = identifyWithWild(cards, level);
    if (!lead) throw new Error('play: cards do not form a legal lead combo');
    return lead;
  }
  let best: Combo | null = null;
  for (const r of allReadings(cards, level)) {
    if (!beats(r, prev)) continue;
    if (best === null || r.power > best.power || (r.power === best.power && r.key > best.key)) {
      best = r;
    }
  }
  if (!best) throw new Error('play: no reading of cards beats the current combo');
  return best;
}

/**
 * Play `cards` from `seat`. Validates turn, legality (subset + leads/beats), then
 * returns a NEW state with the cards removed, `current` set, finish recorded if the
 * hand empties, and the turn advanced (with 接风 when the lead is won).
 *
 * THROWS (without mutating) on any illegal play.
 */
export function play(s: DealState, seat: Seat, cards: Card[]): DealState {
  if (isDealOver(s)) throw new Error('play: deal is already over');
  if (seat !== s.turn) throw new Error(`play: not seat ${seat}'s turn (turn=${s.turn})`);
  if (isFinished(s, seat)) throw new Error(`play: seat ${seat} has already finished`);
  if (cards.length === 0) throw new Error('play: must play at least one card');

  const hand = s.hands[seat]!;
  const prev = s.current?.combo ?? null;

  // Single authoritative legality gate (subset by id + legal reading + leads/beats).
  if (!isLegalPlay(cards, prev, hand, s.level)) {
    throw new Error('play: illegal play');
  }

  // Concrete combo to put on the table (throws if somehow unresolved — shouldn't after gate).
  const playedCombo = choosePlayedCombo(cards, prev, s.level);

  // --- immutable updates ---
  const playedIds = new Set(cards.map(c => c.id));
  const newHand = hand.filter(c => !playedIds.has(c.id));

  const hands = s.hands.map((h, i) => (i === seat ? newHand : h));

  const finished = [...s.finished];
  const justFinished = newHand.length === 0;
  if (justFinished) finished.push(seat);

  const played = [...(s.played ?? []), ...cards]; // 记牌累计：把本手加入已出牌

  // Build an interim state to reason about who acts next.
  const interim: DealState = {
    hands,
    current: { combo: playedCombo, by: seat },
    turn: seat, // placeholder; recomputed below
    passesInRow: 0,
    finished,
    level: s.level,
  };

  // Auto-finish: if exactly one seat still holds cards, it is 末游 → record & end.
  if (liveCount(interim) === 1) {
    const last = SEATS.find(st => !finished.includes(st))!;
    finished.push(last);
    return {
      hands,
      current: { combo: playedCombo, by: seat },
      turn: last, // deal is over; turn is inert (no live opponents)
      passesInRow: 0,
      finished,
      level: s.level,
      played,
    };
  }

  // Normal advance: next live seat counter-clockwise gets to follow/pass.
  const next = nextLive(interim, seat);
  // next is guaranteed non-null: liveCount >= 2 here.
  return {
    hands,
    current: { combo: playedCombo, by: seat },
    turn: next as Seat,
    passesInRow: 0,
    finished,
    level: s.level,
    played,
  };
}

// ---------------------------------------------------------------------------
// pass
// ---------------------------------------------------------------------------

/**
 * `seat` passes (「不要」). Illegal — and THROWS — to pass on a free lead (`current == null`).
 * On the third consecutive pass (all other live seats have passed) the lead returns to
 * `current.by` (or, via 接风, their partner / next live seat) with `current` cleared.
 */
export function pass(s: DealState, seat: Seat): DealState {
  if (isDealOver(s)) throw new Error('pass: deal is already over');
  if (seat !== s.turn) throw new Error(`pass: not seat ${seat}'s turn (turn=${s.turn})`);
  if (s.current === null) throw new Error('pass: cannot pass on a free lead');
  if (isFinished(s, seat)) throw new Error(`pass: seat ${seat} has already finished`);

  const passesInRow = s.passesInRow + 1;

  // The lead is won once every OTHER live seat has passed. Live seats excluding the
  // combo's owner = liveCount - (owner still live ? 1 : 0). When that many have passed
  // in a row, no one beat the combo → owner wins the lead (接风 if owner finished).
  const owner = s.current.by;
  const ownerLive = !isFinished(s, owner);
  const liveOthers = liveCount(s) - (ownerLive ? 1 : 0);

  if (passesInRow >= liveOthers) {
    // Lead won. Resolve next leader (handles 接风 when owner already finished).
    const leader = resolveLeader(s, owner);
    return {
      hands: s.hands,
      current: null, // free lead
      turn: leader,
      passesInRow: 0,
      finished: s.finished,
      level: s.level,
      played: s.played,
    };
  }

  // Otherwise just advance to the next live seat.
  const next = nextLive(s, seat);
  return {
    hands: s.hands,
    current: s.current,
    turn: next as Seat,
    passesInRow,
    finished: s.finished,
    level: s.level,
    played: s.played,
  };
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

/** Is the deal over? True once all 4 seats are finished. */
export function isDealOver(s: DealState): boolean {
  return s.finished.length === 4;
}

/**
 * Finish ranking, head→tail (头游→末游). Only meaningful once the deal is over, where it
 * is exactly a permutation of [0,1,2,3]. While in progress it returns the finishers so far.
 */
export function ranking(s: DealState): Seat[] {
  return [...s.finished];
}

/**
 * 升级数 (display only, not accumulated across deals): the HEAD player's team rises by an
 * amount keyed on the partner's finish rank — partner 二游(rank index 1) → 3,
 * 三游(index 2) → 2, 末游(index 3) → 1. Throws if the deal is not over.
 */
export function levelGain(s: DealState): { team: 0 | 1; gain: 1 | 2 | 3 } {
  if (!isDealOver(s)) throw new Error('levelGain: deal is not over');
  const head = s.finished[0]!;
  const partner = partnerOf(head);
  const partnerRankIndex = s.finished.indexOf(partner); // 0 head,1 二游,2 三游,3 末游
  const gain = ((4 - partnerRankIndex) as 1 | 2 | 3 | 4);
  // partnerRankIndex is 1/2/3 (head is index 0 and is `head`, not its partner) → gain 3/2/1.
  return { team: teamOf(head), gain: gain as 1 | 2 | 3 };
}
