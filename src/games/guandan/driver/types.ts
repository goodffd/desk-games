/**
 * driver/types.ts — 客户端「牌局驱动层」接口契约（Plan 2）。
 *
 * view.ts 只通过 GameDriver 读快照(snapshot)、调动作(play/pass/...)、订阅事件(onChange/...)。
 * 本地(调试)模式用 LocalDriver（本地引擎+AI+进贡）；联机(正常)模式 Plan 3 再加 OnlineDriver。
 * 引擎是唯一真相——driver 只调 engine/ai/match 导出，绝不另写规则判定。
 */

import type { Card, Seat, Rank, Combo } from '../engine/types';
import type { DealState } from '../engine/game';
import type { MatchState, SettleResult, TributeExchange } from '../engine/match';

/** 某家桌面「上一手」：一手牌(Combo) / 不要 / 无。沿用 view.ts 的形状。 */
export type LastPlay = Combo | 'pass' | null;
export type LastPlays = Record<Seat, LastPlay>;

/** 牌局阶段（弹层生命周期靠它：离开 tribute/result 阶段→关对应弹层）。 */
export type GamePhase = 'playing' | 'tribute' | 'dealResult' | 'matchOver';

/** view 渲染所需的全部只读快照（沿用现有形状，不新造 view-model）。 */
export interface GameSnapshot {
  /** 本局引擎态（本地全可见；Plan 3 OnlineDriver 用占位长度填别家手牌，仅张数参与渲染）。 */
  state: DealState;
  /** 整盘态（级别/庄家/打 A）。 */
  match: MatchState;
  /** 各家桌面上一手。 */
  lastPlays: LastPlays;
  /** 最近出牌/不要者（其出牌区浮到手牌之上）。 */
  lastActor: Seat | null;
  /** 是否已点「开始游戏」（联机：进牌桌即 true）。 */
  started: boolean;
  /** 当前阶段。view 据 phase 收弹层（playing↔tribute↔dealResult/matchOver）。 */
  phase: GamePhase;
}

/** 一局结算结果（onResult 载荷）。settle 来自引擎；leftover 是末游剩牌（本地=该座手牌；联机=服务端 lastHand）。 */
export interface DealOutcome {
  settle: SettleResult;
  /** 末游没出完的牌（view 结算弹层展示；驱动层提供，避免 view 读别家占位手牌）。 */
  leftover: Card[];
}

/** 进贡阶段交给 view 弹层处理（归一形状：本地/联机同形）。 */
export interface TributePrompt {
  /** 各进贡：giver→receiver + 进贡牌（view 空间，OnlineDriver 已旋转）。 */
  exchanges: TributeExchange[];
  /** 我是收贡方 → 可还的牌（本地=≤10 池/兜底全手牌；联机=服务端 need-tribute.options）；否则 null（仅展示）。 */
  myReturnOptions: Card[] | null;
  level: Rank;
  /** view 弹层确定后回调：我选的还贡牌 id（非收贡方传 null）。本地 applyTribute+开局；联机发 tribute-return。 */
  resolve: (returnCardId: number | null) => void;
}

/** 牌局驱动：view 与「牌从哪来、动作到哪去」之间的唯一接口。 */
export interface GameDriver {
  /** 当前快照（render 读它）。 */
  snapshot(): GameSnapshot;
  /** 点开始游戏：本地=发牌 +（若非我回合）起 AI；触发 onChange。 */
  start(): void;
  /** 出牌：返回是否合法/已受理（非法不推进）。 */
  play(cards: Card[]): boolean;
  /** 不要：返回是否已受理（领出不能不要 → false）。 */
  pass(): boolean;
  /** 回合超时托管（本地：用 choosePlay 替该座出一手）。 */
  timeoutSeat(seat: Seat): void;
  /** 一局结束后推进到下一局：本地=算进贡→onTribute（或抗贡开局）；联机=no-op（服务端自动续局）。 */
  nextDealOrResult(): void;
  /** 再来一盘：本地=重开整盘；联机=发 restart（房主再来一盘，留座重开）。 */
  freshMatch(): void;
  /** 结算后是否自动续局（联机 true：结算弹层不显「下一局」、等下个 state 自动关；本地 false：手动「下一局」）。 */
  readonly autoAdvance: boolean;
  /** 状态变 → view 拷快照 + renderAll。 */
  onChange(cb: () => void): void;
  /** 一局结束 → view 弹结算层。载荷 DealOutcome（settle + 末游剩牌 leftover），driver 已据 settle 更新 match。 */
  onResult(cb: (o: DealOutcome) => void): void;
  /** 进贡阶段 → view 弹进贡/还贡层。 */
  onTribute(cb: (p: TributePrompt) => void): void;
  /** 报牌/不要语音。 */
  onSpeak(cb: (text: string) => void): void;
  /** 文案提示（抗贡/进贡结果等）。 */
  onHint(cb: (text: string, kind: 'info' | 'warn') => void): void;
  /** 清定时器等资源（unmount 时调）。 */
  dispose(): void;
}
