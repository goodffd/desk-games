// 纯房间登记 + 转发逻辑（不依赖真 socket；client 只需有 send(msgObj)）。互信，不校验棋规。
const RELAY = new Set(['move', 'resign', 'draw-offer', 'draw-accept', 'draw-decline', 'undo-request', 'undo-accept', 'undo-decline']);

function defaultCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混 0O1I
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class RoomRegistry {
  constructor(codeGen = defaultCode) {
    this.codeGen = codeGen;
    this.rooms = new Map();      // code -> { code, host, isPrivate, players:[red,black], nicks:[red,black], spectators:Set, status }
    this.nicks = new Map();      // client -> nick(原样)
    this.byNick = new Set();     // nickKey(小写去空格) 占用集
    this.lobby = new Set();      // 订阅大厅的客户端
  }
  _nickKey(n) { return String(n || '').trim().toLowerCase(); }
  _newCode() {
    let c = this.codeGen();
    while (this.rooms.has(c)) c = this.codeGen();
    return c;
  }
  _snapshot() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.isPrivate) continue;
      out.push({ code: r.code, host: r.host, status: r.status,
        players: r.status === 'playing' ? [r.nicks[0], r.nicks[1]] : null,
        spectators: r.spectators.size });
    }
    return out;
  }
  _broadcastLobby() {
    const rooms = this._snapshot();
    for (const c of this.lobby) c.send({ t: 'lobby', rooms });
  }
  handle(client, msg) {
    if (msg.t === 'hello' || msg.t === 'rename') {
      const key = this._nickKey(msg.nick);
      const cur = this.nicks.get(client);
      const okType = msg.t === 'hello' ? 'hello-ok' : 'rename-ok';
      if (!key) { client.send({ t: 'nick-taken' }); return; }
      if (this.byNick.has(key) && key !== this._nickKey(cur)) { client.send({ t: 'nick-taken' }); return; }
      if (cur) this.byNick.delete(this._nickKey(cur));
      this.nicks.set(client, msg.nick);
      this.byNick.add(key);
      client.send({ t: okType });
      return;
    }
    if (msg.t === 'create') {
      this._leaveRoom(client);   // 先退出可能残留的旧房，防泄漏 + 幽灵 relay
      const code = this._newCode();
      const host = this.nicks.get(client) || '玩家';
      const room = { code, host, isPrivate: !!msg.isPrivate, players: [client, null], nicks: [host, null], spectators: new Set(), pendingSync: new Set(), status: 'waiting' };
      this.rooms.set(code, room);
      client._room = code; client._role = 'red';
      client.send({ t: 'created', code, isPrivate: room.isPrivate });
      if (!room.isPrivate) this._broadcastLobby();
      return;
    }
    if (msg.t === 'join') {
      this._leaveRoom(client);   // 先退旧房（含自建房）：防带房加入残留 + 自加入自房致删房后 null.send 崩溃
      const room = this.rooms.get(msg.code);
      if (!room || room.players[1] || room.status !== 'waiting') { client.send({ t: 'error', msg: '房间不存在或已满' }); return; }
      const nick = this.nicks.get(client) || '玩家';
      room.players[1] = client; room.nicks[1] = nick; room.status = 'playing';
      client._room = room.code; client._role = 'black';
      room.players[0].send({ t: 'paired', color: 'red', you: room.nicks[0], opponent: nick, code: room.code });
      client.send({ t: 'paired', color: 'black', you: nick, opponent: room.nicks[0], code: room.code });
      if (!room.isPrivate) this._broadcastLobby();
      return;
    }
    if (msg.t === 'lobby') {
      this.lobby.add(client);
      client.send({ t: 'lobby', rooms: this._snapshot() });
      return;
    }
    if (msg.t === 'spectate') {
      const room = this.rooms.get(msg.code);
      if (!room || room.isPrivate || room.status !== 'playing') { client.send({ t: 'error', msg: '无法观战该房间' }); return; }
      this._leaveRoom(client);   // 先退旧房
      room.spectators.add(client); client._room = msg.code; client._role = 'spectator';
      client.send({ t: 'spectating', host: room.host, players: [room.nicks[0], room.nicks[1]] });
      const src = room.players[0] || room.players[1];   // 向任一在线玩家要当前棋谱
      if (src) { room.pendingSync.add(client); src.send({ t: 'need-sync' }); }
      this._broadcastLobby();
      return;
    }
    if (msg.t === 'sync') {
      if (client._role === 'spectator') return;   // 观战者不能当同步源
      const room = this.rooms.get(client._room);
      if (!room) return;
      for (const c of room.pendingSync) c.send(msg);   // 发给所有等待同步者（新观战者 / 重连玩家）
      room.pendingSync.clear();
      return;
    }
    if (msg.t === 'rejoin') {
      const room = this.rooms.get(msg.code);
      const nick = msg.nick;   // 重连自带昵称，按房间座位匹配，不走全局判重 → 绕开昵称竞争
      let idx = -1;
      if (room && nick) idx = (room.nicks[0] === nick && !room.players[0]) ? 0 : ((room.nicks[1] === nick && !room.players[1]) ? 1 : -1);
      if (idx === -1) { client.send({ t: 'error', msg: '无法重连：房间不存在或座位已占' }); return; }
      room.players[idx] = client;   // 重新落座
      client._room = room.code; client._role = idx === 0 ? 'red' : 'black';
      this.nicks.set(client, nick); this.byNick.add(this._nickKey(nick));   // 重连后重新登记昵称，维持在线判重一致（防幽灵重名）
      client.send({ t: 'rejoined', color: idx === 0 ? 'red' : 'black', you: nick, opponent: room.nicks[idx === 0 ? 1 : 0] });
      const opp = room.players[idx === 0 ? 1 : 0];
      if (opp) { opp.send({ t: 'peer-reconnected' }); room.pendingSync.add(client); opp.send({ t: 'need-sync' }); }
      return;
    }
    if (RELAY.has(msg.t)) {
      if (client._role === 'spectator') return;   // 观战者不能转发对局消息（防冒充玩家走子/认输）
      const room = this.rooms.get(client._room);
      if (!room) return;
      const opp = client === room.players[0] ? room.players[1] : room.players[0];
      if (opp) opp.send(msg);
      for (const sp of room.spectators) sp.send(msg);
      return;
    }
  }
  // 仅清房间归属（不动昵称/lobby）：供 leave() 与 create/join/spectate 入口「先退旧房」复用，
  // 防同一连接重复 create/join 时旧房残留（内存泄漏）+ 旧房幽灵 relay。
  _leaveRoom(client) {
    const code = client._room;
    if (!code) return;
    const role = client._role;
    client._room = null; client._role = null;
    const room = this.rooms.get(code);
    if (!room) return;
    room.pendingSync.delete(client);   // 清掉待同步集，防断开的连接残留（内存/无效发送）
    if (role === 'spectator') {
      room.spectators.delete(client);
      if (!room.isPrivate) this._broadcastLobby();
      return;
    }
    const idx = room.players[0] === client ? 0 : (room.players[1] === client ? 1 : -1);
    if (idx === -1) return;   // 已不在该房座位（防误清他人座位）
    room.players[idx] = null;   // 标记掉线；保留 nicks[idx] 作为重连凭据
    const other = room.players[idx === 0 ? 1 : 0];
    if (room.status === 'waiting' || !other) {
      // 等待房房主离开 或 两个玩家都掉线 → 删房
      for (const sp of room.spectators) sp.send({ t: 'room-closed' });
      const wasPublic = !room.isPrivate;
      this.rooms.delete(code);
      if (wasPublic) this._broadcastLobby();
    } else {
      other.send({ t: 'peer-disconnected' });   // 对手仍在 → 保留房间等重连
    }
  }
  leave(client) {
    const nk = this.nicks.get(client);
    if (nk) { this.byNick.delete(this._nickKey(nk)); this.nicks.delete(client); }
    this.lobby.delete(client);
    this._leaveRoom(client);
  }
}
