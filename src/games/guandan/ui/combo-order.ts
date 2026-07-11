/**
 * combo-order.ts — 出牌区牌面展示排序（纯函数，无 DOM，可单测）。
 *
 * 规则（与手牌区一致的观感）：
 *  1. 大组在前：三带二的「三同」排在「对子」前（按该点数张数降序）。
 *  2. 同组内按**自然点数**升序：顺子/连对/钢板里含级牌时，级牌回到自然位
 *     （不用 rankValue——它把级牌抬到 15、大小王 16/17，会把级牌甩到牌尾，如打7时 56789 显示成 56897）。
 *  3. 同点数按花色：黑桃→红心→梅花→方块（S→H→C→D，左→右）。与手牌区列**自下而上**一致
 *     （手牌列 flex column 自上而下 D→C→H→S、黑桃在底完整露出，故自下而上=S→H→C→D）。
 *
 * 已知局限：逢人配(红心level)在顺子里替牌时按其自身面点排（非替代位）；A 打头的 A2345 顺按 A=14 排在尾。
 */
import type { Card, Rank } from '../engine/types';
import { rankValue } from '../engine/cards';

const SUIT_ORDER: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 };
/** 自然面点：普通牌取 rank（级牌归自然位）；大小王置于牌尾(大>小)。 */
function natRank(c: Card): number { return c.kind === 'joker' ? (c.big ? 16 : 15) : c.rank; }
function suitKey(c: Card): number { return c.kind === 'joker' ? -1 : (SUIT_ORDER[c.suit] ?? 0); }

export function sortComboCards(cards: Card[], level: Rank): Card[] {
  // 组大小按 rankValue 计数（每个不同物理点数 → 唯一 rankValue，分组正确）。
  const cnt = new Map<number, number>();
  for (const c of cards) { const v = rankValue(c, level); cnt.set(v, (cnt.get(v) ?? 0) + 1); }
  return [...cards].sort((a, b) => {
    const ca = cnt.get(rankValue(a, level))!;
    const cb = cnt.get(rankValue(b, level))!;
    if (ca !== cb) return cb - ca;          // 大组在前
    const na = natRank(a), nb = natRank(b);
    if (na !== nb) return na - nb;          // 同组按自然点数升序（级牌归位）
    return suitKey(a) - suitKey(b);         // 同点数按花色 D→C→H→S
  });
}
