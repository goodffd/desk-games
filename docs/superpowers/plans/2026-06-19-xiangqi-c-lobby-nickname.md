> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 联机大厅 + 昵称 + 观战 + 私密房 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把联机从「纯配对码」升级为「房间大厅 + 昵称（本机记+在线判重）+ 观战 + 私密房」。

**Architecture:** 服务器 `rooms.mjs` 仍是内存哑中转：新增在线昵称集（判重）、大厅订阅+快照广播、房间扩展为「玩家[2]+观战者[N]」、对局消息 1→N 转发；观战中途同步靠让一名玩家用 A 阶段的 PGN 序列化上报当前局面（服务器不懂棋规、只转发）。前端 `online.ts` 从「每动作开一条连接」改为「连一次、hello 判重、常驻收大厅推送」；`main.ts` 重写联机 UI 流程（输名字关→大厅→建/加/观战）。

**Tech Stack:** Node + `ws`（服务端，`server/`，纯 JS `.mjs`）；TypeScript + Canvas（前端）；vitest（`tests/*.test.mjs` 测服务端纯逻辑）；Playwright + 系统 Chrome（E2E）。

## Global Constraints

- `src/engine/` 绝不 import DOM/Canvas；规则只有一处真相（engine），UI/server 不另写判定。
- 服务器是**纯哑中转**：不跑棋规、不持久化、**不落盘**（在线昵称集/房间表/订阅集全内存）。
- 单文件构建必须仍成立：`npm run build` 产出可双击的 `dist/index.html`。
- 验证：`npm test`（vitest run 全绿）+ `npm run typecheck`（tsc --noEmit 无错）。服务端测试放 `tests/*.test.mjs`。**每个任务结束时全套测试必须绿**（本计划已按"每次提交都绿"切分任务）。
- 昵称：localStorage 仅预填输入框；判重走服务器**在线**集合（撞名拒绝、释放于断开）；**不做账号/PIN/落盘/跨设备身份**。
- 观战中途同步复用 A 的 `gameToPgn(game, opts)` / `pgnToGame(text)`（`src/engine/pgn.ts`）。
- 房间码字符集沿用现有 `defaultCode()`（去掉易混 0O1I 的 6 位）。

---

## 现状关键事实（实现前必读）

- `server/rooms.mjs` 现有 `RoomRegistry`：`rooms: Map<code,{host,guest}>`、`handle(client,msg)`、`leave(client)`；`client` 仅需 `.send(msgObj)`，内部用 `client._room`/`client._role`。
- 测试约定（`tests/rooms.test.mjs`）：`fakeClient()` 返回 `{sent:[], send:(m)=>sent.push(m)}`；`new RoomRegistry(() => 'ABC123')` 注入定长码。
- `src/ui/online.ts`：`OnlineMsg` 联合类型、`deriveWsUrl(loc)`、`OnlineSession`（`createRoom/joinRoom/send/close/onMessage/onState`，目前每动作新开连接）。
- `src/ui/controller.ts`：`applyExternalMove(m):boolean`、`reset()`、`getGame():Game`、`loadGame(game:Game)`、`undo()`、`get board/turn/status`、`lastMove`。
- `src/ui/main.ts`：联机状态 `online/onlineColor/onlineResult/pendingOffer`；`enterOnline/exitOnline/newOnline/onOnlineMsg`；canvas click 用 `controller.turn !== onlineColor` 拦截；落子后 `online!.send({t:'move',iccs:moveToIccs(...)})`。
- `src/ui/persist.ts`：thin localStorage 封装模式（`saveTheme/loadTheme` 等）。
- `index.html`：`#online-panel` 内是 o-create/o-join/o-code-* 等；`#online-actions`（认输/求和/悔棋）；`#online-offer`（接受/拒绝）。

## 服务器最终消息协议（各 server 任务的目标）

客户端→服务器：`hello{nick}`、`rename{nick}`、`lobby`、`create{isPrivate}`、`join{code}`、`spectate{code}`、`sync{pgn}`、对局 `move/resign/draw-*/undo-*`。
服务器→客户端：`hello-ok`、`nick-taken`、`rename-ok`、`lobby{rooms}`、`created{code,isPrivate}`、`paired{color,you,opponent}`、`spectating{host,players}`、`need-sync`、`sync{pgn}`、`error{msg}`、`peer-left`、`room-closed`，及对局消息原样转发。

房间内部结构（最终）：`{ code, host, isPrivate, players:[redClient|null, blackClient|null], nicks:[redNick|null, blackNick|null], spectators:Set, status:'waiting'|'playing' }`。

> **任务切分原则**：Task 3 一次性把房间结构迁到最终形态并把 create/join/relay/leave 全部移植过去（每次提交都绿）；Task 4 大厅、Task 5 观战、Task 6 离开细化都在此结构上**叠加**。

---

### Task 1: persist.ts — 昵称存取 + 默认名

**Files:**
- Modify: `src/ui/persist.ts`（末尾追加）
- Test: `tests/persist-nick.test.ts`（新建）

**Interfaces:**
- Produces：`defaultNick(): string`（形如 `棋友728`）；`saveNick(n: string): void`；`loadNick(): string`（无则空串）。被 Task 9 消费。

- [ ] **Step 1: Write the failing test** — `tests/persist-nick.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { defaultNick } from '../src/ui/persist';

describe('defaultNick', () => {
  it('形如 棋友 + 3 位数字', () => {
    for (let i = 0; i < 20; i++) expect(defaultNick()).toMatch(/^棋友\d{3}$/);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/persist-nick.test.ts` → FAIL（`defaultNick` 未导出）。

- [ ] **Step 3: Implement** — `src/ui/persist.ts` 末尾追加：
```ts
const NKEY = 'xiangqi:nick';

// 默认友好名：棋友 + 3 位数字（避免空名；用户进联机时可改）
export function defaultNick(): string {
  return '棋友' + String(Math.floor(Math.random() * 1000)).padStart(3, '0');
}
export function saveNick(n: string): void {
  try { localStorage.setItem(NKEY, n); } catch { /* 忽略 */ }
}
export function loadNick(): string {
  try { return localStorage.getItem(NKEY) || ''; } catch { return ''; }
}
```

- [ ] **Step 4: Run test + typecheck** — `npx vitest run tests/persist-nick.test.ts && npm run typecheck` → PASS、无错。

- [ ] **Step 5: Commit**
```bash
git add src/ui/persist.ts tests/persist-nick.test.ts
git commit -m "feat(persist): 昵称 localStorage 存取 + 默认名 defaultNick"
```

---

### Task 2: rooms.mjs — 在线昵称集 + hello/rename 判重

**Files:** Modify `server/rooms.mjs`；Test `tests/rooms.test.mjs`（追加用例）

**Interfaces:**
- Consumes：现有 `RoomRegistry`、`fakeClient()`。
- Produces：`handle(client,{t:'hello',nick})` → `{t:'hello-ok'}`/`{t:'nick-taken'}`；`{t:'rename',nick}` → `{t:'rename-ok'}`/`{t:'nick-taken'}`；`leave(client)` 释放昵称。内部 `this.nicks:Map`、`this.byNick:Set`、`_nickKey(n)`。被 Task 3/4/5 消费。
- 本任务**不动** rooms 结构与 create/join/relay/leave 既有行为，旧用例继续绿。

- [ ] **Step 1: Write failing tests** — `tests/rooms.test.mjs` 的 `describe` 内追加：
```js
it('hello 判重：占用回 nick-taken，释放后可用', () => {
  const a = fakeClient(); const b = fakeClient();
  reg.handle(a, { t: 'hello', nick: '封福东' });
  expect(a.sent).toContainEqual({ t: 'hello-ok' });
  reg.handle(b, { t: 'hello', nick: '封福东' });
  expect(b.sent).toContainEqual({ t: 'nick-taken' });
  reg.leave(a);
  reg.handle(b, { t: 'hello', nick: '封福东' });
  expect(b.sent).toContainEqual({ t: 'hello-ok' });
});

it('rename 判重；同名 re-hello 不算撞自己', () => {
  const a = fakeClient(); const b = fakeClient();
  reg.handle(a, { t: 'hello', nick: 'Alice' });
  reg.handle(a, { t: 'hello', nick: 'Alice' });
  expect(a.sent.filter((m) => m.t === 'hello-ok').length).toBe(2);
  reg.handle(b, { t: 'hello', nick: 'Bob' });
  reg.handle(b, { t: 'rename', nick: 'Alice' });
  expect(b.sent).toContainEqual({ t: 'nick-taken' });
  reg.handle(b, { t: 'rename', nick: 'Bobby' });
  expect(b.sent).toContainEqual({ t: 'rename-ok' });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/rooms.test.mjs` → 新用例 FAIL。

- [ ] **Step 3: Implement** — 构造函数加字段 + `_nickKey`：
```js
  constructor(codeGen = defaultCode) {
    this.codeGen = codeGen;
    this.rooms = new Map();
    this.nicks = new Map();      // client -> nick(原样)
    this.byNick = new Set();     // nickKey(小写去空格) 占用集
  }
  _nickKey(n) { return String(n || '').trim().toLowerCase(); }
```
`handle(client, msg)` 最前面插入：
```js
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
```
`leave(client)` 开头插入（先于既有房间清理）：
```js
    const nk = this.nicks.get(client);
    if (nk) { this.byNick.delete(this._nickKey(nk)); this.nicks.delete(client); }
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/rooms.test.mjs` → 全绿（新 2 例 + 旧例）。

- [ ] **Step 5: Commit**
```bash
git add server/rooms.mjs tests/rooms.test.mjs
git commit -m "feat(server): 在线昵称集 + hello/rename 判重，断开释放"
```

---

### Task 3: rooms.mjs — 房间结构迁移 + create(isPrivate)/join(昵称)/relay/leave

**Files:** Modify `server/rooms.mjs`；Test `tests/rooms.test.mjs`（更新既有 create/join/relay/leave 用例为新形状）

**Interfaces:**
- Consumes：Task 2 的 `this.nicks`/`_nickKey`。
- Produces：房间结构升级为 `{code,host,isPrivate,players:[red,black],nicks:[red,black],spectators:Set,status}`；`create{isPrivate}`→`created{code,isPrivate}`；`join{code}`→双方 `paired{color,you,opponent}`（先到 red 后到 black），满员/坏码 `error`；relay 给对手（players 数组）；leave 给对手 `peer-left` 并删房。`_role` 取值改为 `'red'|'black'`。
- 一次性迁移：本任务后全套测试**绿**。spectators 集合先存在但为空，status 已维护，为 Task 4/5 铺垫。

- [ ] **Step 1: 更新既有 4 个用例为新形状**（替换 tests/rooms.test.mjs 中的 create/join/error/relay/leave 用例）：
```js
it('create 分配房间码并回 created(含 isPrivate)', () => {
  const a = fakeClient();
  reg.handle(a, { t: 'create' });
  expect(a.sent).toContainEqual({ t: 'created', code: 'ABC123', isPrivate: false });
});

it('join 配对：双方收 paired(含 you/opponent，host=red guest=black)', () => {
  const a = fakeClient(); const b = fakeClient();
  reg.handle(a, { t: 'hello', nick: '甲' });
  reg.handle(b, { t: 'hello', nick: '乙' });
  reg.handle(a, { t: 'create' });
  reg.handle(b, { t: 'join', code: 'ABC123' });
  expect(a.sent).toContainEqual({ t: 'paired', color: 'red', you: '甲', opponent: '乙' });
  expect(b.sent).toContainEqual({ t: 'paired', color: 'black', you: '乙', opponent: '甲' });
});

it('坏码 / 满员 → error', () => {
  const a = fakeClient(); const b = fakeClient(); const c = fakeClient(); const d = fakeClient();
  reg.handle(a, { t: 'join', code: 'NOPE' });
  expect(a.sent[a.sent.length - 1].t).toBe('error');
  reg.handle(b, { t: 'create' });
  reg.handle(c, { t: 'join', code: 'ABC123' });
  reg.handle(d, { t: 'join', code: 'ABC123' });
  expect(d.sent[d.sent.length - 1].t).toBe('error');
});

it('对局消息转发给对手', () => {
  const a = fakeClient(); const b = fakeClient();
  reg.handle(a, { t: 'create' });
  reg.handle(b, { t: 'join', code: 'ABC123' });
  reg.handle(a, { t: 'move', iccs: 'h7-e7' });
  expect(b.sent).toContainEqual({ t: 'move', iccs: 'h7-e7' });
  reg.handle(b, { t: 'undo-request' });
  expect(a.sent).toContainEqual({ t: 'undo-request' });
});

it('一端离开 → 对手收 peer-left，房间清理', () => {
  const a = fakeClient(); const b = fakeClient(); const c = fakeClient();
  reg.handle(a, { t: 'create' });
  reg.handle(b, { t: 'join', code: 'ABC123' });
  reg.leave(a);
  expect(b.sent).toContainEqual({ t: 'peer-left' });
  reg.handle(c, { t: 'join', code: 'ABC123' });
  expect(c.sent[c.sent.length - 1].t).toBe('error');
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run tests/rooms.test.mjs` → create/join/relay/leave 相关 FAIL（旧 host/guest 结构与新断言不符）。

- [ ] **Step 3: Implement** — 替换 `handle` 的 create/join 分支、RELAY 转发，及 `leave` 的房间处理。

create：
```js
    if (msg.t === 'create') {
      const code = this._newCode();
      const host = this.nicks.get(client) || '玩家';
      const room = { code, host, isPrivate: !!msg.isPrivate, players: [client, null], nicks: [host, null], spectators: new Set(), status: 'waiting' };
      this.rooms.set(code, room);
      client._room = code; client._role = 'red';
      client.send({ t: 'created', code, isPrivate: room.isPrivate });
      return;
    }
```
join：
```js
    if (msg.t === 'join') {
      const room = this.rooms.get(msg.code);
      if (!room || room.players[1] || room.status !== 'waiting') { client.send({ t: 'error', msg: '房间不存在或已满' }); return; }
      const nick = this.nicks.get(client) || '玩家';
      room.players[1] = client; room.nicks[1] = nick; room.status = 'playing';
      client._room = room.code; client._role = 'black';
      room.players[0].send({ t: 'paired', color: 'red', you: room.nicks[0], opponent: nick });
      client.send({ t: 'paired', color: 'black', you: nick, opponent: room.nicks[0] });
      return;
    }
```
RELAY（替换旧 host/guest 转发）：
```js
    if (RELAY.has(msg.t)) {
      const room = this.rooms.get(client._room);
      if (!room) return;
      const opp = client === room.players[0] ? room.players[1] : room.players[0];
      if (opp) opp.send(msg);
      return;
    }
```
`leave` 房间处理（保留 Step/Task 2 的昵称释放在前）：
```js
    const code = client._room;
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    const opp = client === room.players[0] ? room.players[1] : room.players[0];
    if (opp) opp.send({ t: 'peer-left' });
    this.rooms.delete(code);
```

- [ ] **Step 4: Run tests** — `npx vitest run tests/rooms.test.mjs` → **全绿**。

- [ ] **Step 5: Commit**
```bash
git add server/rooms.mjs tests/rooms.test.mjs
git commit -m "feat(server): 房间结构迁移 + create(isPrivate)/join(昵称,paired you/opponent)/relay/leave"
```

---

### Task 4: rooms.mjs — 大厅 订阅/快照/广播

**Files:** Modify `server/rooms.mjs`；Test `tests/rooms.test.mjs`

**Interfaces:**
- Consumes：Task 3 房间结构。
- Produces：`{t:'lobby'}`→回 `{t:'lobby',rooms}` 并加入订阅集；快照变化（create 公开房 / join 配对 / leave）广播 `{t:'lobby',rooms}`；`_snapshot()`、`_broadcastLobby()`、`this.lobby:Set`；快照项 `{code,host,status,players,spectators}`（私密房不进快照）。

- [ ] **Step 1: Write failing tests**：
```js
it('订阅 lobby 收快照；公开房广播含 host；私密房不进大厅', () => {
  const host = fakeClient(); const viewer = fakeClient();
  reg.handle(host, { t: 'hello', nick: '甲' });
  reg.handle(viewer, { t: 'lobby' });
  expect(viewer.sent.pop()).toEqual({ t: 'lobby', rooms: [] });
  reg.handle(host, { t: 'create', isPrivate: false });
  expect(viewer.sent.filter((m) => m.t === 'lobby').pop().rooms)
    .toContainEqual({ code: 'ABC123', host: '甲', status: 'waiting', players: null, spectators: 0 });
  const reg2 = new RoomRegistry(() => 'PRIV01'); const h2 = fakeClient(); const v2 = fakeClient();
  reg2.handle(h2, { t: 'hello', nick: '乙' });
  reg2.handle(v2, { t: 'lobby' });
  reg2.handle(h2, { t: 'create', isPrivate: true });
  expect(v2.sent.filter((m) => m.t === 'lobby').pop().rooms).toEqual([]);
});

it('配对后房在快照中转为 playing（供观战）', () => {
  const a = fakeClient(); const b = fakeClient(); const viewer = fakeClient();
  reg.handle(viewer, { t: 'lobby' });
  reg.handle(a, { t: 'create' });
  reg.handle(b, { t: 'join', code: 'ABC123' });
  const room = viewer.sent.filter((m) => m.t === 'lobby').pop().rooms.find((r) => r.code === 'ABC123');
  expect(room.status).toBe('playing');
  expect(room.players).toEqual(['玩家', '玩家']);
});

it('等待中公开房创建者离开 → 大厅移除该房', () => {
  const a = fakeClient(); const viewer = fakeClient();
  reg.handle(viewer, { t: 'lobby' });
  reg.handle(a, { t: 'create' });
  reg.leave(a);
  expect(viewer.sent.filter((m) => m.t === 'lobby').pop().rooms).toEqual([]);
});
```

- [ ] **Step 2: Run to verify fail** — FAIL（无 lobby 处理）。

- [ ] **Step 3: Implement** — 构造函数加 `this.lobby = new Set();`；新增方法：
```js
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
```
`handle` 加 lobby 分支：
```js
    if (msg.t === 'lobby') {
      this.lobby.add(client);
      client.send({ t: 'lobby', rooms: this._snapshot() });
      return;
    }
```
在 create 分支 `return` 前插入：`if (!room.isPrivate) this._broadcastLobby();`
在 join 分支 `return` 前插入：`this._broadcastLobby();`
`leave` 在昵称释放后加：`this.lobby.delete(client);`；在删房后加：`if (!room.isPrivate) this._broadcastLobby();`

- [ ] **Step 4: Run tests** — `npx vitest run tests/rooms.test.mjs` → 全绿。

- [ ] **Step 5: Commit**
```bash
git add server/rooms.mjs tests/rooms.test.mjs
git commit -m "feat(server): 大厅 订阅/快照/广播（create/join/leave 触发）"
```

---

### Task 5: rooms.mjs — 观战 spectate + need-sync/sync + 对局消息 1→N 转发

**Files:** Modify `server/rooms.mjs`；Test `tests/rooms.test.mjs`

**Interfaces:**
- Consumes：Task 4 大厅/广播。
- Produces：`{t:'spectate',code}`→加入 `room.spectators`、回 `{t:'spectating',host,players}`、向 `players[0]` 发 `{t:'need-sync'}`、广播大厅；私密/坏码/未开局→`error`。`{t:'sync',pgn}`（玩家发）→转给本房 spectators。RELAY 同时发对手 + 全部 spectators。

- [ ] **Step 1: Write failing tests**：
```js
it('观战：spectating + need-sync；sync 转给观战者；move 同到对手与观战者', () => {
  const a = fakeClient(); const b = fakeClient(); const s = fakeClient();
  reg.handle(a, { t: 'hello', nick: '甲' });
  reg.handle(b, { t: 'hello', nick: '乙' });
  reg.handle(a, { t: 'create' });
  reg.handle(b, { t: 'join', code: 'ABC123' });
  reg.handle(s, { t: 'spectate', code: 'ABC123' });
  expect(s.sent).toContainEqual({ t: 'spectating', host: '甲', players: ['甲', '乙'] });
  expect(a.sent).toContainEqual({ t: 'need-sync' });
  reg.handle(a, { t: 'sync', pgn: 'PGNDATA' });
  expect(s.sent).toContainEqual({ t: 'sync', pgn: 'PGNDATA' });
  reg.handle(a, { t: 'move', iccs: 'h2-e2' });
  expect(b.sent).toContainEqual({ t: 'move', iccs: 'h2-e2' });
  expect(s.sent).toContainEqual({ t: 'move', iccs: 'h2-e2' });
});

it('私密房/未开局房不可观战 → error', () => {
  const reg3 = new RoomRegistry(() => 'PRIV01'); const a = fakeClient(); const s = fakeClient();
  reg3.handle(a, { t: 'create', isPrivate: true });
  reg3.handle(s, { t: 'spectate', code: 'PRIV01' });
  expect(s.sent[s.sent.length - 1].t).toBe('error');
  const reg4 = new RoomRegistry(() => 'WAIT01'); const a2 = fakeClient(); const s2 = fakeClient();
  reg4.handle(a2, { t: 'create' });
  reg4.handle(s2, { t: 'spectate', code: 'WAIT01' });
  expect(s2.sent[s2.sent.length - 1].t).toBe('error');
});
```

- [ ] **Step 2: Run to verify fail** — FAIL（无 spectate/sync；relay 未发 spectators）。

- [ ] **Step 3: Implement** — `handle` 加 spectate / sync 分支，并把 RELAY 转发改为含 spectators：
```js
    if (msg.t === 'spectate') {
      const room = this.rooms.get(msg.code);
      if (!room || room.isPrivate || room.status !== 'playing') { client.send({ t: 'error', msg: '无法观战该房间' }); return; }
      room.spectators.add(client); client._room = room.code; client._role = 'spectator';
      client.send({ t: 'spectating', host: room.host, players: [room.nicks[0], room.nicks[1]] });
      if (room.players[0]) room.players[0].send({ t: 'need-sync' });
      this._broadcastLobby();
      return;
    }
    if (msg.t === 'sync') {
      const room = this.rooms.get(client._room);
      if (!room) return;
      for (const sp of room.spectators) sp.send(msg);
      return;
    }
```
RELAY 分支改为：
```js
    if (RELAY.has(msg.t)) {
      const room = this.rooms.get(client._room);
      if (!room) return;
      const opp = client === room.players[0] ? room.players[1] : room.players[0];
      if (opp) opp.send(msg);
      for (const sp of room.spectators) sp.send(msg);
      return;
    }
```

- [ ] **Step 4: Run tests** — 全绿。

- [ ] **Step 5: Commit**
```bash
git add server/rooms.mjs tests/rooms.test.mjs
git commit -m "feat(server): 观战 spectate + need-sync/sync + 对局消息 1→N 转发"
```

---

### Task 6: rooms.mjs — 玩家离开通知观战者 room-closed + 观战者离开

**Files:** Modify `server/rooms.mjs`；Test `tests/rooms.test.mjs`

**Interfaces:**
- Consumes：Task 5 spectators。
- Produces：`leave(client)`：观战者离开→仅从 spectators 移除并广播大厅；玩家离开→对手 `peer-left`、观战者 `room-closed`、删房、（非私密）广播大厅。

- [ ] **Step 1: Write failing tests**：
```js
it('玩家离开 → 对手 peer-left、观战者 room-closed、房清理', () => {
  const a = fakeClient(); const b = fakeClient(); const s = fakeClient(); const c = fakeClient();
  reg.handle(a, { t: 'create' });
  reg.handle(b, { t: 'join', code: 'ABC123' });
  reg.handle(s, { t: 'spectate', code: 'ABC123' });
  reg.leave(a);
  expect(b.sent).toContainEqual({ t: 'peer-left' });
  expect(s.sent).toContainEqual({ t: 'room-closed' });
  reg.handle(c, { t: 'join', code: 'ABC123' });
  expect(c.sent[c.sent.length - 1].t).toBe('error');
});

it('观战者离开 → 不影响玩家，仅更新大厅观战数', () => {
  const a = fakeClient(); const b = fakeClient(); const s = fakeClient(); const viewer = fakeClient();
  reg.handle(a, { t: 'create' });
  reg.handle(b, { t: 'join', code: 'ABC123' });
  reg.handle(viewer, { t: 'lobby' });
  reg.handle(s, { t: 'spectate', code: 'ABC123' });
  reg.leave(s);
  expect(a.sent).not.toContainEqual({ t: 'peer-left' });
  expect(viewer.sent.filter((m) => m.t === 'lobby').pop().rooms.find((r) => r.code === 'ABC123').spectators).toBe(0);
});
```

- [ ] **Step 2: Run to verify fail** — FAIL（leave 未区分观战者、未发 room-closed）。

- [ ] **Step 3: Implement** — 整体替换 `leave(client)`：
```js
  leave(client) {
    const nk = this.nicks.get(client);
    if (nk) { this.byNick.delete(this._nickKey(nk)); this.nicks.delete(client); }
    this.lobby.delete(client);
    const code = client._room;
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    if (client._role === 'spectator') {
      room.spectators.delete(client);
      if (!room.isPrivate) this._broadcastLobby();
      return;
    }
    const opp = client === room.players[0] ? room.players[1] : room.players[0];
    if (opp) opp.send({ t: 'peer-left' });
    for (const sp of room.spectators) sp.send({ t: 'room-closed' });
    const wasPublic = !room.isPrivate;
    this.rooms.delete(code);
    if (wasPublic) this._broadcastLobby();
  }
```

- [ ] **Step 4: Run full server suite** — `npx vitest run tests/rooms.test.mjs` → 全部 PASS。

- [ ] **Step 5: Commit**
```bash
git add server/rooms.mjs tests/rooms.test.mjs
git commit -m "feat(server): 离开处理区分玩家/观战者 + room-closed + 大厅广播"
```

> 说明：`server/server.mjs` 无需改动——新消息类型都走 `reg.handle`，断开走 `reg.leave`；relay 模型全在 rooms.mjs。

---

### Task 7: online.ts — 客户端协议重构（常驻连接 + 新消息 + 派发钩子）

**Files:** Modify `src/ui/online.ts`；Test `tests/online-url.test.ts`（新建，测纯函数 `deriveWsUrl`）

**Interfaces:**
- Produces：扩展后的 `OnlineMsg`、`LobbyRoom`；`OnlineSession`：`connect(onReady)`、`hello(nick)`、`rename(nick)`、`subscribeLobby()`、`createRoom(isPrivate)`、`joinRoom(code)`、`spectate(code)`、`send/close/available/onMessage/onState`。一条连接贯穿大厅+对局+观战。被 Task 9 消费。

- [ ] **Step 1: Write the test** — `tests/online-url.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { deriveWsUrl } from '../src/ui/online';

describe('deriveWsUrl', () => {
  it('https→wss、http→ws、file→空', () => {
    expect(deriveWsUrl({ protocol: 'https:', host: 'x:8443' } as Location)).toBe('wss://x:8443/ws');
    expect(deriveWsUrl({ protocol: 'http:', host: 'x:8080' } as Location)).toBe('ws://x:8080/ws');
    expect(deriveWsUrl({ protocol: 'file:', host: '' } as Location)).toBe('');
  });
});
```

- [ ] **Step 2: Run（回归守卫）** — `npx vitest run tests/online-url.test.ts` → 重写后应 PASS。

- [ ] **Step 3: Implement（重写 online.ts 全文）**：
```ts
export type LobbyRoom = { code: string; host: string; status: 'waiting' | 'playing'; players: [string, string] | null; spectators: number };
export type OnlineMsg =
  | { t: 'hello'; nick: string } | { t: 'rename'; nick: string }
  | { t: 'hello-ok' } | { t: 'rename-ok' } | { t: 'nick-taken' }
  | { t: 'lobby' } | { t: 'lobby'; rooms: LobbyRoom[] }
  | { t: 'create'; isPrivate: boolean } | { t: 'created'; code: string; isPrivate: boolean }
  | { t: 'join'; code: string } | { t: 'paired'; color: 'red' | 'black'; you: string; opponent: string }
  | { t: 'spectate'; code: string } | { t: 'spectating'; host: string; players: [string, string] }
  | { t: 'need-sync' } | { t: 'sync'; pgn: string }
  | { t: 'error'; msg: string } | { t: 'peer-left' } | { t: 'room-closed' }
  | { t: 'move'; iccs: string } | { t: 'resign' }
  | { t: 'draw-offer' } | { t: 'draw-accept' } | { t: 'draw-decline' }
  | { t: 'undo-request' } | { t: 'undo-accept' } | { t: 'undo-decline' };

export type OnlineState = 'idle' | 'connecting' | 'open' | 'closed';

// 同源 WS 地址：http→ws、https→wss；file:// 无 host → 空（联机不可用）
export function deriveWsUrl(loc: Pick<Location, 'protocol' | 'host'>): string {
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return '';
  return (loc.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + loc.host + '/ws';
}

export class OnlineSession {
  private ws: WebSocket | null = null;
  onMessage: (m: OnlineMsg) => void = () => {};
  onState: (s: OnlineState) => void = () => {};

  available(): boolean { return deriveWsUrl(location) !== ''; }

  connect(onReady: () => void): void {
    const url = deriveWsUrl(location);
    if (!url) { this.onState('closed'); return; }
    this.onState('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.onState('open'); onReady(); };
    ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data) as OnlineMsg); } catch { /* 忽略坏包 */ } };
    ws.onclose = () => this.onState('closed');
    ws.onerror = () => this.onState('closed');
  }
  hello(nick: string): void { this.send({ t: 'hello', nick }); }
  rename(nick: string): void { this.send({ t: 'rename', nick }); }
  subscribeLobby(): void { this.send({ t: 'lobby' }); }
  createRoom(isPrivate: boolean): void { this.send({ t: 'create', isPrivate }); }
  joinRoom(code: string): void { this.send({ t: 'join', code }); }
  spectate(code: string): void { this.send({ t: 'spectate', code }); }
  send(m: OnlineMsg): void { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  close(): void { this.ws?.close(); this.ws = null; }
}
```

- [ ] **Step 4: Run test** — `npx vitest run tests/online-url.test.ts` → PASS。（项目级 `npm run typecheck` 此刻 main.ts 会红——预期，Task 9 修复后整体绿；本步只验证 online-url 测试与 online.ts 自身。）

- [ ] **Step 5: Commit**
```bash
git add src/ui/online.ts tests/online-url.test.ts
git commit -m "feat(online): 协议重构——常驻连接 + 大厅/昵称/观战消息 + 派发钩子"
```

---

### Task 8: index.html + style.css — 大厅/昵称/观战 UI 标记

**Files:** Modify `index.html`（替换 `#online-panel` 内部）、`src/ui/style.css`（追加样式）

**Interfaces:** Produces 新 DOM id：`#o-gate/#o-nick-input/#o-enter/#o-gate-msg`、`#o-lobby/#o-me-nick/#o-rename/#o-create/#o-private/#o-room-list/#o-code-input/#o-code-submit/#o-status`、`#o-spectate-banner`、`#o-exit`。保留 `#online-actions/#online-offer`。

- [ ] **Step 1: 替换 index.html 第 109–121 行的 `#online-panel`**：
```html
        <div class="online-panel" id="online-panel" hidden>
          <div class="o-gate" id="o-gate">
            <label for="o-nick-input">你的昵称</label>
            <input id="o-nick-input" class="num" maxlength="12" placeholder="输入昵称" style="width:140px" />
            <button id="o-enter" class="btn btn-primary">进入</button>
            <span class="o-gate-msg" id="o-gate-msg"></span>
          </div>
          <div class="o-lobby" id="o-lobby" hidden>
            <div class="o-me">我：<b id="o-me-nick"></b> <button id="o-rename" class="btn">改名</button></div>
            <div class="online-row">
              <button id="o-create" class="btn btn-primary">创建房间</button>
              <label class="o-private"><input type="checkbox" id="o-private" /> 私密房（不进大厅，仅凭码加入）</label>
              <button id="o-exit" class="btn">退出联机</button>
            </div>
            <div class="o-room-list" id="o-room-list"></div>
            <div class="online-code-in">
              或 输房间码加入：<input id="o-code-input" class="num" maxlength="6" placeholder="房间码" style="width:120px" />
              <button id="o-code-submit" class="btn">加入</button>
            </div>
            <div class="online-status" id="o-status"></div>
          </div>
          <div class="o-spectate-banner" id="o-spectate-banner" hidden></div>
        </div>
```

- [ ] **Step 2: 追加 style.css 末尾**：
```css
.o-gate { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.o-gate-msg { color: var(--cinnabar-soft); font-size: 13px; }
.o-me { margin-bottom: 8px; font-size: 14px; color: var(--paper-dim); }
.o-me b { color: var(--gold); }
.o-private { font-size: 13px; color: var(--paper-dim); display: inline-flex; align-items: center; gap: 4px; }
.o-room-list { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.o-room-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 12px; background: var(--stage-2); border: 1px solid var(--line); border-radius: 8px; font-size: 14px; }
.o-room-row .o-room-info { color: var(--paper); }
.o-room-row .o-room-sub { color: var(--paper-dim); font-size: 12px; margin-left: 6px; }
.o-room-empty { color: var(--paper-dim); font-size: 13px; text-align: center; padding: 12px; }
.o-spectate-banner { color: var(--gold); font-size: 14px; padding: 8px 0; }
```

- [ ] **Step 3: 构建验证** — `npm run build` → `dist/index.html` 成功（按钮尚未接线）。

- [ ] **Step 4: Commit**
```bash
git add index.html src/ui/style.css
git commit -m "feat(ui): 联机面板改为 输名字关 + 大厅列表 + 私密房 + 观战横幅 标记"
```

---

### Task 9: main.ts — 联机流程接线（昵称关/大厅/建·加·观战/观战只读/对局昵称）

**Files:** Modify `src/ui/main.ts`

**Interfaces:** Consumes Task 7 `OnlineSession`/`LobbyRoom`、Task 8 DOM id、`persist.loadNick/saveNick/defaultNick`、`gameToPgn/pgnToGame`、`controller.getGame/loadGame/applyExternalMove`。Produces 完整联机交互 + `isSpectating()` 守卫。

- [ ] **Step 1: import + 元素引用 + 状态**

main.ts 顶部：persist 的 import 补 `loadNick, saveNick, defaultNick`；新增 `import { gameToPgn, pgnToGame } from '../engine/pgn';`（与现有 pgn import 合并）；`import type { OnlineMsg } from './online';` 改为 `import type { OnlineMsg, LobbyRoom } from './online';`。

替换第 92–111 行旧 online 元素引用：
```ts
const onlineBtn = document.getElementById('online') as HTMLButtonElement;
const onlinePanel = document.getElementById('online-panel') as HTMLDivElement;
const oGate = document.getElementById('o-gate') as HTMLDivElement;
const oNickInput = document.getElementById('o-nick-input') as HTMLInputElement;
const oEnter = document.getElementById('o-enter') as HTMLButtonElement;
const oGateMsg = document.getElementById('o-gate-msg') as HTMLSpanElement;
const oLobby = document.getElementById('o-lobby') as HTMLDivElement;
const oMeNick = document.getElementById('o-me-nick') as HTMLElement;
const oRename = document.getElementById('o-rename') as HTMLButtonElement;
const oCreate = document.getElementById('o-create') as HTMLButtonElement;
const oPrivate = document.getElementById('o-private') as HTMLInputElement;
const oRoomList = document.getElementById('o-room-list') as HTMLDivElement;
const oCodeInput = document.getElementById('o-code-input') as HTMLInputElement;
const oCodeSubmit = document.getElementById('o-code-submit') as HTMLButtonElement;
const oStatus = document.getElementById('o-status') as HTMLDivElement;
const oExit = document.getElementById('o-exit') as HTMLButtonElement;
const oSpectateBanner = document.getElementById('o-spectate-banner') as HTMLDivElement;
const onlineActions = document.getElementById('online-actions') as HTMLDivElement;
const oResign = document.getElementById('o-resign') as HTMLButtonElement;
const oDraw = document.getElementById('o-draw') as HTMLButtonElement;
const oUndo = document.getElementById('o-undo') as HTMLButtonElement;
const onlineOffer = document.getElementById('online-offer') as HTMLDivElement;
const oOfferText = document.getElementById('o-offer-text') as HTMLSpanElement;
const oAccept = document.getElementById('o-accept') as HTMLButtonElement;
const oDecline = document.getElementById('o-decline') as HTMLButtonElement;
```
替换第 130–133 行状态：
```ts
let online: OnlineSession | null = null;
let onlineColor: Color | null = null;
let onlineResult: string | null = null;
let pendingOffer: 'draw' | 'undo' | null = null;
let spectating = false;
let myNick = '';
let oppNick = '';
let redNick = '', blackNick = '';
```

- [ ] **Step 2: 重写 enter/exit + 大厅渲染 + 派发**

替换第 396–457 行（`isOnline` … `onOnlineMsg` 整段）：
```ts
function isOnline() { return online !== null && onlineColor !== null; }
function isSpectating() { return online !== null && spectating; }

function enterOnline() {
  if (busy()) return;
  const probe = new OnlineSession();
  onlinePanel.hidden = false;
  (document.querySelector('.controls') as HTMLElement).hidden = true;
  bookLine.hidden = true; clocksEl.hidden = true; stopClockTimer();
  onlineActions.hidden = true; onlineOffer.hidden = true; oSpectateBanner.hidden = true;
  if (!probe.available()) {
    oGate.hidden = true; oLobby.hidden = true;
    oStatus.textContent = '联机需通过服务器网址访问（当前为本地文件）';
    oStatus.hidden = false;
    return;
  }
  oLobby.hidden = true; oGate.hidden = false; oGateMsg.textContent = '';
  oNickInput.value = loadNick() || defaultNick();
  oNickInput.focus();
}

function exitOnline() {
  online?.close(); online = null; onlineColor = null; onlineResult = null; pendingOffer = null;
  spectating = false; redNick = blackNick = oppNick = '';
  onlinePanel.hidden = true; onlineActions.hidden = true; onlineOffer.hidden = true; oSpectateBanner.hidden = true;
  (document.querySelector('.controls') as HTMLElement).hidden = false;
  if (clock) { clocksEl.hidden = false; renderClocks(); startClockTimer(); }
  controller.reset(); refresh();
}

function submitNick() {
  const nick = oNickInput.value.trim();
  if (!nick) { oGateMsg.textContent = '请输入昵称'; return; }
  myNick = nick;
  if (!online) {
    online = new OnlineSession();
    online.onState = (st) => {
      if (st === 'closed') {
        if (isOnline()) { onlineResult = '连接已断'; onlineActions.hidden = true; updateStatus(); }
        else if (isSpectating()) { oSpectateBanner.textContent = '连接已断'; }
      } else if (st === 'connecting') oGateMsg.textContent = '连接中…';
    };
    online.onMessage = onOnlineMsg;
    online.connect(() => online!.hello(myNick));
  } else {
    online.hello(myNick);
  }
}

function enterLobby() {
  saveNick(myNick);
  oGate.hidden = true; oLobby.hidden = false;
  oMeNick.textContent = myNick;
  oStatus.textContent = '';
  online!.subscribeLobby();
}

function escapeHtml(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

function renderLobby(rooms: LobbyRoom[]) {
  oRoomList.innerHTML = '';
  if (!rooms.length) { oRoomList.innerHTML = '<div class="o-room-empty">暂无房间，点上面「创建房间」开一个</div>'; return; }
  for (const r of rooms) {
    const row = document.createElement('div'); row.className = 'o-room-row';
    const info = document.createElement('span'); info.className = 'o-room-info';
    const btn = document.createElement('button'); btn.className = 'btn';
    if (r.status === 'waiting') {
      info.innerHTML = `「${escapeHtml(r.host)}」的房间 <span class="o-room-sub">等待中</span>`;
      btn.textContent = '加入'; btn.classList.add('btn-primary');
      btn.onclick = () => { online!.joinRoom(r.code); };
    } else {
      const p = r.players || ['?', '?'];
      info.innerHTML = `${escapeHtml(p[0])} vs ${escapeHtml(p[1])} <span class="o-room-sub">观战 ${r.spectators}</span>`;
      btn.textContent = '观战';
      btn.onclick = () => { online!.spectate(r.code); };
    }
    row.appendChild(info); row.appendChild(btn); oRoomList.appendChild(row);
  }
}

function onOnlineMsg(m: OnlineMsg) {
  switch (m.t) {
    case 'hello-ok': enterLobby(); break;
    case 'rename-ok': myNick = oNickInput.value.trim() || myNick; oMeNick.textContent = myNick; saveNick(myNick); break;
    case 'nick-taken':
      if (oLobby.hidden) { oGateMsg.textContent = '该昵称已被占用，换一个'; oNickInput.focus(); }
      else { oStatus.textContent = '该昵称已被占用，改名失败'; }
      break;
    case 'lobby': renderLobby(m.rooms); break;
    case 'created':
      onlineColor = 'red'; redNick = myNick; blackNick = '';
      oStatus.textContent = m.isPrivate ? `私密房已建，房间码 ${m.code}（发给对方加入）` : '房间已建，在大厅等待对手加入…';
      break;
    case 'paired':
      onlineColor = m.color; onlineResult = null; pendingOffer = null; spectating = false;
      oppNick = m.opponent; redNick = m.color === 'red' ? m.you : m.opponent; blackNick = m.color === 'red' ? m.opponent : m.you;
      controller.reset();
      oLobby.hidden = true; onlineActions.hidden = false;
      refresh();
      break;
    case 'spectating':
      spectating = true; onlineColor = null;
      redNick = m.players[0]; blackNick = m.players[1];
      oLobby.hidden = true; oSpectateBanner.hidden = false;
      oSpectateBanner.textContent = `观战中 · 红 ${redNick} vs 黑 ${blackNick}（同步中…）`;
      break;
    case 'need-sync':
      online!.send({ t: 'sync', pgn: gameToPgn(controller.getGame(), {}) });
      break;
    case 'sync':
      try { controller.loadGame(pgnToGame(m.pgn)); refresh(); oSpectateBanner.textContent = `观战中 · 红 ${redNick} vs 黑 ${blackNick}`; }
      catch { oSpectateBanner.textContent = '同步失败，请退出重试'; }
      break;
    case 'error': oStatus.textContent = m.msg; break;
    case 'peer-left': onlineResult = '对方已断线'; onlineActions.hidden = true; updateStatus(); break;
    case 'room-closed': oSpectateBanner.textContent = '该对局已结束/中断'; break;
    case 'move': {
      const mv = iccsToMove(m.iccs);
      const ok = controller.applyExternalMove(mv);
      if (ok && controller.lastMove) playMoveAnimation(controller.lastMove, refresh); else refresh();
      break;
    }
    case 'resign':
      if (isSpectating()) oSpectateBanner.textContent = '观战 · 一方认输';
      else { onlineResult = '对方认输，你赢了'; onlineActions.hidden = true; updateStatus(); }
      break;
    case 'draw-offer': if (!isSpectating()) { pendingOffer = 'draw'; oOfferText.textContent = '对方求和'; onlineOffer.hidden = false; } break;
    case 'draw-accept':
      if (isSpectating()) oSpectateBanner.textContent = '观战 · 双方和棋';
      else { onlineResult = '和棋（对方接受求和）'; onlineActions.hidden = true; onlineOffer.hidden = true; pendingOffer = null; updateStatus(); }
      break;
    case 'draw-decline': if (!isSpectating()) oStatus.textContent = '对方拒绝求和'; break;
    case 'undo-request': if (!isSpectating()) { pendingOffer = 'undo'; oOfferText.textContent = '对方请求悔棋'; onlineOffer.hidden = false; } break;
    case 'undo-accept': onlineOffer.hidden = true; pendingOffer = null; controller.undo(); controller.undo(); refresh(); break;
    case 'undo-decline': if (!isSpectating()) oStatus.textContent = '对方拒绝悔棋'; break;
  }
}
```

- [ ] **Step 3: 点击守卫 + 对局昵称**

第 460 行点击守卫加 `isSpectating()`：
```ts
  if (browsing || inEndgame || isSpectating() || (isOnline() && (onlineResult || controller.turn !== onlineColor))) return;
```
`updateStatus()` 第 193 行 `turnTextEl.textContent = checking ? ...` 之后补：
```ts
  if ((isOnline() || isSpectating()) && redNick) {
    turnTextEl.textContent += `（红 ${redNick} / 黑 ${blackNick}）`;
  }
```

- [ ] **Step 4: 重写事件绑定**

替换第 602–621 行旧 online 绑定：
```ts
onlineBtn.addEventListener('click', () => { if (busy()) return; if (onlinePanel.hidden) enterOnline(); else exitOnline(); });
oEnter.addEventListener('click', submitNick);
oNickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitNick(); });
oRename.addEventListener('click', () => { const n = prompt('改昵称', myNick); if (!n) return; oNickInput.value = n.trim(); online?.rename(n.trim()); });
oCreate.addEventListener('click', () => { online?.createRoom(oPrivate.checked); });
oCodeSubmit.addEventListener('click', () => { const c = oCodeInput.value.trim().toUpperCase(); if (c) online?.joinRoom(c); });
oExit.addEventListener('click', exitOnline);
oResign.addEventListener('click', () => { if (!isOnline()) return; online!.send({ t: 'resign' }); onlineResult = '你已认输'; onlineActions.hidden = true; updateStatus(); });
oDraw.addEventListener('click', () => { if (isOnline()) { online!.send({ t: 'draw-offer' }); oStatus.textContent = '已发出求和，等待对方'; } });
oUndo.addEventListener('click', () => { if (isOnline()) { online!.send({ t: 'undo-request' }); oStatus.textContent = '已请求悔棋，等待对方'; } });
oAccept.addEventListener('click', () => {
  onlineOffer.hidden = true;
  if (pendingOffer === 'draw') { online!.send({ t: 'draw-accept' }); onlineResult = '和棋'; onlineActions.hidden = true; updateStatus(); }
  else if (pendingOffer === 'undo') { online!.send({ t: 'undo-accept' }); controller.undo(); controller.undo(); refresh(); }
  pendingOffer = null;
});
oDecline.addEventListener('click', () => {
  onlineOffer.hidden = true;
  if (pendingOffer === 'draw') online!.send({ t: 'draw-decline' });
  else if (pendingOffer === 'undo') online!.send({ t: 'undo-decline' });
  pendingOffer = null;
});
```

- [ ] **Step 5: typecheck + build + test** — `npm run typecheck && npm test && npm run build` → 全绿、构建成功。

- [ ] **Step 6: Commit**
```bash
git add src/ui/main.ts
git commit -m "feat(ui): 联机接线——昵称关/大厅渲染/建·加·观战/观战只读/对局昵称"
```

---

### Task 10: 三页端到端冒烟 + 截图 + 部署

**Files:** 临时脚本 `_e2e.mjs`（跑完删）；无源码改动（除非冒烟暴露 bug）

**Interfaces:** Consumes 构建好的 `dist/index.html` + `server/`；Playwright + 系统 Chrome（见记忆 `xiangqi UI 真机冒烟打法`：`channel:'chrome'`、`--no-save`、`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`）。

- [ ] **Step 1: 起 server** — `npm run build && PORT=8127 node server/server.mjs &`（无 CERT_DIR→http；记 PID 收尾 kill）。

- [ ] **Step 2: 写 `_e2e.mjs`（项目根，确保能 resolve node_modules/playwright）**

覆盖：A 设名「甲」建公开房 → B 设名「乙」大厅见「甲」的房并加入 → 双方 paired 互见昵称、A 走子 B 同步 → C 设名「丙」观战该房、收 sync 后局面一致、A 再走子 C 跟进（`#board` 截图比对前后变化）→ 撞名（D 用「甲」→ `#o-gate-msg` 含"已被占用"）→ A 建私密房 → C 大厅看不到。各页 `chromium.launch({ channel: 'chrome' })`、`page.goto('http://localhost:8127')`，用 `#o-room-list` / `#o-spectate-banner` / `#o-gate-msg` 文本断言；结尾各页 `#board` 截图 `/tmp/xq-lobby-{a,b,c}.png`。

- [ ] **Step 3: 跑冒烟** — `node _e2e.mjs && rm -f _e2e.mjs` → 全断言通过、零 console error、出截图。
失败则按 `superpowers:systematic-debugging` 定位（多在 main.ts 派发或 rooms 边界），修对应任务代码 + 补单测，再跑。

- [ ] **Step 4: 截图交 owner** — `kill %1`；把 `/tmp/xq-lobby-*.png` 发 owner 看大厅/观战/对局昵称。owner 点头后继续。

- [ ] **Step 5: 文档 + 提交 + 部署 + 公网实测**

更新 `SPEC.md` C 段（房间码→大厅、加昵称/观战/私密房；账号/落盘仍非目标）与 `CLAUDE.md`（如有结构变化）。
```bash
git add -A && git commit -m "feat: 联机大厅+昵称+观战+私密房 完成（三页 E2E 通过）"
```
合并/部署/推送按既有流程（部署 dist+server 到服务器重启；推 GitHub 需 owner 授权，用 gh 凭据助手）。公网三浏览器实测：大厅配对 + 观战 + 撞名 + 私密房。

---

## Self-Review

**Spec coverage：** hello/rename 判重→T2；释放→T2/T6；房间结构+create(isPrivate)+join(you/opponent)+relay+leave→T3；大厅订阅/快照/广播→T4；观战+need-sync/sync+1→N→T5；玩家/观战者离开+room-closed→T6；前端常驻连接→T7；输名字关 UI+大厅+私密+观战横幅→T8/T9；观战只读+对局昵称→T9；三页 E2E+截图+公网实测→T10；既有功能不回归→T9 Step5 `npm test`+build、T10 冒烟；服务器不落盘/不懂棋规→全 server 任务遵守。

**每次提交都绿（关键）：** T2 仅追加昵称（旧房间逻辑不动）→绿；T3 一次性迁移房间结构 + create/join/relay/leave 并同步更新这 4 个用例→绿；T4/T5/T6 在最终结构上叠加→绿。T7 后 main.ts 在 T9 修复前项目级 typecheck 会红（已注明，T7 只验 online-url 测试）。

**Placeholder scan：** 无 TBD/“类似上文”；每个 step 含完整代码/命令。

**Type consistency：** `LobbyRoom`(T7) ↔ `_snapshot()`(T4) 字段一致；`paired{color,you,opponent}`、`created{code,isPrivate}`、`spectating{host,players}`、`sync{pgn}` 各处一致；`gameToPgn(game,{})`/`pgnToGame(text)`、`controller.getGame/loadGame` 与现有签名一致。

**已知风险：** ① main.ts 行号随编辑漂移——按锚点代码段定位而非死记行号。② `gameToPgn` 第二参为 opts（现有 `saveGame` 用 `{date:today()}`），观战 sync 用 `{}`。③ rename 在房间等待中时大厅 host 名不即时刷新（仅注册集更新）——可接受小限制，spec 已注明改名宜在建房前。
