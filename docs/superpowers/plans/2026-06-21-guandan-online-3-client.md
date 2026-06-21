# 掼蛋联机 · Plan 3：联机客户端层 + 精致大厅 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans（INLINE，主控自己执行，理由见下）实现本计划，task-by-task。步骤用 `- [ ]` 勾选跟踪。
>
> **执行方式**：INLINE 主控执行（同 Plan 2）。理由：① 逻辑任务（协议/session/OnlineDriver/接缝）强耦合现有 `engine`/`driver`/`view`，fresh subagent 每次重吃成本高；② UI 任务靠真机截图迭代 + owner 点头（[[feedback_visual_design_taste]]），非 subagent 能闭环；③ 收尾靠真本地多端冒烟而非纯单测。每个 Task 完立即跑验证；UI Task 完出真机截图给 owner。

**Goal:** 让「点掼蛋」进入联机正常玩法——昵称→精致大厅(绿毡金线)→建房挑座/随机匹配→4 真人开打整盘，掉线 AI 接管、重连收回、观战只看公开；`?debug` 保留本地对 AI。复用 Plan 2 的 `GameDriver` 接缝，牌桌主渲染零改动。

**Architecture:** 权威服务端（Plan 1，`/ws-guandan`）已就位。客户端补三层：`online/protocol.ts`(WS 消息 TS 类型，单一真相)、`online/session.ts`(`OnlineSession`：WS 连接/收发/重连/昵称)、`driver/online-driver.ts`(`OnlineDriver implements GameDriver`：服务端 `state`+`hand` → `GameSnapshot`，**egocentric 旋转**你恒在底部，动作发 WS，无引擎无 AI)。前置 UI 新建 `online/ui/`(绿毡金线大厅/房间)。入口 `index.ts` 改成控制器：`?debug`→LocalDriver 牌桌；正常→联机流。

**Tech Stack:** TypeScript（复用 `engine`/`ai`/`driver`/`ui/view`）+ vitest（协议/session/OnlineDriver 单测，mock WebSocket）+ Vite 单文件 + Playwright 多 context 真本地冒烟。零新增运行时依赖（前端）。

## Global Constraints

- **引擎/规则唯一真相在服务端**：客户端**绝不**跑 `isLegalPlay`/`choosePlay`/`play`/`pass`/`settleDeal`/`planTribute`——这些只在服务端 `MatchDriver`。OnlineDriver 只做「服务端消息 ↔ view-model」翻译。（LocalDriver 仍是本地引擎，调试用。）
- **隐藏手牌零泄漏**：别家手牌服务端从不下发；OnlineDriver 用**占位 Card**（负 id、不渲染牌面）填别家手牌长度。客户端拿不到也不得伪造别家牌。
- **牌桌主渲染零改动**：`view.ts` 的 `renderHand/renderPlay/renderSeatInfo/renderStatus/renderButtons/手牌透明/倒计时/报牌` 函数体不动。改动只在：mount 改注入 driver、两个弹层(结算/进贡)改读 driver 归一数据、加联机状态条。
- **egocentric 旋转**：`viewSeat=(serverSeat - mySeat + 4)%4`（你=viewSeat 0=底部）。队伍维度同步重映射：`viewTeam = serverTeam ^ (mySeat&1)`，"我方"恒为你这队。观战 `mySeat=0`（不旋转）。
- **入口**：真路径 `/guandan` → 联机流；`/guandan?debug`（`location.search` 含 `debug`）→ 本地 LocalDriver 牌桌。
- **协议字段照搬服务端**（不臆造）：见 `server/guandan-rooms.mjs` + `server/guandan-match-driver.ts`。消息恒 `{t:'...', ...}`，WS `/ws-guandan`，JSON。
- **验证命令**：`npm test`（vitest 全绿，含新单测）+ `npm run typecheck`；UI/联机真机用本地 18099 静态服 + 真服务端 + Playwright（`channel:'chrome'`，多 context）。
- **HUMAN_SEAT=0**（view 空间）；座位 0下/1右/2上/3左（逆时针）。

## 服务端协议（照搬，OnlineDriver/session 严格遵守）

**客户端→服务端**（`{t, ...}`）：
`hello{nick}` / `rename{nick}`、`create{isPrivate}` / `join{code}` / `take-seat{seat}` / `start`、`match` / `lobby` / `spectate{code}`、`play{cardIds:number[]}` / `pass` / `tribute-return{cardId:number}`、`rejoin{code,nick}`。

**服务端→客户端**：
- `hello-ok` / `rename-ok` / `nick-taken`
- `created{code,isPrivate}`、`room{code,status,seats,you}`（seats=4 个 `{seat,nick,online,ai}|null`；you=座号|'spectator'|null）、`error{msg}`、`started`、`room-closed`
- `lobby{rooms:[{code,status,players:string[],spectators:number}]}`、`spectating{code,seats}`、`rejoined{seat}`
- `peer-offline{seat}` / `peer-back{seat}`
- `hand{cards:Card[]}`（**仅本人**，已 sortHand）
- `need-tribute{options:Card[]}`（**仅收贡本人**，≤10 可还牌）
- `state{...}`（公开态，发房内所有在线 + 观众）：
  ```
  { t:'state', phase:'playing'|'dealResult'|'tribute'|'matchOver',
    turn:Seat, current:{...Combo, by:Seat}|null, lastActor:Seat|null,
    seats:[{seat,count,lastPlay:{cards:Card[]}|'pass'|null, finishRank:1|2|3|4|null, online, ai}] (×4),
    level:Rank, levels:[Rank,Rank], trumpTeam:Team, dealNo:number,
    // phase==='tribute': + tribute:{exchanges:[{giver,receiver,tribute:Card}], resist, doubleDown, pending:Seat[]}
    // phase==='dealResult'|'matchOver': + result:{ranking:Seat[], gain, passedA, stuck, demoted, lastHand:Card[]}
    // phase==='matchOver': + winner:Team|null
  }
  ```
- **自动续局**：服务端在 `dealResult` 后 `setImmediate` 自动 `nextDeal`（matchOver 不续）。→ **联机无「下一局」按钮**，结算弹层是展示态、等下一个 `state` 自动关。

## 服务端补强（本计划内，SPEC 已要求「房主再来一盘留座重开」）

- **整盘重开（再来一盘）**：`guandan-rooms.mjs` 当前**无** `restart` 消息——Plan 1 漏实现。**本计划补上**（Task R，服务端 ~8 行 + 协议 + 客户端按钮）：房主在 `matchOver` 发 `restart` → 新建 MatchDriver（fresh 整盘回打 2）、**4 座原样留着**、掉线/AI 座保持 AI（`online[]` 同步）、`start()` 重发 state/hand。SPEC 已明确：「整盘打完 → 房主再来一盘（留座重开）或解散」。联机 `matchOver` 弹层：**房主显「再来一盘」**（发 restart）+「返回大厅」；非房主显「等房主再来一盘…」+「返回大厅」。`?debug` 本地仍是 LocalDriver.freshMatch。
- **观战进行中房**：`spectate` 仅 `status==='playing'` 且非私房可观战（rooms.mjs 已限制）。

---

## File Structure

```
src/games/guandan/
├── online/
│   ├── protocol.ts          # 新：全部 WS 消息 TS 类型（C2S / S2C），单一真相
│   ├── session.ts           # 新：OnlineSession——WS 连接/收发/自动重连/昵称(localStorage)/房况(sessionStorage)
│   └── ui/
│       ├── lobby.css        # 新：绿毡金线主题（复用 guandan.css 的色变量）
│       ├── nickname.ts      # 新：昵称页
│       ├── lobby.ts         # 新：大厅(建房/匹配/房列表观战)
│       └── room.ts          # 新：房间(四座环桌/挑座/房号/房主开打/等待)
├── driver/
│   ├── types.ts             # 改：GameSnapshot+phase；onResult→{settle,leftover}；TributePrompt 归一；GameDriver+autoAdvance
│   ├── local-driver.ts      # 改：track phase；onResult 带 leftover；onTribute 归一(resolve 内做 autoReturn)
│   └── online-driver.ts     # 新：OnlineDriver implements GameDriver（state+hand→snapshot，旋转，动作发 WS）
├── ui/view.ts               # 改：mount(root, driver) 注入；started 跳遮罩；两弹层读归一数据 + 按 phase 收弹层 + 联机状态条
└── index.ts                 # 改：mount=联机控制器（?debug→LocalDriver 牌桌；正常→nickname→lobby→room→OnlineDriver 牌桌）
tests/
├── online-protocol.test.ts  # 协议类型 roundtrip（编译期为主 + 运行期断言形状）
├── online-session.test.ts   # mock WebSocket：连接/发包/收包分发/重连
└── online-driver.test.ts    # mock session 喂服务端消息：旋转映射/snapshot 拼装/phase/动作发包/进贡/结算
```

**职责边界**
- `protocol.ts`：纯类型 + 少量构造 helper（如 `msg.play(ids)`）。零逻辑。
- `session.ts`：纯传输——`connect()`/`send(msg)`/`on(type, cb)`/`onClose`/重连。**不懂牌、不懂房**（房况由控制器+OnlineDriver 解释）。
- `online-driver.ts`：实现 `GameDriver`。持 `mySeat`、最近 `state`/`hand`，订阅 session 的 `state/hand/need-tribute` → 拼 snapshot + fire 事件；`play/pass/...` → `session.send`。**DOM-free**（同 LocalDriver）。
- `online/ui/*`：DOM 渲染前置 UI，调 `session.send` + 订阅 session 事件。
- `index.ts` 控制器：编排 session 生命周期 + UI 切换 + 开打时挂 `mountTable(root, onlineDriver)`。

## 归一接口契约（Task 2 落地，OnlineDriver/view 共同遵守）

```ts
// driver/types.ts
export type GamePhase = 'playing' | 'tribute' | 'dealResult' | 'matchOver';

export interface GameSnapshot {
  state: DealState; match: MatchState; lastPlays: LastPlays; lastActor: Seat | null;
  started: boolean;
  phase: GamePhase;                 // 新：弹层生命周期靠它（离开 tribute/result phase→关弹层）
}

export interface DealOutcome {       // onResult 载荷
  settle: SettleResult;             // 升级/过A/卡A/降级/winTeam（view 空间，已旋转）
  leftover: Card[];                 // 末游剩牌（本地=state.hands[末游]；联机=server result.lastHand）
}

export interface TributePrompt {     // onTribute 载荷（归一）
  exchanges: TributeExchange[];     // 各进贡 giver→receiver + tribute 牌（view 空间，已旋转）
  myReturnOptions: Card[] | null;   // 我是收贡方→可还≤10牌；否则 null（仅展示，不弹手选）
  level: Rank;
  resolve: (returnCardId: number | null) => void; // 我选的还贡牌 id；非收贡方传 null
}

export interface GameDriver {
  snapshot(): GameSnapshot;
  start(): void;
  play(cards: Card[]): boolean;
  pass(): boolean;
  timeoutSeat(seat: Seat): void;
  nextDealOrResult(): void;          // 本地：算进贡/开新局。联机：no-op（服务端自动续局）
  freshMatch(): void;                // 本地：重开整盘。联机：发 restart（房主再来一盘，留座重开）
  readonly autoAdvance: boolean;     // 新：true=结算后自动续局(联机)，结算弹层不显「下一局」按钮；false=本地手动
  onChange(cb: () => void): void;
  onResult(cb: (o: DealOutcome) => void): void;
  onTribute(cb: (p: TributePrompt) => void): void;
  onSpeak(cb: (text: string) => void): void;
  onHint(cb: (text: string, kind: 'info'|'warn') => void): void;
  dispose(): void;
}
```

> 弹层生命周期统一：table view 订阅 `onTribute`/`onResult` 开弹层，订阅 `onChange` 时若 `snapshot().phase` 不再是 `tribute`/`dealResult`/`matchOver` 就关对应弹层。本地 resolve/下一局→phase 变→自动关；联机下一个 `state`→phase 变→自动关。

---

### Task 1: WS 协议类型（单一真相）

**Files:** Create `src/games/guandan/online/protocol.ts`、`tests/online-protocol.test.ts`

**Interfaces:**
- Produces: `C2SMessage`/`S2CMessage` 联合类型、`PublicState`/`SeatPublic` 接口、构造 helper `c2s.hello(nick)` 等。OnlineSession/OnlineDriver/UI 全 import 这里。

- [ ] **Step 1: 写类型 + helper**（照搬服务端字段，勿改名）：
```ts
import type { Card, Seat, Rank, Combo } from '../engine/types';
import type { Team } from '../engine/match';

export type RoomStatus = 'waiting' | 'playing';
export interface SeatInfo { seat: Seat; nick: string; online: boolean; ai: boolean; }
export interface LobbyRoom { code: string; status: RoomStatus; players: string[]; spectators: number; }

export interface SeatPublic {
  seat: Seat; count: number;
  lastPlay: { cards: Card[] } | 'pass' | null;
  finishRank: 1 | 2 | 3 | 4 | null; online: boolean; ai: boolean;
}
export interface TributeExchangeWire { giver: Seat; receiver: Seat; tribute: Card; }
export interface PublicState {
  t: 'state';
  phase: 'playing' | 'dealResult' | 'tribute' | 'matchOver';
  turn: Seat; current: (Combo & { by: Seat }) | null; lastActor: Seat | null;
  seats: SeatPublic[]; level: Rank; levels: [Rank, Rank]; trumpTeam: Team; dealNo: number;
  tribute?: { exchanges: TributeExchangeWire[]; resist: boolean; doubleDown: boolean; pending: Seat[] };
  result?: { ranking: Seat[]; gain: 1|2|3; passedA: boolean; stuck: boolean; demoted: boolean; lastHand: Card[] };
  winner?: Team | null;
}

// 客户端→服务端
export type C2SMessage =
  | { t: 'hello'; nick: string } | { t: 'rename'; nick: string }
  | { t: 'create'; isPrivate: boolean } | { t: 'join'; code: string }
  | { t: 'take-seat'; seat: Seat } | { t: 'start' }
  | { t: 'match' } | { t: 'lobby' } | { t: 'spectate'; code: string }
  | { t: 'play'; cardIds: number[] } | { t: 'pass' } | { t: 'tribute-return'; cardId: number }
  | { t: 'restart' }
  | { t: 'rejoin'; code: string; nick: string };

// 服务端→客户端
export type S2CMessage =
  | { t: 'hello-ok' } | { t: 'rename-ok' } | { t: 'nick-taken' }
  | { t: 'created'; code: string; isPrivate: boolean }
  | { t: 'room'; code: string; status: RoomStatus; seats: (SeatInfo | null)[]; you: Seat | 'spectator' | null }
  | { t: 'error'; msg: string } | { t: 'started' } | { t: 'room-closed' }
  | { t: 'lobby'; rooms: LobbyRoom[] } | { t: 'spectating'; code: string; seats: (SeatInfo | null)[] }
  | { t: 'rejoined'; seat: Seat } | { t: 'peer-offline'; seat: Seat } | { t: 'peer-back'; seat: Seat }
  | { t: 'hand'; cards: Card[] } | { t: 'need-tribute'; options: Card[] }
  | PublicState;

export const c2s = {
  hello: (nick: string): C2SMessage => ({ t: 'hello', nick }),
  create: (isPrivate: boolean): C2SMessage => ({ t: 'create', isPrivate }),
  join: (code: string): C2SMessage => ({ t: 'join', code }),
  takeSeat: (seat: Seat): C2SMessage => ({ t: 'take-seat', seat }),
  start: (): C2SMessage => ({ t: 'start' }),
  match: (): C2SMessage => ({ t: 'match' }),
  lobby: (): C2SMessage => ({ t: 'lobby' }),
  spectate: (code: string): C2SMessage => ({ t: 'spectate', code }),
  play: (cardIds: number[]): C2SMessage => ({ t: 'play', cardIds }),
  pass: (): C2SMessage => ({ t: 'pass' }),
  tributeReturn: (cardId: number): C2SMessage => ({ t: 'tribute-return', cardId }),
  restart: (): C2SMessage => ({ t: 'restart' }),
  rejoin: (code: string, nick: string): C2SMessage => ({ t: 'rejoin', code, nick }),
};
```
- [ ] **Step 2: 写测试**（运行期验 helper 形状 + 编译期保类型）`tests/online-protocol.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { c2s } from '../src/games/guandan/online/protocol';
describe('protocol c2s helpers', () => {
  it('构造形状正确', () => {
    expect(c2s.play([1,2,3])).toEqual({ t: 'play', cardIds: [1,2,3] });
    expect(c2s.takeSeat(2)).toEqual({ t: 'take-seat', seat: 2 });
    expect(c2s.rejoin('ABC123', '阿东')).toEqual({ t: 'rejoin', code: 'ABC123', nick: '阿东' });
  });
});
```
- [ ] **Step 3:** `npm test -- online-protocol` 绿 + `npm run typecheck` 干净。
- [ ] **Step 4:** Commit `feat(guandan-online): WS 协议 TS 类型(C2S/S2C 单一真相·Plan3 Task1)`。

---

### Task R: 服务端 `restart`（房主再来一盘，留座重开）

**Files:** Modify `server/guandan-rooms.mjs`；Modify `tests/guandan-rooms.test.ts`

**职责**：`matchOver` 后房主发 `restart` → 新开整盘（回打 2）、4 座原样留着、AI 座保持 AI、重发 state/hand。**只改 rooms.mjs**（MatchDriver 无需改：`online[]` 是公有字段、`start()` 已重发牌且不动 `online`）。

- [ ] **Step 1: 写失败单测** `tests/guandan-rooms.test.ts`（照现有 rooms.test 风格，用 mock client + mock makeDriver）：构造一个 `playing` 房、driver 处于 `match.over===true`（mock driver 暴露 `match.over` + `start()` 返回带 `state` 的 outbound + `online[]`），房主发 `{t:'restart'}` → 新 driver 被建（makeDriver 再调一次）、AI 座的 `online[i]===false` 被同步、`start()` 的 outbound 被 dispatch（房内在线座收到 `state`）。非房主发 restart → 收 `error`；`match.over===false` 发 restart → 收 `error`。
- [ ] **Step 2:** `npm test -- guandan-rooms` RED（无 restart 分支）。
- [ ] **Step 3: 实现** 在 `guandan-rooms.mjs` `handle()` 加分支（`play/pass/tribute-return` 分支附近）：
```js
if (msg.t === 'restart') {
  const room = this.rooms.get(client._room);
  if (!room || room.status !== 'playing') { client.send({ t: 'error', msg: '房间状态不对' }); return; }
  if (room.host !== client) { client.send({ t: 'error', msg: '只有房主能再来一盘' }); return; }
  if (!room.driver || !(room.driver.match && room.driver.match.over)) { client.send({ t: 'error', msg: '本盘未结束' }); return; }
  room.driver = this.makeDriver ? this.makeDriver(room) : null;     // fresh 整盘(打2)
  if (room.driver) {
    room.seats.forEach((s, i) => { if (s && s.ai) room.driver.online[i] = false; }); // 掉线/AI 座保持 AI
    this._dispatch(room, room.driver.start());                       // 重发 state + 各座 hand + 驱动 AI
  }
  return;
}
```
- [ ] **Step 4:** `npm test -- guandan-rooms` GREEN + 全套 `npm test` 绿（引擎/match-driver 单测不破）。
- [ ] **Step 5:** Commit `feat(guandan-online): 服务端 restart 房主再来一盘留座重开(Plan3 TaskR)`。

> 客户端侧：协议 `restart`（Task 1 已含）；`OnlineDriver.freshMatch()` 发 `restart`（Task 5）；结算弹层 matchOver 显「再来一盘」按钮——本地 `freshMatch`/联机房主 `driver.freshMatch()→restart`，非房主隐藏按钮显「等房主再来一盘…」（Task 2 弹层 + Task 10 控制器注入 isHost）。

---

### Task 2: view-model 接缝归一（phase + onResult{settle,leftover} + 归一 onTribute + autoAdvance）

**Files:** Modify `src/games/guandan/driver/types.ts`、`driver/local-driver.ts`、`ui/view.ts`；Modify `tests/local-driver.test.ts`

**Interfaces:**
- Consumes: 现有 `GameDriver`/`GameSnapshot`/`TributePrompt`（Plan 2）。
- Produces: 上方「归一接口契约」——`GamePhase`、`GameSnapshot.phase`、`DealOutcome`、归一 `TributePrompt`、`GameDriver.autoAdvance`。OnlineDriver(Task4/5) + view 弹层遵守。

**做什么**（局部重构，**本地模式零回归**是硬指标）：
1. `types.ts`：按契约改 `GameSnapshot`(+phase)、`onResult` 载荷 `DealOutcome`、`TributePrompt`(归一)、`GameDriver`(+`readonly autoAdvance`)。
2. `local-driver.ts`：
   - 加 `phase: GamePhase` 字段（构造='playing'）；`snapshot()` 带 phase。
   - `after()` 局终：phase='dealResult'（matchOver 时若 settle.match.over→'matchOver'）；`onResult` fire `{settle, leftover: this.state.hands[ranking[3]]!}`。
   - `nextDealOrResult()`：进贡时 phase='tribute'，fire **归一** onTribute：`{exchanges: plan.exchanges, myReturnOptions: plan.exchanges.some(e=>e.receiver===HUMAN_SEAT)? returnableCards(dealt[HUMAN_SEAT]!, level): null, level, resolve}`；`resolve(cardId)` 内部构造 returns（我方=按 cardId 取牌，AI 方=autoReturn(dealt[receiver])）→ applyTribute → startDealAfterTribute（phase='playing'）。抗贡：phase='playing' 直接开局 + onHint。
   - `startDealAfterTribute`/`freshMatch`/`start`/`beginDeal`：phase='playing'。
   - `readonly autoAdvance = false`。
3. `view.ts`：
   - `showResult(o: DealOutcome)`：读 `o.settle`（名次/升级文案，同前）+ `o.leftover`（末游剩牌，**不再读 state.hands**）。按钮规则：**dealResult**——「下一局」仅 `!driver.autoAdvance`（本地）显示→`driver.nextDealOrResult()`；联机 autoAdvance=true→无按钮、等 phase 变自动关。**matchOver**——「再来一盘」：本地直接显→`driver.freshMatch()`；联机仅**房主**显（控制器经 `setResultHostCtx(isHost)` 注入）→`driver.freshMatch()`(发 restart)，非房主显「等房主再来一盘…」+「返回大厅」。
   - `showTribute(p: TributePrompt)`：渲染 `p.exchanges`（进贡飞入，同前）；`p.myReturnOptions` 非空→渲染 ≤10 手选 + 确定→`p.resolve(pickedId)`；为空→展示「等待还贡…」，不弹手选。**不再读 dealt/plan/autoReturn**。
   - **弹层生命周期**：table view 持 `tributeOverlay`/`resultOverlay` 引用；`onChange` 里若 `phase` 离开对应阶段就 `overlay.remove()`。删掉 showResult/showTribute 内的「确定后 overlay.remove()」自移除，统一交 phase 收。
- [ ] **Step 1:** 改 `types.ts`（契约）。`npm run typecheck`（预期 local-driver/view 报错——下面修）。
- [ ] **Step 2:** 改 `local-driver.ts`（phase/onResult/onTribute/autoAdvance）。
- [ ] **Step 3: 改单测** `tests/local-driver.test.ts`：onResult 断言改读 `o.settle`+`o.leftover`（末游剩牌=完局时该座手牌）；onTribute 断言改读归一 `p.exchanges`/`p.myReturnOptions`/`p.resolve(cardId)`；新增 `snapshot().phase` 断言（playing→dealResult→tribute→playing）。`autoAdvance===false`。
- [ ] **Step 4:** 改 `view.ts`（弹层读归一 + phase 收弹层 + autoAdvance 按钮）。
- [ ] **Step 5:** `npm test` 全绿 + `npm run typecheck` 干净。
- [ ] **Step 6: 真机冒烟（本地零回归）**：`npm run build` + 跑 `sandbox/2026-06-21-guandan-driver-smoke/smoke-full.mjs desktop`——结算弹层(末游剩牌)/进贡弹层(含末游进贡)/双贡/抗贡/手牌透明/倒计时全过、零前端错误（同 Plan 2 基线）。
- [ ] **Step 7:** Commit `refactor(guandan): view-model 接缝归一(phase/onResult-leftover/归一onTribute/autoAdvance·Plan3 Task2)`。

---

### Task 3: OnlineSession（WS 连接/收发/重连/昵称）

**Files:** Create `src/games/guandan/online/session.ts`、`tests/online-session.test.ts`

**Interfaces:**
- Consumes: Task 1 `C2SMessage`/`S2CMessage`。
- Produces: `class OnlineSession`，构造 `new OnlineSession(url, opts?: { WebSocketCtor?, storage? })`（默认 `window.WebSocket`/`window.localStorage`+`sessionStorage`；单测注入 mock）。方法：`connect()`、`send(msg: C2SMessage)`、`on(type, cb)`/`off`、`onOpen(cb)`/`onClose(cb)`、`nick` getter/`setNick`、`saveRoom(code,seat)`/`clearRoom()`/`savedRoom()`、`dispose()`。重连：`onClose` 若 `savedRoom()` 有值→延时重连 `connect()`→open 后自动 `send(rejoin(code,nick))`。

- [ ] **Step 1: 写失败单测**（mock WebSocket：可手动触发 open/message/close、记录 send）`tests/online-session.test.ts`：
  - `connect()` 后 `send(c2s.hello('x'))` → mock 收到 JSON.stringify 的 `{t:'hello',nick:'x'}`。
  - mock 推 `{t:'hello-ok'}` → `on('hello-ok', cb)` 被调用一次。
  - mock 推 `{t:'state',...}` → `on('state', cb)` 收到该对象。
  - 断线（mock close）且 `savedRoom()` 有值（先 `saveRoom('ABC',2)`）→ 注入即时重连定时→重连 open 后自动发 `{t:'rejoin',code:'ABC',nick}`。
  - 昵称：`setNick('阿东')` 存入 mock storage；新 session 读回。
- [ ] **Step 2:** `npm test -- online-session` RED。
- [ ] **Step 3:** 实现 `session.ts`（注入 `WebSocketCtor`/`storage`/`schedule`，重连退避；`on` 用 `Map<type, Set<cb>>`，message 解析 JSON 后按 `msg.t` 分发）。
- [ ] **Step 4:** `npm test -- online-session` GREEN + `npm run typecheck`。
- [ ] **Step 5:** Commit `feat(guandan-online): OnlineSession WS连接/收发/重连/昵称(单测·Plan3 Task3)`。

---

### Task 4: OnlineDriver——状态映射 + egocentric 旋转（snapshot/phase/onChange/onResult/onSpeak）

**Files:** Create `src/games/guandan/driver/online-driver.ts`、`tests/online-driver.test.ts`

**Interfaces:**
- Consumes: Task1 `protocol`、Task2 归一 `GameDriver`/`GameSnapshot`/`DealOutcome`/`TributePrompt`、Task3 `OnlineSession`（或注入更小的 `{ on, send }` 接口便于单测）。
- Produces: `class OnlineDriver implements GameDriver`，构造 `new OnlineDriver(io: { on(type,cb); send(msg) }, mySeat: Seat | 'spectator')`。本任务实现：snapshot 拼装（含旋转）、phase、onChange/onResult/onSpeak、`autoAdvance=true`、`nextDealOrResult=no-op`、`start/timeoutSeat=no-op`（联机由服务端驱动；timeoutSeat 不发包，服务端有自己的托管/AI）。play/pass/tribute resolve/`freshMatch`(发 restart) 在 Task 5。

**映射规则**（旋转 `v(serverSeat)=(serverSeat - base + 4)%4`，base=mySeat（spectator→0）；逆 `s(viewSeat)=(viewSeat+base)%4`）：
- 收 `hand{cards}` → 存 `myHand=cards`。
- 收 `state{...}` → 存 `lastState`；拼 snapshot：
  - `state.hands[viewSeat]`：viewSeat 0 = `myHand`（spectator 时为空，占位长度=该座 count）；其余 viewSeat = `Array(serverSeats[s(viewSeat)].count)` 填占位 Card（`{kind:'normal',suit:'S',rank:2,id:-1000-viewSeat*100-k}`）。
  - `current`: server.current → `{ combo: stripBy(server.current), by: v(server.current.by) }`（null→null）。
  - `turn`: v(server.turn)；`finished`: 按 server.seats 的 finishRank 1..4 排序，取对应 `v(seat)`。
  - `level`: server.level；`passesInRow`: 0。
  - `lastPlays[viewSeat]` = server.seats[s(viewSeat)].lastPlay（`{cards}`→存为 `{cards} as Combo`，renderPlay 只读 .cards；'pass'/null 原样）。
  - `lastActor`: server.lastActor==null?null:v(server.lastActor)。
  - `match`: `{ levels:[server.levels[base&1], server.levels[1-(base&1)]], trumpTeam: (server.trumpTeam ^ (base&1)) as Team, dealNo: server.dealNo, stuckA:[0,0], over: server.phase==='matchOver', winner: server.winner!=null ? ((server.winner ^ (base&1)) as Team) : null }`。
  - `started`: true；`phase`: server.phase。
  - fire `onChange`。
  - **报牌**（diff 上一 state）：current 由 null/旧 combo 变成新 combo（by 出了新牌）→ fire `onSpeak(comboSpeech(newCombo, level))`；某座 lastPlay 新变 'pass' → fire `onSpeak('不要')`。（comboSpeech 纯函数，复用 `ui/render`。）
  - **结算**：phase 进入 `dealResult`/`matchOver` 且带 `result` → fire `onResult({ settle: 旋转重建的 SettleResult, leftover: result.lastHand })`。SettleResult：`{ match: snapshot.match, winTeam: v?(team)…→ 用 (teamOf(result.ranking[0]) ^ (base&1)), gain, passedA, stuck, demoted }`（teamOf=seat%2，旋转后取 view 队）。
- `snapshot()` 返回最近拼好的 snapshot（无 state 时返回一个空的 playing 占位，避免 mount 前崩）。

- [ ] **Step 1: 写失败单测**（mock io：`emit(type,msg)` 推消息、记录 send）`tests/online-driver.test.ts`：
  - mySeat=2：推一个 `state`（turn=2 服务端）→ `snapshot().state.turn===0`（旋转到 view 自己）；`snapshot().started===true`、`phase==='playing'`。
  - 推 `hand{cards: 5 张}` + `state`(seats[2].count=5) → `snapshot().state.hands[0].length===5` 且是真牌；别家 hands 长度=各自 count、且全是占位（id<0）。
  - `current.by` 服务端=2 → snapshot.current.by===0（旋转）；`lastActor` 同理。
  - `levels`/`trumpTeam` 重映射：mySeat=1（奇）时 `snapshot().match.levels[0]===server.levels[1]`（我方=server 队1）。
  - onChange 每来一个 state 触发一次。
  - 报牌：state.current 从 null→单张 → onSpeak 收到 comboSpeech 文案；某座 lastPlay→'pass' → onSpeak 收到 '不要'。
  - 结算：推 `state{phase:'dealResult', result:{ranking,gain,...,lastHand}}` → onResult 收到 `{settle, leftover===lastHand}`；winTeam 旋转正确。
  - `autoAdvance===true`；`nextDealOrResult()` 不向 io.send 发任何东西（freshMatch 发 restart 在 Task 5 验）。
- [ ] **Step 2:** `npm test -- online-driver` RED。
- [ ] **Step 3:** 实现 `online-driver.ts`（映射 + 事件）。
- [ ] **Step 4:** `npm test -- online-driver` GREEN + `npm run typecheck` + 全套 `npm test` 绿。
- [ ] **Step 5:** Commit `feat(guandan-online): OnlineDriver 状态映射+egocentric旋转(单测·Plan3 Task4)`。

---

### Task 5: OnlineDriver——动作发包 + 进贡 + dispose

**Files:** Modify `src/games/guandan/driver/online-driver.ts`、`tests/online-driver.test.ts`

- [ ] **Step 1: 追加失败单测**：
  - `play([cardA,cardB])`（turn 是我时）→ io.send 收到 `{t:'play',cardIds:[A.id,B.id]}`，返回 true；非我 turn → 返回 false 不发包。
  - `pass()`（我 turn 且 current!=null）→ send `{t:'pass'}` true；current===null→false 不发。
  - 收 `need-tribute{options}` 后下一个 tribute `state` → onTribute fire `{exchanges(旋转), myReturnOptions===options, level, resolve}`；`resolve(cardId)` → send `{t:'tribute-return',cardId}`；非收贡（无 need-tribute）→ onTribute 的 myReturnOptions===null、resolve(null) 不发包。
  - `freshMatch()` → send `{t:'restart'}`（房主再来一盘）。
  - `dispose()` 后再推消息不再 fire 事件（解绑）。
- [ ] **Step 2:** RED。
- [ ] **Step 3:** 实现：`play(cards)`：`if (snapshot.turn!==0||phase!=='playing') return false; send(c2s.play(cards.map(c=>c.id))); return true`。`pass()` 同理（current!=null 守卫）。`need-tribute` handler 存 `myTributeOptions`；进 tribute state 时 fire 归一 onTribute（resolve→`send(c2s.tributeReturn(id))`，清 options）。`freshMatch()`→`send(c2s.restart())`。`dispose()` 解绑 io。`timeoutSeat`/`start`/`nextDealOrResult` no-op。
- [ ] **Step 4:** GREEN + typecheck + 全套 test。
- [ ] **Step 5:** Commit `feat(guandan-online): OnlineDriver 动作发包+进贡还贡+dispose(单测·Plan3 Task5)`。

---

### Task 6: 牌桌 view 注入 driver + `?debug` 本地通路

**Files:** Modify `src/games/guandan/ui/view.ts`、`src/games/guandan/index.ts`

- [ ] **Step 1:** `view.ts`：`export function mount(root)` 改 `export function mountTable(root: HTMLElement, driver: GameDriver): () => void`，删内部 `new LocalDriver()`，用注入的 `driver`。`started` 初值=`driver.snapshot().started`；若**已 started（联机）跳过「开始游戏」遮罩**直接 `renderLevels()+renderAll()`（音频解锁由前置 UI 手势负责，见 Task10）；未 started（本地）保留遮罩→点击 `primeAudio()+driver.start()`。其余（onChange/onResult/onTribute/onSpeak/onHint 接线、弹层、倒计时、dispose）不变。
- [ ] **Step 2:** `index.ts`：`mount(root)` 改成控制器骨架——本任务先只接 `?debug` 通路：
```ts
import { LocalDriver } from './driver/local-driver';
import { mountTable } from './ui/view';
function mount(root: HTMLElement): () => void {
  const debug = new URLSearchParams(location.search).has('debug');
  if (debug) return mountTable(root, new LocalDriver());
  // 正常联机流在 Task 10 接入；本任务先占位回退到 debug 行为，保证可运行
  return mountTable(root, new LocalDriver());
}
export const guandanModule: GameModule = { id:'guandan', name:'掼蛋', desc:'…', mount };
```
- [ ] **Step 3:** `npm run typecheck` + `npm test` 绿。
- [ ] **Step 4: 真机冒烟**：`npm run build` + 跑 `smoke-full.mjs desktop`（走默认 = 当前 LocalDriver 通路）零回归；另手动 `/guandan?debug` 与 `/guandan` 都进本地牌桌正常（过渡态）。
- [ ] **Step 5:** Commit `refactor(guandan): 牌桌 mountTable(root,driver) 注入 + ?debug 本地通路(Plan3 Task6)`。

---

### Task 7: 前置 UI——主题样式 + 昵称页（绿毡金线）

**Files:** Create `src/games/guandan/online/ui/lobby.css`、`online/ui/nickname.ts`

**职责**：`lobby.css` 抽出绿毡金线主题变量（背景绿毡渐变、金线描边、卡片、按钮、嵌字 Noto Sans SC，复用 `guandan.css` 既有色）。`nickname.ts`：`renderNickname(root, { initial, onSubmit(nick) }): cleanup`——居中金线卡片、输入框（预填 localStorage 昵称）、「进入大厅」按钮、判重错误位（外部调 `showNickError()`）。

- [ ] **Step 1:** 写 `lobby.css` 主题 + `nickname.ts`（纯渲染 + 回调，无 WS）。导出 `renderNickname` + `showNickTaken(root)` 提示。
- [ ] **Step 2:** `npm run typecheck` 干净。
- [ ] **Step 3: 真机截图**：临时 harness 挂 `renderNickname` → Playwright 截图（桌面+手机）。**给 owner 看，点头才继续**（绿毡金线质感、输入框、按钮）。
- [ ] **Step 4:** Commit `feat(guandan-online): 大厅绿毡金线主题 + 昵称页(Plan3 Task7)`。

---

### Task 8: 前置 UI——大厅页（建房/匹配/房列表观战）

**Files:** Create `src/games/guandan/online/ui/lobby.ts`

**职责**：`renderLobby(root, { nick, rooms, onCreate(isPrivate), onMatch(), onSpectate(code), onRefresh() }): { update(rooms), cleanup() }`——三主入口卡片（建房/随机匹配/刷新大厅）+ 公开房列表（房号/玩家昵称/人数/状态徽章，playing 房「观战」按钮）。绿毡金线，与牌桌同调。匹配中显示「匹配中…(x/4)」等待态。

- [ ] **Step 1:** 写 `lobby.ts`（纯渲染 + 回调；`update(rooms)` 重渲房列表）。
- [ ] **Step 2:** typecheck 干净。
- [ ] **Step 3: 真机截图**：harness 喂假 rooms 列表 → Playwright 截图（含空列表/多房/匹配中三态）。**给 owner 看点头**。
- [ ] **Step 4:** Commit `feat(guandan-online): 大厅页(建房/匹配/房列表观战)(Plan3 Task8)`。

---

### Task 9: 前置 UI——房间页（四座环桌/挑座/房号/开打/等待）

**Files:** Create `src/games/guandan/online/ui/room.ts`

**职责**：`renderRoom(root, { code, you, isHost, onTakeSeat(seat), onStart(), onLeave() }): { update({seats,status,you}), cleanup() }`——四座环桌（复用座位头像 + 队伍配色，对门 0&2/1&3 同队标注），每座显示昵称/空位「入座」/在线·AI 徽章；顶部房号（可复制邀请）；房主「开打」按钮（坐满 4 真人才亮，否则「等待玩家…」）；「离开」。掉线/重连状态条（`peer-offline/back` 由控制器调 `update`）。

- [ ] **Step 1:** 写 `room.ts`（纯渲染 + 回调；`update` 重渲座位/状态/开打按钮可用性）。
- [ ] **Step 2:** typecheck 干净。
- [ ] **Step 3: 真机截图**：harness 喂房况（空位/坐满/某座 AI/我是房主 vs 否）→ 截图。**给 owner 看点头**（环桌布局、挑座、队友标注、房号复制）。
- [ ] **Step 4:** Commit `feat(guandan-online): 房间页(四座环桌/挑座/房号/开打)(Plan3 Task9)`。

---

### Task 10: 联机控制器——编排 session + UI + 开打挂牌桌（含观战/重连/状态条）

**Files:** Modify `src/games/guandan/index.ts`；Modify `ui/view.ts`（联机状态条）

**职责**：`index.ts` 控制器把 Task3 session + Task7-9 UI + Task4/5 OnlineDriver + Task6 mountTable 串起来。状态机：`nickname → lobby → room(waiting) → table(playing)`，分支 `spectate → table(观战)`。

- [ ] **Step 1:** 控制器骨架（替换 Task6 的占位分支）：
  - `?debug` → `mountTable(root, new LocalDriver())`（不变）。
  - 正常：`new OnlineSession('wss?://host/ws-guandan')`（同源推导 ws/wss + host）；`connect()`；
    - `onOpen` → 若 `savedRoom()` 有 → 自动 rejoin（session 内已做）；否则渲染 `nickname`。
    - `hello-ok`/`rename-ok` → 渲染 `lobby`（发 `lobby` 订阅房列表）。`nick-taken` → `showNickTaken`。
    - `created`/`room` → 渲染/更新 `room`（记 `you`/`isHost`=you===0 且 status waiting 的房主… 用 `room.seats[0]` host 约定：rooms.mjs 房主默认坐 0，但挑座后 host 仍是建房者——控制器据 `created` 自己记 isHost）。
    - `lobby{rooms}` → `lobby.update(rooms)`。`spectating` → 挂观战牌桌。
    - `started` + 首个 `state`/`hand` → `new OnlineDriver(sessionIo, mySeat)`（mySeat 来自最近 `room.you`/`rejoined.seat`/spectate='spectator'）→ `mountTable(root, onlineDriver)`；把后续 `state/hand/need-tribute/peer-*` 喂给 driver/状态条。
    - `peer-offline/back` → 牌桌状态条提示（某座掉线 AI 接管 / 回来）。
    - `room-closed`/`error` → 提示 + 回大厅。
  - **音频解锁**：在 nickname/lobby/room 的首次点击里 `primeAudio()`（导出自 view 或控制器自带），保证联机首次报牌能响。
  - `saveRoom(code, seat)` 在 take-seat/rejoined/started 时写，离开/room-closed 时 clear。
- [ ] **Step 2:** `view.ts` 加**联机状态条**：mountTable 末尾若 `driver` 提供 `peerStatus`（或控制器经回调注入）→ 顶部细条显示「X 掉线，AI 接管 / X 已回来」。最简：导出 `setTableBanner(text)` 由控制器调。
- [ ] **Step 3:** `npm run typecheck` + `npm test` 绿（控制器逻辑尽量薄；可抽纯函数 `pickMySeat`/`wsUrl` 加小单测）。
- [ ] **Step 4: 真机冒烟（关键·见 Task 11）**：本任务先单端跑通：真服务端 + 1 真人建房（其余座靠 Task11 多 context）——至少验昵称→大厅→建房→挑座→（坐满前）等待态、`?debug` 仍本地可玩。
- [ ] **Step 5:** Commit `feat(guandan-online): 联机控制器 编排 session/UI/OnlineDriver 牌桌 + 状态条(Plan3 Task10)`。

---

### Task 11: 真本地 4-context 联机冒烟（收尾验收）

**Files:** Create `sandbox/2026-06-21-guandan-online-smoke/smoke-online.mjs` + `NOTE.md`

**职责**：起**真服务端**（`server/server.mjs`，PORT 注入，无 TLS 走 http/ws）托管 `dist` + `/ws-guandan`；Playwright 开 **4 个 context**（4 个独立"玩家"）+ 可选第 5 个观战；脚本驱动：4 人各 `hello` 不同昵称 → 1 人建房 → 其余 3 人 `join` 同房号 → 各自挑空位 → 房主开打 → 进牌桌。验收：
- 每个 context 只在自己 `.gd-player-hand` 看到 27 张**自己的**牌；DOM 里抓不到别家牌面（占位无花色/点数）。
- 各家轮流出牌/不要推进；egocentric——每个 context 自己都在底部。
- 一人 context 关闭（掉线）→ 其余 3 端看到「AI 接管」状态条、牌局继续不卡。
- 该人重开 context + `rejoin`（sessionStorage）→ 收回座位、看到正确当前态（手牌 + 公开态）。
- 观战 context：只公开态、无手牌、无操作按钮。
- 打到至少一次结算（升级）+ 进贡（含某真人收贡手选 ≤10 → `tribute-return`）。
- 全程各端零 `console.error`/`pageerror`。

- [ ] **Step 1:** 写 `smoke-online.mjs`（spawn server.mjs；4 context 编排；带 4 分钟上限 + 截图各端关键态）。
- [ ] **Step 2:** `npm run build` + 跑 → 全验收点过；截图留证。
- [ ] **Step 3: 给 owner 看截图**（4 端各看各牌 / 掉线接管 / 重连收回 / 观战）。点头。
- [ ] **Step 4:** Commit `test(guandan-online): 真本地 4-context 联机冒烟(Plan3 Task11)`。

---

## Self-Review

- **Spec 覆盖**：SPEC「客户端驱动层改造/前置 UI/协议/进贡还贡/观战/重连/掉线 AI/再来一盘/测试策略」逐项对应——协议(T1)、服务端 restart(TR)、接缝归一(T2)、session 重连(T3)、OnlineDriver 映射+旋转(T4)+动作进贡+freshMatch(T5)、view 注入+?debug(T6)、UI 昵称/大厅/房间(T7-9)、控制器+观战+状态条+isHost(T10)、4-context 真机冒烟(T11)。「整盘重开」服务端 restart 已纳入本计划(TR)；其 live 验证靠 TR 服务端单测 + T5 客户端单测（4-context 冒烟预算内打不到 matchOver）。多页 E2E 固化 + 公网部署属 Plan 4。
- **Placeholder 扫描**：无 TBD。逻辑任务(T1-6)给全类型/全单测；UI 任务(T7-9)给确切函数签名 + 截图验收（owner 点头是真实验收门，符合其工作法）；控制器(T10)给状态机分支清单。
- **类型一致**：`GameSnapshot{...,phase}`、`DealOutcome{settle,leftover}`、`TributePrompt{exchanges,myReturnOptions,level,resolve(cardId|null)}`、`GameDriver.autoAdvance`、`OnlineDriver(io,mySeat)`、旋转 `v/s`、协议 `c2s.*`/`S2CMessage` 全计划统一。
- **风险**：① 两弹层数据源分歧——T2 归一是关键缝，本地零回归靠真机冒烟守。② egocentric 旋转含队伍维度——T4 单测正负向覆盖奇偶 mySeat。③ 联机无「下一局」/「再来一盘」——autoAdvance + 服务端缺口已明确。④ iOS 音频——前置 UI 手势 prime。
