/**
 * Guandan AI 记牌（card counting）— 纯函数，NEVER imports DOM。
 * 诚实：只用"已公开出过的牌"(s.played) + 自己手牌，绝不读对手手牌内容。
 *
 * 核心量：unseen = 全牌堆(108) − 自己手牌 − 已出牌 = 对手+队友合计仍持有的牌。
 * 由 unseen 可判断"某牌型是否已是保证赢家(top)"：若未现身牌整体都压不住它，则它必赢。
 * 这是 sound（保守）判断——unseen 是对手手牌的上界，压不住即真压不住；能压则可能有人能压。
 */
import type { Card, Combo, Rank, Seat } from '../engine/types';
import type { DealState } from '../engine/game';
import { makeDeck } from '../engine/cards';
import { enumerateFollows } from '../engine/legal';

/** 全牌堆快照（108 张，id 稳定；makeDeck 确定性构造，与发牌同一 id 空间）。 */
const FULL_DECK: readonly Card[] = makeDeck();

/** 未现身的牌：对手+队友合计仍持有（= 全牌堆 − 自己手牌 − 已出牌）。 */
export function computeUnseen(s: DealState, seat: Seat): Card[] {
  const mine = new Set(s.hands[seat]!.map(c => c.id));
  const played = new Set((s.played ?? []).map(c => c.id));
  return FULL_DECK.filter(c => !mine.has(c.id) && !played.has(c.id));
}

/** combo 是否已是保证赢家：未现身牌里不存在任何能压它的组合。 */
export function isTop(combo: Combo, unseen: Card[], level: Rank): boolean {
  return enumerateFollows(unseen, combo, level).length === 0;
}
