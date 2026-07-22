/**
 * 牌类联机会话（客户端传输层）。
 *
 * 只管：连 WebSocket、收发 `{t,...}`、按 `msg.t` 分发、断线自动重连并用会话令牌收回座位。
 * **不懂牌、不懂房**——牌局解释在各游戏的驱动里，房间编排在各游戏的控制器里。
 * WebSocket 与 storage 全可注入，便于测试。
 *
 * 与游戏无关，所以放在共享位置：掼蛋自带一份等价实现（`src/games/guandan/online/session.ts`），
 * 迁移它要动已上线的游戏，本次不碰；新游戏一律用这份，别再抄第三份。
 */

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
}
export type WebSocketCtor = new (url: string) => WebSocketLike;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface Credential { code: string; seat: number; nick: string; token: string }

export interface SessionOpts {
  /** storage 键前缀，各游戏一套，互不覆盖 */
  keyPrefix: string;
  WebSocketCtor?: WebSocketCtor;
  local?: StorageLike;    // 跨重开兜底（所有标签页共享）
  session?: StorageLike;  // 本标签页主存（多标签互不覆盖）
  schedule?: (fn: () => void, ms: number) => number;
  reconnectMs?: number;
}

type Listener = (msg: unknown) => void;

export class CardRoomSession {
  private ws: WebSocketLike | null = null;
  private readonly url: string;
  private readonly WS: WebSocketCtor;
  private readonly local: StorageLike;
  private readonly session: StorageLike;
  private readonly schedule: (fn: () => void, ms: number) => number;
  private readonly reconnectMs: number;
  private readonly nickKey: string;
  private readonly roomKey: string;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly openCbs = new Set<() => void>();
  private readonly closeCbs = new Set<() => void>();
  private disposed = false;
  private reconnecting = false;
  /** 服务端落座后私发的会话令牌（座位私钥）；重连靠它认证，防他人拿房号+昵称冒名劫持座位与手牌。 */
  private seatToken = '';

  constructor(url: string, opts: SessionOpts) {
    this.url = url;
    this.WS = opts.WebSocketCtor ?? (window.WebSocket as unknown as WebSocketCtor);
    this.local = opts.local ?? window.localStorage;
    this.session = opts.session ?? window.sessionStorage;
    this.schedule = opts.schedule ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.reconnectMs = opts.reconnectMs ?? 1500;
    this.nickKey = `${opts.keyPrefix}_nick`;
    this.roomKey = `${opts.keyPrefix}_room`;
  }

  get nick(): string { return this.local.getItem(this.nickKey) ?? ''; }
  setNick(n: string): void { this.local.setItem(this.nickKey, n); }

  private read(store: StorageLike): Credential | null {
    const raw = store.getItem(this.roomKey);
    if (!raw) return null;
    try {
      const o = JSON.parse(raw) as Partial<Credential>;
      if (typeof o.code !== 'string' || typeof o.seat !== 'number') return null;
      return {
        code: o.code, seat: o.seat,
        nick: typeof o.nick === 'string' ? o.nick : this.nick,
        token: typeof o.token === 'string' ? o.token : '',
      };
    } catch { return null; }
  }
  /** 本标签页优先 → 其次跨重开兜底。多标签下各守各座，手机杀后台仍能捞回。 */
  savedRoom(): Credential | null { return this.read(this.session) ?? this.read(this.local); }
  saveRoom(code: string, seat: number, nick: string): void {
    const cred = JSON.stringify({ code, seat, nick, token: this.seatToken });
    this.session.setItem(this.roomKey, cred);
    this.local.setItem(this.roomKey, cred);
  }
  clearRoom(): void { this.session.removeItem(this.roomKey); this.local.removeItem(this.roomKey); }

  connect(): void {
    if (this.disposed) return;
    const ws = new this.WS(this.url);
    this.ws = ws;
    ws.onopen = (): void => {
      this.reconnecting = false;
      const room = this.savedRoom();
      // 有会话令牌才自动收座；没有就老老实实回昵称页，别拿旧凭据去撞
      if (room && room.token) this.send({ t: 'rejoin', code: room.code, token: room.token, nick: room.nick });
      this.openCbs.forEach((cb) => cb());
    };
    ws.onmessage = (ev: { data: unknown }): void => {
      let msg: { t?: unknown };
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)) as { t?: unknown }; } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'seat-token') {                       // 令牌内部消化，不外派
        const tk = (msg as { token?: unknown }).token;
        if (typeof tk === 'string') {
          this.seatToken = tk;
          const cur = this.savedRoom();
          if (cur) this.saveRoom(cur.code, cur.seat, cur.nick);  // 令牌可能晚于 room 到，回补一次
        }
        return;
      }
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

  send(msg: Record<string, unknown>): void {
    try { this.ws?.send(JSON.stringify(msg)); } catch { /* 未连/已断：忽略 */ }
  }

  on(type: string, cb: Listener): void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(cb);
  }
  onOpen(cb: () => void): void { this.openCbs.add(cb); }
  onClose(cb: () => void): void { this.closeCbs.add(cb); }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear(); this.openCbs.clear(); this.closeCbs.clear();
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }
}
