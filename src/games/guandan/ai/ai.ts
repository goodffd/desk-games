/**
 * Guandan AI — 拆牌规划诚实打法。
 * Pure function; NEVER imports DOM. 诚实：只读自己手牌内容 + 各家手牌张数(公开)。
 */
import type { Card, Combo, Seat, Rank } from '../engine/types';
import type { DealState } from '../engine/game';
import { enumerateFollows, isWild } from '../engine/legal';
import { decompose } from './decompose';

const BOMB_TYPES = new Set(['bomb', 'straightFlush', 'kingBomb']);
function isBomb(c: Combo): boolean { return BOMB_TYPES.has(c.type); }
function wildCount(combo: Combo, level: Rank): number {
  return combo.cards.reduce((n, c) => n + (isWild(c, level) ? 1 : 0), 0);
}

/** 控制牌：炸弹类，或 key ≥ A 的高张牌型（A=14；大牌留着管节奏，不先甩）。 */
const CONTROL_KEY = 14; // A
function isControl(combo: Combo, _level: Rank): boolean {
  return isBomb(combo) || combo.key >= CONTROL_KEY;
}

/** 自由领牌：拆解驱动。 */
function chooseLead(hand: Card[], level: Rank): Card[] {
  const { combos } = decompose(hand, level);
  if (combos.length === 0) return [hand[0]!];
  if (combos.length === 1) return combos[0]!.cards;

  // 优先甩非控制牌型；都为控制牌则退而求其次全集
  const nonControl = combos.filter(c => !isControl(c, level));
  const pool = nonControl.length > 0 ? nonControl : combos;

  // 选最低 key；tie：长度更长（多甩牌）优先；再 tie：少用红心2
  const pick = pool.reduce((best, c) => {
    if (c.key !== best.key) return c.key < best.key ? c : best;
    if (c.cards.length !== best.cards.length) return c.cards.length > best.cards.length ? c : best;
    return wildCount(c, level) < wildCount(best, level) ? c : best;
  });
  return pick.cards;
}

export function choosePlay(s: DealState, seat: Seat): Card[] | null {
  const hand = s.hands[seat]!;
  const level = s.level;

  // ---- LEAD ----
  if (s.current === null) {
    if (hand.length === 0) return null;
    return chooseLead(hand, level);
  }

  // ---- FOLLOW（本任务暂用基础逻辑，Task 4 替换）----
  const partner = ((seat + 2) % 4) as Seat;
  if (s.current.by === partner) return null;
  const follows = enumerateFollows(hand, s.current.combo, level);
  if (follows.length === 0) return null;
  const nonBombs = follows.filter(c => !isBomb(c));
  if (nonBombs.length > 0) {
    return nonBombs.reduce((b, c) =>
      c.key < b.key || (c.key === b.key && c.cards.length < b.cards.length) ? c : b).cards;
  }
  return follows.reduce((b, c) => (c.power < b.power ? c : b)).cards;
}
