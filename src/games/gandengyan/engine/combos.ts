import type { Card, Combo, Rank } from './types';
import { MAX_BOMB_SIZE, POWER_TWO, RANK_A, power } from './types';

/**
 * 牌型识别与压制判定。engine 是规则唯一真相，UI 与 AI 不得另写一套判定。
 *
 * 大一法则是主干：跟牌须**同牌型、同张数、关键点数正好大一级**。
 * 上家出 5，你手里握着 K 和 A 也只能干瞪眼——只能出 6。
 *
 * 例外只有三个逃生口，它们**不走大一那条链**：
 *   ① 单张 2 压任意单张   ② 对 2 压任意对子   ③ 炸弹压任意非炸牌型
 *
 * 尚未实现：王的百搭与显式指派（#7）。在那之前，除了「大王 + 小王 = 王炸」，
 * 任何含王的组合都不成牌型。
 */

/** 取出各张的自然点数并升序；遇到王直接判失败（王只在 `identifyJokerBomb` 里另行处理）。 */
function naturalRanks(cards: readonly Card[]): Rank[] | null {
  const rs: Rank[] = [];
  for (const c of cards) {
    if (c.kind !== 'normal') return null;
    rs.push(c.rank);
  }
  return rs.sort((a, b) => a - b);
}

/** 连续递增且不含 2（2 不入顺、也不入连对；A 只当最高位，自然序 3..14 天然满足）。 */
function isConsecutive(ranks: readonly Rank[]): boolean {
  if (ranks.some((r) => r === 2)) return false;
  for (let i = 1; i < ranks.length; i++) {
    if (ranks[i]! !== ranks[i - 1]! + 1) return false;
  }
  return true;
}

/** 王炸：恰好一张大王 + 一张小王。单张王出不去，两张王也只有这一种用法。 */
function identifyJokerBomb(cards: readonly Card[]): Combo | null {
  if (cards.length !== 2) return null;
  const jokers = cards.filter((c) => c.kind === 'joker');
  if (jokers.length !== 2) return null;
  const big = jokers.filter((c) => c.kind === 'joker' && c.big).length;
  if (big !== 1) return null; // 一副牌里大小王各一张，两张同色王不成王炸
  return { type: 'jokerBomb', cards: [...cards], length: 2, key: 0 };
}

/**
 * 认这一组牌是什么牌型；认不出来返回 `null`。
 *
 * 顺子与连对走**自然序**且封顶在 A：`2` 不参与，`A` 只当最高位，
 * 所以 `A23`、`KA2`、`A2345` 全部不成立。顺子长度不限，连对 2 对起。
 * 炸弹 3 或 4 张同点，**同一个炸最多 4 张**。
 */
export function identify(cards: readonly Card[]): Combo | null {
  if (cards.length === 0) return null;

  const jokerBomb = identifyJokerBomb(cards);
  if (jokerBomb) return jokerBomb;

  const ranks = naturalRanks(cards);
  if (!ranks) return null;
  const cs = [...cards];

  if (ranks.length === 1) {
    return { type: 'single', cards: cs, length: 1, key: power(ranks[0]!) };
  }

  if (ranks.length === 2 && ranks[0] === ranks[1]) {
    return { type: 'pair', cards: cs, length: 2, key: power(ranks[0]!) };
  }

  // 炸弹：3~4 张同点。超过 4 张一律不认——一副牌里同点只有 4 张，
  // 别让「张数越多越大」自然延伸出 5 张、6 张炸（#7 的王当替身时尤其危险）。
  const allSame = ranks.every((r) => r === ranks[0]);
  if (allSame && ranks.length >= 3) {
    if (ranks.length > MAX_BOMB_SIZE) return null;
    return { type: 'bomb', cards: cs, length: ranks.length, key: power(ranks[0]!) };
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

/** 这一手是不是「2」（单张 2 或对 2）——两个逃生口的判据。 */
export function isTwo(combo: Combo): boolean {
  return (combo.type === 'single' || combo.type === 'pair') && combo.key === POWER_TWO;
}

/** 炸弹类（含王炸）。 */
export function isBomb(combo: Combo): boolean {
  return combo.type === 'bomb' || combo.type === 'jokerBomb';
}

/**
 * `next` 能不能压住 `prev`。
 *
 * 判定顺序就是规则的优先级，从最硬的往下走：
 *   1. 王炸压一切，且没有东西压得住它
 *   2. 炸弹压任意非炸牌型；炸弹之间**先比张数、同张数比点数且「大就行」**（不受大一约束）
 *   3. 普通牌型之间：先看逃生口（单张 2 压任意单张、对 2 压任意对子），
 *      再走大一法则——同牌型、同张数、关键点数正好大一级
 *
 * 注意大一那条链**只在 3..A 之间**：2 的权重虽然是 15，但它不是「A+1」，
 * 它出手靠的是自己的特权。顺子与连对没有特权，所以顶格顺子 `QKA` 之上
 * 真的接不了任何普通顺子（2 不入顺，A 已封顶），只能炸。
 */
export function beats(prev: Combo, next: Combo): boolean {
  // 1. 王炸
  if (next.type === 'jokerBomb') return prev.type !== 'jokerBomb';
  if (prev.type === 'jokerBomb') return false;

  // 2. 炸弹
  if (next.type === 'bomb') {
    if (prev.type !== 'bomb') return true;                            // 炸弹压任意非炸
    if (next.length !== prev.length) return next.length > prev.length; // 先比张数
    return next.key > prev.key;                                        // 同张数比点数，大就行
  }
  if (prev.type === 'bomb') return false;                              // 普通牌压不住炸弹

  // 3. 普通牌型
  if (next.type !== prev.type || next.length !== prev.length) return false;
  if (isTwo(next) && !isTwo(prev)) return true;                        // 逃生口：2 的特权
  return next.key === prev.key + 1 && next.key <= RANK_A;              // 大一法则，链条封顶在 A
}
