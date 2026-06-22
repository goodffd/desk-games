/**
 * online-driver.ts — 联机模式牌局驱动（Plan 3 Task 4+5）。
 *
 * 实现 GameDriver：把权威服务端的公开态 `state` + 私有 `hand` + `need-tribute` 翻译成跟
 * LocalDriver 同形的 GameSnapshot / onResult / onTribute；动作发 WS。**自身无引擎无 AI**。
 *
 * egocentric 旋转：玩家真实座位 base 映射到 view 座位 0（你恒在底部），队伍维度同步重映射
 * （"我方"恒为你这队），使 view 的牌桌渲染（HUMAN_SEAT=0 + 四向布局）零改动继承。
 * 别家手牌服务端从不下发——用占位 Card（负 id、不渲染牌面）填长度。本模块 NEVER imports DOM。
 */

import type { Card, Seat, Rank, Combo } from '../engine/types';
import type { DealState } from '../engine/game';
import { teamOf, type MatchState, type Team, type SettleResult, type TributeExchange } from '../engine/match';
import { comboSpeech } from '../ui/render';
import { c2s, type C2SMessage, type S2CType, type PublicState } from '../online/protocol';
import type { GameDriver, GameSnapshot, GamePhase, DealOutcome, TributePrompt, LastPlays } from './types';

/** OnlineDriver 依赖的最小 IO（OnlineSession 满足）。 */
export interface OnlineIO {
  on(type: S2CType, cb: (msg: unknown) => void): void;
  send(msg: C2SMessage): void;
}

const emptyLastPlays = (): LastPlays => ({ 0: null, 1: null, 2: null, 3: null });

/** 占位手牌（别家手牌只参与张数渲染，牌面永不展示；负 id 防与真牌/彼此冲突）。 */
function placeholders(vSeat: Seat, count: number): Card[] {
  return Array.from({ length: count }, (_, k): Card => ({ kind: 'normal', suit: 'S', rank: 2, id: -1 - vSeat * 1000 - k }));
}

function stripBy(c: Combo & { by: Seat }): Combo {
  const { type, cards, length, key, power } = c;
  return { type, cards, length, key, power };
}

function emptySnapshot(): GameSnapshot {
  const state: DealState = { hands: [[], [], [], []], current: null, turn: 0, passesInRow: 0, finished: [], level: 2 };
  const match: MatchState = { levels: [2, 2], trumpTeam: 0, dealNo: 1, stuckA: [0, 0], over: false, winner: null };
  return { state, match, lastPlays: emptyLastPlays(), lastActor: null, started: true, phase: 'playing' };
}

export class OnlineDriver implements GameDriver {
  /** 联机由服务端自动续局，结算弹层不显「下一局」。 */
  readonly autoAdvance = true;

  private readonly io: OnlineIO;
  private readonly base: Seat;       // 我的真实座位（旋转基准）；spectator=0
  private readonly spectator: boolean;

  private lastState: PublicState | null = null;
  private myHand: Card[] = [];
  private snap: GameSnapshot = emptySnapshot();
  private myTributeOptions: Card[] | null = null;
  private pendingTribute: PublicState['tribute'] | null = null;
  private lastSpokenSig = '';
  private disposed = false;

  private changeCb: (() => void) | null = null;
  private resultCb: ((o: DealOutcome) => void) | null = null;
  private tributeCb: ((p: TributePrompt) => void) | null = null;
  private speakCb: ((text: string) => void) | null = null;
  private hintCb: ((text: string, kind: 'info' | 'warn') => void) | null = null;

  constructor(io: OnlineIO, mySeat: Seat | 'spectator') {
    this.io = io;
    this.spectator = mySeat === 'spectator';
    this.base = mySeat === 'spectator' ? 0 : mySeat;
    io.on('state', (m) => { if (!this.disposed) this.onState(m as PublicState); });
    io.on('hand', (m) => { if (!this.disposed) this.onHand(m as { cards: Card[] }); });
    io.on('need-tribute', (m) => { if (!this.disposed) this.onNeedTribute(m as { options: Card[] }); });
  }

  // ── 旋转 ──
  private v(serverSeat: Seat): Seat { return ((serverSeat - this.base + 4) % 4) as Seat; } // server→view
  private s(viewSeat: Seat): Seat { return ((viewSeat + this.base) % 4) as Seat; }          // view→server
  private vTeam(serverTeam: Team): Team { return (serverTeam ^ (this.base & 1)) as Team; }

  // ── 收消息 ──
  private onHand(m: { cards: Card[] }): void { this.myHand = m.cards; this.rebuild(); this.fireChange(); }

  private onState(st: PublicState): void {
    this.lastState = st;
    this.rebuild();
    this.fireChange();
    this.detectSpeak(st);
    if (st.phase === 'tribute' && st.tribute) this.onTributePhase(st);
    if ((st.phase === 'dealResult' || st.phase === 'matchOver') && st.result) this.fireResult(st);
  }

  private onNeedTribute(m: { options: Card[] }): void {
    this.myTributeOptions = m.options;
    if (this.pendingTribute) { const t = this.pendingTribute; this.pendingTribute = null; this.fireTribute(t); }
  }

  // ── 拼快照（旋转） ──
  private rebuild(): void {
    const st = this.lastState;
    if (!st) return;
    const VS: Seat[] = [0, 1, 2, 3];
    const hands: Card[][] = [[], [], [], []];
    for (const vSeat of VS) {
      if (vSeat === 0 && !this.spectator) hands[0] = this.myHand;
      else hands[vSeat] = placeholders(vSeat, st.seats[this.s(vSeat)]!.count);
    }
    const finished: Seat[] = [];
    for (let r = 1 as 1 | 2 | 3 | 4; r <= 4; r++) {
      const sp = st.seats.find((x) => x.finishRank === r);
      if (sp) finished.push(this.v(sp.seat));
    }
    const lastPlays = emptyLastPlays();
    for (const vSeat of VS) {
      const lp = st.seats[this.s(vSeat)]!.lastPlay;
      lastPlays[vSeat] = lp === null ? null : lp === 'pass' ? 'pass' : ({ cards: lp.cards } as unknown as Combo);
    }
    const state: DealState = {
      hands,
      current: st.current ? { combo: stripBy(st.current), by: this.v(st.current.by) } : null,
      turn: this.v(st.turn),
      passesInRow: 0,
      finished,
      level: st.level,
    };
    const b = this.base & 1;
    const match: MatchState = {
      levels: [st.levels[b], st.levels[(1 - b) as 0 | 1]] as [Rank, Rank], // [我方, 对方]
      trumpTeam: this.vTeam(st.trumpTeam),
      dealNo: st.dealNo,
      stuckA: [0, 0],
      over: st.phase === 'matchOver',
      winner: st.winner != null ? this.vTeam(st.winner) : null,
    };
    this.snap = {
      state, match, lastPlays,
      lastActor: st.lastActor === null ? null : this.v(st.lastActor),
      started: true,
      phase: st.phase as GamePhase,
    };
  }

  // ── 报牌（diff：每个 state ≈ 一个动作；按签名去重，避免 setAI 等重播） ──
  private detectSpeak(st: PublicState): void {
    if (st.lastActor === null) return;
    const lp = st.seats[st.lastActor]!.lastPlay;
    let sig: string; let text: string;
    const ctx = st.current ? st.current.cards.map((c) => c.id).slice().sort((a, b) => a - b).join(',') : 'lead';
    if (lp === 'pass') { sig = `pass:${st.lastActor}:${ctx}`; text = '不要'; }
    else if (st.current && st.current.by === st.lastActor) {
      sig = `play:${st.lastActor}:${ctx}`; text = comboSpeech(stripBy(st.current), st.level);
    } else return;
    if (sig !== this.lastSpokenSig) { this.lastSpokenSig = sig; this.fireSpeak(text); }
  }

  // ── 进贡 ──
  private onTributePhase(st: PublicState): void {
    const mineIsReceiver = !this.spectator && (st.tribute!.exchanges.some((e) => e.receiver === this.base));
    if (mineIsReceiver && !this.myTributeOptions) {
      this.pendingTribute = st.tribute; // 等 need-tribute（服务端 state 先于 need-tribute 下发）
      return;
    }
    this.fireTribute(st.tribute!);
  }

  private fireTribute(tw: NonNullable<PublicState['tribute']>): void {
    const exchanges: TributeExchange[] = tw.exchanges.map((e) => ({ giver: this.v(e.giver), receiver: this.v(e.receiver), tribute: e.tribute }));
    const st = this.lastState!;
    const level = st.levels[st.trumpTeam] as Rank; // 新局级牌（庄家队级别），用于进贡牌逢人配渲染
    const options = this.myTributeOptions;
    this.tributeCb?.({
      exchanges,
      myReturnOptions: options ?? null,
      level,
      resolve: (returnCardId: number | null): void => {
        if (returnCardId != null) this.io.send(c2s.tributeReturn(returnCardId));
        this.myTributeOptions = null;
      },
    });
  }

  private fireResult(st: PublicState): void {
    const r = st.result!;
    const settle: SettleResult = {
      match: this.snap.match,                                   // 已旋转
      winTeam: this.vTeam(teamOf(r.ranking[0] as Seat)),        // 头游的队（旋转到 view 队）
      gain: r.gain, passedA: r.passedA, stuck: r.stuck, demoted: r.demoted,
    };
    this.resultCb?.({ settle, leftover: r.lastHand });
  }

  // ── GameDriver ──
  snapshot(): GameSnapshot { return this.snap; }

  start(): void { /* 联机：服务端 started 后才挂牌桌，无需本地 start */ }
  timeoutSeat(_seat: Seat): void { /* 联机：服务端自有托管/AI，客户端不发超时包 */ }
  nextDealOrResult(): void { /* 联机：服务端自动续局 */ }
  freshMatch(): void { this.io.send(c2s.restart()); } // 房主再来一盘（非房主由 UI 隐藏按钮）

  play(cards: Card[]): boolean {
    if (this.spectator || this.snap.phase !== 'playing' || this.snap.state.turn !== 0) return false;
    this.io.send(c2s.play(cards.map((c) => c.id)));
    return true;
  }

  pass(): boolean {
    if (this.spectator || this.snap.phase !== 'playing' || this.snap.state.turn !== 0) return false;
    if (this.snap.state.current === null) return false; // 领出不能不要
    this.io.send(c2s.pass());
    return true;
  }

  onChange(cb: () => void): void { this.changeCb = cb; }
  onResult(cb: (o: DealOutcome) => void): void { this.resultCb = cb; }
  onTribute(cb: (p: TributePrompt) => void): void { this.tributeCb = cb; }
  onSpeak(cb: (text: string) => void): void { this.speakCb = cb; }
  onHint(cb: (text: string, kind: 'info' | 'warn') => void): void { this.hintCb = cb; }

  /** 控制器更新座位昵称后强制重渲：rejoin 后 'room'(带昵称)晚于挂台，名字需补刷一帧。 */
  requestRender(): void { this.fireChange(); }

  private fireChange(): void { this.changeCb?.(); }
  private fireSpeak(text: string): void { this.speakCb?.(text); }
  /** 联机抗贡/提示文案当前由服务端态体现，保留接口（暂未主动 fire）。 */
  emitHint(text: string, kind: 'info' | 'warn'): void { this.hintCb?.(text, kind); }

  dispose(): void { this.disposed = true; }
}
