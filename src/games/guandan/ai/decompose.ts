/**
 * Guandan 拆牌（hand decomposition）— 纯函数，NEVER imports DOM。
 *
 * 把手牌拆成近似最少手数的合法牌型组合，作为 AI "还剩几手能走完"的骨架。
 * 牌型积木全部取自引擎 enumerateLeads（不在此重写任何规则）。
 *
 * 求解：递归 cover 当前**最低牌**（用包含它且 ⊆ 剩余手牌的合法牌型），
 * 最小化组合数；记忆化（剩余 id 签名）+ visited 上限；超限退化为贪心，保证快且确定。
 */
import type { Card, Combo, Rank } from '../engine/types';
import { enumerateLeads, isWild } from '../engine/legal';
import { rankValue } from '../engine/cards';

export interface Decomposition {
  combos: Combo[];
  handCount: number;
}

const VISIT_CAP = 60_000;          // 单次求解 visited 上限，超则贪心兜底
const CACHE_CAP = 4_000;           // 模块级结果缓存条数上限（纯函数，安全）
const cache = new Map<string, Decomposition>();

function handKey(hand: Card[], level: Rank): string {
  return level + '|' + hand.map(c => c.id).sort((a, b) => a - b).join(',');
}
function wildCount(combo: Combo, level: Rank): number {
  return combo.cards.reduce((n, c) => n + (isWild(c, level) ? 1 : 0), 0);
}
function comboWithin(combo: Combo, remaining: Set<number>): boolean {
  return combo.cards.every(c => remaining.has(c.id));
}
/** tie-break：同手数时更优的拆法（少用红心2 → 更优）。 */
function totalWild(combos: Combo[], level: Rank): number {
  return combos.reduce((n, c) => n + wildCount(c, level), 0);
}

export function decompose(hand: Card[], level: Rank): Decomposition {
  if (hand.length === 0) return { combos: [], handCount: 0 };

  const ck = handKey(hand, level);
  const hit = cache.get(ck);
  if (hit) return hit;

  const byId = new Map<number, Card>();
  for (const c of hand) byId.set(c.id, c);

  // 全部候选牌型；按"包含某 id"建索引（cover 最低牌时只看含该牌的牌型，限制分支）
  const allCombos = enumerateLeads(hand, level);
  const combosByCard = new Map<number, Combo[]>();
  for (const combo of allCombos) {
    for (const c of combo.cards) {
      const list = combosByCard.get(c.id);
      if (list) list.push(combo); else combosByCard.set(c.id, [combo]);
    }
  }

  const memo = new Map<string, Combo[]>();
  let visited = 0;
  let bailed = false;

  function lowestId(remaining: Set<number>): number {
    let anchor = -1, lo = Infinity;
    for (const id of remaining) {
      const rv = rankValue(byId.get(id)!, level);
      if (rv < lo || (rv === lo && id < anchor)) { lo = rv; anchor = id; }
    }
    return anchor;
  }

  function solve(remaining: Set<number>): Combo[] | null {
    if (remaining.size === 0) return [];
    if (++visited > VISIT_CAP) { bailed = true; return null; }
    const k = [...remaining].sort((a, b) => a - b).join(',');
    const cached = memo.get(k);
    if (cached) return cached;

    const anchor = lowestId(remaining);
    let best: Combo[] | null = null;

    for (const combo of combosByCard.get(anchor) ?? []) {
      if (!comboWithin(combo, remaining)) continue;
      const next = new Set(remaining);
      for (const c of combo.cards) next.delete(c.id);
      const sub = solve(next);
      if (sub === null) { if (bailed) return null; else continue; }
      const cand = [combo, ...sub];
      if (
        best === null ||
        cand.length < best.length ||
        (cand.length === best.length && totalWild(cand, level) < totalWild(best, level))
      ) best = cand;
    }

    if (best !== null) memo.set(k, best);
    return best;
  }

  const ids = new Set(hand.map(c => c.id));
  let combos = solve(ids);
  if (combos === null) combos = greedy(ids, combosByCard, byId, level);

  const result: Decomposition = { combos, handCount: combos.length };
  if (cache.size >= CACHE_CAP) cache.clear();   // 简单有界：满了清空
  cache.set(ck, result);
  return result;

  // 贪心兜底：每轮 cover 最低牌，取含它且 ⊆ 剩余的最大长度牌型（tie：少红心2）。
  function greedy(
    remaining: Set<number>,
    idx: Map<number, Combo[]>,
    cardOf: Map<number, Card>,
    lvl: Rank,
  ): Combo[] {
    const out: Combo[] = [];
    const rem = new Set(remaining);
    while (rem.size > 0) {
      let anchor = -1, lo = Infinity;
      for (const id of rem) {
        const rv = rankValue(cardOf.get(id)!, lvl);
        if (rv < lo || (rv === lo && id < anchor)) { lo = rv; anchor = id; }
      }
      let pick: Combo | null = null;
      for (const combo of idx.get(anchor) ?? []) {
        if (!comboWithin(combo, rem)) continue;
        if (
          pick === null ||
          combo.cards.length > pick.cards.length ||
          (combo.cards.length === pick.cards.length && wildCount(combo, lvl) < wildCount(pick, lvl))
        ) pick = combo;
      }
      if (pick === null) break; // 理论不会：单张总是合法牌型
      out.push(pick);
      for (const c of pick.cards) rem.delete(c.id);
    }
    return out;
  }
}
