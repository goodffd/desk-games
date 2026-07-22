import type { Card, Combo, Rank } from './types';
import { POWER_TWO, RANK_A, power } from './types';

/**
 * 牌型识别与大一法则。engine 是规则唯一真相，UI 与 AI 不得另写一套判定。
 *
 * 本期（#5）只认四种普通牌型：单张 / 对子 / 顺子 / 连对。
 * 炸弹与逃生口在 #6，王的百搭与显式指派在 #7 —— 在那之前，
 * **任何含王的组合一律不成牌型**，三张同点也不成牌型（它将来是炸弹，不是「三张」）。
 */

/** 按自然点数升序，王排最后（本期只用于识别，王一律导致识别失败）。 */
function naturalRanks(cards: readonly Card[]): Rank[] | null {
  const rs: Rank[] = [];
  for (const c of cards) {
    if (c.kind !== 'normal') return null; // 带王：本期不成牌型（#7 再开）
    rs.push(c.rank);
  }
  return rs.sort((a, b) => a - b);
}

/** 连续递增且不含 2（2 不入顺、也不入连对；A 只当最高位，故自然序 3..14 天然满足）。 */
function isConsecutive(ranks: readonly Rank[]): boolean {
  if (ranks.some((r) => r === 2)) return false;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i]! !== ranks[i - 1]! + 1) return false;
  }
  return true;
}

/**
 * 认这一组牌是什么牌型；认不出来返回 `null`。
 *
 * 干瞪眼的顺子与连对都走**自然序**且封顶在 A：`2` 不参与，`A` 只当最高位，
 * 所以 `A23`、`KA2`、`A2345` 全部不成立。顺子长度不限，连对 2 对起。
 */
export function identify(cards: readonly Card[]): Combo | null {
  const ranks = naturalRanks(cards);
  if (!ranks || ranks.length === 0) return null;
  const cs = [...cards];

  if (ranks.length === 1) {
    return { type: 'single', cards: cs, length: 1, key: power(ranks[0]!) };
  }

  if (ranks.length === 2 && ranks[0] === ranks[1]) {
    return { type: 'pair', cards: cs, length: 2, key: power(ranks[0]!) };
  }

  // 顺子：≥3 张、点数互不相同且连续
  if (ranks.length >= 3 && isConsecutive(ranks)) {
    return { type: 'run', cards: cs, length: ranks.length, key: ranks[ranks.length - 1]! };
  }

  // 连对：偶数张、≥2 对、每对同点且各对点数连续
  if (ranks.length >= 4 && ranks.length % 2 === 0) {
    const tops: Rank[] = [];
    for (let i = 0; i < ranks.length; i += 2) {
      if (ranks[i] !== ranks[i + 1]) { tops.length = 0; break; }
      tops.push(ranks[i]!);
    }
    if (tops.length >= 2 && isConsecutive(tops)) {
      return { type: 'pairRun', cards: cs, length: ranks.length, key: tops[tops.length - 1]! };
    }
  }

  return null;
}

/**
 * 大一法则：`next` 能不能压住 `prev`。
 *
 * 三个条件缺一不可：**同牌型、同张数、关键点数正好大一级**。
 * 上家出 5，你手里握着 K 和 A 也只能干瞪眼——只能出 6。
 *
 * 第四个条件 `next.key <= RANK_A` 是这套规则里最容易写错的一处：
 * 它把大一链条**封死在 A**，于是
 *   ① A 上面接不了普通单张（2 的权重是 15，但 2 是特权牌，不是「A+1」）；
 *   ② 顶格顺子 `QKA` 之上没有普通顺子可接（2 不入顺，A 已封顶）。
 * 2 与炸弹要出手，只能走 #6 的逃生口，不走这条链。
 */
export function beats(prev: Combo, next: Combo): boolean {
  return next.type === prev.type
    && next.length === prev.length
    && next.key === prev.key + 1
    && next.key <= RANK_A;
}

/** 这一手是不是「2」（单张 2 或对 2）——#6 的逃生口会用到，这里先给个诚实的判据。 */
export function isTwo(combo: Combo): boolean {
  return (combo.type === 'single' || combo.type === 'pair') && combo.key === POWER_TWO;
}
