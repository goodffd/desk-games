/**
 * 干瞪眼引擎的类型与全序常量。规则真相见 SPEC.md《干瞪眼》节，术语见 ../CONTEXT.md。
 * 本目录纯逻辑：绝不 import DOM、不碰网络。
 */

export type Suit = 'S' | 'H' | 'D' | 'C';                 // ♠♥♦♣

/** 牌面自然点数：2..10，J=11 Q=12 K=13 A=14。注意 2 的**自然点数**是 2，权重另算。 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type Card =
  | { kind: 'normal'; suit: Suit; rank: Rank; id: number }  // id 唯一 0..53
  | { kind: 'joker'; big: boolean; id: number };            // big=true 大王

/** 座位号 0..seatCount-1，按出牌顺序排；下一位 = (i+1) % seatCount。 */
export type Seat = number;

/**
 * 牌型。带王的百搭牌型是 #7。
 *
 * 描述炸弹只用两个正交属性：**张数**（`length`）与**是否含王**。
 * 术语表把「软炸 / 硬炸」列为禁用词——两地定义完全相反（一说按张数分、一说按含不含王分），
 * 用哪个都必然被误解。
 */
export type ComboType = 'single' | 'pair' | 'run' | 'pairRun' | 'bomb' | 'jokerBomb';

/**
 * 一手打出去的牌。
 * `key` = 关键点数：单张/对子/炸弹取该点的**权重**，顺子/连对取最高位的**自然点数**；
 * 王炸没有点数可言，`key` 固定为 0 且不参与任何比较。
 * `牌型标识`（CONTEXT.md）= `type | length | key` 三元组，花色不进标识。
 */
export interface Combo {
  type: ComboType;
  cards: Card[];
  length: number;
  key: number;
}

/** 一个炸最多几张：一副牌里同点只有 4 张，王当替身（#7）也不许突破。 */
export const MAX_BOMB_SIZE = 4;

/** A 的自然点数，也是大一链条的顶。 */
export const RANK_A = 14;

/**
 * 2 的权重。
 *
 * 干瞪眼的点数序是 `3<4<…<K<A<2`，所以 2 是最大的单张——但它**不是「A+1」**：
 * A 上面接不了任何普通单张。2 只能靠自己的特权（单张 2 压任意单张、对 2 压任意对子）
 * 出手，而那是 #6 的逃生口。把它的权重设成 15 只是为了排序时排在 A 之上，
 * 大一法则那边会显式把链条封在 A（见 combos.ts 的 `beats`）。
 */
export const POWER_TWO = 15;

/** 一张牌在**单张/对子**语境下的权重：2→15，其余同自然点数；王本期不参与。 */
export function power(rank: Rank): number {
  return rank === 2 ? POWER_TWO : rank;
}
