import type { Card, Combo, Seat, WildAssign } from './types';
import { beats, identify, isBomb } from './combos';
import { hasAnyPlay } from './legal';
import { MAX_SEATS, MIN_SEATS } from './cards';

/**
 * 干瞪眼单局状态机。engine 是规则唯一真相，UI 与 AI 不得另写一套判定。
 *
 * 一局的形状：
 *   庄领出 → 各家按大一法则跟牌或过牌 → 一轮全过 → **只有该轮赢家摸 1 张** →
 *   由他领出下一轮 → 牌堆见底后不再补 → 先打完手牌者赢，本局立刻结束。
 *
 * 已实现：单张 / 对子 / 顺子 / 连对（#5），炸弹 / 王炸 / 三个逃生口（#6）。
 * 尚未实现，按票号排队：
 * - #7 王的百搭与显式指派 —— 在那之前，王**只能凑王炸**（大王+小王），
 *      单张王与「王 + 普通牌」都出不去
 * 僵局收场（#8）：领出方确实一张也出不了时允许过、出牌权顺延；绕一圈无人能动则本局终止，
 * 剩牌张数最少者为赢家、并列则无人收分。这条同时是模糊测试的终止性保证。
 *
 * 一个值得记住的结构性事实：**卡住的手牌有且只有「恰好一张王」**——领出可以出任意合法牌型，
 * 而任何一张普通牌都是合法单张，所以有普通牌就卡不住；两张王能出王炸，也卡不住。
 * 全场只有两张王，于是单副牌下**全圈卡死只可能发生在 2 人局、双方各剩一张王**，
 * 3 人以上凑不出三个「只剩一张王」的人。这也意味着 `fewestCardsWinner` 的「不并列」那一支
 * 在单副牌下走不到（能卡住的人手里必然都是 1 张）；留着它是为了忠于规格。
 *
 * 结算（#9）：底分 × 剩牌张数 × 2^炸弹数 × 个人倍数（每张王 ×2、每张 2 ×2、春天 ×2），
 * 赢家收各输家之和。不封顶。详见 `settle`。
 *
 * 至此单局引擎的规则面已合拢，剩下的是模糊测试（#10）与服务端接线（#12 起）。
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
  /**
   * 连续有几家「轮到领出却无牌可出」而过掉。
   * 攒到 `seatCount` 就是全圈无人能动 —— 僵局。任何人出牌都会把它清零。
   */
  readonly leadPassesInRow: number;
  /** 本局是否以僵局收场（全圈无人能动） */
  readonly stalemate: boolean;
  /**
   * 本局打出过几个炸（含王炸）。只为喂结算而存在——**别在测试里断言它**，
   * 一律穿过 `settle()` 断言最终倍数，否则就是把测试焊在内部表示上。
   */
  readonly bombsPlayed: number;
  /** 各家整局有没有打出过牌。只为判「春天」而存在，同样别直接断言。 */
  readonly hasPlayed: readonly boolean[];
  /**
   * 赢家。打空手牌者为赢家；僵局时为剩牌张数最少者，并列则为 `null`。
   * `null` 且 `stalemate` 为假，表示本局还没结束。
   */
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
    leadPassesInRow: 0,
    stalemate: false,
    bombsPlayed: 0,
    hasPlayed: Array.from({ length: seatCount }, () => false),
    winner: null,
  };
}

export function isDealOver(s: DealState): boolean {
  return s.winner !== null || s.stalemate;
}

function nextSeat(s: DealState, seat: Seat): Seat {
  return (seat + 1) % s.seatCount;
}

/**
 * 出牌被拒时，说清楚**这一种情况**为什么压不住。
 *
 * 别把「关键点数正好大一级」这句话套到炸弹身上——炸弹根本不走大一那条链，
 * 那样的报错会把人往错的方向带。
 */
function whyCannotBeat(prev: Combo, next: Combo): string {
  if (prev.type === 'jokerBomb') return '桌面是王炸，压一切，没有东西压得住它';
  if (prev.type === 'bomb') {
    return next.type === 'bomb'
      ? `桌面是 ${prev.length} 张炸(点数 ${prev.key})，要压它得张数更多，或同张数而点数更大`
      : `桌面是 ${prev.length} 张炸，只有更大的炸弹或王炸压得住`;
  }
  if (isBomb(next)) return '内部错误：炸弹本应压得住任意非炸牌型';
  if (next.type !== prev.type || next.length !== prev.length) {
    return `桌面是 ${prev.type}(${prev.length} 张)，跟牌必须同牌型、同张数`;
  }
  return `桌面是 ${prev.type}(关键点数 ${prev.key})，跟牌的关键点数须正好大一级`
    + `（2 与炸弹另有特权，不走这条链）`;
}

/**
 * 僵局时的赢家：剩牌张数最少的那一家；并列则没有赢家（本局无人收分）。
 *
 * 单副牌下这一支实际上总是并列——卡住的手牌有且只有「恰好一张王」
 * （有普通牌就能领出，两张王能出王炸），而全场只有两张王，所以能卡住的人
 * 手里必然都是 1 张。留着按张数比的逻辑是为了忠于规格：规则说的是
 * 「剩牌最少者为赢家」，而不是「僵局一律不算分」。
 */
function fewestCardsWinner(s: DealState): Seat | null {
  let best = Infinity;
  let winner: Seat | null = null;
  let tied = false;
  for (let seat = 0; seat < s.seatCount; seat++) {
    const n = s.hands[seat]!.length;
    if (n < best) { best = n; winner = seat; tied = false; }
    else if (n === best) tied = true;
  }
  return tied ? null : winner;
}

function assertActionable(s: DealState, seat: Seat): void {
  if (isDealOver(s)) throw new Error('本局已结束，不能再出牌或过牌');
  if (seat !== s.turn) throw new Error(`还没轮到座 ${seat}，当前是座 ${s.turn} 的回合`);
}

/**
 * 出牌。非法一律抛错，绝不返回一个"看起来还行"的状态——
 * 规则错误必须当场炸出来，不能顺着往下走。
 */
export function play(
  s: DealState,
  seat: Seat,
  cards: readonly Card[],
  assign: readonly WildAssign[] = [],
): DealState {
  assertActionable(s, seat);

  const hand = s.hands[seat]!;
  const handIds = new Set(hand.map((c) => c.id));
  const playIds = new Set(cards.map((c) => c.id));
  if (playIds.size !== cards.length) throw new Error('同一张牌不能出两次');
  for (const c of cards) {
    if (!handIds.has(c.id)) throw new Error(`座 ${seat} 手里没有这张牌（id=${c.id}）`);
  }

  const combo = identify(cards, assign);
  if (!combo) {
    const jokers = cards.filter((c) => c.kind === 'joker').length;
    throw new Error(
      jokers === 0 ? '这手牌不合法：认不出牌型'
        : cards.length === 1 ? '这手牌不合法：王不能单独打出'
          : assign.length !== jokers ? `这手牌不合法：${jokers} 张王要 ${jokers} 条指派，收到 ${assign.length} 条`
            : '这手牌不合法：按你给的指派认不出牌型（王不能替 2；指派须指向本次打出的王）',
    );
  }

  if (s.current && !beats(s.current.combo, combo)) {
    throw new Error(`压不住：${whyCannotBeat(s.current.combo, combo)}`);
  }

  const rest = hand.filter((c) => !playIds.has(c.id));
  const hands = s.hands.map((h, i) => (i === seat ? rest : h));
  const bombsPlayed = s.bombsPlayed + (isBomb(combo) ? 1 : 0);
  const hasPlayed = s.hasPlayed.map((p, i) => (i === seat ? true : p));

  // 打空手牌即胜，本局立刻结束——不排后面的名次，也不摸牌。
  if (rest.length === 0) {
    return {
      ...s,
      hands,
      played: [...s.played, ...cards],
      bombsPlayed,
      hasPlayed,
      current: { combo, by: seat },
      passesInRow: 0,
      leadPassesInRow: 0,
      winner: seat,
    };
  }

  return {
    ...s,
    hands,
    played: [...s.played, ...cards],
    bombsPlayed,
    hasPlayed,
    current: { combo, by: seat },
    passesInRow: 0,
    leadPassesInRow: 0, // 有人出牌 → 顺延计数清零，不会攒到误判僵局
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

  // 领出：能出就必须出；确实一张也出不了才允许过，出牌权顺延给下家。
  // 「确实出不了」只可能是手里剩的全是打不出去的王（单张王不能出）。
  if (s.current === null) {
    if (hasAnyPlay(s.hands[seat]!, null)) {
      throw new Error('轮到你领出，桌面为空时必须出牌，不能过');
    }
    const leadPassesInRow = s.leadPassesInRow + 1;

    // 绕一圈回来还是没人能动 → 本局终止，剩牌张数最少者为赢家，并列则无人收分。
    if (leadPassesInRow >= s.seatCount) {
      return { ...s, leadPassesInRow, stalemate: true, winner: fewestCardsWinner(s) };
    }
    return { ...s, leadPassesInRow, turn: nextSeat(s, seat) };
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
 * 本局结算。
 *
 * ```
 * 某输家赔付 = 底分 × 剩牌张数 × 2^(本局炸弹总数) × 个人倍数
 * 个人倍数   = 每张王 ×2 · 每张 2 ×2（逐张相乘）· 春天 ×2
 * 赢家得分   = 各输家赔付之和
 * ```
 *
 * 计分一律按剩余**张数**，不按牌面点数——调研里全部来源无一例外。
 * **不做**「手里剩炸弹加倍」（判定「剩几个炸」要先跑一层拆牌算法，且三张同点
 * 已按 3 张计入张数），**不封顶**（owner 看过 5120 底分的极值后确认）。
 */
export function settle(s: DealState, base: number): { winner: Seat | null; pay: number[]; gain: number } {
  if (!isDealOver(s)) throw new Error('本局未结束，不能结算');

  // 僵局且剩牌张数并列最少 → 没有赢家，本局无人收分。
  if (s.winner === null) {
    return { winner: null, pay: s.hands.map(() => 0), gain: 0 };
  }

  const winner = s.winner;
  const bombMultiplier = 2 ** s.bombsPlayed; // 全场共享，每个炸一律 ×2，不分大小

  const pay = s.hands.map((hand, seat) => {
    if (seat === winner) return 0;

    // 个人倍数：只作用于该输家自己，且**逐张**相乘
    let personal = 1;
    for (const c of hand) {
      if (c.kind === 'joker' || c.rank === 2) personal *= 2;
    }
    if (!s.hasPlayed[seat]) personal *= 2; // 春天：整局一张牌都没打出去过

    return base * hand.length * bombMultiplier * personal;
  });

  return { winner, pay, gain: pay.reduce((a, b) => a + b, 0) };
}
