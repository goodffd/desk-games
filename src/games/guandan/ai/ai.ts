/**
 * Guandan AI — 拆牌规划诚实打法。
 * Pure function; NEVER imports DOM. 诚实：只读自己手牌内容 + 各家手牌张数(公开)。
 */
import type { Card, Combo, Seat, Rank } from '../engine/types';
import type { DealState } from '../engine/game';
import { enumerateFollows, isWild } from '../engine/legal';
import { rankValue } from '../engine/cards';
import { returnableCards } from '../engine/match';
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

  // ---- FOLLOW ----
  return chooseFollow(s, seat);
}

/** 残局：自己或任一对手手牌很少（≤ 阈值）→ 放宽出牌、敢拆敢炸。 */
const ENDGAME_CARDS = 6;

/** 对手手牌 ≤ 此张数即视为"即将走完"，此时放宽跟牌（敢拆敢炸阻挡）。 */
const OPP_ABOUT_TO_WIN_CARDS = 2;

/** 出 cards 对剩余手牌计划的"结构损伤"：0=计划内的一手；>0=多花了手数。 */
function damage(hand: Card[], cards: Card[], level: Rank): number {
  const ids = new Set(cards.map(c => c.id));
  const rest = hand.filter(c => !ids.has(c.id));
  const before = decompose(hand, level).handCount;
  const after = decompose(rest, level).handCount;
  return (1 + after) - before;
}

function chooseFollow(s: DealState, seat: Seat): Card[] | null {
  const hand = s.hands[seat]!;
  const level = s.level;
  const partner = ((seat + 2) % 4) as Seat;

  // 队友领先：默认不要；但本手能直接走完(出完=hand 全清)则出
  if (s.current!.by === partner) {
    const all = enumerateFollows(hand, s.current!.combo, level)
      .find(c => c.cards.length === hand.length);
    return all ? all.cards : null;
  }

  const follows = enumerateFollows(hand, s.current!.combo, level);
  if (follows.length === 0) return null;

  const nonBombs = follows.filter(c => !isBomb(c));
  const bombs = follows.filter(c => isBomb(c));

  // 各家公开张数：残局 / 对手即将走完
  const oppAboutToWin = ([0, 1, 2, 3] as Seat[])
    .some(o => o !== seat && o !== partner
      && s.hands[o]!.length <= OPP_ABOUT_TO_WIN_CARDS && s.hands[o]!.length > 0);
  const endgame = hand.length <= ENDGAME_CARDS || oppAboutToWin;

  // 非炸弹候选按 (损伤 delta, key, 长度) 排序，取最优
  if (nonBombs.length > 0) {
    const scored = nonBombs.map(c => ({ c, d: damage(hand, c.cards, level) }));
    scored.sort((a, b) =>
      a.d - b.d || a.c.key - b.c.key || a.c.cards.length - b.c.cards.length);
    const best = scored[0]!;
    // 全部候选都损伤结构(>0) 且非残局/对手没要走完 → 战略不要，保牌
    if (best.d > 0 && !endgame) return null;
    return best.c.cards;
  }

  // 只剩炸弹能压：仅在残局 / 对手要走完 / 自己也快走完时才炸；用最弱够用炸弹
  if (endgame) {
    return bombs.reduce((b, c) => (c.power < b.power ? c : b)).cards;
  }
  return null; // 否则忍住炸弹，pass
}

/**
 * AI 还贡选牌：可还牌(≤10)中，移除后对剩余计划损伤最小、再取点数最低者。
 * 损伤=移除该牌后 handCount 相对 (base−1) 的增量：0=本是落单单张；>0=拆了对子/结构。
 */
export function chooseReturn(hand: Card[], level: Rank): Card {
  const cand = returnableCards(hand, level);
  const pool = cand.length > 0 ? cand : hand;
  const base = decompose(hand, level).handCount;
  let best = pool[0]!;
  let bestScore = Infinity;
  for (const card of pool) {
    const rest = hand.filter(c => c.id !== card.id);
    const after = decompose(rest, level).handCount;
    const delta = after - (base - 1);                  // 0=落单；>0=拆结构
    const score = delta * 100 + rankValue(card, level); // 先少损伤，再低点数
    if (score < bestScore) { bestScore = score; best = card; }
  }
  return best;
}
