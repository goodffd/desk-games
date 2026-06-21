/**
 * driver/types.ts — 客户端「牌局驱动层」接口契约（Plan 2）。
 *
 * view.ts 只通过 GameDriver 读快照(snapshot)、调动作(play/pass/...)、订阅事件(onChange/...)。
 * 本地(调试)模式用 LocalDriver（本地引擎+AI+进贡）；联机(正常)模式 Plan 3 再加 OnlineDriver。
 * 引擎是唯一真相——driver 只调 engine/ai/match 导出，绝不另写规则判定。
 */

import type { Card, Seat, Rank, Combo } from '../engine/types';
import type { DealState } from '../engine/game';
import type { MatchState, TributePlan, SettleResult } from '../engine/match';

/** 某家桌面「上一手」：一手牌(Combo) / 不要 / 无。沿用 view.ts 的形状。 */
export type LastPlay = Combo | 'pass' | null;
export type LastPlays = Record<Seat, LastPlay>;

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
  /** 是否已点「开始游戏」。 */
  started: boolean;
}

/** 进贡阶段交给 view 弹层处理；view 收齐还贡后调 resolve(returns)，driver 应用并开新局。 */
export interface TributePrompt {
  /** 本局发到的手牌（含进贡前）。 */
  dealt: Card[][];
  plan: TributePlan;
  level: Rank;
  /** view 弹层确定后回调；returns[i] 对应 plan.exchanges[i] 的还贡牌（AI 收贡侧 driver 已用 autoReturn 填好）。 */
  resolve: (returns: Card[]) => void;
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
  /** 一局结束后推进到下一局：算进贡 → 触发 onTribute（或抗贡直接开局 onChange+onHint）。 */
  nextDealOrResult(): void;
  /** 再来一盘（整盘结束后重开）。 */
  freshMatch(): void;
  /** 状态变 → view 拷快照 + renderAll。 */
  onChange(cb: () => void): void;
  /** 一局结束 → view 弹结算层。settle = 本局结算结果（升级数/过A/卡A/降级/赢家队），
   *  driver 已据它更新 match（snapshot().match 为结算后级别）；OnlineDriver 将来用服务端下发的结果填同形状。 */
  onResult(cb: (settle: SettleResult) => void): void;
  /** 进贡阶段 → view 弹进贡/还贡层。 */
  onTribute(cb: (p: TributePrompt) => void): void;
  /** 报牌/不要语音。 */
  onSpeak(cb: (text: string) => void): void;
  /** 文案提示（抗贡/进贡结果等）。 */
  onHint(cb: (text: string, kind: 'info' | 'warn') => void): void;
  /** 清定时器等资源（unmount 时调）。 */
  dispose(): void;
}
