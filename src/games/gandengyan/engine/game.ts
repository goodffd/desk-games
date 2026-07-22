import type { Card, Combo, Seat } from './types';
import { beats, identify } from './combos';
import { MAX_SEATS, MIN_SEATS } from './cards';

/**
 * 干瞪眼单局状态机。engine 是规则唯一真相，UI 与 AI 不得另写一套判定。
 *
 * 一局的形状：
 *   庄领出 → 各家按大一法则跟牌或过牌 → 一轮全过 → **只有该轮赢家摸 1 张** →
 *   由他领出下一轮 → 牌堆见底后不再补 → 先打完手牌者赢，本局立刻结束。
 *
 * 本期（#5）范围：单张 / 对子 / 顺子 / 连对。尚未实现，按票号排队：
 * - #6 炸弹族与三个逃生口（单张 2 压任意单张、对 2 压任意对子、炸弹压任意非炸）
 * - #7 王的百搭与显式指派 —— 在那之前**王是打不出去的死牌**
 * - #8 僵局收场（领出方无牌可出时出牌权顺延；全圈无人能动则本局终止）
 *
 * 因为 #8 还没到，本期存在一个**已知的未覆盖状态**：轮到某人领出、而他手里只剩王。
 * 那种局面下 `pass` 会拒绝（领出不能过牌）、`play` 也会拒绝（王不成牌型），状态机卡住。
 * 这不是可以静默吞掉的边角——`play`/`pass` 的报错信息会直说是哪种情况，
 * 本期的测试用构造手牌绕开它，等 #8 补上正式规则。
 */
export interface DealState {
  /** 本局人数 2~5 */
  readonly seatCount: number;
  /** 各家手牌，按座位号索引 */
  readonly hands: readonly (readonly Card[])[];
  /** 牌堆：发完剩下的，摸完不再补 */
  readonly deck: readonly Card[];
  /** 已经打出去的牌，按打出顺序；守恒校验与将来的记牌都靠它 */
  readonly played: readonly Card[];
  /** 桌面当前牌与它的主人；`null` 表示新一轮，轮到的人要领出 */
  readonly current: { readonly combo: Combo; readonly by: Seat } | null;
  /** 轮到谁 */
  readonly turn: Seat;
  /** 本轮连续过牌数；到了 `seatCount - 1` 就是一轮结束 */
  readonly passesInRow: number;
  /** 赢家；`null` 表示本局还没结束 */
  readonly winner: Seat | null;
}

export function createDeal(init: {
  hands: Card[][];
  deck: Card[];
  dealer: Seat;
}): DealState {
  const seatCount = init.hands.length;
  if (seatCount < MIN_SEATS || seatCount > MAX_SEATS) {
    throw new Error(`人数只能是 ${MIN_SEATS}~${MAX_SEATS}，收到 ${seatCount}`);
  }
  if (!Number.isInteger(init.dealer) || init.dealer < 0 || init.dealer >= seatCount) {
    throw new Error(`庄的座位号越界：${init.dealer}（本局 ${seatCount} 人）`);
  }
  return {
    seatCount,
    hands: init.hands.map((h) => [...h]),
    deck: [...init.deck],
    played: [],
    current: null,
    turn: init.dealer,
    passesInRow: 0,
    winner: null,
  };
}

export function isDealOver(s: DealState): boolean {
  return s.winner !== null;
}

function nextSeat(s: DealState, seat: Seat): Seat {
  return (seat + 1) % s.seatCount;
}

function assertActionable(s: DealState, seat: Seat): void {
  if (isDealOver(s)) throw new Error('本局已结束，不能再出牌或过牌');
  if (seat !== s.turn) throw new Error(`还没轮到座 ${seat}，当前是座 ${s.turn} 的回合`);
}

/**
 * 出牌。非法一律抛错，绝不返回一个"看起来还行"的状态——
 * 规则错误必须当场炸出来，不能顺着往下走。
 */
export function play(s: DealState, seat: Seat, cards: readonly Card[]): DealState {
  assertActionable(s, seat);

  const hand = s.hands[seat]!;
  const handIds = new Set(hand.map((c) => c.id));
  const playIds = new Set(cards.map((c) => c.id));
  if (playIds.size !== cards.length) throw new Error('同一张牌不能出两次');
  for (const c of cards) {
    if (!handIds.has(c.id)) throw new Error(`座 ${seat} 手里没有这张牌（id=${c.id}）`);
  }

  const combo = identify(cards);
  if (!combo) {
    const hasJoker = cards.some((c) => c.kind === 'joker');
    throw new Error(hasJoker
      ? '这手牌不合法：王还不能出（百搭与显式指派见 #7）'
      : '这手牌不合法：认不出牌型');
  }

  if (s.current && !beats(s.current.combo, combo)) {
    throw new Error(
      `压不住：桌面是 ${s.current.combo.type}(${s.current.combo.length}张, 关键点数 ${s.current.combo.key})，`
      + `跟牌须同牌型同张数且关键点数正好大一级`,
    );
  }

  const rest = hand.filter((c) => !playIds.has(c.id));
  const hands = s.hands.map((h, i) => (i === seat ? rest : h));

  // 打空手牌即胜，本局立刻结束——不排后面的名次，也不摸牌。
  if (rest.length === 0) {
    return {
      ...s,
      hands,
      played: [...s.played, ...cards],
      current: { combo, by: seat },
      passesInRow: 0,
      winner: seat,
    };
  }

  return {
    ...s,
    hands,
    played: [...s.played, ...cards],
    current: { combo, by: seat },
    passesInRow: 0,
    turn: nextSeat(s, seat),
  };
}

/**
 * 过牌。
 *
 * 领出（桌面为空）时不许过——这条全网所有实现都一致。
 * 跟牌时**要得起也可以过**，这一层「留牌做局 / 抢出牌权」的策略是干瞪眼的乐趣所在。
 */
export function pass(s: DealState, seat: Seat): DealState {
  assertActionable(s, seat);
  if (s.current === null) {
    throw new Error('轮到你领出，桌面为空时必须出牌，不能过');
  }

  const passesInRow = s.passesInRow + 1;

  // 其余各家全过 → 本轮结束
  if (passesInRow >= s.seatCount - 1) {
    const roundWinner = s.current.by;
    const drawn = s.deck.length > 0 ? s.deck[0]! : null; // 牌堆见底后不再补
    return {
      ...s,
      hands: drawn
        ? s.hands.map((h, i) => (i === roundWinner ? [...h, drawn] : h))
        : s.hands,
      deck: drawn ? s.deck.slice(1) : s.deck,
      current: null,
      turn: roundWinner,
      passesInRow: 0,
    };
  }

  return { ...s, passesInRow, turn: nextSeat(s, seat) };
}

/**
 * 本期的最小结算：底分 × 剩牌张数，赢家收各输家之和。
 *
 * 完整结算（炸弹倍数连乘、个人倍数逐张、春天）是 #9 的事，这里只把「按张数算」这条骨架立住——
 * 全部来源一律按剩余**张数**计分，没有一家按牌面点数。
 */
export function settleBySize(s: DealState, base: number): { winner: Seat; pay: number[]; gain: number } {
  if (!isDealOver(s)) throw new Error('本局未结束，不能结算');
  const winner = s.winner!;
  const pay = s.hands.map((h, i) => (i === winner ? 0 : base * h.length));
  return { winner, pay, gain: pay.reduce((a, b) => a + b, 0) };
}
