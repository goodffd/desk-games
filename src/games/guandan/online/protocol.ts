/**
 * protocol.ts — 掼蛋联机 WS 协议（`/ws-guandan`）TS 类型，单一真相（Plan 3 Task 1）。
 *
 * 字段严格照搬服务端实现（server/guandan-rooms.mjs + server/guandan-match-driver.ts），
 * 不臆造。OnlineSession / OnlineDriver / 前置 UI 全 import 这里。消息恒 `{ t: '...', ... }`。
 */

import type { Card, Seat, Rank, Combo } from '../engine/types';
import type { Team } from '../engine/match';

export type RoomStatus = 'waiting' | 'playing';

/** 房间内一个座位的公开信息（room / spectating 消息里的 seats[i]）。 */
export interface SeatInfo { seat: Seat; nick: string; online: boolean; ai: boolean; }

/** 大厅公开房列表的一项。 */
export interface LobbyRoom { code: string; status: RoomStatus; players: string[]; spectators: number; }

/** 公开态里某座位的对外信息（手牌只给张数，不给牌面）。 */
export interface SeatPublic {
  seat: Seat;
  count: number;
  lastPlay: { cards: Card[] } | 'pass' | null;
  finishRank: 1 | 2 | 3 | 4 | null;
  online: boolean;
  ai: boolean;
  /** 掉线宽限中（真人掉线、等重连，尚未转全速AI）。房间层在广播时按真实连接态覆盖。 */
  disconnected?: boolean;
}

/** 进贡一项（公开态 tribute.exchanges[i]）。 */
export interface TributeExchangeWire { giver: Seat; receiver: Seat; tribute: Card; return?: Card; }

/** 公开态 `state`（发房内所有在线玩家 + 观众；手牌另经私有 `hand` 私发本人）。 */
export interface PublicState {
  t: 'state';
  phase: 'playing' | 'dealResult' | 'tribute' | 'matchOver';
  turn: Seat;
  current: (Combo & { by: Seat }) | null;
  lastActor: Seat | null;
  seats: SeatPublic[];
  level: Rank;
  levels: [Rank, Rank];
  trumpTeam: Team;
  dealNo: number;
  /** 服务端权威：本回合剩余托管毫秒（phase==='playing' 且有在线真人计时时由房间注入）。客户端据此显示倒计时，
   *  观战/重连中途进入也能对上真实剩余时间，而非各自从满倒计。 */
  turnRemainMs?: number;
  /** phase==='tribute' 时存在。 */
  tribute?: { exchanges: TributeExchangeWire[]; resist: boolean; doubleDown: boolean; pending: Seat[] };
  /** phase==='dealResult' | 'matchOver' 时存在。 */
  result?: { ranking: Seat[]; gain: 1 | 2 | 3; passedA: boolean; stuck: boolean; demoted: boolean; lastHand: Card[] };
  /** phase==='matchOver' 时存在。 */
  winner?: Team | null;
}

/** 客户端 → 服务端。 */
export type C2SMessage =
  | { t: 'hello'; nick: string }
  | { t: 'rename'; nick: string }
  | { t: 'create'; isPrivate: boolean }
  | { t: 'join'; code: string }
  | { t: 'take-seat'; seat: Seat }
  | { t: 'start' }
  | { t: 'match' }
  | { t: 'lobby' }
  | { t: 'spectate'; code: string }
  | { t: 'play'; cardIds: number[] }
  | { t: 'pass' }
  | { t: 'tribute-return'; cardId: number }
  | { t: 'restart' }
  | { t: 'rejoin'; code: string; token: string; nick: string }; // token=会话令牌(座位私钥)，认证按 token 非昵称，防冒名劫持

/** 服务端 → 客户端。 */
export type S2CMessage =
  | { t: 'hello-ok' }
  | { t: 'rename-ok' }
  | { t: 'nick-taken' }
  | { t: 'created'; code: string; isPrivate: boolean }
  | { t: 'room'; code: string; status: RoomStatus; seats: (SeatInfo | null)[]; you: Seat | 'spectator' | null }
  | { t: 'error'; msg: string }
  | { t: 'started' }
  | { t: 'room-closed' }
  | { t: 'lobby'; rooms: LobbyRoom[] }
  | { t: 'spectating'; code: string; seats: (SeatInfo | null)[] }
  | { t: 'rejoined'; seat: Seat }
  | { t: 'seat-token'; seat: Seat; token: string } // 落座后私发本座会话令牌(仅本人收)，客户端存作重连凭据
  | { t: 'peer-offline'; seat: Seat }
  | { t: 'peer-back'; seat: Seat }
  | { t: 'hand'; cards: Card[] }
  | { t: 'need-tribute'; options: Card[] }
  | PublicState;

/** 所有服务端消息的判别 tag（运行期分发用）。 */
export type S2CType = S2CMessage['t'];

/** 客户端发包构造器（避免散落 magic 字符串）。 */
export const c2s = {
  hello: (nick: string): C2SMessage => ({ t: 'hello', nick }),
  rename: (nick: string): C2SMessage => ({ t: 'rename', nick }),
  create: (isPrivate: boolean): C2SMessage => ({ t: 'create', isPrivate }),
  join: (code: string): C2SMessage => ({ t: 'join', code }),
  takeSeat: (seat: Seat): C2SMessage => ({ t: 'take-seat', seat }),
  start: (): C2SMessage => ({ t: 'start' }),
  match: (): C2SMessage => ({ t: 'match' }),
  lobby: (): C2SMessage => ({ t: 'lobby' }),
  spectate: (code: string): C2SMessage => ({ t: 'spectate', code }),
  play: (cardIds: number[]): C2SMessage => ({ t: 'play', cardIds }),
  pass: (): C2SMessage => ({ t: 'pass' }),
  tributeReturn: (cardId: number): C2SMessage => ({ t: 'tribute-return', cardId }),
  restart: (): C2SMessage => ({ t: 'restart' }),
  rejoin: (code: string, token: string, nick: string): C2SMessage => ({ t: 'rejoin', code, token, nick }),
};
