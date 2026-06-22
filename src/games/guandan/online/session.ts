/**
 * session.ts — 掼蛋联机 WS 客户端会话（Plan 3 Task 3）。
 *
 * 纯传输层：连 `/ws-guandan`、收发 `{t,...}`、按 msg.t 分发、断线自动重连（重连后自动 rejoin）。
 * 昵称 + 房况(房号+座位，重连凭据)均存 localStorage——必须跨标签页/重开浏览器存活，否则手机杀后台
 * 后重开只能观战、收不回座位。控制器在离房/解散/重连失败时主动 clearRoom 清陈旧房况。
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
  local?: StorageLike;    // 昵称 + 房况（持久，跨标签页/重开存活）
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
    this.schedule = opts.schedule ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.reconnectMs = opts.reconnectMs ?? 1500;
  }

  // ── 昵称（localStorage）──
  get nick(): string { return this.local.getItem(NICK_KEY) ?? ''; }
  setNick(n: string): void { this.local.setItem(NICK_KEY, n); }

  // ── 房况（localStorage，重连凭据；跨标签页/重开存活，手机杀后台后仍能收回座位）──
  savedRoom(): { code: string; seat: number } | null {
    const raw = this.local.getItem(ROOM_KEY);
    if (!raw) return null;
    try {
      const o = JSON.parse(raw) as { code?: unknown; seat?: unknown };
      return typeof o.code === 'string' && typeof o.seat === 'number' ? { code: o.code, seat: o.seat } : null;
    } catch { return null; }
  }
  saveRoom(code: string, seat: number): void { this.local.setItem(ROOM_KEY, JSON.stringify({ code, seat })); }
  clearRoom(): void { this.local.removeItem(ROOM_KEY); }

  // ── 连接 ──
  connect(): void {
    if (this.disposed) return;
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = (): void => {
      this.reconnecting = false;
      // 断线重连：有房况则自动收回座位
      const room = this.savedRoom();
      if (room && this.nick) this.rawSend(c2s.rejoin(room.code, this.nick));
      this.openCbs.forEach((cb) => cb());
    };
    ws.onmessage = (ev: { data: unknown }): void => {
      let msg: { t?: unknown };
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as { t?: unknown }; } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
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
