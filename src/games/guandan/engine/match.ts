/**
 * 整盘状态机（二期：升级 / 进贡 / 打 A 过 A）。
 *
 * 纯函数、不可变：每个转换返回新对象，从不修改入参。建立在一期单局引擎之上——
 * 单局（game.ts/createDeal/play/pass/ranking）不动，本模块只负责"把多局串成一盘"：
 *   1. 一局结束 → settleDeal：按名次给头游方升级 + 判打 A 过 A。
 *   2. 未收盘 → planTribute：定进贡/还贡/抗贡 + 进贡局首攻。
 *   3. applyTribute：把进贡牌与还贡牌在新手牌间交换。
 *   4. 调用方用新级牌 createDeal 开下一局。
 *
 * 规则见 SPEC.md「二期」(owner 2026-06-21 已确认 Q1-Q6)：
 * - Q1 当前局打"上局赢家队"的级（首局打 2）。
 * - Q2 严格过 A：打 A 局须头游 + 对家非末游(gain≥2)才过；头游+对家末游(gain=1)则卡 A。
 * - Q2b 连续卡 A 3 次未过 → 降回 2。
 * - Q3 逢人配不作进贡牌（进除逢人配外最大的一张）。
 * - Q4 还贡牌 rankValue ≤ 10。
 * - Q5 抗贡 = 应进贡方持两张大王（单贡看末游一人；双贡看三游+末游合计）。
 * - Q6 进贡局由进贡方（末游）先首攻；抗贡则头游先攻。
 *
 * 本模块 NEVER imports DOM。
 */

import type { Card, Rank, Seat } from './types';
import { makeDeck, deal, rankValue } from './cards';

const A: Rank = 14;            // 打 A（升级终点）
const RESET_LEVEL: Rank = 2;  // 连续卡 A 3 次降回 2（Q2b）
const STUCK_LIMIT = 3;        // 连续卡 A 次数上限（Q2b）

export type Team = 0 | 1;     // 队 0 = 座位 0&2；队 1 = 座位 1&3

export const teamOf = (seat: Seat): Team => (seat % 2) as Team;
export const partnerOf = (seat: Seat): Seat => ((seat + 2) % 4) as Seat;

/**
 * 打 A 局"双下"即锁定过 A —— 可提前收盘、不必让对手打完剩牌。
 * 条件：finished 前两名(头游+二游)同队 且 该队级牌已到 A。此时 gain=3(升3级)≥2，严格过A 已必成，
 * 后两名(两个对手)的名次无论如何都不改变过 A 结果，故可立即宣布胜利。
 */
export function passALockedEarly(m: MatchState, finished: Seat[]): boolean {
  return finished.length >= 2
    && teamOf(finished[0] as Seat) === teamOf(finished[1] as Seat)
    && m.levels[teamOf(finished[0] as Seat)] === A;
}

/** 提前收盘用的完整名次：不足 4 人时把仍在场座位补到末尾（顺序不影响双下 gain=3 / 过A 判定）。 */
export function fullRanking(finished: Seat[]): Seat[] {
  const rest = ([0, 1, 2, 3] as Seat[]).filter((s) => !finished.includes(s));
  return [...finished, ...rest];
}

/** 一张逢人配（红心级牌）？ */
const isWild = (c: Card, level: Rank): boolean =>
  c.kind === 'normal' && c.suit === 'H' && c.rank === level;

// ---------------------------------------------------------------------------
// 整盘状态
// ---------------------------------------------------------------------------

export interface MatchState {
  /** 两队当前级别（打几）。levels[team]。 */
  levels: [Rank, Rank];
  /** 当前局打谁的级（庄家队 = 上局赢家队；首局任意，两队都打 2）。 */
  trumpTeam: Team;
  /** 第几局（1 起）。 */
  dealNo: number;
  /** 各队连续卡 A 次数（Q2b）。 */
  stuckA: [number, number];
  /** 整盘是否结束。 */
  over: boolean;
  /** 赢家队（over 时有值）。 */
  winner: Team | null;
}

/** 当前局级牌 = 庄家队的级别。 */
export function dealLevel(m: MatchState): Rank {
  return m.levels[m.trumpTeam];
}

/** 开新整盘：两队打 2、第 1 局。首局首攻由调用方随机定（两队都打 2，级牌恒为 2）。 */
export function startMatch(): MatchState {
  return { levels: [2, 2], trumpTeam: 0, dealNo: 1, stuckA: [0, 0], over: false, winner: null };
}

// ---------------------------------------------------------------------------
// 结算单局 → 升级 / 打 A 过 A
// ---------------------------------------------------------------------------

export interface SettleResult {
  /** 结算后的新整盘状态（trumpTeam 已切到本局头游方、dealNo+1）。 */
  match: MatchState;
  /** 本局头游方队。 */
  winTeam: Team;
  /** 本局升级数（对家二游 3 / 三游 2 / 末游 1）。 */
  gain: 1 | 2 | 3;
  /** 本局是否过 A 收盘。 */
  passedA: boolean;
  /** 本局是否卡 A（打 A 局头游+对家末游，没过）。 */
  stuck: boolean;
  /** 本局是否因连续卡 A 3 次而降回 2。 */
  demoted: boolean;
}

/**
 * 一局结束后结算：按名次 `finished`（头游→末游，须长度 4）给头游方升级，
 * 并按 Q2/Q2b 判打 A 过 A / 卡 A / 降级。返回新整盘状态 + 结果（供 UI / 进贡使用）。
 */
export function settleDeal(m: MatchState, finished: Seat[]): SettleResult {
  if (finished.length !== 4) throw new Error('settleDeal: 名次须为完整 4 人排列');
  const head = finished[0] as Seat;
  const winTeam = teamOf(head);
  const partnerIdx = finished.indexOf(partnerOf(head)); // 1=二游 / 2=三游 / 3=末游
  const gain = (4 - partnerIdx) as 1 | 2 | 3;           // 二游→3 / 三游→2 / 末游→1

  const levels: [Rank, Rank] = [m.levels[0], m.levels[1]];
  const stuckA: [number, number] = [m.stuckA[0], m.stuckA[1]];
  const was = levels[winTeam];
  let over = false;
  let winner: Team | null = null;
  let passedA = false;
  let stuck = false;
  let demoted = false;

  if (was === A) {
    // 打 A 局：严格过 A（Q2）——头游 + 对家非末游(gain≥2)才过。
    if (gain >= 2) {
      over = true;
      winner = winTeam;
      passedA = true;
    } else {
      // 头游 + 对家末游(gain=1) → 卡 A（Q2b）。
      stuck = true;
      stuckA[winTeam] += 1;
      if (stuckA[winTeam] >= STUCK_LIMIT) {
        levels[winTeam] = RESET_LEVEL; // 连续卡 A 3 次 → 降回 2
        stuckA[winTeam] = 0;
        demoted = true;
      }
    }
  } else {
    // 未到 A：升级，封顶 A（不可越过 A，到 A 后须另开一局打过）。
    levels[winTeam] = Math.min(A, was + gain) as Rank;
  }

  return {
    match: { levels, trumpTeam: winTeam, dealNo: m.dealNo + 1, stuckA, over, winner },
    winTeam,
    gain,
    passedA,
    stuck,
    demoted,
  };
}

// ---------------------------------------------------------------------------
// 进贡 / 还贡 / 抗贡
// ---------------------------------------------------------------------------

export interface TributeExchange {
  /** 进贡方座位。 */
  giver: Seat;
  /** 收贡方座位。 */
  receiver: Seat;
  /** 进贡的牌（giver 手中除逢人配外最大的一张）。 */
  tribute: Card;
}

export interface TributePlan {
  /** 进贡交换（单贡 1 项 / 双贡 2 项 / 抗贡 0 项）。 */
  exchanges: TributeExchange[];
  /** 是否抗贡（持双大王，免进免还）。 */
  resist: boolean;
  /** 本局首攻：进贡则末游、抗贡则头游（Q6）。 */
  firstLeader: Seat;
  /** 是否双下（头游+二游同队 → 双贡）。 */
  doubleDown: boolean;
}

/** 一手中除逢人配外最大的一张（进贡牌；Q3）。一手 27 张不可能全是逢人配，必非空。 */
function largestNonWild(hand: Card[], level: Rank): Card {
  const cand = hand.filter(c => !isWild(c, level));
  const pool = cand.length ? cand : hand;
  return pool.reduce((best, c) => (rankValue(c, level) > rankValue(best, level) ? c : best));
}

/** 持两张大王（抗贡判定；Q5）。 */
function hasTwoBigJokers(cards: Card[]): boolean {
  return cards.filter(c => c.kind === 'joker' && c.big).length >= 2;
}

/**
 * 据上一局名次 `finished`（头游→末游）与本局新发手牌 `hands`、级牌 `level`，定进贡计划：
 * - 非双下：末游 → 头游（单贡）；抗贡看末游一人持双大王。
 * - 双下（头游+二游同队）：末游 → 头游、三游 → 二游（双贡）；抗贡看三游+末游合计持双大王。
 * - 首攻：进贡则末游、抗贡则头游（Q6）。
 */
export function planTribute(finished: Seat[], hands: Card[][], level: Rank): TributePlan {
  if (finished.length !== 4) throw new Error('planTribute: 名次须为完整 4 人排列');
  const head = finished[0] as Seat;
  const second = finished[1] as Seat;
  const third = finished[2] as Seat;
  const last = finished[3] as Seat;
  const doubleDown = teamOf(head) === teamOf(second);

  const resist = doubleDown
    ? hasTwoBigJokers([...(hands[third] as Card[]), ...(hands[last] as Card[])])
    : hasTwoBigJokers(hands[last] as Card[]);

  if (resist) {
    return { exchanges: [], resist: true, firstLeader: head, doubleDown };
  }

  let exchanges: TributeExchange[];
  if (doubleDown) {
    // 双贡：末游、三游各拿最大非王牌进贡；头游拿点数较大的那张、二游拿较小的（与谁出无关，
    // owner ruling）。相等则末游→头游（确定性）。还贡沿各 exchange 的 giver 原路返还。
    const tLast = largestNonWild(hands[last] as Card[], level);
    const tThird = largestNonWild(hands[third] as Card[], level);
    const lastBigger = rankValue(tLast, level) >= rankValue(tThird, level);
    const big = lastBigger ? { giver: last, tribute: tLast } : { giver: third, tribute: tThird };
    const small = lastBigger ? { giver: third, tribute: tThird } : { giver: last, tribute: tLast };
    exchanges = [
      { giver: big.giver, receiver: head, tribute: big.tribute },
      { giver: small.giver, receiver: second, tribute: small.tribute },
    ];
  } else {
    exchanges = [{ giver: last, receiver: head, tribute: largestNonWild(hands[last] as Card[], level) }];
  }

  return { exchanges, resist: false, firstLeader: last, doubleDown };
}

/** 收贡方可用作还贡的牌（rankValue ≤ 10；Q4）。 */
export function returnableCards(hand: Card[], level: Rank): Card[] {
  return hand.filter(c => rankValue(c, level) <= 10);
}

/** AI/默认还贡：最小的一张可还牌（保留较大牌）。无 ≤10 牌时兜底取全局最小。 */
export function autoReturn(hand: Card[], level: Rank): Card {
  const cand = returnableCards(hand, level);
  const pool = cand.length ? cand : hand;
  return pool.reduce((best, c) => (rankValue(c, level) < rankValue(best, level) ? c : best));
}

/**
 * 把进贡 + 还贡应用到手牌：每项交换里，进贡牌从 giver 移到 receiver、还贡牌从 receiver 移到 giver。
 * `returns[i]` = 第 i 个 exchange 的还贡牌（收贡方选或 AI autoReturn）；须取自 receiver 当前手牌。
 * 返回新手牌数组（各家张数不变、108 守恒）。抗贡（exchanges 空）原样返回。
 */
export function applyTribute(hands: Card[][], plan: TributePlan, returns: Card[]): Card[][] {
  const out = hands.map(h => [...h]);
  plan.exchanges.forEach((ex, i) => {
    const ret = returns[i] as Card;
    out[ex.giver] = (out[ex.giver] as Card[]).filter(c => c.id !== ex.tribute.id).concat(ret);
    out[ex.receiver] = (out[ex.receiver] as Card[]).filter(c => c.id !== ret.id).concat(ex.tribute);
  });
  return out;
}

// ---------------------------------------------------------------------------
// 发牌
// ---------------------------------------------------------------------------

/** 发新局的 4 手牌（注入 shuffle，同一期 deal）。 */
export function dealHands(shuffle: (n: number) => number[]): Card[][] {
  return deal(makeDeck(), shuffle);
}
