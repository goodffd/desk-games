import type { Card, Seat, WildAssign } from '../src/games/gandengyan/engine/types';
import { makeDeck, dealHands, sortHand } from '../src/games/gandengyan/engine/cards';
import { createDeal, play, pass, isDealOver, settle, type DealState } from '../src/games/gandengyan/engine/game';
import { isLegalPlay } from '../src/games/gandengyan/engine/legal';
import { chooseGandengyanPlay } from '../src/games/gandengyan/ai/choose';

/**
 * 干瞪眼服务端权威对局驱动。规则与结算全在 engine 里，这里只负责
 * 「谁能做什么、做完之后谁该收到什么」，一行规则判定都不复制。
 *
 * 两条协议硬约束（SPEC《干瞪眼》工程形态）：
 *   ① **牌堆内容绝不进公开态**——泄了就是完美记牌器。掼蛋压根没有牌堆这个概念，
 *      干瞪眼有，`DealState.deck` 就摆在那儿，随手 spread 一下就泄。
 *   ② **桌面当前牌的指派必须进公开态**——否则重连的人看到一张王，
 *      算不出大一该出什么、也不知道界面上该把它画成几点。
 */

export type Outbound = { to: 'all' | 'seat'; seat?: Seat; msg: any };

const err = (seat: Seat, msg: string): Outbound => ({ to: 'seat', seat, msg: { t: 'error', msg } });

/** 不洗牌（测试用固定顺序）。生产由房间层注入真随机。 */
const defaultShuffle = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** 一手打出去的牌在界面上的样子：牌 + 每张王算作什么点数。 */
interface PlayedView { cards: Card[]; assign: WildAssign[] }

/**
 * 把客户端送来的指派整成引擎认得的形状；形状不对就返回 `null`（由调用方报错）。
 *
 * 这是**客户端可控输入**，掼蛋没有对应物——攻击面比它多一整个结构体。
 * 这里只挡「形状不对」（不是数组、元素不是对象、字段不是数字）；
 * 「指到别人的王 / 指到普通牌 / 指到不存在的牌 / 点数是 2 或越界 / 条数对不上 /
 * 同一张王指派两次」这些**语义**问题一律交给 engine 的 `identify` 判——
 * 规则的真相只有一份，驱动层不另写一套。
 */
function sanitizeAssign(raw: unknown): WildAssign[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  const out: WildAssign[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') return null;
    const { jokerId, rank } = a as { jokerId?: unknown; rank?: unknown };
    if (typeof jokerId !== 'number' || !Number.isFinite(jokerId)) return null;
    if (typeof rank !== 'number' || !Number.isFinite(rank)) return null;
    out.push({ jokerId, rank: rank as WildAssign['rank'] });
  }
  return out;
}

export class GandengyanDriver {
  state: DealState;
  seatCount: number;
  online: boolean[];
  /** 掉线的「真人」座（区别于「AI 补位空座」）：两者都由 AI 代打，但界面上一个显示「掉线」、
   *  一个显示「AI」。宽限期 online 仍为 true（只回合超时代打、不全速），disconnected 独立标记。 */
  disconnected: boolean[];
  shuffle: (n: number) => number[];
  base: number;
  lastPlays: (PlayedView | 'pass' | null)[];
  lastActor: Seat | null = null;
  phase: 'playing' | 'dealResult' = 'playing';
  /** 单调递增的行棋数：房间层据它区分「真出了一手」与「纯重广播」，避免观众进场刷新真人倒计时。 */
  ply = 0;
  /** 当前桌面牌的指派（公开态要带上，重连的人才知道那张王算几点）。 */
  currentAssign: WildAssign[] = [];

  constructor(opts: { shuffle?: (n: number) => number[]; seatCount?: number; dealer?: Seat; base?: number } = {}) {
    this.seatCount = opts.seatCount ?? 5;
    this.shuffle = opts.shuffle ?? defaultShuffle;
    this.base = opts.base ?? 1;
    this.online = Array.from({ length: this.seatCount }, () => true);
    this.disconnected = Array.from({ length: this.seatCount }, () => false);
    this.lastPlays = Array.from({ length: this.seatCount }, () => null);
    const dealer = opts.dealer ?? 0;
    const dealt = dealHands(makeDeck(), this.seatCount, dealer, this.shuffle);
    this.state = createDeal({ hands: dealt.hands, deck: dealt.deck, dealer });
  }

  start(): Outbound[] {
    return [this.broadcastState(), ...this.handMsgs()];
  }

  /**
   * 公开态。**这里面绝不能出现牌堆内容**——只报还剩几张。
   * 桌面当前牌连同它的指派一起下发。
   */
  publicState(): Record<string, unknown> {
    const s = this.state;
    const base: Record<string, unknown> = {
      phase: this.phase,
      turn: s.turn,
      current: s.current
        ? { type: s.current.combo.type, length: s.current.combo.length, key: s.current.combo.key,
            cards: s.current.combo.cards, assign: this.currentAssign, by: s.current.by }
        : null,
      lastActor: this.lastActor,
      deckCount: s.deck.length,      // 只报张数，不报是哪些牌
      seats: Array.from({ length: this.seatCount }, (_, i) => ({
        seat: i as Seat,
        count: s.hands[i]!.length,
        lastPlay: this.lastPlays[i] ?? null,
        online: this.online[i],
        // AI 补位空座（从来不是真人）= 非在线且非掉线真人；掉线真人单列 disconnected，界面显示「掉线」而非「AI」
        ai: !this.online[i] && !this.disconnected[i],
        disconnected: this.disconnected[i],
      })),
    };
    if (this.phase === 'dealResult') {
      const r = settle(s, this.base);
      base['result'] = {
        winner: r.winner, pay: r.pay, gain: r.gain,
        stalemate: s.stalemate,
        hands: s.hands.map((h) => h.length),
        base: r.base, bombsPlayed: r.bombsPlayed, bombMultiplier: r.bombMultiplier,
        seats: r.seats,   // 逐座明细：剩牌张数 / 王数·2数 / 春天 / 个人倍数 / 赔付（#16 结算表逐项展开）
      };
    }
    return base;
  }

  broadcastState(): Outbound { return { to: 'all', msg: { t: 'state', ...this.publicState() } }; }

  /** 私发各座手牌——**只发给本人**。 */
  handMsgs(): Outbound[] {
    return Array.from({ length: this.seatCount }, (_, i) => ({
      to: 'seat' as const, seat: i as Seat,
      msg: { t: 'hand', cards: sortHand(this.state.hands[i]!) },
    }));
  }

  syncSeat(seat: Seat): Outbound[] {
    return [
      { to: 'seat', seat, msg: { t: 'state', ...this.publicState() } },
      { to: 'seat', seat, msg: { t: 'hand', cards: sortHand(this.state.hands[seat]!) } },
    ];
  }

  /** 观众只补公开态，绝不给手牌。 */
  spectatorSync(_client: unknown): Outbound[] {
    return [{ to: 'all', msg: { t: 'state', ...this.publicState() } }];
  }

  handlePlay(seat: Seat, cardIds: unknown, rawAssign: unknown): Outbound[] {
    if (this.phase !== 'playing') return [err(seat, '本局已结束')];
    if (this.state.turn !== seat) return [err(seat, '还没轮到你')];

    const ids = Array.isArray(cardIds) ? cardIds : null;
    if (!ids) return [err(seat, '出牌格式不对')];
    const cards = this.cardsByIds(seat, ids);
    if (!cards) return [err(seat, '牌不在你手里')];

    const assign = sanitizeAssign(rawAssign);
    if (!assign) return [err(seat, '王的指派格式不对')];

    // 合法性判定全交给 engine；非法就原样返回，**状态一个字节不动**（引擎是纯函数，不赋值就没变化）
    if (!isLegalPlay(this.state.hands[seat]!, cards, assign, this.state.current?.combo ?? null)) {
      return [err(seat, '这手牌出不了')];
    }
    this.applyPlay(seat, cards, assign);
    return this.afterAction();
  }

  handlePass(seat: Seat): Outbound[] {
    if (this.phase !== 'playing') return [err(seat, '本局已结束')];
    if (this.state.turn !== seat) return [err(seat, '还没轮到你')];
    // 领出时能出就必须出；确实出不了（手里只剩王）engine 才放行，报错文案也由它给
    try {
      this.state = pass(this.state, seat);
    } catch (e) {
      return [err(seat, (e as Error).message)];
    }
    this.lastPlays[seat] = 'pass';
    this.lastActor = seat;
    this.ply++;
    return this.afterAction();
  }

  /** 回合超时托管 / AI 座代打：走启发式+记牌 AI（#14）挑一手；返回 null（跟不上 / 领出只剩王 /
   *  要得起但忍住留逃生口）就过。AI 只在 engine 枚举的合法候选里挑，故永不产出非法出牌。 */
  forceAutoPlay(): Outbound[] {
    if (this.phase !== 'playing') return [];
    const seat = this.state.turn;
    const pick = chooseGandengyanPlay({
      hand: this.state.hands[seat]!,
      current: this.state.current?.combo ?? null,
      played: this.state.played,          // 公开已出牌，AI 记牌用；不给别家手牌/牌堆
      seatCount: this.seatCount,
    });
    if (pick === null) return this.handlePass(seat);
    this.applyPlay(seat, pick.cards, pick.assign);
    return this.afterAction();
  }

  setAI(seat: Seat, on: boolean): Outbound[] {
    this.online[seat] = !on;
    return [this.broadcastState()];
  }

  /** 标记/取消某座为「掉线真人」——AI 代打但界面显示「掉线」，区别于 AI 补位空座。
   *  房间层在真人宽限掉线时置 true、重连时置 false。不动 online（宽限期只回合超时代打）。 */
  markDisconnected(seat: Seat, on: boolean): Outbound[] {
    this.disconnected[seat] = on;
    return [this.broadcastState()];
  }

  /** 玩一手 AI：轮到的是 AI 座才动，否则返回空（房间层据此逐手带延迟驱动）。 */
  stepAI(): Outbound[] {
    if (this.phase !== 'playing') return [];
    if (this.online[this.state.turn]) return [];  // 人类座不代打
    return this.forceAutoPlay();
  }

  // ── 内部 ──────────────────────────────────────────────────────────────
  private applyPlay(seat: Seat, cards: Card[], assign: WildAssign[]): void {
    const wasLead = this.state.current === null;
    this.state = play(this.state, seat, cards, assign);
    if (wasLead) this.lastPlays = this.lastPlays.map(() => null);
    this.lastPlays[seat] = { cards, assign };
    this.currentAssign = assign;
    this.lastActor = seat;
    this.ply++;
  }

  private afterAction(): Outbound[] {
    if (isDealOver(this.state)) this.phase = 'dealResult';
    return [this.broadcastState(), ...this.handMsgs()];
  }

  /** 按 id 从该座手牌里取牌；有一张不在自己手上就整手作废（防拿别人的牌 / 不存在的 id / 重复 id）。 */
  private cardsByIds(seat: Seat, ids: unknown[]): Card[] | null {
    const hand = this.state.hands[seat]!;
    const seen = new Set<number>();
    const out: Card[] = [];
    for (const id of ids) {
      if (typeof id !== 'number' || seen.has(id)) return null;
      seen.add(id);
      const c = hand.find((x) => x.id === id);
      if (!c) return null;
      out.push(c);
    }
    return out.length ? out : null;
  }
}
