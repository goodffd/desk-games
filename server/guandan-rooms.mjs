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
  }
  leave(client) {
    const nk = this.nicks.get(client);
    if (nk) { this.byNick.delete(this._nickKey(nk)); this.nicks.delete(client); }
    this.lobby.delete(client);
  }
}
