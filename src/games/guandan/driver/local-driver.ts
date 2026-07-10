/**
 * local-driver.ts — 本地（调试）模式牌局驱动（Plan 2 Task 2）。
 *
 * 把原 view.ts 内联的「本地引擎 + AI 调度 + 状态推进 + 进贡」逻辑抽到这里，view 只经
 * GameDriver 接口读快照/调动作/订阅事件。本模块 **NEVER imports DOM**：
 *  - 语音：fire `onSpeak(text)`，由 view 真正播放；AI 等本句报牌播完才出下一手——
 *    用注入的 `speechBusyMs()`（view 喂语音结束剩余 ms）替代 DOM 里的 gdSpeakEndAt。
 *  - 定时：注入 `schedule/clearScheduled`（默认 setTimeout/clearTimeout；单测注入即时调度）。
 *  - 发牌：注入 `shuffle`（默认随机；单测注入确定性排列）+ `firstLeader`（首攻，默认随机）。
 *  - 报牌文案 `comboSpeech` 是纯字符串函数（render.ts 顶层只 import 类型/数据），故可在此 import。
 *
 * 引擎是唯一真相：只调 engine/ai/match 导出，绝不另写规则判定。
 */

import type { Card, Seat, Rank } from '../engine/types';
import { makeDeck, deal, sortHand } from '../engine/cards';
import { createDeal, play, pass, isDealOver, ranking } from '../engine/game';
import type { DealState } from '../engine/game';
import { isLegalPlay } from '../engine/legal';
import { choosePlay, chooseReturn } from '../ai/ai';
import { comboSpeech } from '../ui/render';
import {
  startMatch, settleDeal, planTribute, applyTribute, dealLevel, returnableCards,
  type MatchState,
} from '../engine/match';
import type { GameDriver, GameSnapshot, TributePrompt, LastPlays, GamePhase, DealOutcome } from './types';

const HUMAN_SEAT: Seat = 0;

/** 本地座位连接态：人类座在线(人像)，其余三座 AI(头像显机器人)。view 据此渲染头像。 */
const LOCAL_SEAT_STATUS: ('online' | 'ai')[] =
  ([0, 1, 2, 3] as Seat[]).map((s) => (s === HUMAN_SEAT ? 'online' : 'ai'));

/** 随机洗牌（注入用默认；与 view 旧实现一致）。 */
function randomShuffle(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

const emptyLastPlays = (): LastPlays => ({ 0: null, 1: null, 2: null, 3: null });

export interface LocalDriverOpts {
  /** 注入洗牌（默认 randomShuffle；单测传确定性排列）。 */
  shuffle?: (n: number) => number[];
  /** 注入定时（默认 window.setTimeout；单测传即时调度）。返回可被 clearScheduled 取消的句柄。 */
  schedule?: (fn: () => void, ms: number) => number;
  /** 注入取消定时（默认 window.clearTimeout）。 */
  clearScheduled?: (id: number) => void;
  /** 语音结束剩余毫秒（view 据 gdSpeakEndAt 喂；默认 0=不等）。AI 等它归零再出下一手。 */
  speechBusyMs?: () => number;
  /** 首局首攻座位（默认随机 0..3；单测传定值）。后续局首攻由进贡计划定。 */
  firstLeader?: () => Seat;
}

/**
 * 本地驱动：单机对 3 个 AI。持 match/state/lastPlays/lastActor/started，对外暴露快照 + 动作 + 事件。
 */
export class LocalDriver implements GameDriver {
  private match: MatchState;
  private state: DealState;
  private started = false;
  private phase: GamePhase = 'playing';
  private lastPlays: LastPlays = emptyLastPlays();
  private lastActor: Seat | null = null;

  /** 本地手动续局（结算弹层显「下一局」）。 */
  readonly autoAdvance = false;

  private readonly shuffle: (n: number) => number[];
  private readonly schedule: (fn: () => void, ms: number) => number;
  private readonly clearScheduled: (id: number) => void;
  private readonly speechBusyMs: () => number;
  private readonly pickFirstLeader: () => Seat;

  private readonly timers: number[] = [];
  private changeCb: (() => void) | null = null;
  private resultCb: ((o: DealOutcome) => void) | null = null;
  private tributeCb: ((p: TributePrompt) => void) | null = null;
  private speakCb: ((text: string) => void) | null = null;
  private hintCb: ((text: string, kind: 'info' | 'warn') => void) | null = null;

  constructor(opts: LocalDriverOpts = {}) {
    this.shuffle = opts.shuffle ?? randomShuffle;
    this.schedule = opts.schedule ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.clearScheduled = opts.clearScheduled ?? ((id) => window.clearTimeout(id));
    this.speechBusyMs = opts.speechBusyMs ?? ((): number => 0);
    this.pickFirstLeader = opts.firstLeader ?? ((): Seat => Math.floor(Math.random() * 4) as Seat);
    this.match = startMatch();
    this.state = this.dealNew(dealLevel(this.match));
  }

  // ── 发牌 ───────────────────────────────────────────────────
  /** 发一局：按级牌发牌 + 排序 + 定首攻（首局随机/注入首攻；后续局传 hands/firstLeader）。 */
  private dealNew(level: Rank, hands?: Card[][], firstLeader?: Seat): DealState {
    const dealt = hands ?? deal(makeDeck(), this.shuffle);
    const sorted = dealt.map((h) => sortHand(h, level));
    const leader = firstLeader ?? this.pickFirstLeader();
    return createDeal(sorted, leader, level);
  }

  // ── 快照 ───────────────────────────────────────────────────
  snapshot(): GameSnapshot {
    return { state: this.state, match: this.match, lastPlays: this.lastPlays, lastActor: this.lastActor, started: this.started, phase: this.phase, seatStatus: LOCAL_SEAT_STATUS };
  }

  // ── 事件订阅 ───────────────────────────────────────────────
  onChange(cb: () => void): void { this.changeCb = cb; }
  onResult(cb: (o: DealOutcome) => void): void { this.resultCb = cb; }
  onTribute(cb: (p: TributePrompt) => void): void { this.tributeCb = cb; }
  onSpeak(cb: (text: string) => void): void { this.speakCb = cb; }
  onHint(cb: (text: string, kind: 'info' | 'warn') => void): void { this.hintCb = cb; }

  private fireChange(): void { this.changeCb?.(); }
  private fireSpeak(text: string): void { this.speakCb?.(text); }
  private fireHint(text: string, kind: 'info' | 'warn'): void { this.hintCb?.(text, kind); }

  // ── 引擎推进（同时维护 lastPlays/lastActor，并 fire 语音） ──
  private applyPlay(seat: Seat, cards: Card[]): void {
    const wasLead = this.state.current === null;
    this.state = play(this.state, seat, cards);
    if (wasLead) this.lastPlays = emptyLastPlays(); // 新一圈：清掉上圈
    this.lastPlays[seat] = this.state.current ? this.state.current.combo : null;
    this.lastActor = seat;
    if (this.state.current) this.fireSpeak(comboSpeech(this.state.current.combo, this.state.level));
  }

  private applyPass(seat: Seat): void {
    this.state = pass(this.state, seat);
    this.lastPlays[seat] = 'pass';
    this.lastActor = seat;
    this.fireSpeak('不要');
    // 不在此清桌面：留到赢家领新圈时由 applyPlay 的 wasLead 统一清（同 view 旧逻辑）。
  }

  /** 一步动作后：渲染 → 局终结算/否则若非我回合起 AI（= view 旧 afterAction/scheduleAi-inner 的公共尾）。 */
  private after(): void {
    this.fireChange();
    if (isDealOver(this.state)) {
      const finished = ranking(this.state);
      const settle = settleDeal(this.match, finished);
      this.match = settle.match; // 升级/打A过A 已结算；snapshot().match 随之更新
      this.phase = settle.match.over ? 'matchOver' : 'dealResult';
      const leftover = this.state.hands[finished[3]!]!; // 末游剩牌
      this.resultCb?.({ settle, leftover });
    } else if (this.state.turn !== HUMAN_SEAT) {
      this.scheduleAi();
    }
  }

  // ── AI 自动推进 ────────────────────────────────────────────
  private scheduleAi(): void {
    if (isDealOver(this.state) || this.state.turn === HUMAN_SEAT) return;
    const act = (): void => {
      if (isDealOver(this.state) || this.state.turn === HUMAN_SEAT) return;
      // 上一手报牌还在播就再等，等播完再出，语音不被下一手打断截断
      const left = this.speechBusyMs();
      if (left > 0) { this.timers.push(this.schedule(act, Math.min(left + 50, 1600))); return; }
      const seat = this.state.turn;
      const decision = choosePlay(this.state, seat);
      try {
        if (decision === null) this.applyPass(seat);
        else this.applyPlay(seat, decision);
      } catch (e) {
        console.error('AI step error', e);
        return;
      }
      this.after();
    };
    // 思考 1.2~2.5s（让倒计时可见）+ 等上句报牌播完
    this.timers.push(this.schedule(act, 1200 + Math.floor(Math.random() * 1300)));
  }

  // ── 动作（GameDriver） ─────────────────────────────────────
  start(): void {
    this.started = true;
    this.fireChange(); // 开始后才显示状态/思考中浮标
    if (this.state.turn !== HUMAN_SEAT) this.scheduleAi();
  }

  play(cards: Card[]): boolean {
    if (isDealOver(this.state) || this.state.turn !== HUMAN_SEAT) return false;
    const prev = this.state.current?.combo ?? null;
    if (!isLegalPlay(cards, prev, this.state.hands[HUMAN_SEAT]!, this.state.level)) return false;
    this.applyPlay(HUMAN_SEAT, cards);
    this.after();
    return true;
  }

  pass(): boolean {
    if (isDealOver(this.state) || this.state.turn !== HUMAN_SEAT) return false;
    if (this.state.current === null) return false; // 自己领出时不能不要
    this.applyPass(HUMAN_SEAT);
    this.after();
    return true;
  }

  /** 回合超时托管：用 choosePlay 替该座出一手（AI 兜底，保证合法）。 */
  timeoutSeat(seat: Seat): void {
    if (!this.started || isDealOver(this.state) || this.state.turn !== seat) return;
    try {
      const decision = choosePlay(this.state, seat);
      if (decision === null) this.applyPass(seat);
      else this.applyPlay(seat, decision);
    } catch (e) {
      console.error('autoPlay error', e);
      if (this.state.current !== null) this.applyPass(seat); else return;
    }
    this.after();
  }

  // ── 局终 → 下一局 / 进贡 ───────────────────────────────────
  /** 一局结束后由「下一局」按钮调：算进贡 → fire onTribute（抗贡则直接开局 + onHint）。 */
  nextDealOrResult(): void {
    const finished = ranking(this.state);   // 上一局名次（头游→末游）
    const level = dealLevel(this.match);     // 新级牌 = 上局赢家队级别（match 已结算）
    const dealt = deal(makeDeck(), this.shuffle);
    const plan = planTribute(finished, dealt, level);

    if (plan.resist) {
      this.startDealAfterTribute(level, dealt, plan.firstLeader);
      this.fireHint('对方持两张大王，抗贡！本局免进贡', 'info');
      return;
    }

    this.phase = 'tribute';
    // 我是收贡方 → 给可还牌池（≤10；无则兜底全手牌，同 view 旧逻辑）；否则 null（仅展示进贡）。
    const humanEx = plan.exchanges.find((e) => e.receiver === HUMAN_SEAT);
    const cands = humanEx ? returnableCards(dealt[HUMAN_SEAT]!, level) : [];
    const myReturnOptions = humanEx ? (cands.length ? cands : dealt[HUMAN_SEAT]!) : null;

    this.tributeCb?.({
      exchanges: plan.exchanges,
      myReturnOptions,
      level,
      resolve: (returnCardId: number | null): void => {
        // 我选的还贡牌按 id 取；AI 收贡侧 chooseReturn 智能兜底。
        const returns = plan.exchanges.map((ex) => {
          if (ex.receiver === HUMAN_SEAT && returnCardId != null) {
            return dealt[HUMAN_SEAT]!.find((c) => c.id === returnCardId) ?? chooseReturn(dealt[ex.receiver]!, level);
          }
          return chooseReturn(dealt[ex.receiver]!, level);
        });
        const tributed = applyTribute(dealt, plan, returns);
        this.startDealAfterTribute(level, tributed, plan.firstLeader);
      },
    });
  }

  /** 进贡结束（或抗贡）后真正开新局：清桌面、渲染、AI 接手。 */
  private startDealAfterTribute(level: Rank, tributed: Card[][], firstLeader: Seat): void {
    this.state = this.dealNew(level, tributed, firstLeader);
    this.phase = 'playing';
    this.lastPlays = emptyLastPlays();
    this.lastActor = null;
    this.fireChange();
    if (this.state.turn !== HUMAN_SEAT) this.scheduleAi();
  }

  /** 再来一盘：重置整盘从打 2 开打。 */
  freshMatch(): void {
    this.match = startMatch();
    this.state = this.dealNew(dealLevel(this.match));
    this.phase = 'playing';
    this.lastPlays = emptyLastPlays();
    this.lastActor = null;
    this.fireChange();
    if (this.state.turn !== HUMAN_SEAT) this.scheduleAi();
  }

  // ── 资源清理 ───────────────────────────────────────────────
  dispose(): void {
    for (const t of this.timers) this.clearScheduled(t);
    this.timers.length = 0;
  }
}
