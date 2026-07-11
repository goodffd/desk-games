/**
 * Guandan AI — 拆牌规划 + 记牌 + 双下竞速。
 * Pure function; NEVER imports DOM. 诚实：只读自己手牌 + 各家张数(公开) + 已出牌(s.played, 公开)。
 *
 * 三层增强（相对旧"拆牌诚实打法"）：
 *  1. 记牌：由 unseen(未现身牌) 动态判断牌型是否已是保证赢家(isTop)，取代静态"key≥A=控制牌"。
 *  2. 双下竞速：队友已头游后，未走完的我转激进——抢二游 + 敢炸拦对手(match 计分双下=+3 最高)。
 *  3. 记牌炸弹纪律：要炸时优先用"不会被未现身牌反压"的 top 炸，避免过炸。
 */
import type { Card, Combo, Seat, Rank } from '../engine/types';
import type { DealState } from '../engine/game';
import { enumerateFollows, isWild } from '../engine/legal';
import { rankValue } from '../engine/cards';
import { returnableCards } from '../engine/match';
import { decompose } from './decompose';
import { computeUnseen, isTop } from './counting';
import { endgameRollout } from './rollout';

const BOMB_TYPES = new Set(['bomb', 'straightFlush', 'kingBomb']);
function isBomb(c: Combo): boolean { return BOMB_TYPES.has(c.type); }
function wildCount(combo: Combo, level: Rank): number {
  return combo.cards.reduce((n, c) => n + (isWild(c, level) ? 1 : 0), 0);
}
const partnerOf = (seat: Seat): Seat => ((seat + 2) % 4) as Seat;

/** 残局：自己 ≤ 此张数即放宽出牌、敢拆敢炸。 */
const ENDGAME_CARDS = 6;
/** 对手手牌 ≤ 此张数即"即将走完"，放宽跟牌（敢拆敢炸阻挡）。 */
const OPP_ABOUT_TO_WIN_CARDS = 2;

/** 我方是否已锁头游、我仍在场 → 转"双下竞速"（抢二游、敢炸拦对手）。 */
function racingForDouble(s: DealState, seat: Seat): boolean {
  return s.finished[0] === partnerOf(seat) && !s.finished.includes(seat);
}

/**
 * 控制牌：炸弹类，或经记牌判定"已是保证赢家(top)"的高张牌型。
 * 记牌前用静态 key≥A 近似；现在用 unseen 精确判断（大牌若被炸/更大牌压着则不算控制；
 * 中张若已成最大则算控制）。unseen 为空时回退静态近似。
 */
function isControl(combo: Combo, level: Rank, unseen: Card[] | null): boolean {
  if (isBomb(combo)) return true;
  if (unseen && unseen.length > 0) return isTop(combo, unseen, level);
  return combo.key >= 14; // A：无记牌信息时的静态近似
}

/** 自由领牌：拆解驱动，先甩非控制的低张，控制/保证赢家留着管节奏。 */
function chooseLead(hand: Card[], level: Rank, unseen: Card[]): Card[] {
  const { combos } = decompose(hand, level);
  if (combos.length === 0) return [hand[0]!];
  if (combos.length === 1) return combos[0]!.cards;

  const nonControl = combos.filter(c => !isControl(c, level, unseen));
  const pool = nonControl.length > 0 ? nonControl : combos;

  // 选最低 key；tie：长度更长（多甩牌）优先；再 tie：少用红心2
  const pick = pool.reduce((best, c) => {
    if (c.key !== best.key) return c.key < best.key ? c : best;
    if (c.cards.length !== best.cards.length) return c.cards.length > best.cards.length ? c : best;
    return wildCount(c, level) < wildCount(best, level) ? c : best;
  });
  return pick.cards;
}

/** rollout 触发：自己手牌 ≤ 此数 且 全场剩牌 ≤ 下者（真残局，推演短、方差低、成本小）。 */
const ROLLOUT_CARDS = 9;
const ROLLOUT_TOTAL = 26;

export function choosePlay(s: DealState, seat: Seat): Card[] | null {
  const hand = s.hands[seat]!;
  if (hand.length === 0) return null;
  const unseen = computeUnseen(s, seat);
  const heur = heuristicChoose(s, seat, unseen);

  // 残局精算：真残局时用 determinized rollout 精修——把启发式选择也纳入候选，
  // 只有别的候选"明显更优"才覆盖（保证不劣于启发式）。
  const totalLeft = s.hands.reduce((n, h) => n + h.length, 0);
  if (hand.length <= ROLLOUT_CARDS && totalLeft <= ROLLOUT_TOTAL && unseen.length > 0) {
    return endgameRollout(s, seat, unseen, heuristicChoose, heur);
  }
  return heur;
}

/** 启发式决策（记牌+双下，无 rollout）——也是 rollout 内部推演用的基策略。 */
export function heuristicChoose(s: DealState, seat: Seat, unseen: Card[]): Card[] | null {
  const hand = s.hands[seat]!;
  const level = s.level;
  if (hand.length === 0) return null;

  // ---- LEAD ----
  if (s.current === null) {
    return chooseLead(hand, level, unseen);
  }
  // ---- FOLLOW ----
  return chooseFollow(s, seat, unseen);
}

/** 出 cards 对剩余手牌计划的"结构损伤"：0=计划内一手；>0=多花手数。 */
function damage(hand: Card[], cards: Card[], level: Rank): number {
  const ids = new Set(cards.map(c => c.id));
  const rest = hand.filter(c => !ids.has(c.id));
  const before = decompose(hand, level).handCount;
  const after = decompose(rest, level).handCount;
  return (1 + after) - before;
}

function chooseFollow(s: DealState, seat: Seat, unseen: Card[]): Card[] | null {
  const hand = s.hands[seat]!;
  const level = s.level;
  const partner = partnerOf(seat);
  const racing = racingForDouble(s, seat);

  // 队友领先：默认不要让队友走；但本手能直接走完则出。
  // （队友领先 ⇒ 队友未走完 ⇒ 不可能同时 racing，无需特判。）
  if (s.current!.by === partner) {
    const all = enumerateFollows(hand, s.current!.combo, level)
      .find(c => c.cards.length === hand.length);
    return all ? all.cards : null;
  }

  const follows = enumerateFollows(hand, s.current!.combo, level);
  if (follows.length === 0) return null;

  const nonBombs = follows.filter(c => !isBomb(c));
  const bombs = follows.filter(c => isBomb(c));

  // 对手即将走完？残局？双下竞速？→ 放宽（敢拆、敢炸）
  const oppAboutToWin = ([0, 1, 2, 3] as Seat[])
    .some(o => o !== seat && o !== partner
      && s.hands[o]!.length <= OPP_ABOUT_TO_WIN_CARDS && s.hands[o]!.length > 0);
  const aggressive = hand.length <= ENDGAME_CARDS || oppAboutToWin || racing;

  // 非炸弹候选按 (损伤 delta, key, 长度) 排序，取最优
  if (nonBombs.length > 0) {
    const scored = nonBombs.map(c => ({ c, d: damage(hand, c.cards, level) }));
    scored.sort((a, b) =>
      a.d - b.d || a.c.key - b.c.key || a.c.cards.length - b.c.cards.length);
    const best = scored[0]!;
    // 全部候选都损伤结构(>0) 且不激进 → 一般保牌；但"便宜抢节奏"例外：
    // 损伤≤1 的小牌(≤2 张)拿下这轮领出权，帮自己更快走完（抢头游）。
    if (best.d > 0 && !aggressive) {
      if (best.d <= 1 && best.c.cards.length <= 2) return best.c.cards;
      return null;
    }
    return best.c.cards;
  }

  // 只剩炸弹能压：仅在激进态才炸；优先用"不会被未现身牌反压"的 top 炸，再取最弱够用。
  if (aggressive) {
    const safe = bombs.filter(b => isTop(b, unseen, level));
    const pool = safe.length > 0 ? safe : bombs;
    return pool.reduce((b, c) => (c.power < b.power ? c : b)).cards;
  }
  return null; // 否则忍住炸弹，pass
}

/**
 * AI 还贡选牌：可还牌(≤10)中，移除后对剩余计划损伤最小、再取点数最低者。
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
    const delta = after - (base - 1);
    const score = delta * 100 + rankValue(card, level);
    if (score < bestScore) { bestScore = score; best = card; }
  }
  return best;
}
