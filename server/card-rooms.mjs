// 牌类通用房间层：连接 / 昵称 / 大厅 / 建房 / 加入 / 观战 / 座位认领 / 房主开打 /
// 掉线宽限接管 / 重连 / 再来一盘。掼蛋与干瞪眼共用（见 docs/adr/0001）。
//
// **本层不拆对局消息**。原先的实现会去认 `msg.phase === 'dealResult'`、`msg.t === 'need-tribute'`
// 这类游戏自有的字段，那等于把两个游戏的公开态形状焊死在房间层里。这里把方向倒过来：
// 房间层只把**它知道的事实**（谁在线 / 谁掉线 / 谁是 AI、本回合还剩多少毫秒）交给游戏适配器，
// 由适配器自己写进自己的消息；续局节奏、发呆催办这类游戏自有的东西也归适配器决定。
// 于是房间层真正只管座位与转发，加一个游戏不必改这里一行。
//
// ── 游戏适配器要提供什么 ────────────────────────────────────────────────
//   minSeats / maxSeats            座位数范围（掼蛋 4~4，干瞪眼 2~5）
//   createRunner(room)             建对局运行器；没有对局逻辑时返回 null
//   decorate(out, facts)           房间层给事实 { presence, turnRemainMs }，游戏自己写进消息
//   autoAdvance(out, runner)       这批消息之后要不要自动推进 → { delayMs, run() } | null
//   pendingDecision(out, ctx, r)   要不要起「谁发呆就替他做」的定时 → { delayMs, run() } | null
//   clearPendingOn(out)            这批消息是否意味着「不用催了」
//
// ── 运行器要提供什么 ───────────────────────────────────────────────────
//   start() / setAI(seat,on) / syncSeat(seat) / spectatorSync(client)
//   forceAutoPlay() / stepAI()     可选；没有就当该能力不存在
//   turnSeat()                     当前轮到哪座（不在对局中返回 null）
//   progress()                     单调递增的行棋计数，用来判「有没有真进展」
//   isOver()                       整盘是否结束（再来一盘的守卫）
//   handleGameMessage(seat, msg)   房间层不认识的消息一律原样交给它
import { randomUUID } from 'node:crypto';

export function defaultCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去易混 0O1I
  let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
/** 会话令牌（座位私钥）：落座私发给本人，rejoin 靠它认证——防他人拿房号+昵称冒名重连、劫持座位+手牌。 */
function newToken() { return randomUUID(); }

/**
 * 昵称占用表。**全服一套**：多个游戏各自有大厅，但同一个名字全服只能有一个人用，
 * 否则「掼蛋里的甲」和「干瞪眼里的甲」是不是同一个人就说不清了。
 * 不传就各自新建一套（单游戏用法与既有测试照旧）。
 */
export class NickRegistry {
  constructor() { this.byClient = new Map(); this.taken = new Set(); }
  key(n) { return String(n || '').trim().toLowerCase(); }
  get(client) { return this.byClient.get(client); }
  /** 登记；重名返回 false。 */
  claim(client, nick) {
    const k = this.key(nick);
    if (!k) return false;
    const cur = this.byClient.get(client);
    if (this.taken.has(k) && k !== this.key(cur)) return false;
    if (cur) this.taken.delete(this.key(cur));
    this.byClient.set(client, nick);
    this.taken.add(k);
    return true;
  }
  /** 换连接重登（重连时用）：先清掉该连接的旧占用，再登记，不做重名拒绝。 */
  reclaim(client, nick) {
    const prev = this.byClient.get(client);
    if (prev) this.taken.delete(this.key(prev));
    this.byClient.set(client, nick);
    this.taken.add(this.key(nick));
  }
  release(client) {
    const n = this.byClient.get(client);
    if (n) { this.taken.delete(this.key(n)); this.byClient.delete(client); }
  }
}

export class CardRoomRegistry {
  constructor({
    adapter,
    codeGen = defaultCode,
    nicks = new NickRegistry(),
    turnTimeoutMs = 0,
    disconnectGraceMs = 0,
    disconnectGraceMisses = 2,
    aiDelayMs = null,   // AI 每手思考延迟；null=按原来的 1.2~2.5s 随机（观感），冒烟/测试可调小
  }) {
    this.adapter = adapter;
    this.codeGen = codeGen;
    this.nicks = nicks;
    this.turnTimeoutMs = turnTimeoutMs;
    this.disconnectGraceMs = disconnectGraceMs;
    this.disconnectGraceMisses = disconnectGraceMisses;
    this.aiDelayMs = aiDelayMs;
    this.rooms = new Map();   // code -> room（本注册表只装本游戏的房，大厅天然按游戏分桶）
    this.lobby = new Set();
    this.queue = [];
  }

  get minSeats() { return this.adapter.minSeats; }
  get maxSeats() { return this.adapter.maxSeats; }

  // ── 只读快照：稳定的观察面，内部记账（宽限计数、计时器句柄、client 引用）一概不出去 ──
  roomSnapshot(code) {
    const r = this.rooms.get(code);
    if (!r) return null;
    return {
      code: r.code,
      status: r.status,
      isPrivate: r.isPrivate,
      hostSeat: r.hostSeat,
      seatCount: r.seatCount,
      seats: r.seats.map((s) => (s ? {
        nick: s.nick, online: !!s.online, ai: !!s.ai,
        disconnected: !!s.disconnected, connected: !!s.client,
      } : null)),
      spectators: r.spectators.size,
      hasDriver: !!r.runner,
    };
  }
  hasRoom(code) { return this.rooms.has(code); }
  lobbySnapshot() { return this._snapshot(); }
  seatOf(client) { return client._room ? { code: client._room, seat: client._seat ?? null } : null; }
  matchQueueSize() { return this.queue.length; }

  // ── 入站 ────────────────────────────────────────────────────────────
  handle(client, msg) {
    switch (msg.t) {
      case 'hello': case 'rename': return this._onNick(client, msg);
      case 'create': return this._onCreate(client, msg);
      case 'join': return this._onJoin(client, msg);
      case 'take-seat': return this._onTakeSeat(client, msg);
      case 'start': return this._onStart(client);
      case 'match': return this._onMatch(client);
      case 'lobby': return this._onLobby(client);
      case 'spectate': return this._onSpectate(client, msg);
      case 'rejoin': return this._onRejoin(client, msg);
      case 'restart': return this._onRestart(client);
      default: return this._onGameMessage(client, msg);
    }
  }

  _onNick(client, msg) {
    if (!this.nicks.claim(client, msg.nick)) { client.send({ t: 'nick-taken' }); return; }
    client.send({ t: msg.t === 'hello' ? 'hello-ok' : 'rename-ok' });
  }

  /** 目标座位数：房主可在建房时指定，夹在适配器给的区间里；不指定就取上限。 */
  _wantedSeats(msg) {
    const n = Number(msg && msg.seats);
    if (!Number.isInteger(n)) return this.maxSeats;
    return Math.min(this.maxSeats, Math.max(this.minSeats, n));
  }

  _newRoom(code, host, isPrivate, seatCount, status) {
    return {
      code, isPrivate: !!isPrivate, host, hostSeat: 0, seatCount,
      seats: Array.from({ length: seatCount }, () => null),
      spectators: new Set(), pendingSync: new Set(),
      status, runner: null,
    };
  }

  _onCreate(client, msg) {
    this._leaveRoom(client);
    const code = this._newCode();
    const room = this._newRoom(code, client, msg.isPrivate, this._wantedSeats(msg), 'waiting');
    this.rooms.set(code, room);
    this._seat(room, client, 0);              // 房主默认坐 0
    client.send({ t: 'created', code, isPrivate: room.isPrivate });
    this._sendRoom(room);
    if (!room.isPrivate) this._broadcastLobby();
  }

  _onJoin(client, msg) {
    this._leaveRoom(client);
    const room = this.rooms.get(msg.code);
    if (!room || room.status !== 'waiting') { client.send({ t: 'error', msg: '房间不存在或已开打' }); return; }
    client._room = room.code; client._seat = null; // 进房但未落座
    this._sendRoom(room, client);
  }

  _onTakeSeat(client, msg) {
    const room = this.rooms.get(client._room);
    if (!room || room.status !== 'waiting') { client.send({ t: 'error', msg: '不在等待房中' }); return; }
    const i = msg.seat;
    // 须整数座位号：非整数(如1.5)会挂成幽灵数组属性、把自己从座位表清出
    if (!(Number.isInteger(i) && i >= 0 && i < room.seatCount) || (room.seats[i] && room.seats[i].client !== client)) {
      client.send({ t: 'error', msg: '座位已占或非法' }); return;
    }
    this._seat(room, client, i);
    if (room.host === client) room.hostSeat = i; // 房主换座：房主座号跟随（重连据此转移房主标识）
    this._sendRoom(room);
  }

  _onStart(client) {
    const room = this.rooms.get(client._room);
    if (!room || room.status !== 'waiting') { client.send({ t: 'error', msg: '房间状态不对' }); return; }
    if (room.host !== client) { client.send({ t: 'error', msg: '只有房主能开始' }); return; }
    if (!room.seats.some((s) => s)) { client.send({ t: 'error', msg: '至少 1 人落座才能开始' }); return; }
    room.status = 'playing';
    // ≥1 人即可开打：空座补 AI（无 client、ai=true），由服务端代打（= 单机对 AI 的特例）
    for (let i = 0; i < room.seatCount; i++) {
      if (!room.seats[i]) room.seats[i] = { client: null, nick: null, online: false, ai: true };
    }
    room.runner = this.adapter.createRunner(room);
    this._sendRoom(room);
    for (const s of room.seats) if (s && s.client) s.client.send({ t: 'started' }); // 跳过 AI 空座
    if (room.runner) {
      this._dispatch(room, room.runner.start());
      // start() 不驱动 AI；把 AI 座（含空座补的）告诉运行器，否则首攻恰是 AI 座就整局卡死
      this._announceAiSeats(room);
    }
    if (!room.isPrivate) this._broadcastLobby();
  }

  /** 把「哪些座是 AI」告诉运行器，并驱动它们出牌。 */
  _announceAiSeats(room) {
    for (let i = 0; i < room.seatCount; i++) {
      const s = room.seats[i];
      if (s && s.ai && room.runner.setAI) this._dispatch(room, room.runner.setAI(i, true));
    }
  }

  _onMatch(client) {
    this._leaveRoom(client);
    if (!this.queue.includes(client)) this.queue.push(client);
    const need = this.maxSeats;
    if (this.queue.length < need) return;
    const group = this.queue.splice(0, need);
    const code = this._newCode();
    const room = this._newRoom(code, group[0], false, need, 'playing');
    this.rooms.set(code, room);
    group.forEach((c, i) => this._seat(room, c, i));
    room.runner = this.adapter.createRunner(room);
    this._sendRoom(room);
    for (const s of room.seats) if (s && s.client) s.client.send({ t: 'started' });
    if (room.runner) this._dispatch(room, room.runner.start());
    if (!room.isPrivate) this._broadcastLobby();
  }

  _onLobby(client) {
    this.lobby.add(client);
    client.send({ t: 'lobby', rooms: this._snapshot() });
  }

  _onSpectate(client, msg) {
    const room = this.rooms.get(msg.code);
    if (!room || room.isPrivate || room.status !== 'playing') { client.send({ t: 'error', msg: '无法观战' }); return; }
    this._leaveRoom(client);
    room.spectators.add(client);
    client._room = room.code; client._seat = 'spectator';
    client.send({ t: 'spectating', code: room.code, seats: this._seatInfo(room) });
    if (room.runner && room.runner.spectatorSync) this._dispatch(room, room.runner.spectatorSync(client));
    this._broadcastLobby();
  }

  _onRejoin(client, msg) {
    const room = this.rooms.get(msg.code);
    const token = (typeof msg.token === 'string' && msg.token) ? msg.token : null;
    // 按会话令牌认证（非昵称）：令牌落座时私发、只本人有，防他人拿房号+昵称冒名重连劫持座位与手牌
    const idx = (room && token) ? room.seats.findIndex((s) => s && !s.online && s.token === token) : -1;
    if (idx === -1) { client.send({ t: 'error', msg: '无法重连：房间不存在或座位已占' }); return; }
    this._leaveRoom(client);
    const seat = room.seats[idx];
    seat.client = client; seat.online = true; seat.ai = false;
    seat.disconnected = false; seat.graceMisses = 0;    // 回来即收座、宽限额度重新给满
    if (idx === room.hostSeat) room.host = client;      // 房主重连：房主标识转到新连接，否则「再来一盘」永久失效
    client._room = room.code; client._seat = idx;
    this.nicks.reclaim(client, msg.nick);               // 重登昵称维持判重一致，并清掉该连接的旧占用
    client.send({ t: 'rejoined', seat: idx });
    if (room.runner && room.runner.setAI) this._dispatch(room, room.runner.setAI(idx, false));
    if (room.runner && room.runner.syncSeat) this._dispatch(room, room.runner.syncSeat(idx));
    for (const s of room.seats) if (s && s.client && s.online && s.client !== client) s.client.send({ t: 'peer-back', seat: idx });
    this._sendRoom(room);
  }

  _onRestart(client) {
    const room = this.rooms.get(client._room);
    if (!room || room.status !== 'playing') { client.send({ t: 'error', msg: '房间状态不对' }); return; }
    if (room.host !== client) { client.send({ t: 'error', msg: '只有房主能再来一盘' }); return; }
    if (!room.runner || !room.runner.isOver()) { client.send({ t: 'error', msg: '本盘未结束' }); return; }
    room.runner = this.adapter.createRunner(room);
    if (room.runner) {
      this._dispatch(room, room.runner.start());
      this._announceAiSeats(room);
    }
  }

  /** 房间层不认识的消息 → 原样交给运行器，内容一概不看。 */
  _onGameMessage(client, msg) {
    const room = this.rooms.get(client._room);
    if (!room || room.status !== 'playing' || client._seat === 'spectator' || typeof client._seat !== 'number') return;
    if (!room.runner) return;
    const out = room.runner.handleGameMessage(client._seat, msg);
    if (out) this._dispatch(room, out);
  }

  leave(client) {
    this.nicks.release(client);
    this.lobby.delete(client);
    const qi = this.queue.indexOf(client);
    if (qi >= 0) this.queue.splice(qi, 1);
    this._leaveRoom(client);
  }

  // ── 座位与房间维护 ──────────────────────────────────────────────────
  _newCode() { let c = this.codeGen(); while (this.rooms.has(c)) c = this.codeGen(); return c; }

  _seat(room, client, i) {
    for (let k = 0; k < room.seatCount; k++) if (room.seats[k] && room.seats[k].client === client) room.seats[k] = null;
    const nick = this.nicks.get(client) || '玩家';
    const token = newToken();
    room.seats[i] = { client, nick, online: true, ai: false, token };
    client._room = room.code; client._seat = i;
    client.send({ t: 'seat-token', seat: i, token }); // 私发本座会话令牌（仅本人收），客户端存作重连凭据
  }

  _seatInfo(room) {
    return room.seats.map((s, i) => (s ? { seat: i, nick: s.nick, online: s.online, ai: s.ai } : null));
  }

  _sendRoom(room, only = null) {
    const seats = this._seatInfo(room);
    const targets = only ? [only] : [
      ...room.seats.filter((s) => s && s.client).map((s) => s.client), // 跳过 AI 空座
      ...room.spectators,
    ];
    for (const c of targets) c.send({ t: 'room', code: room.code, status: room.status, seats, you: c._seat ?? null });
  }

  _clearTimers(room, keys = ['_turnTimer', '_aiTimer', '_advanceTimer', '_pendingTimer']) {
    for (const k of keys) if (room[k]) { clearTimeout(room[k]); room[k] = null; }
  }

  _leaveRoom(client) {
    const code = client._room;
    if (!code) return;
    const seatRole = client._seat;
    client._room = null; client._seat = null;
    const room = this.rooms.get(code);
    if (!room) return;
    room.pendingSync.delete(client);
    if (seatRole === 'spectator') { room.spectators.delete(client); if (!room.isPrivate) this._broadcastLobby(); return; }
    const idx = room.seats.findIndex((s) => s && s.client === client);
    if (idx === -1) return;             // 进房未落座

    if (room.status === 'waiting') {
      room.seats[idx] = null;
      if (room.host === client) {       // 房主走：删房
        this._clearTimers(room, ['_aiTimer', '_advanceTimer']);
        for (const sp of room.spectators) sp.send({ t: 'room-closed' });
        this.rooms.delete(code); if (!room.isPrivate) this._broadcastLobby();
      } else { this._sendRoom(room); }
      return;
    }

    // playing：掉线 → 进「掉线宽限」（不立刻全速AI），靠回合超时代打、连续 N 手没回来才转全速AI；
    // 任意时刻重连收座、额度重新给满。保留昵称作重连凭据。disconnectGraceMs=0 时退回旧行为（掉线即全速AI）。
    const canForce = !!(room.runner && room.runner.canForceAutoPlay && room.runner.canForceAutoPlay());
    const grace = this.disconnectGraceMs > 0 && canForce;
    const seat = room.seats[idx];
    seat.online = false; seat.client = null;
    if (grace) { seat.disconnected = true; seat.ai = false; seat.graceMisses = 0; }
    else { seat.disconnected = false; seat.ai = true; }
    for (const s of room.seats) if (s && s.client && s.online) s.client.send({ t: 'peer-offline', seat: idx });
    for (const sp of room.spectators) sp.send({ t: 'peer-offline', seat: idx });

    if (!grace) {
      if (room.runner && room.runner.setAI) this._dispatch(room, room.runner.setAI(idx, true)); // 旧行为：立刻全速AI
    } else {
      if (room.runner.turnSeat() === idx) {
        // 断线座正是当前回合：把截止压到 min(原, now+宽限)——断线不续命（已走的算数），但最多再等一个宽限
        room._turnTimerSeat = idx;
        if (!room._turnStartedAt) room._turnStartedAt = Date.now();
        const cap = Date.now() + this.disconnectGraceMs;
        room._turnDeadline = room._turnDeadline ? Math.min(room._turnDeadline, cap) : cap;
        this._scheduleTurnTimer(room);
      } // 非当前回合：等轮到它时 _armTurnTimeout 自会按宽限计时
      // 即时广播一次当前态：别人的头像上立刻显示「掉线了」，不用等到下个公开态
      const bs = room.runner.broadcastState ? room.runner.broadcastState() : null;
      if (bs) this._dispatch(room, bs);
    }

    if (!room.seats.some((s) => s && s.online)) {   // 全部掉线 → 删房（清所有计时，避免对死房代打/续局）
      this._clearTimers(room);
      for (const sp of room.spectators) sp.send({ t: 'room-closed' });
      this.rooms.delete(code); if (!room.isPrivate) this._broadcastLobby();
    }
  }

  // ── 出站 ────────────────────────────────────────────────────────────
  _dispatch(room, outbound) {
    if (!outbound || !outbound.length) return;

    // 先按当前回合更新计时——只在回合真的变了时重置。观战/重连/他人掉线的纯重广播不重置，
    // 否则观众一进场就把当前真人的倒计时刷回满：真人明明到点了，却被迫等观众那份新计时到 0。
    this._armTurnTimeout(room);

    // 房间层只交事实，不碰消息内容：谁在线 / 谁掉线 / 谁是 AI，本回合还剩多少毫秒。
    const presence = room.seats.map((s) => (s ? { online: !!s.online, disconnected: !!s.disconnected, ai: !!s.ai } : null));
    const turnRemainMs = (room._turnTimerSeat != null && room._turnDeadline)
      ? Math.max(0, room._turnDeadline - Date.now()) : null;
    const shaped = this.adapter.decorate(outbound, { presence, turnRemainMs }) || outbound;

    for (const o of shaped) {
      if (o.to === 'seat') {
        const s = room.seats[o.seat];
        if (s && s.client && s.online) s.client.send(o.msg);
      } else { // 'all'：房内在线玩家 + 观众
        for (const s of room.seats) if (s && s.client && s.online) s.client.send(o.msg);
        for (const sp of room.spectators) sp.send(o.msg);
      }
    }

    this._armAutoAdvance(room, shaped);
    this._armPendingDecision(room, shaped);
    this._scheduleAIStep(room);
  }

  /** 游戏自有的「这一段打完了，隔一会儿自动往下走」（掼蛋的单局结算停留 → 续局）。 */
  _armAutoAdvance(room, outbound) {
    if (!room.runner || room._advancing) return;
    const plan = this.adapter.autoAdvance(outbound, room.runner);
    if (!plan) return;
    room._advancing = true;
    room._advanceTimer = setTimeout(() => {
      room._advanceTimer = null;
      room._advancing = false;
      if (!room.runner) return;
      const out = plan.run();
      if (out) this._dispatch(room, out);
    }, plan.delayMs);
  }

  /** 游戏自有的「谁发呆就替他做」（掼蛋的还贡超时）。 */
  _armPendingDecision(room, outbound) {
    if (!room.runner) return;
    if (this.adapter.clearPendingOn(outbound) && room._pendingTimer) {
      clearTimeout(room._pendingTimer); room._pendingTimer = null;
    }
    if (room._pendingTimer) return;
    const humans = room.seats.filter((s) => s && s.online).length;
    const plan = this.adapter.pendingDecision(outbound, { humans }, room.runner);
    if (!plan) return;
    room._pendingTimer = setTimeout(() => {
      room._pendingTimer = null;
      if (!room.runner) return;
      const out = plan.run();
      if (out) this._dispatch(room, out);
    }, plan.delayMs);
  }

  /** AI 座回合：带思考延迟逐手驱动（服务端权威计时，观感同单机；不瞬间打完）。 */
  _scheduleAIStep(room) {
    const r = room.runner;
    const turn = r ? r.turnSeat() : null;
    const seat = (typeof turn === 'number') ? room.seats[turn] : null;
    const canStep = !!(r && r.canStepAI && r.canStepAI());
    if (!(seat && seat.ai && !seat.online && canStep)) {
      if (room._aiTimer) { clearTimeout(room._aiTimer); room._aiTimer = null; }
      return;
    }
    if (room._aiTimer) return; // 已排一手，等它落子
    const delay = this.aiDelayMs != null ? this.aiDelayMs : 1200 + Math.floor(Math.random() * 1300);
    room._aiTimer = setTimeout(() => {
      room._aiTimer = null;
      if (!room.runner) return;
      const out = room.runner.stepAI();
      if (out && out.length) this._dispatch(room, out); // _dispatch 末尾会再排下一手
    }, delay);
  }

  /** 回合超时：在线真人座(turnTimeoutMs) 或 掉线宽限座(disconnectGraceMs) 发呆到点 → 替他出一手。
   *  只在「计时座位变 或 出现新进展」时才重置；同座同进展的纯重广播保持原计时不动。
   *  全速AI座不计时——它是即时代打的。 */
  _armTurnTimeout(room) {
    const r = room.runner;
    const turn = r ? r.turnSeat() : null;
    const seat = (typeof turn === 'number') ? room.seats[turn] : null;
    const armSeat = (seat && (seat.online || seat.disconnected)) ? turn : null;
    const progress = r ? r.progress() : 0;
    if (armSeat === room._turnTimerSeat && progress === room._turnTimerPly && room._turnTimer) return;
    if (room._turnTimer) { clearTimeout(room._turnTimer); room._turnTimer = null; }
    room._turnTimerSeat = armSeat; room._turnTimerPly = progress;
    const dur = !seat ? 0 : (seat.disconnected ? this.disconnectGraceMs : this.turnTimeoutMs);
    const canForce = !!(r && r.canForceAutoPlay && r.canForceAutoPlay());
    if (!dur || armSeat == null || !canForce) { room._turnStartedAt = 0; room._turnDeadline = 0; return; }
    room._turnStartedAt = Date.now();
    room._turnDeadline = room._turnStartedAt + dur;
    this._scheduleTurnTimer(room);
  }

  _scheduleTurnTimer(room) {
    if (room._turnTimer) { clearTimeout(room._turnTimer); room._turnTimer = null; }
    if (!room._turnDeadline) return;
    room._turnTimer = setTimeout(() => { room._turnTimer = null; this._fireTurnTimeout(room); },
      Math.max(0, room._turnDeadline - Date.now()));
  }

  /** 到点托管：替当前回合座做一手。掉线宽限座累计未归次数，连续 N 手仍没回 → 转全速AI。 */
  _fireTurnTimeout(room) {
    const r = room.runner;
    if (!r || !(r.canForceAutoPlay && r.canForceAutoPlay())) return;
    const idx = room._turnTimerSeat;
    const s = (typeof idx === 'number') ? room.seats[idx] : null;
    const out = r.forceAutoPlay() || [];
    if (s && s.disconnected) {
      s.graceMisses = (s.graceMisses || 0) + 1;
      if (s.graceMisses >= this.disconnectGraceMisses) {   // 连续没回来 → 转全速AI（此后即时代打、不再计时）
        s.disconnected = false; s.ai = true;
        const ai = (r.setAI ? r.setAI(idx, true) : []) || [];
        this._dispatch(room, [...out, ...ai]);
        return;
      }
    }
    this._dispatch(room, out);
  }

  _snapshot() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.isPrivate) continue;
      out.push({
        code: r.code,
        status: r.status,
        players: r.seats.filter((s) => s && s.nick).map((s) => s.nick), // 滤掉 AI 补位空座，别混进玩家名单
        spectators: r.spectators.size,
      });
    }
    return out;
  }

  _broadcastLobby() {
    const rooms = this._snapshot();
    for (const c of this.lobby) c.send({ t: 'lobby', rooms });
  }
}
