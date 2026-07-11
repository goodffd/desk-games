/**
 * 现版 AI 逻辑快照（"拆牌规划诚实打法"，AI 增强改造前的版本），仅供 ai-improvement 对打基线。
 * 不要在产品代码里引用。源 = ai/ai.ts @ AI 增强任务前的版本（记牌/双下/残局搜索之前）。
 * 依赖 decompose.ts（本次改造不动它），故基线行为随 decompose 稳定。
 */
import type { Card, Combo, Seat, Rank } from '../../src/games/guandan/engine/types';
import type { DealState } from '../../src/games/guandan/engine/game';
import { enumerateFollows, isWild } from '../../src/games/guandan/engine/legal';
import { decompose } from '../../src/games/guandan/ai/decompose';

const BOMB_TYPES = new Set(['bomb', 'straightFlush', 'kingBomb']);
function isBomb(c: Combo): boolean { return BOMB_TYPES.has(c.type); }
function wildCount(combo: Combo, level: Rank): number {
  return combo.cards.reduce((n, c) => n + (isWild(c, level) ? 1 : 0), 0);
}

const CONTROL_KEY = 14; // A
function isControl(combo: Combo, _level: Rank): boolean {
  return isBomb(combo) || combo.key >= CONTROL_KEY;
}

function chooseLead(hand: Card[], level: Rank): Card[] {
  const { combos } = decompose(hand, level);
  if (combos.length === 0) return [hand[0]!];
  if (combos.length === 1) return combos[0]!.cards;

  const nonControl = combos.filter(c => !isControl(c, level));
  const pool = nonControl.length > 0 ? nonControl : combos;

  const pick = pool.reduce((best, c) => {
    if (c.key !== best.key) return c.key < best.key ? c : best;
    if (c.cards.length !== best.cards.length) return c.cards.length > best.cards.length ? c : best;
    return wildCount(c, level) < wildCount(best, level) ? c : best;
  });
  return pick.cards;
}

export function baselineChoosePlay(s: DealState, seat: Seat): Card[] | null {
  const hand = s.hands[seat]!;
  const level = s.level;

  if (s.current === null) {
    if (hand.length === 0) return null;
    return chooseLead(hand, level);
  }
  return chooseFollow(s, seat);
}

const ENDGAME_CARDS = 6;
const OPP_ABOUT_TO_WIN_CARDS = 2;

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

  if (s.current!.by === partner) {
    const all = enumerateFollows(hand, s.current!.combo, level)
      .find(c => c.cards.length === hand.length);
    return all ? all.cards : null;
  }

  const follows = enumerateFollows(hand, s.current!.combo, level);
  if (follows.length === 0) return null;

  const nonBombs = follows.filter(c => !isBomb(c));
  const bombs = follows.filter(c => isBomb(c));

  const oppAboutToWin = ([0, 1, 2, 3] as Seat[])
    .some(o => o !== seat && o !== partner
      && s.hands[o]!.length <= OPP_ABOUT_TO_WIN_CARDS && s.hands[o]!.length > 0);
  const endgame = hand.length <= ENDGAME_CARDS || oppAboutToWin;

  if (nonBombs.length > 0) {
    const scored = nonBombs.map(c => ({ c, d: damage(hand, c.cards, level) }));
    scored.sort((a, b) =>
      a.d - b.d || a.c.key - b.c.key || a.c.cards.length - b.c.cards.length);
    const best = scored[0]!;
    if (best.d > 0 && !endgame) return null;
    return best.c.cards;
  }

  if (endgame) {
    return bombs.reduce((b, c) => (c.power < b.power ? c : b)).cards;
  }
  return null;
}
