import type { Card, Rank, Seat, Suit } from './types';
import { power } from './types';

/** 干瞪眼的牌与发牌。engine 纯逻辑：不 import DOM、不碰网络、自己不摇骰子。 */

const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const MIN_SEATS = 2;
export const MAX_SEATS = 5;
const DEALER_CARDS = 6;   // 庄多发一张，抵消先出牌的优势
const OTHER_CARDS = 5;

/** 一副 54 张：52 张普通牌 + 大王 + 小王，id 0..53。 */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  let id = 0;
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ kind: 'normal', suit, rank, id: id++ });
  }
  deck.push({ kind: 'joker', big: false, id: id++ }); // 52 小王
  deck.push({ kind: 'joker', big: true, id: id++ });  // 53 大王
  return deck;
}

/**
 * 发牌：庄 6 张、其余各 5 张，剩下的全部进牌堆。
 *
 * @param shuffle 注入的洗牌函数——吃 n，吐 `[0..n-1]` 的一个排列。
 *   引擎自己不摇骰子，随机源由调用方给（测试注入种子洗牌，服务端注入真随机），
 *   这样任何一局都能凭种子原样复现。
 */
export function dealHands(
  deck: readonly Card[],
  seatCount: number,
  dealer: Seat,
  shuffle: (n: number) => number[],
): { hands: Card[][]; deck: Card[] } {
  if (!Number.isInteger(seatCount) || seatCount < MIN_SEATS || seatCount > MAX_SEATS) {
    throw new Error(`人数只能是 ${MIN_SEATS}~${MAX_SEATS}，收到 ${seatCount}`);
  }
  if (!Number.isInteger(dealer) || dealer < 0 || dealer >= seatCount) {
    throw new Error(`庄的座位号越界：${dealer}（本局 ${seatCount} 人）`);
  }

  const perm = shuffle(deck.length);
  const shuffled = perm.map((i) => deck[i]!);

  const hands: Card[][] = Array.from({ length: seatCount }, () => []);
  let cursor = 0;
  for (let seat = 0; seat < seatCount; seat++) {
    const want = seat === dealer ? DEALER_CARDS : OTHER_CARDS;
    hands[seat] = shuffled.slice(cursor, cursor + want);
    cursor += want;
  }
  return { hands, deck: shuffled.slice(cursor) };
}

/**
 * 首局的庄。随机源注入，引擎自己不摇骰子——同一个随机源必然给出同一个庄。
 * 之后每局的庄是上一局的赢家（见 `nextDealer`）。
 */
export function firstDealer(seatCount: number, rnd: () => number): Seat {
  const n = Math.abs(Math.trunc(rnd()));
  return n % seatCount;
}

/** 下一局的庄 = 上一局的赢家。 */
export function nextDealer(previousWinner: Seat): Seat {
  return previousWinner;
}

/**
 * 一张牌的排序权重：3..A 按自然点数，2 排到 A 之上，王再往上。
 * 只用于**手牌排序显示**；牌型的关键点数走 `combos.ts`，不要拿这个去比大小。
 */
export function sortValue(c: Card): number {
  if (c.kind === 'joker') return c.big ? 17 : 16;
  return power(c.rank);
}

/** 手牌升序排列，返回新数组，不动原来的。 */
export function sortHand(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => sortValue(a) - sortValue(b));
}
