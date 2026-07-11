/**
 * session.ts — 掼蛋联机 WS 客户端会话（Plan 3 Task 3）。
 *
 * 纯传输层：连 `/ws-guandan`、收发 `{t,...}`、按 msg.t 分发、断线自动重连（重连后自动 rejoin）。
 * 重连凭据(房号+座位+昵称)双写：sessionStorage 为主(每标签页独立，刷新/断线重连守住各自座位——
 * 一台电脑开多标签页测试时不会互相覆盖)，localStorage 为兜底(手机杀后台/重开浏览器后 session 没了，
 * 仍能捞回最近一次座位)。昵称随凭据存——共享的 gd_nick 会被最后一个标签覆盖，rejoin 必须用本座真昵称。
 * **不懂牌、不懂房**——牌局解释在 OnlineDriver、房间编排在控制器。WebSocket/storage/定时全可注入。
 */

import type { C2SMessage, S2CType } from './protocol';
import { c2s } from './protocol';

/** 最小 WebSocket 形状（便于注入 mock，不绑死 DOM 类型）。 */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

/** 最小 storage 形状（localStorage / sessionStorage）。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OnlineSessionOpts {
  WebSocketCtor?: WebSocketCtor;
  local?: StorageLike;    // 昵称 + 房况兜底（跨重开持久，所有标签页共享）
  session?: StorageLike;  // 房况主存（每标签页独立，多标签互不覆盖）
  schedule?: (fn: () => void, ms: number) => number; // 重连退避定时
  reconnectMs?: number;
}

type Listener = (msg: unknown) => void;

const NICK_KEY = 'gd_nick';
const ROOM_KEY = 'gd_room';

export class OnlineSession {
  private ws: WebSocketLike | null = null;
  private readonly url: string;
  private readonly WS: WebSocketCtor;
  private readonly local: StorageLike;
  private readonly session: StorageLike;
  private readonly schedule: (fn: () => void, ms: number) => number;
  private readonly reconnectMs: number;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly openCbs = new Set<() => void>();
  private readonly closeCbs = new Set<() => void>();
  private disposed = false;
  private reconnecting = false;

  constructor(url: string, opts: OnlineSessionOpts = {}) {
    this.url = url;
    this.WS = opts.WebSocketCtor ?? (window.WebSocket as unknown as WebSocketCtor);
    this.local = opts.local ?? window.localStorage;
    this.session = opts.session ?? window.sessionStorage;
    this.schedule = opts.schedule ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.reconnectMs = opts.reconnectMs ?? 1500;
  }

  // ── 昵称（localStorage，仅作昵称输入框默认值；多标签共享，会被最后一个标签覆盖）──
  get nick(): string { return this.local.getItem(NICK_KEY) ?? ''; }
  setNick(n: string): void { this.local.setItem(NICK_KEY, n); }

  // ── 房况（重连凭据 {房号,座位,昵称,会话令牌}）──
  private seatToken = ''; // 服务端落座后私发的会话令牌(座位私钥)；rejoin 靠它认证、防冒名劫持隐藏手牌
  private _readCred(store: StorageLike): { code: string; seat: number; nick: string; token: string } | null {
    const raw = store.getItem(ROOM_KEY);
    if (!raw) return null;
    try {
      const o = JSON.parse(raw) as { code?: unknown; seat?: unknown; nick?: unknown; token?: unknown };
      if (typeof o.code !== 'string' || typeof o.seat !== 'number') return null;
      return { code: o.code, seat: o.seat, nick: typeof o.nick === 'string' ? o.nick : this.nick, token: typeof o.token === 'string' ? o.token : '' };
    } catch { return null; }
  }
  /** 本标签页(session)优先 → 其次跨重开兜底(local)。多标签下各守各座，手机杀后台仍能捞回。 */
  savedRoom(): { code: string; seat: number; nick: string; token: string } | null {
    return this._readCred(this.session) ?? this._readCred(this.local);
  }
  saveRoom(code: string, seat: number, nick: string): void {
    const cred = JSON.stringify({ code, seat, nick, token: this.seatToken });
    this.session.setItem(ROOM_KEY, cred); // 本标签页（主，多标签互不覆盖）
    this.local.setItem(ROOM_KEY, cred);   // 跨重开兜底（手机杀后台/重开浏览器）
  }
  clearRoom(): void { this.session.removeItem(ROOM_KEY); this.local.removeItem(ROOM_KEY); }
  /** 收到本座会话令牌：记住 + 补写进已存的重连凭据(seat-token 可能晚于 room 到，故要回补 token)。 */
  private onSeatToken(token: string): void {
    this.seatToken = token;
    const cur = this.savedRoom();
    if (cur) this.saveRoom(cur.code, cur.seat, cur.nick); // 用新 token 重写凭据
  }

  // ── 连接 ──
  connect(): void {
    if (this.disposed) return;
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = (): void => {
      this.reconnecting = false;
      // 断线重连：有房况则自动收回座位（用凭据里的本座昵称，不用共享 gd_nick——多标签会被覆盖）
      const room = this.savedRoom();
      if (room && room.token) this.rawSend(c2s.rejoin(room.code, room.token, room.nick)); // 有会话令牌才自动 rejoin
      this.openCbs.forEach((cb) => cb());
    };
    ws.onmessage = (ev: { data: unknown }): void => {
      let msg: { t?: unknown };
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as { t?: unknown }; } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'seat-token') { const tk = (msg as { token?: unknown }).token; if (typeof tk === 'string') this.onSeatToken(tk); return; } // 会话令牌内部消化，不外派给控制器
      this.listeners.get(msg.t)?.forEach((cb) => cb(msg));
    };
    ws.onclose = (): void => {
      this.ws = null;
      this.closeCbs.forEach((cb) => cb());
      if (!this.disposed && this.savedRoom() && !this.reconnecting) {
        this.reconnecting = true;
        this.schedule(() => { if (!this.disposed) this.connect(); }, this.reconnectMs);
      }
    };
  }

  private rawSend(msg: C2SMessage): void { try { this.ws?.send(JSON.stringify(msg)); } catch { /* 未连/已断：忽略 */ } }
  send(msg: C2SMessage): void { this.rawSend(msg); }

  // ── 订阅 ──
  on(type: S2CType, cb: Listener): void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(cb);
  }
  off(type: S2CType, cb: Listener): void { this.listeners.get(type)?.delete(cb); }
  onOpen(cb: () => void): void { this.openCbs.add(cb); }
  onClose(cb: () => void): void { this.closeCbs.add(cb); }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear(); this.openCbs.clear(); this.closeCbs.clear();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }
}
