import type { Card, Seat, Rank } from '../src/games/guandan/engine/types';
import { dealHands, startMatch, dealLevel, settleDeal, planTribute, returnableCards, applyTribute, passALockedEarly, fullRanking, type MatchState, type SettleResult, type TributePlan } from '../src/games/guandan/engine/match';
import { createDeal, play, pass, isDealOver, ranking, type DealState } from '../src/games/guandan/engine/game';
import { sortHand } from '../src/games/guandan/engine/cards';
import { isLegalPlay } from '../src/games/guandan/engine/legal';
import { choosePlay, chooseReturn } from '../src/games/guandan/ai/ai';

export type Outbound = { to: 'all' | 'seat'; seat?: Seat; msg: any };

interface PendingResult {
  finished: Seat[];
  settle: SettleResult;
  lastHand: Card[];
}

interface PendingDeal {
  hands: Card[][];
  plan: TributePlan;
}

export class MatchDriver {
  match: MatchState;
  state: DealState;
  online: boolean[] = [true, true, true, true];
  shuffle: (n: number) => number[];
  lastPlays: ({ cards: Card[] } | 'pass' | null)[] = [null, null, null, null];
  lastActor: Seat | null = null;
  phase: 'playing' | 'dealResult' | 'tribute' | 'matchOver' = 'playing';
  /** 单调递增的「行棋数」：每次真出牌/不要 +1。房间据它区分「真有进展(回合变了)」与「纯重广播(观战/重连 sync)」，
   *  避免观众进场把当前真人的回合计时刷新。AI/托管出牌也算进展。 */
  ply = 0;
  pendingResult: PendingResult | null = null;
  pendingDeal: PendingDeal | null = null;
  tributeReturns: Map<Seat, Card> = new Map();

  constructor(opts: { shuffle?: (n: number) => number[] } = {}) {
    this.shuffle = opts.shuffle ?? defaultShuffle;
    this.match = startMatch();
    this.state = createDeal([[], [], [], []], 0, dealLevel(this.match));
    this.phase = 'playing';
    this.pendingResult = null;
    this.pendingDeal = null;
    this.tributeReturns = new Map();
  }

  start(): Outbound[] {
    const hands = dealHands(this.shuffle);
    this.state = createDeal(hands, 0, dealLevel(this.match));
    this.lastPlays = [null, null, null, null];
    this.lastActor = null;
    this.phase = 'playing';
    this.pendingResult = null;
    this.pendingDeal = null;
    this.tributeReturns = new Map();
    return [this.broadcastState(), ...this.handMsgs()];
  }

  publicState() {
    const s = this.state;
    const base = {
      phase: this.phase, turn: s.turn, current: s.current ? { ...s.current.combo, by: s.current.by } : null,
      lastActor: this.lastActor,
      seats: ([0, 1, 2, 3] as Seat[]).map(i => ({
        seat: i, count: s.hands[i]!.length,
        lastPlay: this.lastPlays[i] ?? null, finishRank: rankOf(s.finished, i), online: this.online[i], ai: !this.online[i],
      })),
      level: s.level, levels: this.match.levels, trumpTeam: this.match.trumpTeam, dealNo: this.match.dealNo,
    };
    if (this.phase === 'tribute' && this.pendingDeal) {
      const plan = this.pendingDeal.plan;
      const pending = plan.exchanges.filter(e => !this.tributeReturns.has(e.receiver)).map(e => e.receiver);
      // 带上已知还贡牌（AI 收贡进阶段即算好、人类的收到即有）→ 客户端展示"谁还了什么给谁"
      const exchanges = plan.exchanges.map(e => ({ ...e, return: this.tributeReturns.get(e.receiver) }));
      return { ...base, tribute: { exchanges, resist: plan.resist, doubleDown: plan.doubleDown, pending } };
    }
    if ((this.phase === 'dealResult' || this.phase === 'matchOver') && this.pendingResult) {
      const { finished, settle, lastHand } = this.pendingResult;
      const result = {
        ranking: finished,
        gain: settle.gain,
        passedA: settle.passedA,
        stuck: settle.stuck,
        demoted: settle.demoted,
        lastHand,
      };
      if (this.phase === 'matchOver') {
        return { ...base, result, winner: settle.match.winner };
      }
      return { ...base, result };
    }
    return base;
  }

  broadcastState(): Outbound { return { to: 'all', msg: { t: 'state', ...this.publicState() } }; }
  handMsgs(): Outbound[] {
    return ([0, 1, 2, 3] as Seat[]).map(i => ({
      to: 'seat', seat: i, msg: { t: 'hand', cards: sortHand(this.state.hands[i]!, this.state.level) },
    }));
  }
  syncSeat(seat: Seat): Outbound[] {
    return [
      { to: 'seat', seat, msg: { t: 'state', ...this.publicState() } },
      { to: 'seat', seat, msg: { t: 'hand', cards: sortHand(this.state.hands[seat]!, this.state.level) } },
    ];
  }
  spectatorSync(_client: unknown): Outbound[] {
    return [{ to: 'all', msg: { t: 'state', ...this.publicState() } }];
  }

  nextDeal(): Outbound[] {
    if (this.match.over) return [];
    const hands = dealHands(this.shuffle);
    const plan = planTribute(this.pendingResult!.finished, hands, dealLevel(this.match));
    this.pendingDeal = { hands, plan };
    if (plan.resist) {
      // 抗贡：应进贡方持双大王、免进贡，直接开局(head 首攻)。给全场一条通知，否则玩家困惑为何没进贡还贡。
      const started = this.beginDeal(hands, plan.firstLeader);
      return [{ to: 'all', msg: { t: 'notice', text: '本局抗贡：应进贡方持双大王，免进贡还贡' } }, ...started];
    }
    this.phase = 'tribute';
    this.tributeReturns = new Map();
    const out: Outbound[] = [];
    for (const ex of plan.exchanges) {
      if (this.online[ex.receiver]) {
        out.push({ to: 'seat', seat: ex.receiver, msg: { t: 'need-tribute', options: returnableCards(hands[ex.receiver]!, dealLevel(this.match)) } });
      } else {
        this.tributeReturns.set(ex.receiver, chooseReturn(hands[ex.receiver]!, dealLevel(this.match)));
      }
    }
    out.unshift(this.broadcastState());
    return this.maybeFinishTribute(out);
  }

  handleTributeReturn(seat: Seat, cardId: number): Outbound[] {
    if (this.phase !== 'tribute' || !this.pendingDeal) return [err(seat, '当前无需还贡')];
    const ex = this.pendingDeal.plan.exchanges.find(e => e.receiver === seat);
    if (!ex || this.tributeReturns.has(seat)) return [err(seat, '你无需还贡')];
    const card = this.pendingDeal.hands[seat]!.find(c => c.id === cardId);
    const ok = card && returnableCards(this.pendingDeal.hands[seat]!, dealLevel(this.match)).some(c => c.id === cardId);
    if (!ok) return [err(seat, '还贡牌不合规(须≤10)')];
    this.tributeReturns.set(seat, card!);
    return this.maybeFinishTribute([]);
  }

  forceAutoReturn(): Outbound[] {
    if (this.phase !== 'tribute' || !this.pendingDeal) return [];
    for (const ex of this.pendingDeal.plan.exchanges) {
      if (!this.tributeReturns.has(ex.receiver)) {
        this.tributeReturns.set(ex.receiver, chooseReturn(this.pendingDeal.hands[ex.receiver]!, dealLevel(this.match)));
      }
    }
    return this.maybeFinishTribute([]);
  }

  private maybeFinishTribute(out: Outbound[]): Outbound[] {
    const need = this.pendingDeal!.plan.exchanges.filter(e => !this.tributeReturns.has(e.receiver));
    if (need.length) return out;
    const returns = this.pendingDeal!.plan.exchanges.map(e => this.tributeReturns.get(e.receiver)!);
    const hands = applyTribute(this.pendingDeal!.hands, this.pendingDeal!.plan, returns);
    // 开新局前先广播一次"全部还贡已知"的 tribute state，让客户端拿到完整还贡（供开局汇总揭示）。
    const reveal = this.broadcastState();
    return [...out, reveal, ...this.beginDeal(hands, this.pendingDeal!.plan.firstLeader)];
  }

  private beginDeal(hands: Card[][], firstLeader: Seat): Outbound[] {
    this.state = createDeal(hands, firstLeader, dealLevel(this.match));
    this.phase = 'playing';
    this.lastPlays = [null, null, null, null];
    this.lastActor = null;
    this.pendingDeal = null;
    this.pendingResult = null;
    return [this.broadcastState(), ...this.handMsgs()]; // 首攻若 AI 座，由房间层带延迟驱动
  }

  // ── PUBLIC: validate → applyPlay → afterAction → driveAI ──────────────────
  handlePlay(seat: Seat, cardIds: number[]): Outbound[] {
    if (this.state.turn !== seat) return [err(seat, '还没轮到你')];
    const cards = this.cardsByIds(seat, cardIds);
    if (!cards) return [err(seat, '牌不在你手里')];
    if (!isLegalPlay(cards, this.state.current?.combo ?? null, this.state.hands[seat]!, this.state.level))
      return [err(seat, '不合规')];
    this.applyPlay(seat, cards);
    return [...this.afterAction(seat)]; // AI 后续座由房间层带延迟逐手驱动
  }

  handlePass(seat: Seat): Outbound[] {
    if (this.state.turn !== seat) return [err(seat, '还没轮到你')];
    if (this.state.current === null) return [err(seat, '领出不能不要')];
    this.applyPass(seat);
    return [...this.afterAction(seat)]; // AI 后续座由房间层带延迟逐手驱动
  }

  /** 回合超时托管：替当前轮到的座位（在线真人发呆时）用 choosePlay 自动出一手，同 AI 接管。 */
  forceAutoPlay(): Outbound[] {
    if (this.phase !== 'playing' || isDealOver(this.state)) return [];
    const seat = this.state.turn;
    const decision = choosePlay(this.state, seat);
    if (decision === null) this.applyPass(seat); else this.applyPlay(seat, decision);
    return [...this.afterAction(seat)]; // AI 后续座由房间层带延迟逐手驱动
  }

  // ── PRIVATE: state-advancing core (no driveAI) ────────────────────────────
  private applyPlay(seat: Seat, cards: Card[]): void {
    const wasLead = this.state.current === null;
    this.state = play(this.state, seat, cards);
    if (wasLead) this.lastPlays = [null, null, null, null];
    this.lastPlays[seat] = { cards };
    this.lastActor = seat;
    this.ply++;
  }

  private applyPass(seat: Seat): void {
    this.state = pass(this.state, seat);
    this.lastPlays[seat] = 'pass';
    this.lastActor = seat;
    this.ply++;
  }

  // ── AI 接管 ───────────────────────────────────────────────────────────────
  setAI(seat: Seat, on: boolean): Outbound[] {
    this.online[seat] = !on;
    return [this.broadcastState()]; // 转 AI 后由房间层带延迟驱动其出牌
  }

  /** 玩一手 AI：当前回合是 AI 座(online[seat]=false)且未收盘才出一手，返回该手公开态+私发；否则 []。
   *  房间层据此逐手带思考延迟驱动（延迟在服务端=权威计时，所有客户端一致）。 */
  stepAI(): Outbound[] {
    if (this.phase !== 'playing' || isDealOver(this.state) || passALockedEarly(this.match, this.state.finished)) return [];
    const seat = this.state.turn;
    if (this.online[seat]) return []; // 人类座不代打
    const decision = choosePlay(this.state, seat);
    if (decision === null) this.applyPass(seat); else this.applyPlay(seat, decision);
    return this.afterAction(seat);
  }

  /** 同步把连续 AI 座一次打完（无延迟）——仅测试/内部用；房间层实时对局用 stepAI 逐手带延迟。 */
  driveAI(): Outbound[] {
    const out: Outbound[] = [];
    let guard = 0;
    for (let step = this.stepAI(); step.length && guard++ < 200; step = this.stepAI()) out.push(...step);
    return out;
  }

  private afterAction(actor: Seat): Outbound[] {
    const out: Outbound[] = [];
    // 局终 或 打A局双下即锁定过A(提前收盘、不必让对手打完剩牌) → 结算收盘。
    const early = passALockedEarly(this.match, this.state.finished);
    if (isDealOver(this.state) || early) {
      const finished = isDealOver(this.state) ? ranking(this.state) : fullRanking(this.state.finished);
      const settle = settleDeal(this.match, finished);
      this.match = settle.match;
      const lastSeat = finished[3] as Seat;
      this.phase = settle.match.over ? 'matchOver' : 'dealResult';
      this.pendingResult = { finished, settle, lastHand: this.state.hands[lastSeat]! };
      out.push(this.broadcastState());
    } else {
      out.push(this.broadcastState(), { to: 'seat', seat: actor, msg: { t: 'hand', cards: sortHand(this.state.hands[actor]!, this.state.level) } });
    }
    return out;
  }

  private cardsByIds(seat: Seat, ids: number[]): Card[] | null {
    const hand = this.state.hands[seat]!; const out: Card[] = [];
    for (const id of ids) { const c = hand.find(x => x.id === id); if (!c) return null; out.push(c); }
    return out.length ? out : null;
  }
}

function err(seat: Seat, msg: string): Outbound { return { to: 'seat', seat, msg: { t: 'error', msg } }; }

function rankOf(finished: Seat[], seat: Seat): 1 | 2 | 3 | 4 | null {
  const i = finished.indexOf(seat); return i === -1 ? null : ((i + 1) as 1 | 2 | 3 | 4);
}

function defaultShuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]!; a[i] = a[j]!; a[j] = t; }
  return a;
}
