// 纯房间登记 + 转发（不依赖真 socket；client 只需有 send(msgObj)）。互信，不校验牌规。
function defaultCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去易混 0O1I
  let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class RoomRegistry {
  constructor(codeGen = defaultCode, makeDriver = null, tributeTimeoutMs = 0, turnTimeoutMs = 0, disconnectGraceMs = 0, disconnectGraceMisses = 2) {
    this.codeGen = codeGen;
    this.makeDriver = makeDriver;       // (room) => MatchDriver；Task 9 接入
    this.tributeTimeoutMs = tributeTimeoutMs;
    this.turnTimeoutMs = turnTimeoutMs; // 回合超时(在线真人座发呆)→ 服务端 choosePlay 代打
    this.disconnectGraceMs = disconnectGraceMs;         // 掉线宽限：单次回合超时(0=不启用,掉线即转全速AI=旧行为)
    this.disconnectGraceMisses = disconnectGraceMisses; // 掉线宽限座连续被超时代打几手仍没回来 → 转全速AI
    this.rooms = new Map();             // code -> room
    this.nicks = new Map();             // client -> nick(原样)
    this.byNick = new Set();            // nickKey 占用集
    this.lobby = new Set();             // 订阅大厅
    this.queue = [];                    // 随机匹配 FIFO 池（client）
  }
  _nickKey(n) { return String(n || '').trim().toLowerCase(); }
  handle(client, msg) {
    if (msg.t === 'hello' || msg.t === 'rename') {
      const key = this._nickKey(msg.nick);
      const cur = this.nicks.get(client);
      if (!key) { client.send({ t: 'nick-taken' }); return; }
      if (this.byNick.has(key) && key !== this._nickKey(cur)) { client.send({ t: 'nick-taken' }); return; }
      if (cur) this.byNick.delete(this._nickKey(cur));
      this.nicks.set(client, msg.nick);
      this.byNick.add(key);
      client.send({ t: msg.t === 'hello' ? 'hello-ok' : 'rename-ok' });
      return;
    }
    if (msg.t === 'create') {
      this._leaveRoom(client);
      const code = this._newCode();
      const room = { code, isPrivate: !!msg.isPrivate, host: client,
        seats: [null, null, null, null], spectators: new Set(), pendingSync: new Set(),
        status: 'waiting', driver: null };
      this.rooms.set(code, room);
      this._seat(room, client, 0);              // 房主默认坐 0
      client.send({ t: 'created', code, isPrivate: room.isPrivate });
      this._sendRoom(room);
      if (!room.isPrivate) this._broadcastLobby();
      return;
    }
    if (msg.t === 'join') {
      this._leaveRoom(client);
      const room = this.rooms.get(msg.code);
      if (!room || room.status !== 'waiting') { client.send({ t: 'error', msg: '房间不存在或已开打' }); return; }
      client._room = room.code; client._seat = null; // 进房但未落座
      this._sendRoom(room, client);
      return;
    }
    if (msg.t === 'take-seat') {
      const room = this.rooms.get(client._room);
      if (!room || room.status !== 'waiting') { client.send({ t: 'error', msg: '不在等待房中' }); return; }
      const i = msg.seat;
      if (!(i >= 0 && i < 4) || (room.seats[i] && room.seats[i].client !== client)) {
        client.send({ t: 'error', msg: '座位已占或非法' }); return; }
      this._seat(room, client, i);
      this._sendRoom(room);
      return;
    }
    if (msg.t === 'start') {
      const room = this.rooms.get(client._room);
      if (!room || room.status !== 'waiting') { client.send({ t: 'error', msg: '房间状态不对' }); return; }
      if (room.host !== client) { client.send({ t: 'error', msg: '只有房主能开始' }); return; }
      if (room.seats.some(s => !s)) { client.send({ t: 'error', msg: '未坐满 4 人' }); return; }
      room.status = 'playing';
      room.driver = this.makeDriver ? this.makeDriver(room) : null;
      this._sendRoom(room);
      for (const s of room.seats) s.client.send({ t: 'started' });
      if (room.driver) this._dispatch(room, room.driver.start());
      if (!room.isPrivate) this._broadcastLobby();
      return;
    }
    if (msg.t === 'match') {
      this._leaveRoom(client);
      if (!this.queue.includes(client)) this.queue.push(client);
      if (this.queue.length >= 4) {
        const four = this.queue.splice(0, 4);
        const code = this._newCode();
        const room = { code, isPrivate: false, host: four[0],
          seats: [null, null, null, null], spectators: new Set(), pendingSync: new Set(),
          status: 'playing', driver: null };
        this.rooms.set(code, room);
        four.forEach((c, i) => this._seat(room, c, i));
        room.driver = this.makeDriver ? this.makeDriver(room) : null;
        this._sendRoom(room);
        for (const s of room.seats) s.client.send({ t: 'started' });
        if (room.driver) this._dispatch(room, room.driver.start());
        if (!room.isPrivate) this._broadcastLobby();
      }
      return;
    }
    if (msg.t === 'lobby') {
      this.lobby.add(client);
      client.send({ t: 'lobby', rooms: this._snapshot() });
      return;
    }
    if (msg.t === 'spectate') {
      const room = this.rooms.get(msg.code);
      if (!room || room.isPrivate || room.status !== 'playing') {
        client.send({ t: 'error', msg: '无法观战' });
        return;
      }
      this._leaveRoom(client);
      room.spectators.add(client);
      client._room = room.code;
      client._seat = 'spectator';
      client.send({ t: 'spectating', code: room.code, seats: this._seatInfo(room) });
      if (room.driver && room.driver.spectatorSync) this._dispatch(room, room.driver.spectatorSync(client));
      this._broadcastLobby();
      return;
    }
    if (msg.t === 'rejoin') {
      const room = this.rooms.get(msg.code);
      const idx = room ? room.seats.findIndex(s => s && !s.online && s.nick === msg.nick) : -1;
      if (idx === -1) { client.send({ t: 'error', msg: '无法重连：房间不存在或座位已占' }); return; }
      this._leaveRoom(client);
      room.seats[idx].client = client; room.seats[idx].online = true; room.seats[idx].ai = false;
      room.seats[idx].disconnected = false; room.seats[idx].graceMisses = 0; // 回来即收座、宽限计数清零
      client._room = room.code; client._seat = idx;
      this.nicks.set(client, msg.nick); this.byNick.add(this._nickKey(msg.nick)); // 重登昵称维持判重一致
      client.send({ t: 'rejoined', seat: idx });
      if (room.driver && room.driver.setAI) this._dispatch(room, room.driver.setAI(idx, false));
      if (room.driver && room.driver.syncSeat) this._dispatch(room, room.driver.syncSeat(idx));
      for (const s of room.seats) if (s && s.client && s.online && s.client !== client) s.client.send({ t: 'peer-back', seat: idx });
      this._sendRoom(room);
      return;
    }
    if (msg.t === 'play' || msg.t === 'pass' || msg.t === 'tribute-return') {
      const room = this.rooms.get(client._room);
      if (!room || room.status !== 'playing' || client._seat === 'spectator' || typeof client._seat !== 'number') return;
      if (!room.driver) return;
      let out;
      if (msg.t === 'play') out = room.driver.handlePlay(client._seat, msg.cardIds || []);
      else if (msg.t === 'pass') out = room.driver.handlePass(client._seat);
      else out = room.driver.handleTributeReturn(client._seat, msg.cardId);
      this._dispatch(room, out);
      this._armTributeTimeout(room, out);
      return;
    }
    if (msg.t === 'restart') {
      // 整盘打完 → 房主再来一盘：新开整盘(回打2)、4 座原样留着、掉线/AI 座保持 AI。
      const room = this.rooms.get(client._room);
      if (!room || room.status !== 'playing') { client.send({ t: 'error', msg: '房间状态不对' }); return; }
      if (room.host !== client) { client.send({ t: 'error', msg: '只有房主能再来一盘' }); return; }
      if (!room.driver || !(room.driver.match && room.driver.match.over)) { client.send({ t: 'error', msg: '本盘未结束' }); return; }
      room.driver = this.makeDriver ? this.makeDriver(room) : null;
      if (room.driver) {
        this._dispatch(room, room.driver.start());                 // 重新发牌 + 公开态 + 各座私有手牌(turn=0)
        // 掉线/AI 座设为 AI（setAI 会驱动 AI 出牌——start() 不 driveAI，首攻座若是 AI 否则会卡）
        for (let i = 0; i < 4; i++) {
          const s = room.seats[i];
          if (s && s.ai && room.driver.setAI) this._dispatch(room, room.driver.setAI(i, true));
        }
      }
      return;
    }
  }
  leave(client) {
    const nk = this.nicks.get(client);
    if (nk) { this.byNick.delete(this._nickKey(nk)); this.nicks.delete(client); }
    this.lobby.delete(client);
    const qi = this.queue.indexOf(client);
    if (qi >= 0) this.queue.splice(qi, 1);
    this._leaveRoom(client);
  }
  _newCode() { let c = this.codeGen(); while (this.rooms.has(c)) c = this.codeGen(); return c; }
  _seat(room, client, i) {
    // 先清掉该 client 在本房的旧座
    for (let k = 0; k < 4; k++) if (room.seats[k] && room.seats[k].client === client) room.seats[k] = null;
    const nick = this.nicks.get(client) || '玩家';
    room.seats[i] = { client, nick, online: true, ai: false };
    client._room = room.code; client._seat = i;
  }
  _seatInfo(room) {
    return room.seats.map((s, i) => s ? { seat: i, nick: s.nick, online: s.online, ai: s.ai } : null);
  }
  _sendRoom(room, only = null) {
    const seats = this._seatInfo(room);
    const targets = only ? [only] : [
      ...room.seats.filter(Boolean).map(s => s.client),
      ...room.spectators,
    ];
    for (const c of targets) c.send({ t: 'room', code: room.code, status: room.status, seats, you: c._seat ?? null });
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
    const idx = room.seats.findIndex(s => s && s.client === client);
    if (idx === -1) return;             // 进房未落座
    if (room.status === 'waiting') {
      room.seats[idx] = null;
      if (room.host === client) {       // 房主走：删房
        for (const sp of room.spectators) sp.send({ t: 'room-closed' });
        this.rooms.delete(code); if (!room.isPrivate) this._broadcastLobby();
      } else { this._sendRoom(room); }
      return;
    }
    // playing：掉线 → 进入「掉线宽限」(不立刻全速AI)，靠回合超时(disconnectGraceMs)代打、连续 N 手没回来才转
    // 全速AI；任意时刻 rejoin 收座清零。保留昵称作重连凭据。disconnectGraceMs=0 时退回旧行为(掉线即全速AI)。
    const grace = this.disconnectGraceMs > 0 && room.driver && typeof room.driver.forceAutoPlay === 'function';
    room.seats[idx].online = false; room.seats[idx].client = null;
    if (grace) { room.seats[idx].disconnected = true; room.seats[idx].ai = false; room.seats[idx].graceMisses = 0; }
    else { room.seats[idx].disconnected = false; room.seats[idx].ai = true; }
    for (const s of room.seats) if (s && s.client && s.online) s.client.send({ t: 'peer-offline', seat: idx });
    for (const sp of room.spectators) sp.send({ t: 'peer-offline', seat: idx });
    if (!grace) {
      if (room.driver && room.driver.setAI) this._dispatch(room, room.driver.setAI(idx, true)); // 旧行为：立刻全速AI
    } else if (room.driver.state && room.driver.state.turn === idx) {
      // 断线座正是当前回合：把截止压到 min(原, now+宽限)——断线不续命(已走的算数)，但最多再等宽限(10s)。
      room._turnTimerSeat = idx;
      if (!room._turnStartedAt) room._turnStartedAt = Date.now();
      const cap = Date.now() + this.disconnectGraceMs;
      room._turnDeadline = room._turnDeadline ? Math.min(room._turnDeadline, cap) : cap;
      this._scheduleTurnTimer(room);
    } // 断线座非当前回合：等轮到它时 _armTurnTimeout 自会按掉线宽限给计时，这里无需动当前计时
    const anyHuman = room.seats.some(s => s && s.online);
    if (!anyHuman) {                    // 全部掉线 → 删房（清回合计时，避免对死房代打）
      if (room._turnTimer) { clearTimeout(room._turnTimer); room._turnTimer = null; }
      for (const sp of room.spectators) sp.send({ t: 'room-closed' });
      this.rooms.delete(code); if (!room.isPrivate) this._broadcastLobby();
    }
  }
  _dispatch(room, outbound) {
    if (!outbound) return;
    // 先按「当前牌局态」更新回合计时——只在回合真的变了时重置。观战/重连/他人掉线的纯重广播不重置计时，
    // 否则观众一进场就把当前真人的倒计时刷回满：真人明明到点了，却被迫等观众那份新计时到 0 才托管出牌。
    this._armTurnTimeout(room);
    // 注入服务端权威「本回合剩余毫秒」（到截止时间，含掉线宽限座的较短截止）：客户端据此显示一致倒计时。
    const remain = (room._turnTimerSeat != null && room._turnDeadline)
      ? Math.max(0, room._turnDeadline - Date.now()) : null;
    for (const o of outbound) {
      if (remain != null && o.msg && o.msg.t === 'state' && o.msg.phase === 'playing') o.msg.turnRemainMs = remain;
      if (o.to === 'seat') {
        const s = room.seats[o.seat];
        if (s && s.client && s.online) s.client.send(o.msg);
      } else { // 'all'：房内在线玩家 + 观众
        for (const s of room.seats) if (s && s.client && s.online) s.client.send(o.msg);
        for (const sp of room.spectators) sp.send(o.msg);
      }
    }
    // 自动续局：dealResult 后自动触发 nextDeal（matchOver 不续）
    const hasDealResult = (outbound || []).some(o => o.msg && o.msg.t === 'state' && o.msg.phase === 'dealResult');
    if (hasDealResult && room.driver && !room._advancing && typeof room.driver.nextDeal === 'function') {
      room._advancing = true;
      setImmediate(() => {
        room._advancing = false;
        if (room.driver && typeof room.driver.nextDeal === 'function') {
          const o = room.driver.nextDeal();
          this._dispatch(room, o);
          this._armTributeTimeout(room, o);
        }
      });
    }
  }
  /** 回合超时计时：在线真人座(turnTimeoutMs) 或 掉线宽限座(disconnectGraceMs) 发呆到点 → forceAutoPlay 代打。
   *  只在「该计时座位变(armSeat) 或 出现新行棋(driver.ply 变)」时才重置；同座同 ply 的纯重广播（观战/重连/
   *  他人掉线）保持原计时不动（修「观众进场刷新真人倒计时」）。全速AI座(setAI 过)不计时——driveAI 即时代打。 */
  _armTurnTimeout(room) {
    const d = room.driver;
    const playing = !!(d && d.phase === 'playing');
    const turn = playing && d.state ? d.state.turn : null;
    const seat = (typeof turn === 'number') ? room.seats[turn] : null;
    // 在线真人 或 掉线宽限座 都计时；全速AI座(online=false && !disconnected)不计时
    const armSeat = (seat && (seat.online || seat.disconnected)) ? turn : null;
    const ply = (d && typeof d.ply === 'number') ? d.ply : 0;
    if (armSeat === room._turnTimerSeat && ply === room._turnTimerPly && room._turnTimer) return; // 无真实进展→不动
    if (room._turnTimer) { clearTimeout(room._turnTimer); room._turnTimer = null; }
    room._turnTimerSeat = armSeat; room._turnTimerPly = ply;
    const dur = !seat ? 0 : (seat.disconnected ? this.disconnectGraceMs : this.turnTimeoutMs);
    if (!dur || armSeat == null || !d || typeof d.forceAutoPlay !== 'function') { room._turnStartedAt = 0; room._turnDeadline = 0; return; }
    room._turnStartedAt = Date.now();
    room._turnDeadline = room._turnStartedAt + dur;
    this._scheduleTurnTimer(room);
  }
  /** 按当前 room._turnDeadline 起/重起计时器（掉线把截止压短后也调它）。 */
  _scheduleTurnTimer(room) {
    if (room._turnTimer) { clearTimeout(room._turnTimer); room._turnTimer = null; }
    if (!room._turnDeadline) return;
    room._turnTimer = setTimeout(() => { room._turnTimer = null; this._fireTurnTimeout(room); }, Math.max(0, room._turnDeadline - Date.now()));
  }
  /** 到点托管：forceAutoPlay 代打一手。掉线宽限座累计 graceMisses，连续 disconnectGraceMisses 手仍没回 → 转全速AI。 */
  _fireTurnTimeout(room) {
    const d = room.driver;
    if (!d || typeof d.forceAutoPlay !== 'function') return;
    const idx = room._turnTimerSeat;
    const s = (typeof idx === 'number') ? room.seats[idx] : null;
    const o = d.forceAutoPlay();                          // 替当前回合座代打一手
    if (s && s.disconnected) {
      s.graceMisses = (s.graceMisses || 0) + 1;
      if (s.graceMisses >= this.disconnectGraceMisses) {  // 连续没回来 → 转全速AI(此后 driveAI 即时代打、不再计时)
        s.disconnected = false; s.ai = true;
        const ai = (d.setAI ? d.setAI(idx, true) : []);
        this._dispatch(room, [...o, ...ai]);
        this._armTributeTimeout(room, o);
        return;
      }
    }
    this._dispatch(room, o);
    this._armTributeTimeout(room, o);
  }
  _armTributeTimeout(room, out) {
    const needsTribute = (out || []).some(o => o.msg && o.msg.t === 'need-tribute');
    if (needsTribute && !room._tributeTimer && this.tributeTimeoutMs) {
      room._tributeTimer = setTimeout(() => { room._tributeTimer = null; if (room.driver) this._dispatch(room, room.driver.forceAutoReturn()); }, this.tributeTimeoutMs);
    }
    const leftTribute = (out || []).some(o => o.msg && o.msg.t === 'state' && o.msg.phase === 'playing');
    if (leftTribute && room._tributeTimer) { clearTimeout(room._tributeTimer); room._tributeTimer = null; }
  }
  _snapshot() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.isPrivate) continue;
      out.push({
        code: r.code,
        status: r.status,
        players: r.seats.filter(Boolean).map(s => s.nick),
        spectators: r.spectators.size
      });
    }
    return out;
  }
  _broadcastLobby() {
    const rooms = this._snapshot();
    for (const c of this.lobby) c.send({ t: 'lobby', rooms });
  }
}
