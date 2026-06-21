// 纯房间登记 + 转发（不依赖真 socket；client 只需有 send(msgObj)）。互信，不校验牌规。
function defaultCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去易混 0O1I
  let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class RoomRegistry {
  constructor(codeGen = defaultCode, makeDriver = null) {
    this.codeGen = codeGen;
    this.makeDriver = makeDriver;       // (room) => MatchDriver；Task 9 接入
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
  _leaveRoom(client) { /* Task 7 完整实现；此处先占位空函数 */ if (client) { client._room = client._room || null; } }
  _dispatch(room, outbound) {
    if (!outbound) return;
    for (const o of outbound) {
      if (o.to === 'seat') {
        const s = room.seats[o.seat];
        if (s && s.client && s.online) s.client.send(o.msg);
      } else { // 'all'：房内在线玩家 + 观众
        for (const s of room.seats) if (s && s.client && s.online) s.client.send(o.msg);
        for (const sp of room.spectators) sp.send(o.msg);
      }
    }
  }
}
