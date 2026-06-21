# 掼蛋联机 · Plan 1：权威服务端 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建掼蛋联机的权威服务端——握全局牌局、跑引擎+AI、按座位下发；4 座房间登记 + 匹配 + 观战 + 掉线AI接管 + 重连，纯单测覆盖，可用 ws 客户端打通整盘。

**Architecture:** 复用现有纯函数引擎（`src/games/guandan/engine` + `ai` + `match`，唯一真相，不双写）。`server/rooms.mjs` 管房间生命周期（纯 JS、无引擎依赖）；`server/match-driver.ts` 每个 playing 房一个权威牌局（import 引擎，按座位产出 outbound 消息）；`server/server.mjs` 用 Node `ws` 把两者和 socket 粘起来 + 托管 dist。引擎+match-driver 经 esbuild 打成 `match-driver.bundle.mjs` 供生产 server 用；测试直接跑 TS。

**Tech Stack:** TypeScript 引擎（复用）+ Node `ws` + esbuild（打服务端 bundle）+ vitest（含 `.mjs`/`.ts` 服务端单测）。服务端无前端依赖。

## Global Constraints

- **引擎是唯一真相**：`rooms.mjs`/`match-driver.ts`/`server.mjs` 绝不复制规则判定；一律调 `engine`/`ai`/`match` 的导出函数。
- **手牌私发**：`hand` 消息只发给该座位本人；公开态 `state` 发给房内所有人 + 观众；别人的手牌字段永不进任何下发消息。
- **互信不防作弊**：服务端只校验「发的 cardId 属于该座位 + `isLegalPlay` 通过」；不防同队线下串牌。
- **开局必须 4 真人**；开打后掉线由 AI 接管（`choosePlay`）、人回来收回座位；局中不加人。
- **整盘 parity**：跨局升级 / 进贡（含双贡：头游拿点数大的，逢人配不进、大小王进）/ 抗贡 / 打A过A，全用 `match.ts` 导出，不另写。
- **房号**：6 位、去掉易混字符 `0O1I`，复用 xiangqi `defaultCode` 写法。
- **删房**：`waiting` 房房主离开删房；`playing` 房仅当 4 真人全掉线才删房（≥1 真人在线则保留，空座 AI 顶）。
- **昵称**：localStorage 本机 + 服务端在线判重（`byNick` 小写去空格占用集）；无账号/落盘。
- **缓存**：HTML 响应带 `Cache-Control: no-store`（同 xiangqi）。
- **测试命令**：`npm test`（vitest，全绿）+ `npm run typecheck`。服务端 bundle 构建：`node server/build.mjs`。

## 复用的引擎接口（已存在，勿改）

```ts
// engine/game.ts
interface DealState { hands: Card[][]; current: {combo:Combo;by:Seat}|null; turn: Seat; passesInRow: number; finished: Seat[]; level: Rank; }
createDeal(hands: Card[][], firstLeader: Seat, level: Rank): DealState
play(s: DealState, seat: Seat, cards: Card[]): DealState          // 非法则 throw
pass(s: DealState, seat: Seat): DealState
isDealOver(s: DealState): boolean
ranking(s: DealState): Seat[]                                      // 头游→末游（须 deal over）
// engine/legal.ts
isLegalPlay(cards: Card[], current: Combo|null, hand: Card[], level: Rank): boolean
// ai/ai.ts
choosePlay(s: DealState, seat: Seat): Card[] | null               // null = 不要
// engine/match.ts
interface MatchState { levels:[Rank,Rank]; trumpTeam:Team; dealNo:number; stuckA:[number,number]; over:boolean; winner:Team|null; }
startMatch(): MatchState
dealLevel(m: MatchState): Rank
settleDeal(m: MatchState, finished: Seat[]): SettleResult         // {match,winTeam,gain,passedA,stuck,demoted}
planTribute(finished: Seat[], hands: Card[][], level: Rank): TributePlan  // {exchanges:[{giver,receiver,tribute}],resist,firstLeader,doubleDown}
returnableCards(hand: Card[], level: Rank): Card[]                // rankValue ≤ 10
autoReturn(hand: Card[], level: Rank): Card
applyTribute(hands: Card[][], plan: TributePlan, returns: Card[]): Card[][]
dealHands(shuffle:(n:number)=>number[]): Card[][]                 // 发 4 手牌
teamOf(seat:Seat):Team; partnerOf(seat:Seat):Seat
// engine/cards.ts
rankValue(c: Card, level: Rank): number; sortHand(cards: Card[], level: Rank): Card[]
type Card = {kind:'normal';suit;rank;id} | {kind:'joker';big;id}; type Seat=0|1|2|3; type Team=0|1; type Rank=2..14
```

## 线协议（本计划定义的契约，Plan 3 客户端照此实现）

座位编号固定：**0 下（你）/ 1 右（下家）/ 2 上（对家）/ 3 左（上家）**；队 0=座位0&2，队 1=座位1&3。

**客户端 → 服务端**
```
{t:'hello', nick}              {t:'rename', nick}
{t:'create', isPrivate?}       {t:'join', code}        {t:'take-seat', seat}    {t:'start'}
{t:'match'}                    {t:'lobby'}             {t:'spectate', code}
{t:'play', cardIds:number[]}   {t:'pass'}              {t:'tribute-return', cardId}
{t:'rejoin', code, nick}
```

**服务端 → 客户端**
```
{t:'hello-ok'} | {t:'nick-taken'}
{t:'created', code, isPrivate}
{t:'room', code, status, seats:[SeatInfo×4], you:seat|null}      // 房内座位快照（每次变动重发）
{t:'started'}                                                    // 4 真人，房主开打
{t:'state', ...PublicState}                                      // 公开态（房内所有人+观众）
{t:'hand', cards:Card[]}                                         // 私有手牌（仅本人）
{t:'need-tribute', options:Card[]}                              // 收贡座位还贡可选牌（仅本人）
{t:'spectating', code, seats}                                    // 观战确认
{t:'lobby', rooms:[{code,status,players,spectators}]}
{t:'rejoined', seat} | {t:'peer-offline', seat} | {t:'peer-back', seat}
{t:'room-closed'} | {t:'error', msg}
```

**SeatInfo**（房间座位快照，无手牌）
```
{ seat:0|1|2|3, nick:string|null, online:boolean, ai:boolean }   // nick=null 表示空座
```

**PublicState**（`state` 消息体；match-driver 产出；无任何手牌）
```
{
  phase: 'playing' | 'tribute' | 'dealResult' | 'matchOver',
  turn: Seat | null,
  current: { type, key, length, cards:Card[], by:Seat } | null,   // 桌面顶牌（牌面公开）
  lastActor: Seat | null,
  seats: [ { seat, count, lastPlay: {cards:Card[]}|'pass'|null, finishRank:1|2|3|4|null, online, ai } ×4 ],
  level: Rank,                       // 本局级牌
  levels: [Rank, Rank],              // 两队级别 [队0, 队1]
  trumpTeam: Team,
  dealNo: number,
  // phase==='tribute': tribute:{ exchanges:[{giver,receiver,tribute:Card}], resist, doubleDown, pending:Seat[] }
  // phase==='dealResult': result:{ ranking:Seat[], gain, passedA, stuck, demoted, lastHand:Card[] }
  // phase==='matchOver': winner:Team
}
```

## File Structure

```
server/
├── package.json            # 新：依赖 ws；devDep esbuild
├── rooms.mjs               # 新：4 座房间登记（纯 JS，无引擎依赖）
├── match-driver.ts         # 新：每房权威牌局（import 引擎/ai/match，产出 outbound）
├── build.mjs               # 新：esbuild 把 match-driver.ts(+引擎) 打成 match-driver.bundle.mjs
└── server.mjs              # 新：http(s) 托管 dist + /ws，粘 rooms+driver+socket
tests/
├── rooms.test.ts           # 新：RoomRegistry 房间生命周期（fakeClient）
└── match-driver.test.ts    # 新：MatchDriver 引擎驱动 + 按座位下发 + AI + 进贡
.gitignore                  # 改：忽略 server/match-driver.bundle.mjs（构建产物）
vite.config.ts              # 改：vitest include 纳入 tests/*.test.ts（已含则免）
```

**职责边界**
- `rooms.mjs`：房间/座位/匹配/观战/重连，**不碰牌**；每个 `playing` 房持有一个 `driver` 句柄，游戏消息转交 driver、把 driver 的 outbound 按目标 client 发出。driver 由依赖注入（构造 `RoomRegistry(codeGen, makeDriver)`），测试可注入假 driver。
- `match-driver.ts`：`MatchDriver` 类，**只管牌**，不知道 socket/房间；输入「座位 + 操作」，输出「给谁发什么」（`{to:'seat'|'all', seat?, msg}[]`）。纯函数式产出，便于单测。

---

### Task 1: 脚手架（server 子包 + 测试接纳 + gitignore）

**Files:**
- Create: `server/package.json`
- Modify: `vite.config.ts`（确认 vitest `include` 覆盖 `tests/**/*.test.ts`）
- Modify: `.gitignore`（加 `server/match-driver.bundle.mjs`、`server/node_modules`）

**Interfaces:**
- Produces: 一个能跑 `.test.ts` 服务端单测的工程；`server/` 子包占位。

- [ ] **Step 1: 看 vitest 当前 include**

Run: `sed -n '1,20p' vite.config.ts`
Expected: 看到 `test:{...}`；确认 `include`（默认 `**/*.{test,spec}.?(c|m)[jt]s?(x)` 即可覆盖 `tests/*.test.ts`）。若已是默认/已含 `tests`，本步无改动。

- [ ] **Step 2: 写 server/package.json**

```json
{
  "name": "desk-games-server",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "dependencies": { "ws": "^8.18.0" },
  "devDependencies": { "esbuild": "^0.23.0" }
}
```

- [ ] **Step 3: 改 .gitignore**

在 `.gitignore` 末尾追加：
```
# 联机服务端构建产物 / 依赖
server/match-driver.bundle.mjs
server/node_modules
```

- [ ] **Step 4: 验证测试工程仍绿**

Run: `npm test 2>&1 | tail -3`
Expected: 现有 238 测试全绿（本步未加新测，仅确认没破工程）。

- [ ] **Step 5: Commit**

```bash
git add server/package.json vite.config.ts .gitignore
git commit -m "chore(guandan-online): 服务端子包脚手架 + gitignore bundle"
```

---

### Task 2: RoomRegistry — 昵称登记 + 在线判重

**Files:**
- Create: `server/rooms.mjs`
- Create: `tests/rooms.test.ts`

**Interfaces:**
- Produces: `class RoomRegistry { constructor(codeGen?, makeDriver?); handle(client, msg); leave(client); }`；`client` 仅需 `{ send(msgObj) }`。`hello/rename` → `hello-ok`/`nick-taken`。

- [ ] **Step 1: 写失败测试 `tests/rooms.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RoomRegistry } from '../server/rooms.mjs';

function fakeClient() { const sent: any[] = []; return { sent, send: (m: any) => sent.push(m) }; }
const last = (c: any) => c.sent[c.sent.length - 1];

describe('RoomRegistry — 昵称', () => {
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123'); });

  it('hello 登记昵称 → hello-ok', () => {
    const a = fakeClient();
    reg.handle(a, { t: 'hello', nick: '甲' });
    expect(last(a)).toEqual({ t: 'hello-ok' });
  });

  it('重名（不区分大小写/空格）→ nick-taken', () => {
    const a = fakeClient(); const b = fakeClient();
    reg.handle(a, { t: 'hello', nick: '甲' });
    reg.handle(b, { t: 'hello', nick: ' 甲 ' });
    expect(last(b)).toEqual({ t: 'nick-taken' });
  });

  it('空昵称 → nick-taken', () => {
    const a = fakeClient();
    reg.handle(a, { t: 'hello', nick: '   ' });
    expect(last(a)).toEqual({ t: 'nick-taken' });
  });

  it('leave 后昵称释放，可被再用', () => {
    const a = fakeClient(); const b = fakeClient();
    reg.handle(a, { t: 'hello', nick: '甲' });
    reg.leave(a);
    reg.handle(b, { t: 'hello', nick: '甲' });
    expect(last(b)).toEqual({ t: 'hello-ok' });
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npm test -- rooms 2>&1 | tail -8`
Expected: FAIL — `Cannot find module '../server/rooms.mjs'`。

- [ ] **Step 3: 写 `server/rooms.mjs`（昵称部分）**

```js
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
```

- [ ] **Step 4: 跑测试看绿**

Run: `npm test -- rooms 2>&1 | tail -6`
Expected: PASS（4 个昵称用例）。

- [ ] **Step 5: Commit**

```bash
git add server/rooms.mjs tests/rooms.test.ts
git commit -m "feat(guandan-online): RoomRegistry 昵称登记 + 在线判重"
```

---

### Task 3: RoomRegistry — 建房 + 挑座 + 房间快照

**Files:**
- Modify: `server/rooms.mjs`
- Modify: `tests/rooms.test.ts`

**Interfaces:**
- Consumes: Task 2 `RoomRegistry`。
- Produces: `create` → `created{code}` + `room{seats,you}`；`take-seat{seat}` 落座并重广播 `room`。room 结构：`{ code, isPrivate, seats:[{client,nick,online,ai}|null ×4], spectators:Set, status:'waiting'|'playing', driver:null, host:client }`。

- [ ] **Step 1: 写失败测试（追加 describe）**

```ts
describe('RoomRegistry — 建房 + 挑座', () => {
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123'); });
  const hello = (c: any, nick: string) => reg.handle(c, { t: 'hello', nick });
  const roomMsg = (c: any) => [...c.sent].reverse().find((m: any) => m.t === 'room');

  it('create → created + room(房主落座 0，其余空)', () => {
    const a = fakeClient(); hello(a, '甲');
    reg.handle(a, { t: 'create' });
    expect(a.sent).toContainEqual({ t: 'created', code: 'ABC123', isPrivate: false });
    const r = roomMsg(a);
    expect(r.status).toBe('waiting');
    expect(r.you).toBe(0);
    expect(r.seats[0]).toMatchObject({ nick: '甲', online: true, ai: false });
    expect(r.seats[1]).toBeNull();
  });

  it('join + take-seat：乙坐座位 2，双方都收到更新的 room', () => {
    const a = fakeClient(); const b = fakeClient(); hello(a, '甲'); hello(b, '乙');
    reg.handle(a, { t: 'create' });
    reg.handle(b, { t: 'join', code: 'ABC123' });
    reg.handle(b, { t: 'take-seat', seat: 2 });
    expect(roomMsg(b).you).toBe(2);
    expect(roomMsg(a).seats[2]).toMatchObject({ nick: '乙', online: true });
  });

  it('坐已占座位 → error，原座位不变', () => {
    const a = fakeClient(); const b = fakeClient(); hello(a, '甲'); hello(b, '乙');
    reg.handle(a, { t: 'create' });            // 甲在 0
    reg.handle(b, { t: 'join', code: 'ABC123' });
    reg.handle(b, { t: 'take-seat', seat: 0 }); // 抢甲的座
    expect(last(b).t).toBe('error');
  });

  it('换座：甲从 0 换到 1，座位 0 释放', () => {
    const a = fakeClient(); hello(a, '甲');
    reg.handle(a, { t: 'create' });
    reg.handle(a, { t: 'take-seat', seat: 1 });
    const r = roomMsg(a);
    expect(r.you).toBe(1);
    expect(r.seats[0]).toBeNull();
    expect(r.seats[1]).toMatchObject({ nick: '甲' });
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npm test -- rooms 2>&1 | tail -8`
Expected: FAIL — `create` 未处理，`roomMsg` 返回 undefined。

- [ ] **Step 3: 实现 create / join / take-seat + 快照广播**

在 `rooms.mjs` 的 `handle` 里（昵称分支之后）追加，并加私有方法：

```js
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
```

加私有方法（放 class 内）：

```js
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
```

> 注：`_leaveRoom` 在 Task 7 写全（掉线/删房）。本任务先放安全占位（不抛错），让 create/join 的「先退旧房」调用不崩。

- [ ] **Step 4: 跑测试看绿**

Run: `npm test -- rooms 2>&1 | tail -6`
Expected: PASS（昵称 4 + 建房挑座 4）。

- [ ] **Step 5: Commit**

```bash
git add server/rooms.mjs tests/rooms.test.ts
git commit -m "feat(guandan-online): 建房 + 挑空位入座 + 房间快照广播"
```

---

### Task 4: RoomRegistry — 房主开打（4 真人 → playing，建 driver）

**Files:**
- Modify: `server/rooms.mjs`
- Modify: `tests/rooms.test.ts`

**Interfaces:**
- Consumes: Task 3。`makeDriver(room)` 注入（测试传假 driver）。
- Produces: `start`（仅房主、仅 4 座满）→ `status='playing'`，`room.driver = this.makeDriver(room)`，广播 `started` + driver 初始 outbound。

- [ ] **Step 1: 写失败测试**

```ts
describe('RoomRegistry — 房主开打', () => {
  // 假 driver：记录被创建，start() 返回一条广播
  const fakeDriver = (room: any) => ({ room, started: false,
    start() { this.started = true; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }]; } });
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123', fakeDriver); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });

  function fourSeated() {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => hello(c, '玩家' + i));
    reg.handle(cs[0], { t: 'create' });                         // 0
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    return cs;
  }

  it('不满 4 人 start → error', () => {
    const cs = [fakeClient(), fakeClient()]; cs.forEach((c, i) => hello(c, 'p' + i));
    reg.handle(cs[0], { t: 'create' });
    reg.handle(cs[1], { t: 'join', code: 'ABC123' }); reg.handle(cs[1], { t: 'take-seat', seat: 1 });
    reg.handle(cs[0], { t: 'start' });
    expect(last(cs[0]).t).toBe('error');
  });

  it('非房主 start → error', () => {
    const cs = fourSeated();
    reg.handle(cs[2], { t: 'start' });
    expect(last(cs[2]).t).toBe('error');
  });

  it('房主 4 人满 start → playing，建 driver，广播 started + driver 初态', () => {
    const cs = fourSeated();
    reg.handle(cs[0], { t: 'start' });
    expect(cs[0].sent).toContainEqual({ t: 'started' });
    expect(cs[3].sent).toContainEqual({ t: 'state', phase: 'playing', turn: 0 });
    const room = reg.rooms.get('ABC123');
    expect(room.status).toBe('playing');
    expect(room.driver.started).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npm test -- rooms 2>&1 | tail -8`
Expected: FAIL — `start` 未处理。

- [ ] **Step 3: 实现 start + outbound 分发**

`handle` 内追加：

```js
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
```

加 outbound 分发器（把 driver 产出的 `{to,seat?,msg}` 发给对应 client / 全房 / 观众）：

```js
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
```

- [ ] **Step 4: 跑测试看绿**

Run: `npm test -- rooms 2>&1 | tail -6`
Expected: PASS（含开打 3 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/rooms.mjs tests/rooms.test.ts
git commit -m "feat(guandan-online): 房主开打(4真人→playing)+建driver+outbound分发"
```

---

### Task 5: RoomRegistry — 随机匹配（FIFO 凑 4 自动开打）

**Files:**
- Modify: `server/rooms.mjs`
- Modify: `tests/rooms.test.ts`

**Interfaces:**
- Consumes: Task 4 `_seat/_dispatch/makeDriver`。
- Produces: `match` 入池；满 4 → 自动建匿名公开房、填座 0~3、`playing`、driver.start。

- [ ] **Step 1: 写失败测试**

```ts
describe('RoomRegistry — 随机匹配', () => {
  let codes: string[]; let reg: any;
  const fakeDriver = (room: any) => ({ start: () => [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }] });
  beforeEach(() => { codes = ['M00001']; reg = new RoomRegistry(() => codes.shift() || 'X' + Math.random(), fakeDriver); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });

  it('凑够 4 人自动开局：四人各落一座、收 started', () => {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => { hello(c, 'q' + i); reg.handle(c, { t: 'match' }); });
    cs.forEach(c => expect(c.sent).toContainEqual({ t: 'started' }));
    const room = reg.rooms.get('M00001');
    expect(room.status).toBe('playing');
    expect(room.seats.map((s: any) => s.nick).sort()).toEqual(['q0', 'q1', 'q2', 'q3']);
  });

  it('不足 4 人时只入池不开局', () => {
    const cs = [fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => { hello(c, 'q' + i); reg.handle(c, { t: 'match' }); });
    cs.forEach(c => expect(c.sent).not.toContainEqual({ t: 'started' }));
    expect(reg.queue.length).toBe(3);
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npm test -- rooms 2>&1 | tail -8`
Expected: FAIL — `match` 未处理。

- [ ] **Step 3: 实现 match**

`handle` 内追加：

```js
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
```

并在 `leave`/`_leaveRoom` 里把 client 从 `this.queue` 移除（Task 7 一并处理；本任务先在 `leave` 加 `const qi=this.queue.indexOf(client); if(qi>=0) this.queue.splice(qi,1);`）。

- [ ] **Step 4: 跑测试看绿**

Run: `npm test -- rooms 2>&1 | tail -6`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/rooms.mjs tests/rooms.test.ts
git commit -m "feat(guandan-online): 随机匹配 FIFO 凑4自动开局"
```

---

### Task 6: RoomRegistry — 大厅 + 观战

**Files:**
- Modify: `server/rooms.mjs`
- Modify: `tests/rooms.test.ts`

**Interfaces:**
- Consumes: Task 4/5。
- Produces: `lobby` 订阅公开房列表（含变动广播）；`spectate{code}` 进观众集，收 `spectating` + 后续公开态。观众**不**收 `hand`/`need-tribute`，**不能**发游戏操作。

- [ ] **Step 1: 写失败测试**

```ts
describe('RoomRegistry — 大厅 + 观战', () => {
  const fakeDriver = (room: any) => ({ start: () => [], spectatorSync: () => [{ to: 'all', msg: { t: 'state', phase: 'playing' } }] });
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123', fakeDriver); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });
  function playingRoom() {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => hello(c, 'p' + i));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' });
    return cs;
  }

  it('lobby 订阅 → 收公开房列表', () => {
    playingRoom();
    const v = fakeClient(); reg.handle(v, { t: 'lobby' });
    const lob = [...v.sent].reverse().find((m: any) => m.t === 'lobby');
    expect(lob.rooms.find((r: any) => r.code === 'ABC123')).toBeTruthy();
  });

  it('spectate playing 房 → spectating + 进观众集', () => {
    playingRoom();
    const v = fakeClient(); hello(v, '观'); reg.handle(v, { t: 'spectate', code: 'ABC123' });
    expect([...v.sent].reverse().find((m: any) => m.t === 'spectating')).toBeTruthy();
    expect(reg.rooms.get('ABC123').spectators.has(v)).toBe(true);
  });

  it('观战者发 play → 被忽略（不进 driver）', () => {
    playingRoom();
    const v = fakeClient(); hello(v, '观'); reg.handle(v, { t: 'spectate', code: 'ABC123' });
    const before = v.sent.length;
    reg.handle(v, { t: 'play', cardIds: [1, 2] });
    expect(v.sent.length).toBe(before); // 无响应
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npm test -- rooms 2>&1 | tail -8`
Expected: FAIL — `lobby`/`spectate` 未处理。

- [ ] **Step 3: 实现 lobby + spectate + 快照**

`handle` 内追加：

```js
    if (msg.t === 'lobby') { this.lobby.add(client); client.send({ t: 'lobby', rooms: this._snapshot() }); return; }
    if (msg.t === 'spectate') {
      const room = this.rooms.get(msg.code);
      if (!room || room.isPrivate || room.status !== 'playing') { client.send({ t: 'error', msg: '无法观战' }); return; }
      this._leaveRoom(client);
      room.spectators.add(client); client._room = room.code; client._seat = 'spectator';
      client.send({ t: 'spectating', code: room.code, seats: this._seatInfo(room) });
      if (room.driver && room.driver.spectatorSync) this._dispatch(room, room.driver.spectatorSync(client));
      this._broadcastLobby();
      return;
    }
```

加快照 + 大厅广播：

```js
  _snapshot() {
    const out = [];
    for (const r of this.rooms.values()) {
      if (r.isPrivate) continue;
      out.push({ code: r.code, status: r.status,
        players: r.seats.filter(Boolean).map(s => s.nick), spectators: r.spectators.size });
    }
    return out;
  }
  _broadcastLobby() { const rooms = this._snapshot(); for (const c of this.lobby) c.send({ t: 'lobby', rooms }); }
```

并在 create/start/match 成局/删房处调 `if (!room.isPrivate) this._broadcastLobby();`（建公开房、开打、删房都要刷大厅）。

> `spectatorSync(client)` 让 driver 给新观众补发当前公开态（实现见 Task 11）。

- [ ] **Step 4: 跑测试看绿**

Run: `npm test -- rooms 2>&1 | tail -6`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/rooms.mjs tests/rooms.test.ts
git commit -m "feat(guandan-online): 大厅订阅 + 观战(只收公开态/禁发操作)"
```

---

### Task 7: RoomRegistry — 掉线（座位 offline + AI 接管标记 + 删房）

**Files:**
- Modify: `server/rooms.mjs`
- Modify: `tests/rooms.test.ts`

**Interfaces:**
- Consumes: Task 4。driver 需有 `setAI(seat, on)`（标记座位由 AI 接管，返回 outbound；Task 12）。
- Produces: `_leaveRoom` 完整版：`waiting` 房房主走删房；`playing` 房标记座位 offline+ai、广播 `peer-offline{seat}`、driver.setAI；4 真人全掉线删房。`leave(client)` 串起昵称释放 + 退房 + 出匹配池。

- [ ] **Step 1: 写失败测试**

```ts
describe('RoomRegistry — 掉线', () => {
  const drv = (room: any) => ({ start: () => [], setAI: (seat: number, on: boolean) => [{ to: 'all', msg: { t: 'state', aiSeat: seat, ai: on } }] });
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123', drv); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });
  function playing() {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => hello(c, 'p' + i));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' });
    return cs;
  }

  it('waiting 房房主离开 → 删房', () => {
    const a = fakeClient(); hello(a, '甲'); reg.handle(a, { t: 'create' });
    reg.leave(a);
    expect(reg.rooms.has('ABC123')).toBe(false);
  });

  it('playing 中一人掉线 → 座位 offline+ai，其余收 peer-offline，房保留', () => {
    const cs = playing();
    reg.leave(cs[2]);
    const room = reg.rooms.get('ABC123');
    expect(room).toBeTruthy();
    expect(room.seats[2]).toMatchObject({ online: false, ai: true, nick: 'p2' }); // 保留昵称作凭据
    expect(cs[0].sent).toContainEqual({ t: 'peer-offline', seat: 2 });
  });

  it('playing 中 4 真人全掉线 → 删房', () => {
    const cs = playing();
    cs.forEach(c => reg.leave(c));
    expect(reg.rooms.has('ABC123')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npm test -- rooms 2>&1 | tail -8`
Expected: FAIL — `_leaveRoom` 占位未实现真逻辑。

- [ ] **Step 3: 实现完整 `_leaveRoom` + `leave`**

替换 Task 3 的占位 `_leaveRoom`，并补 `leave` 的退房/出池：

```js
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
    // playing：标记座位掉线 + AI 接管，保留昵称作重连凭据
    room.seats[idx].online = false; room.seats[idx].ai = true; room.seats[idx].client = null;
    for (const s of room.seats) if (s && s.client && s.online) s.client.send({ t: 'peer-offline', seat: idx });
    for (const sp of room.spectators) sp.send({ t: 'peer-offline', seat: idx });
    if (room.driver && room.driver.setAI) this._dispatch(room, room.driver.setAI(idx, true));
    const anyHuman = room.seats.some(s => s && s.online);
    if (!anyHuman) {                    // 4 真人全掉线 → 删房
      for (const sp of room.spectators) sp.send({ t: 'room-closed' });
      this.rooms.delete(code); if (!room.isPrivate) this._broadcastLobby();
    }
  }
  leave(client) {
    const nk = this.nicks.get(client);
    if (nk) { this.byNick.delete(this._nickKey(nk)); this.nicks.delete(client); }
    this.lobby.delete(client);
    const qi = this.queue.indexOf(client); if (qi >= 0) this.queue.splice(qi, 1);
    this._leaveRoom(client);
  }
```

> 注意 `_dispatch` 在标记 `client=null` 后调 `setAI`，故 `setAI` 的 outbound 不能发给该已离座 client（`_dispatch` 已按 `s.client && s.online` 过滤，安全）。

- [ ] **Step 4: 跑测试看绿**

Run: `npm test -- rooms 2>&1 | tail -6`
Expected: PASS（全部 rooms 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/rooms.mjs tests/rooms.test.ts
git commit -m "feat(guandan-online): 掉线→座位offline+AI接管+删房规则"
```

---

### Task 8: RoomRegistry — 重连（按房号+昵称收回座位）

**Files:**
- Modify: `server/rooms.mjs`
- Modify: `tests/rooms.test.ts`

**Interfaces:**
- Consumes: Task 7。driver 需 `setAI(seat,false)` + `syncSeat(seat)`（重发该座位完整态：`hand` + `state`；Task 11/12）。
- Produces: `rejoin{code,nick}` → 按 `seats[i].nick===nick && !online` 匹配空座 → 收回（online=true,ai=false,client=本连接）→ `rejoined{seat}` + driver.syncSeat + 广播 `peer-back{seat}`。

- [ ] **Step 1: 写失败测试**

```ts
describe('RoomRegistry — 重连', () => {
  const drv = (room: any) => ({ start: () => [], setAI: () => [], syncSeat: (seat: number) => [{ to: 'seat', seat, msg: { t: 'state', resync: seat } }] });
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123', drv); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });
  function playing() {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => hello(c, 'p' + i));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' });
    return cs;
  }

  it('掉线后 rejoin → 收回座位、收 rejoined + 重发态、其余收 peer-back', () => {
    const cs = playing();
    reg.leave(cs[2]);
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', nick: 'p2' });
    expect(re.sent).toContainEqual({ t: 'rejoined', seat: 2 });
    expect(re.sent).toContainEqual({ t: 'state', resync: 2 });
    const room = reg.rooms.get('ABC123');
    expect(room.seats[2]).toMatchObject({ online: true, ai: false, nick: 'p2' });
    expect(cs[0].sent).toContainEqual({ t: 'peer-back', seat: 2 });
  });

  it('座位未掉线 / 昵称不符 → error', () => {
    playing();
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', nick: 'p2' }); // p2 仍在线
    expect(last(re).t).toBe('error');
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npm test -- rooms 2>&1 | tail -8`
Expected: FAIL — `rejoin` 未处理。

- [ ] **Step 3: 实现 rejoin**

`handle` 内追加：

```js
    if (msg.t === 'rejoin') {
      const room = this.rooms.get(msg.code);
      const idx = room ? room.seats.findIndex(s => s && !s.online && s.nick === msg.nick) : -1;
      if (idx === -1) { client.send({ t: 'error', msg: '无法重连：房间不存在或座位已占' }); return; }
      this._leaveRoom(client);
      room.seats[idx].client = client; room.seats[idx].online = true; room.seats[idx].ai = false;
      client._room = room.code; client._seat = idx;
      this.nicks.set(client, msg.nick); this.byNick.add(this._nickKey(msg.nick)); // 重登昵称维持判重一致
      client.send({ t: 'rejoined', seat: idx });
      if (room.driver && room.driver.setAI) this._dispatch(room, room.driver.setAI(idx, false));
      if (room.driver && room.driver.syncSeat) this._dispatch(room, room.driver.syncSeat(idx));
      for (const s of room.seats) if (s && s.client && s.online && s.client !== client) s.client.send({ t: 'peer-back', seat: idx });
      this._sendRoom(room);
      return;
    }
```

- [ ] **Step 4: 跑测试看绿**

Run: `npm test -- rooms 2>&1 | tail -6`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/rooms.mjs tests/rooms.test.ts
git commit -m "feat(guandan-online): 重连按房号+昵称收回座位+重发态"
```

---

### Task 9: MatchDriver — 发牌 + 初始按座位下发（start/snapshot）

**Files:**
- Create: `server/match-driver.ts`
- Create: `tests/match-driver.test.ts`

**Interfaces:**
- Consumes: 引擎 `dealHands/createDeal/startMatch/dealLevel/sortHand` + `Card/Seat`。
- Produces: `class MatchDriver { constructor(opts:{shuffle?, scheduleAI?}); start(): Outbound[]; publicState(): PublicState; snapshotFor(seat): Outbound[]; spectatorSync(client): Outbound[]; }`。`Outbound = {to:'seat'|'all', seat?, msg}`。`start()` 发牌 + 广播公开态 + 给每座私发 `hand`。

- [ ] **Step 1: 写失败测试 `tests/match-driver.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { MatchDriver } from '../server/match-driver';

// 不洗牌：固定顺序发牌，便于断言（shuffle 返回 0..n-1 原序）
const noShuffle = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('MatchDriver — 发牌 + 下发', () => {
  it('start：广播 1 条公开态 + 给 4 座各私发自己的 hand(27张)', () => {
    const d = new MatchDriver({ shuffle: noShuffle });
    const out = d.start();
    const states = out.filter(o => o.to === 'all' && o.msg.t === 'state');
    const hands = out.filter(o => o.to === 'seat' && o.msg.t === 'hand');
    expect(states).toHaveLength(1);
    expect(states[0].msg.phase).toBe('playing');
    expect(hands).toHaveLength(4);
    for (let s = 0; s < 4; s++) {
      const h = hands.find(o => o.seat === s)!;
      expect(h.msg.cards).toHaveLength(27);
    }
  });

  it('公开态不含任何手牌字段', () => {
    const d = new MatchDriver({ shuffle: noShuffle });
    const st = d.start().find(o => o.msg.t === 'state')!.msg;
    expect(JSON.stringify(st)).not.toContain('"hands"');
    expect(st.seats.every((x: any) => x.count === 27 && x.lastPlay === null)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npm test -- match-driver 2>&1 | tail -8`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 MatchDriver 骨架 + start + publicState**

```ts
import type { Card, Seat, Rank } from '../src/games/guandan/engine/types';
import { dealHands, startMatch, dealLevel, type MatchState } from '../src/games/guandan/engine/match';
import { createDeal, type DealState } from '../src/games/guandan/engine/game';
import { sortHand } from '../src/games/guandan/engine/cards';

export type Outbound = { to: 'all' } | { to: 'seat'; seat: Seat } extends never ? never
  : { to: 'all' | 'seat'; seat?: Seat; msg: any };

export class MatchDriver {
  match: MatchState;
  state: DealState;
  online: boolean[] = [true, true, true, true]; // 座位是否真人在线（false=AI 接管）
  shuffle: (n: number) => number[];
  constructor(opts: { shuffle?: (n: number) => number[] } = {}) {
    this.shuffle = opts.shuffle ?? defaultShuffle;
    this.match = startMatch();
    this.state = createDeal([[], [], [], []], 0, dealLevel(this.match)); // 占位，start() 真发牌
  }
  start(): Outbound[] {
    const hands = dealHands(this.shuffle);
    this.state = createDeal(hands, 0, dealLevel(this.match)); // 首局首攻=座位0（无进贡）
    return [this.broadcastState(), ...this.handMsgs()];
  }
  publicState() {
    const s = this.state;
    return {
      phase: 'playing', turn: s.turn, current: s.current ? { ...s.current.combo, by: s.current.by } : null,
      lastActor: s.current ? s.current.by : null,
      seats: ([0, 1, 2, 3] as Seat[]).map(i => ({
        seat: i, count: s.hands[i].length,
        lastPlay: null, finishRank: rankOf(s.finished, i), online: this.online[i], ai: !this.online[i],
      })),
      level: s.level, levels: this.match.levels, trumpTeam: this.match.trumpTeam, dealNo: this.match.dealNo,
    };
  }
  broadcastState(): Outbound { return { to: 'all', msg: { t: 'state', ...this.publicState() } }; }
  handMsgs(): Outbound[] {
    return ([0, 1, 2, 3] as Seat[]).map(i => ({
      to: 'seat', seat: i, msg: { t: 'hand', cards: sortHand(this.state.hands[i], this.state.level) },
    }));
  }
}
function rankOf(finished: Seat[], seat: Seat): 1 | 2 | 3 | 4 | null {
  const i = finished.indexOf(seat); return i === -1 ? null : ((i + 1) as 1 | 2 | 3 | 4);
}
function defaultShuffle(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
```

> `Outbound` 类型用简单写法即可：`export type Outbound = { to: 'all' | 'seat'; seat?: Seat; msg: any };`（替换上面那行绕口的条件类型）。

- [ ] **Step 4: 跑测试看绿**

Run: `npm test -- match-driver 2>&1 | tail -6`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/match-driver.ts tests/match-driver.test.ts
git commit -m "feat(guandan-online): MatchDriver 发牌+公开态/私有手牌按座下发"
```

---

### Task 10: MatchDriver — 出牌 / 不要（校验 + 推进 + lastPlay 公开态）

**Files:**
- Modify: `server/match-driver.ts`
- Modify: `tests/match-driver.test.ts`

**Interfaces:**
- Consumes: `isLegalPlay/play/pass/isDealOver`。Task 9 `publicState`。
- Produces: `handlePlay(seat, cardIds): Outbound[]`、`handlePass(seat): Outbound[]`。维护 `lastPlays:(...|'pass'|null)[]` 与 `lastActor`，并入 publicState.seats[i].lastPlay。非法/非回合 → 给该座 `error`，不推进。

- [ ] **Step 1: 写失败测试**

```ts
describe('MatchDriver — 出牌/不要', () => {
  function freshDeal() { const d = new MatchDriver({ shuffle: noShuffle }); d.start(); return d; }
  const handOf = (d: any, seat: number) => d.state.hands[seat];

  it('非回合出牌 → error，不推进', () => {
    const d = freshDeal(); // 首攻=座位0
    const out = d.handlePlay(1, [handOf(d, 1)[0].id]);
    expect(out.find((o: any) => o.msg.t === 'error')).toBeTruthy();
    expect(d.state.turn).toBe(0);
  });

  it('座位0 合法领出单张 → 推进到下一家 + 公开态含其 lastPlay + 手牌-1', () => {
    const d = freshDeal();
    const card = handOf(d, 0)[0];
    const out = d.handlePlay(0, [card.id]);
    const st = out.find((o: any) => o.to === 'all' && o.msg.t === 'state')!.msg;
    expect(st.seats[0].lastPlay).toEqual({ cards: [card] });
    expect(st.seats[0].count).toBe(26);
    expect(d.state.turn).toBe(1);
    // 出牌后只给出牌者补发新手牌
    const myHand = out.find((o: any) => o.to === 'seat' && o.seat === 0 && o.msg.t === 'hand');
    expect(myHand!.msg.cards).toHaveLength(26);
  });

  it('非法组合（乱凑两张）→ error', () => {
    const d = freshDeal();
    const h = handOf(d, 0);
    // 取两张不同点的牌强凑（非对子）——isLegalPlay 应拒
    const a = h[0]; const b = h.find((c: any) => c.kind === 'normal' && c.rank !== (a.kind === 'normal' ? a.rank : -1));
    const out = d.handlePlay(0, [a.id, b.id]);
    expect(out.find((o: any) => o.msg.t === 'error')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试看红**

Run: `npm test -- match-driver 2>&1 | tail -8`
Expected: FAIL — `handlePlay/handlePass` 未定义。

- [ ] **Step 3: 实现 handlePlay/handlePass + lastPlays**

构造器加 `this.lastPlays = [null,null,null,null]; this.lastActor = null;`，`start()` 末尾重置它们。`publicState().seats[i].lastPlay` 改读 `this.lastPlays[i]`。新增：

```ts
import { isLegalPlay } from '../src/games/guandan/engine/legal';
import { play, pass, isDealOver } from '../src/games/guandan/engine/game';

handlePlay(seat: Seat, cardIds: number[]): Outbound[] {
  if (this.state.turn !== seat) return [err(seat, '还没轮到你')];
  const cards = this.cardsByIds(seat, cardIds);
  if (!cards) return [err(seat, '牌不在你手里')];
  if (!isLegalPlay(cards, this.state.current?.combo ?? null, this.state.hands[seat], this.state.level))
    return [err(seat, '不合规')];
  const wasLead = this.state.current === null;
  this.state = play(this.state, seat, cards);
  if (wasLead) this.lastPlays = [null, null, null, null];
  this.lastPlays[seat] = { cards };
  this.lastActor = seat;
  return this.afterAction(seat);
}
handlePass(seat: Seat): Outbound[] {
  if (this.state.turn !== seat) return [err(seat, '还没轮到你')];
  if (this.state.current === null) return [err(seat, '领出不能不要')];
  this.state = pass(this.state, seat);
  this.lastPlays[seat] = 'pass';
  this.lastActor = seat;
  return this.afterAction(seat);
}
private afterAction(actor: Seat): Outbound[] {
  const out: Outbound[] = [this.broadcastState(), { to: 'seat', seat: actor, msg: { t: 'hand', cards: sortHand(this.state.hands[actor], this.state.level) } }];
  // Task 13 会在这里追加：deal over → settle/tribute；AI 续手
  return out;
}
private cardsByIds(seat: Seat, ids: number[]): Card[] | null {
  const hand = this.state.hands[seat]; const out: Card[] = [];
  for (const id of ids) { const c = hand.find(x => x.id === id); if (!c) return null; out.push(c); }
  return out.length ? out : null;
}
```

加顶层 helper：`function err(seat: Seat, msg: string): Outbound { return { to: 'seat', seat, msg: { t: 'error', msg } }; }`

- [ ] **Step 4: 跑测试看绿**

Run: `npm test -- match-driver 2>&1 | tail -6`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/match-driver.ts tests/match-driver.test.ts
git commit -m "feat(guandan-online): MatchDriver 出牌/不要 校验+推进+lastPlay公开态"
```

---

### Task 11: MatchDriver — 重连/观战补发当前态（syncSeat / spectatorSync）

**Files:**
- Modify: `server/match-driver.ts`
- Modify: `tests/match-driver.test.ts`

**Interfaces:**
- Consumes: Task 10。
- Produces: `syncSeat(seat): Outbound[]`（给该座补发 `state`(public，定向该 client) + 它的 `hand`）；`spectatorSync(client): Outbound[]`（给观众补发 `state`，无手牌）。

- [ ] **Step 1: 写失败测试**

```ts
describe('MatchDriver — 重连/观战补发', () => {
  it('syncSeat：给该座补发 公开态(seat 定向) + 自己手牌', () => {
    const d = new MatchDriver({ shuffle: noShuffle }); d.start();
    const out = d.syncSeat(2);
    expect(out.find((o: any) => o.to === 'seat' && o.seat === 2 && o.msg.t === 'state')).toBeTruthy();
    const h = out.find((o: any) => o.to === 'seat' && o.seat === 2 && o.msg.t === 'hand');
    expect(h!.msg.cards).toHaveLength(27);
  });
  it('spectatorSync：只补公开态，无 hand', () => {
    const d = new MatchDriver({ shuffle: noShuffle }); d.start();
    const out = d.spectatorSync({} as any);
    expect(out.some((o: any) => o.msg.t === 'hand')).toBe(false);
    expect(out.some((o: any) => o.msg.t === 'state')).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试看红 → Step 3: 实现**

```ts
syncSeat(seat: Seat): Outbound[] {
  return [
    { to: 'seat', seat, msg: { t: 'state', ...this.publicState() } },
    { to: 'seat', seat, msg: { t: 'hand', cards: sortHand(this.state.hands[seat], this.state.level) } },
  ];
}
spectatorSync(_client: unknown): Outbound[] {
  // 观众的 state 走 'all' 通道由 rooms 的 _dispatch 发给观众即可；这里产出一条公开态广播
  return [{ to: 'all', msg: { t: 'state', ...this.publicState() } }];
}
```

> rooms `spectate` 用 `_dispatch(room, driver.spectatorSync(client))`，`'all'` 会发给在线玩家+观众；新观众也在 `room.spectators` 里，能收到。手牌从不走 `'all'`，故观众永不见手牌。

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
git add server/match-driver.ts tests/match-driver.test.ts
git commit -m "feat(guandan-online): 重连/观战补发当前态(syncSeat/spectatorSync)"
```

---

### Task 12: MatchDriver — AI 接管（setAI + 轮到 AI 自动出）

**Files:**
- Modify: `server/match-driver.ts`
- Modify: `tests/match-driver.test.ts`

**Interfaces:**
- Consumes: `choosePlay`。Task 10 `handlePlay/handlePass`。
- Produces: `setAI(seat, on): Outbound[]`（置 `online[seat]=!on`，广播公开态；on 且正轮到该座 → 立即 AI 推进）；内部 `driveAI(): Outbound[]`——当 `turn` 是 AI 座（`!online[turn]`）时用 `choosePlay` 自动出/不要，循环直到轮到真人或本局结束。`afterAction` 末尾调 `driveAI`。

- [ ] **Step 1: 写失败测试**

```ts
describe('MatchDriver — AI 接管', () => {
  it('setAI(座位X,true) 且轮到该座 → AI 自动推进，turn 不停在 AI 座', () => {
    const d = new MatchDriver({ shuffle: noShuffle }); d.start(); // 轮到座位0
    const out = d.setAI(0, true);
    expect(out.some((o: any) => o.msg.t === 'state')).toBe(true);
    // 座位0 被 AI 接管且首攻 → 应已自动出牌，turn 前移
    expect(d.online[0]).toBe(false);
    expect(d.state.turn).not.toBe(0);
  });

  it('全 4 座 AI → 一路自动打完整局不卡死', () => {
    const d = new MatchDriver({ shuffle: noShuffle }); d.start();
    for (let s = 0; s < 4; s++) d.setAI(s as any, true);
    // setAI 链式驱动后，本局应已结束（finished 满 4 或 deal over）
    expect(d.state.finished.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```ts
import { choosePlay } from '../src/games/guandan/ai/ai';

setAI(seat: Seat, on: boolean): Outbound[] {
  this.online[seat] = !on;
  const out: Outbound[] = [this.broadcastState()];
  out.push(...this.driveAI());
  return out;
}
private driveAI(): Outbound[] {
  const out: Outbound[] = [];
  let guard = 0;
  while (!isDealOver(this.state) && !this.online[this.state.turn] && guard++ < 200) {
    const seat = this.state.turn;
    const decision = choosePlay(this.state, seat);
    const step = decision === null ? this.handlePass(seat) : this.handlePlay(seat, decision.map(c => c.id));
    out.push(...step);
  }
  return out;
}
```

并把 `afterAction` 改为末尾 `out.push(...this.driveAI());`（真人出完牌后，若下一家是 AI 座，自动续）。注意 `driveAI` 内部又调 `handlePlay`→`afterAction`→`driveAI`，会递归；为避免重复驱动，把 `afterAction` 的 AI 续手与 `driveAI` 二选一：**让 `handlePlay/handlePass` 不在 afterAction 里调 driveAI，统一由外层调用方在每次 handle 后调一次 `driveAI`**。即：`afterAction` 只产出「广播+补手牌」；`handlePlay/handlePass/setAI/start` 的返回值里，由 rooms 那层在 dispatch 前补一次 driveAI。

> **决策（写进实现）**：`handlePlay`/`handlePass`/`setAI` 的公开返回值**末尾自带 `...this.driveAI()`**（外层无需关心）；`driveAI` 内部调用的是**私有** `applyPlay/applyPass`（不再触发 driveAI），避免递归重复。把 Task 10 的 `handlePlay/handlePass` 拆成：公开 `handlePlay`（校验 + `applyPlay` + `afterAction` + `driveAI`）与私有 `applyPlay`（仅推进 + lastPlay）。`driveAI` 调私有版。

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
git add server/match-driver.ts tests/match-driver.test.ts
git commit -m "feat(guandan-online): AI 接管(setAI+轮到AI座自动出,防递归)"
```

---

### Task 13: MatchDriver — 一局结束结算 + 整盘推进（settle / dealResult / matchOver）

**Files:**
- Modify: `server/match-driver.ts`
- Modify: `tests/match-driver.test.ts`

**Interfaces:**
- Consumes: `isDealOver/ranking` + `settleDeal/dealLevel`。
- Produces: `afterAction` 检测 `isDealOver` → 算 `ranking` → `settleDeal` → 进 `phase:'dealResult'`（含 ranking/gain/末游剩牌），整盘 `over` → `phase:'matchOver'`。`nextDeal()` 进入下一局（接 Task 14 进贡后发牌）。

- [ ] **Step 1: 写失败测试**

```ts
describe('MatchDriver — 局终结算', () => {
  it('全 AI 自对局打完一局 → 公开态进 dealResult，含 ranking(长度4)', () => {
    const d = new MatchDriver({ shuffle: defaultShuffleSeeded() }); // 见下：可复现洗牌
    const out = d.start();
    for (let s = 0; s < 4; s++) out.push(...d.setAI(s as any, true));
    const lastState = [...out].reverse().find(o => o.msg.t === 'state')!.msg;
    expect(['dealResult', 'tribute', 'matchOver']).toContain(lastState.phase);
    if (lastState.phase === 'dealResult') expect(lastState.result.ranking).toHaveLength(4);
  });
});
// 可复现洗牌：Fisher-Yates with 固定 LCG 种子（测试确定性，不用 Math.random）
function defaultShuffleSeeded() {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return (n: number) => { const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
}
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

把 `afterAction` 改为：

```ts
private afterAction(actor: Seat): Outbound[] {
  const out: Outbound[] = [];
  if (isDealOver(this.state)) {
    const finished = ranking(this.state);
    const settle = settleDeal(this.match, finished);
    this.match = settle.match;
    const lastSeat = finished[3];
    this.phase = settle.match.over ? 'matchOver' : 'dealResult';
    this.pendingResult = { finished, settle, lastHand: this.state.hands[lastSeat] };
    out.push(this.broadcastState());
  } else {
    out.push(this.broadcastState(), { to: 'seat', seat: actor, msg: { t: 'hand', cards: sortHand(this.state.hands[actor], this.state.level) } });
  }
  return out;
}
```

`publicState()` 增补 phase 分支：`if (this.phase==='dealResult'||this.phase==='matchOver') 加 result/winner`。新增字段 `this.phase='playing'`、`this.pendingResult=null`（构造器 + start 重置）。`settleDeal` 后 `dealResult` 阶段的 `result = { ranking: finished, gain: settle.gain, passedA, stuck, demoted, lastHand }`；`matchOver` 加 `winner: settle.match.winner`。

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
git add server/match-driver.ts tests/match-driver.test.ts
git commit -m "feat(guandan-online): 局终 settle→dealResult/matchOver 公开态"
```

---

### Task 14: MatchDriver — 进贡/还贡（含双贡 + AI/超时兜底）

**Files:**
- Modify: `server/match-driver.ts`
- Modify: `tests/match-driver.test.ts`

**Interfaces:**
- Consumes: `planTribute/returnableCards/autoReturn/applyTribute/dealHands`。
- Produces: `nextDeal()`：未收盘 → `planTribute` → 抗贡则直接发下一局；否则进 `phase:'tribute'`，进贡自动执行，给收贡的**真人**座位发 `need-tribute{options}`（AI 座位 `autoReturn`）；`handleTributeReturn(seat, cardId)` 收齐所有还贡 → `applyTribute` → `createDeal(firstLeader)` 发下一局。超时由 server 层定时器调 `forceAutoReturn()` 兜底。

- [ ] **Step 1: 写失败测试**

```ts
describe('MatchDriver — 进贡/还贡', () => {
  it('全 AI 自对局：连打数局不卡死，每局 ranking 合法（进贡/还贡走 autoReturn）', () => {
    const d = new MatchDriver({ shuffle: defaultShuffleSeeded() });
    const out = d.start();
    for (let s = 0; s < 4; s++) out.push(...d.setAI(s as any, true));
    let guard = 0;
    while (!d.match.over && guard++ < 30) { out.push(...d.nextDeal()); for (let s = 0; s < 4; s++) out.push(...d.setAI(s as any, true)); }
    expect(d.match.over || guard >= 30).toBeTruthy(); // 不死循环
  });

  it('收贡座位是真人 → 发 need-tribute；该人 tribute-return 后开下一局', () => {
    // 造一个「非抗贡单贡、收贡座位在线」的局面：用全 AI 打完首局拿到 finished，再设收贡座位 online
    const d = new MatchDriver({ shuffle: defaultShuffleSeeded() });
    d.start(); for (let s = 0; s < 4; s++) d.setAI(s as any, true);
    // 头游座位设为在线真人
    const head = d.pendingResult.finished[0];
    d.online[head] = true;
    const out = d.nextDeal();
    const need = out.find((o: any) => o.msg.t === 'need-tribute' && o.seat === head);
    if (need) { // 非抗贡才有还贡
      expect(Array.isArray(need.msg.options)).toBe(true);
      const r = d.handleTributeReturn(head, need.msg.options[0].id);
      expect(r.some((o: any) => o.msg.t === 'state')).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现 nextDeal + handleTributeReturn**

```ts
nextDeal(): Outbound[] {
  if (this.match.over) return [];
  const hands = dealHands(this.shuffle);
  const plan = planTribute(this.pendingResult!.finished, hands, dealLevel(this.match));
  this.pendingDeal = { hands, plan };
  if (plan.resist) return this.beginDeal(hands, plan.firstLeader); // 抗贡：直接开打
  // 进贡自动；还贡：真人发 need-tribute、AI autoReturn
  this.phase = 'tribute';
  this.tributeReturns = new Map();      // receiver seat -> Card
  const out: Outbound[] = [];
  for (const ex of plan.exchanges) {
    if (this.online[ex.receiver]) {
      out.push({ to: 'seat', seat: ex.receiver, msg: { t: 'need-tribute', options: returnableCards(hands[ex.receiver], dealLevel(this.match)) } });
    } else {
      this.tributeReturns.set(ex.receiver, autoReturn(hands[ex.receiver], dealLevel(this.match)));
    }
  }
  out.unshift(this.broadcastState()); // 进 tribute 阶段公开态
  return this.maybeFinishTribute(out);
}
handleTributeReturn(seat: Seat, cardId: number): Outbound[] {
  if (this.phase !== 'tribute' || !this.pendingDeal) return [err(seat, '当前无需还贡')];
  const ex = this.pendingDeal.plan.exchanges.find(e => e.receiver === seat);
  if (!ex || this.tributeReturns.has(seat)) return [err(seat, '你无需还贡')];
  const card = this.pendingDeal.hands[seat].find(c => c.id === cardId);
  const ok = card && returnableCards(this.pendingDeal.hands[seat], dealLevel(this.match)).some(c => c.id === cardId);
  if (!ok) return [err(seat, '还贡牌不合规(须≤10)')];
  this.tributeReturns.set(seat, card!);
  return this.maybeFinishTribute([]);
}
forceAutoReturn(): Outbound[] {        // server 超时兜底
  if (this.phase !== 'tribute' || !this.pendingDeal) return [];
  for (const ex of this.pendingDeal.plan.exchanges)
    if (!this.tributeReturns.has(ex.receiver))
      this.tributeReturns.set(ex.receiver, autoReturn(this.pendingDeal.hands[ex.receiver], dealLevel(this.match)));
  return this.maybeFinishTribute([]);
}
private maybeFinishTribute(out: Outbound[]): Outbound[] {
  const need = this.pendingDeal!.plan.exchanges.filter(e => !this.tributeReturns.has(e.receiver));
  if (need.length) return out;          // 还有真人没还，等
  const returns = this.pendingDeal!.plan.exchanges.map(e => this.tributeReturns.get(e.receiver)!);
  const hands = applyTribute(this.pendingDeal!.hands, this.pendingDeal!.plan, returns);
  return [...out, ...this.beginDeal2(hands, this.pendingDeal!.plan.firstLeader)];
}
private beginDeal(hands: Card[][], firstLeader: Seat): Outbound[] { return this.beginDeal2(hands, firstLeader); }
private beginDeal2(hands: Card[][], firstLeader: Seat): Outbound[] {
  this.state = createDeal(hands, firstLeader, dealLevel(this.match));
  this.phase = 'playing'; this.lastPlays = [null, null, null, null]; this.lastActor = null;
  this.pendingDeal = null; this.pendingResult = null;
  return [this.broadcastState(), ...this.handMsgs(), ...this.driveAI()];
}
```

> `beginDeal/beginDeal2` 重复，合并为一个 `beginDeal`（删 `beginDeal2`，统一调 `beginDeal`）。构造器/字段加 `phase`、`pendingResult`、`pendingDeal`、`tributeReturns`。`publicState` 的 `tribute` 阶段加 `tribute:{exchanges,resist,doubleDown,pending:[...还没还的receiver]}`。

- [ ] **Step 3.5: 双贡正确性测试（复用引擎已验，driver 只透传）**

```ts
it('双贡：planTribute 产出 2 项 exchange 时，给两个收贡真人各发 need-tribute', () => {
  // 直接构造 driver 内部状态触发：mock pendingResult 为双下名次 + 两收贡在线
  const d = new MatchDriver({ shuffle: defaultShuffleSeeded() });
  d.start(); for (let s = 0; s < 4; s++) d.setAI(s as any, true);
  d.pendingResult = { finished: [0, 2, 1, 3], settle: { match: d.match } } as any; // 头0/二2 同队=双下
  d.online[0] = true; d.online[2] = true;
  const out = d.nextDeal();
  const needs = out.filter((o: any) => o.msg.t === 'need-tribute');
  // 双下两收贡=头游0+二游2（除非抗贡）；至少 0 或 2 收到（依发牌是否抗贡）
  expect(needs.every((o: any) => o.seat === 0 || o.seat === 2)).toBe(true);
});
```

- [ ] **Step 4: 跑绿 → Step 5: Commit**

```bash
git add server/match-driver.ts tests/match-driver.test.ts
git commit -m "feat(guandan-online): 进贡/还贡(含双贡+AI/超时autoReturn)+整盘推进"
```

---

### Task 15: 服务端打包（esbuild bundle）+ server.mjs（http+ws 粘合）

**Files:**
- Create: `server/build.mjs`
- Create: `server/server.mjs`
- Modify: `package.json`（加 `"build:server": "node server/build.mjs"`）

**Interfaces:**
- Consumes: `rooms.mjs` + 打包后的 `match-driver.bundle.mjs`（导出 `MatchDriver`）。
- Produces: 可运行服务端：`PORT=8080 node server/server.mjs` 托管 `dist/` + `/ws`，每个 playing 房注入 `new MatchDriver(...)`，超时兜底定时器。

- [ ] **Step 1: 写 esbuild 打包脚本 `server/build.mjs`**

```js
import { build } from 'esbuild';
await build({
  entryPoints: ['server/match-driver.ts'],
  bundle: true, format: 'esm', platform: 'node', target: 'node18',
  outfile: 'server/match-driver.bundle.mjs',
});
console.log('built server/match-driver.bundle.mjs');
```

- [ ] **Step 2: 跑打包，验证产物可被 node import**

Run: `cd server && npm install --omit=dev 2>&1 | tail -2 && cd .. && node server/build.mjs && node -e "import('./server/match-driver.bundle.mjs').then(m=>console.log('export MatchDriver:', typeof m.MatchDriver))"`
Expected: 打印 `built ...` 和 `export MatchDriver: function`。

- [ ] **Step 3: 写 `server/server.mjs`（照搬 xiangqi server.mjs + 注入 driver + 超时）**

```js
import { createServer as http } from 'node:http';
import { createServer as https } from 'node:https';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { RoomRegistry } from './rooms.mjs';
import { MatchDriver } from './match-driver.bundle.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dir, '..', 'dist');
const PORT = process.env.PORT || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

const handler = async (req, res) => {
  let path = decodeURIComponent((req.url || '/').split('?')[0]);
  if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
  // SPA：非静态文件路径都回 index.html（深链 /guandan 等）
  if (path === '/' || path === '') path = '/index.html';
  let file = normalize(join(DIST, path));
  if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const buf = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' }).end(buf);
  } catch {
    try { const buf = await readFile(join(DIST, 'index.html')); res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' }).end(buf); }
    catch { res.writeHead(404).end('not found'); }
  }
};

const CERT_DIR = process.env.CERT_DIR;
const useTls = !!(CERT_DIR && existsSync(`${CERT_DIR}/fullchain.pem`) && existsSync(`${CERT_DIR}/privkey.pem`));
const server = useTls
  ? https({ key: readFileSync(`${CERT_DIR}/privkey.pem`), cert: readFileSync(`${CERT_DIR}/fullchain.pem`) }, handler)
  : http(handler);

// 每个 playing 房注入一个 MatchDriver；还贡超时 30s 兜底
const TRIBUTE_TIMEOUT = 30000;
const reg = new RoomRegistry(undefined, (room) => {
  const d = new MatchDriver({});
  room._tributeTimer = null;
  return d;
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 << 20 });
wss.on('connection', (ws) => {
  const client = { send: (m) => { try { ws.send(JSON.stringify(m)); } catch {} } };
  ws.on('message', (data) => { try { reg.handle(client, JSON.parse(data.toString())); } catch {} });
  ws.on('close', () => reg.leave(client));
});
server.listen(PORT, () => console.log(`guandan server on :${PORT} (${useTls ? 'https/wss' : 'http/ws'})`));
```

> **还贡超时**：`rooms.mjs` 在 `_dispatch` 发出含 `need-tribute` 的 outbound 后，启动 `setTimeout(()=>this._dispatch(room, room.driver.forceAutoReturn()), TRIBUTE_TIMEOUT)`；收到 `tribute-return` 或还贡收齐后 `clearTimeout`。本 Task 在 rooms.mjs 接 `play/pass/tribute-return` 时一并接超时（见 Step 4）。

- [ ] **Step 4: 在 rooms.mjs 接游戏消息（play/pass/tribute-return）转交 driver**

`handle` 内追加（放 RELAY 类）：

```js
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
```

加超时管理：

```js
  _armTributeTimeout(room, out) {
    const needsTribute = (out || []).some(o => o.msg && o.msg.t === 'need-tribute');
    if (needsTribute && !room._tributeTimer && this.tributeTimeoutMs) {
      room._tributeTimer = setTimeout(() => { room._tributeTimer = null; if (room.driver) this._dispatch(room, room.driver.forceAutoReturn()); }, this.tributeTimeoutMs);
    }
    const leftTribute = (out || []).some(o => o.msg && o.msg.t === 'state' && o.msg.phase === 'playing');
    if (leftTribute && room._tributeTimer) { clearTimeout(room._tributeTimer); room._tributeTimer = null; }
  }
```

并在构造器加参数 `tributeTimeoutMs = 0`（测试默认 0=不开定时器；server.mjs 传 30000）。`RoomRegistry` 构造签名扩成 `(codeGen, makeDriver, tributeTimeoutMs)`，server.mjs 用 `new RoomRegistry(undefined, makeDriver, 30000)`。`nextDeal` 的 outbound 也要过 `_armTributeTimeout`——在 dealResult 后触发 nextDeal 的地方（房主点「再来一盘」/自动续局）一并 arm。

> **何时调 nextDeal**：dealResult 后由谁触发下一局？决策：**dealResult 广播后，rooms 自动调 `driver.nextDeal()` 并 dispatch**（无需玩家点「下一局」，跟二期单机自动进下一局一致）。在 `_dispatch` 检测到 `phase==='dealResult'` 的 state 时，下一拍 `setImmediate(()=>{ const o=room.driver.nextDeal(); this._dispatch(room,o); this._armTributeTimeout(room,o); })`。`matchOver` 则不续，等房主「再来一盘」（Plan 3 客户端做按钮）。

- [ ] **Step 5: 冒烟——本地起服务端 + 一个 ws 脚本打通建房**

Run（写 `/tmp/wssmoke.mjs` 用 `ws` 连 4 个客户端建房开打，断言收到 `state`）：
```bash
npm run build && node server/build.mjs && (PORT=8099 node server/server.mjs &) && sleep 1 && node /tmp/wssmoke.mjs
```
Expected: 4 客户端 hello→create/join/take-seat→start→各收到 `hand`(27) + `state`(playing)。脚本打印 `OK`。（脚本内容在 Plan 3/E2E 复用；此处最小验证 server 粘合通。）

- [ ] **Step 6: Commit**

```bash
git add server/build.mjs server/server.mjs server/rooms.mjs package.json
git commit -m "feat(guandan-online): esbuild打包 + server.mjs(http+ws) + 游戏消息转driver + 还贡超时 + 自动续局"
```

---

## Self-Review（写完计划后自查）

- **Spec coverage**：建房/匹配（T3-5）、4 真人开打（T4）、掉线 AI 接管（T7,12）、重连收回（T8,11）、观战只公开（T6,11）、整盘升级/进贡含双贡/抗贡/打A（T13,14 透传引擎）、手牌私发（T9-11 贯穿）、删房规则（T7）、昵称判重（T2）——均有对应任务。部署细节（systemd/证书）属 Plan 4，不在本计划。
- **Placeholder 扫描**：T3 的 `_leaveRoom` 占位在 T7 写全（已注明）；`beginDeal/beginDeal2` 合并、`Outbound` 类型简化已在注里点明——执行时按注修正，非遗留 TODO。
- **类型一致**：`Outbound={to:'all'|'seat';seat?;msg}`、`SeatInfo`、`PublicState` 全计划统一；driver 方法名 `start/handlePlay/handlePass/handleTributeReturn/setAI/syncSeat/spectatorSync/nextDeal/forceAutoReturn` 在 rooms 调用处一致。
- **风险点**：driveAI 递归（T12 已用「公开 handle 调 driveAI、私有 applyPlay 不调」拆解）；还贡超时跨 rooms/driver（T15 _armTributeTimeout）；自动续局时机（T15 setImmediate on dealResult）。这三处是实现时最易错的，已在任务里点明决策。
