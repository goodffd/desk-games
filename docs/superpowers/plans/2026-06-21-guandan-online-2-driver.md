# 掼蛋联机 · Plan 2：客户端驱动层重构 实现计划

> **执行方式（重要）：本计划 INLINE 由主控自己执行（executing-plans / 手动），不派 fresh subagent。** 原因：这是对单个 842 行 `view.ts` 的紧耦合重构（渲染/游戏逻辑/AI/进贡/弹层共享同一批可变闭包变量），fresh-context subagent 每个任务都得重新吃下整个文件、极易顾此失彼；且验证主要靠 Playwright 真机冒烟而非单测。按 subagent-driven-development 自己的决策树「紧耦合 → 手动执行」。每步改完**立即真机冒烟**确认本地(调试)模式零回归。

**Goal:** 把 `view.ts` 里的「本地引擎 + AI + 状态推进 + 进贡」抽到 `LocalDriver`，view 通过 `GameDriver` 接口读快照/调动作/订阅事件渲染，本地(调试)模式所有 UI 行为零回归——为 Plan 3 接 `OnlineDriver` 铺好同一条缝。

**Architecture:** 最小侵入缝：view 保留 `state/match/lastPlays/lastActor/started` 作**只读镜像**变量（渲染函数原样不改），由 `driver.onChange` 回调把 `driver.snapshot()` 拷进镜像后 `renderAll()`。游戏逻辑（出牌/不要/afterAction/AI 调度/超时托管/局终结算/进贡决策）搬进 `LocalDriver`，通过事件（`onChange/onResult/onTribute/onSpeak/onHint`）驱动 view 的弹层/语音/提示。引擎仍唯一真相。

**Tech Stack:** TS（复用引擎 `engine`/`ai`/`match`）+ vitest（LocalDriver 纯逻辑单测）+ Playwright 系统 Chrome 真机冒烟（view 重构零回归验证）。

## Global Constraints

- **引擎唯一真相**：driver 只调 `engine`/`ai`/`match` 导出，不另写规则。
- **本地模式零回归**：这阵子打磨的全部行为必须照旧——27 张牌面/列叠/手机旋转、出牌-不要按钮（人像左右、`@media(hover)`、不要标签同款深底）、手牌透明（轮到我盖回 z8、否则逐张相交 dim）、进贡/还贡弹层（含双贡、抗贡、人类手选≤10、AI autoReturn）、20s 倒计时闹钟+超时托管、报牌语音、末游剩牌、再来一盘、开始游戏遮罩（点后才发牌）。每步真机冒烟比对。
- **OnlineDriver 不在本计划**（Plan 3）。本计划 view 仍只挂 `LocalDriver`；`?debug` 入口分流留到 Plan 3 接 OnlineDriver 时才有意义——本计划只把 mount 改成「经 GameDriver 接口用 LocalDriver」。
- **HUMAN_SEAT=0**；座位 0下/1右/2上/3左。
- **验证命令**：`npm test`（vitest 全绿，含新 LocalDriver 单测）+ `npm run typecheck`；真机冒烟用本地 18099 静态服 + Playwright（`channel:'chrome'`，`runFor` 非 fastForward，fill 后 blur，选牌用 `page.click`/dispatch pointerdown）。

## 复用的引擎接口（已存在，勿改）

`createDeal/play/pass/isDealOver/ranking` (game.ts)、`startMatch/dealLevel/settleDeal/planTribute/returnableCards/autoReturn/applyTribute` (match.ts)、`isLegalPlay` (legal.ts)、`choosePlay` (ai.ts)、`deal/makeDeck/sortHand/rankValue` (cards.ts)。

## File Structure

```
src/games/guandan/
├── driver/
│   ├── types.ts            # 新：GameDriver 接口 + GameSnapshot + 事件回调类型
│   └── local-driver.ts     # 新：LocalDriver——本地引擎+AI+进贡，发事件（从 view.ts 抽出的逻辑）
└── ui/view.ts              # 改：删内联游戏逻辑；持 driver；onChange 镜像快照→renderAll；
                            #     弹层/语音/提示/超时托管 改由 driver 事件驱动；动作转 driver
tests/
└── local-driver.test.ts    # 新：LocalDriver 纯逻辑单测（play/pass→快照+事件；进贡 plan→onTribute）
```

**职责边界**
- `LocalDriver`：**只管牌局逻辑 + AI 调度 + 进贡决策**，不碰 DOM。持 `match/state/lastPlays/lastActor/started`，对外暴露 `snapshot()` + 动作方法 + 事件订阅。AI 延时/语音时机通过注入的 `schedule(fn, ms)`（默认 `setTimeout`）解耦，便于单测用即时调度。
- `view.ts`：**只管 DOM 渲染 + 交互 + 弹层/语音**。渲染读镜像变量（不变）；动作调 `driver`；弹层/语音/提示/倒计时由 driver 事件触发。

## 接口契约（Task 1 定义，后续任务遵守）

```ts
// driver/types.ts
import type { Card, Seat, Rank } from '../engine/types';
import type { DealState } from '../engine/game';
import type { MatchState, TributePlan } from '../engine/match';

export type LastPlays = Record<Seat, { combo: import('../engine/types').Combo } | 'pass' | null>;

/** view 渲染所需的全部只读快照（沿用现有形状，不新造 view-model）。 */
export interface GameSnapshot {
  state: DealState;          // 本局引擎态（含 hands：本地全可见；Plan3 OnlineDriver 用占位长度填别家）
  match: MatchState;         // 整盘态（级别/庄家/打A）
  lastPlays: LastPlays;      // 各家桌面上一手
  lastActor: Seat | null;    // 最近出牌/不要者
  started: boolean;          // 是否已点开始
}

/** 进贡阶段交给 view 弹层处理；view 收齐还贡后调 resolve(returns) 让 driver 应用并开局。 */
export interface TributePrompt {
  dealt: Card[][];           // 本局发到的手牌（含进贡前）
  plan: TributePlan;
  level: Rank;
  resolve: (returns: Card[]) => void;
}

export interface GameDriver {
  snapshot(): GameSnapshot;
  start(): void;                          // 点开始游戏：本地=发牌+(若非我回合)起 AI；触发 onChange
  play(cards: Card[]): boolean;           // 出牌（返回是否合法/已受理）
  pass(): boolean;                        // 不要
  timeoutSeat(seat: Seat): void;          // 回合超时托管（本地：用 choosePlay 替该座出一手）
  nextDealOrResult(): void;               // 一局结束后推进：结算→onResult；点「下一局」→进贡/开新局
  freshMatch(): void;                     // 再来一盘
  onChange(cb: () => void): void;         // 状态变→view 拷快照+renderAll
  onResult(cb: (settle: SettleResult) => void): void; // 一局结束→view 弹 showResult(读 settle 升级数/过A/卡A/降级)
  onTribute(cb: (p: TributePrompt) => void): void; // 进贡阶段→view 弹 showTribute
  onSpeak(cb: (text: string) => void): void;       // 报牌/不要语音
  onHint(cb: (text: string, kind: 'info'|'warn') => void): void; // 文案提示
  dispose(): void;                        // 清定时器
}
```

> 注：`onResult`/进贡/下一局的编排——本地现状是「出完牌 isDealOver → showResult 弹层，弹层里「下一局」按钮 → nextDeal → 进贡」。重构后：driver 在 afterAction 检测 isDealOver → `settleDeal`（更新 match）→ fire `onResult(settle)`；view 的 showResult 弹层「下一局」按钮 → `driver.nextDealOrResult()` → driver 算 planTribute → fire `onTribute`（或抗贡直接开局 fire onChange+onHint）。`freshMatch` 同理由「再来一盘」按钮调。
>
> **执行中修订（2026-06-21，Task 2 实施时）**：
> - `onResult` 由原计划的 `() => void` 改为 **`(settle: SettleResult) => void`**：showResult 渲染升级弹层需要 `gain/passedA/stuck/demoted/winTeam`——这些是 `settleDeal` 的派生返回值，并非全存于 `MatchState`，无法仅凭 snapshot.match 重建。settle 移进 driver（为 OnlineDriver 用服务端结果铺路）后，必须经 onResult 载荷递给 view。Task 1 的 `driver/types.ts` 已同步（import `SettleResult`）。
> - 关于进贡结果提示文案（「X进贡♥给Y」用 `SEAT_LABELS`/`cardBrief`，属展示层）：driver **不**构建该串，仅 `onTribute` 递 `{dealt,plan,level,resolve}`；view 在 `resolve` 后自行用 plan/level 拼提示。driver 的 `onHint` 只发**无座位/牌标签的固定串**（抗贡「对方持两张大王…」），保持 driver 不依赖 UI 标签。
> - `LocalDriver` 构造注入项最终定为 `{ shuffle?, schedule?, clearScheduled?, speechBusyMs?, firstLeader? }`：`speechBusyMs()` 由 view 喂语音结束剩余 ms（替代 DOM 里的 `gdSpeakEndAt - performance.now()`，driver 保持 DOM-free）；`firstLeader()` 让单测可定首攻、确定性验「非我回合 AI 自动推进」。`comboSpeech`（纯字符串函数）由 driver 从 `../ui/render` import 构建 onSpeak 文本。

---

### Task 1: 定义 GameDriver 接口 + 快照/事件类型

**Files:** Create `src/games/guandan/driver/types.ts`

- [ ] **Step 1**：按上方「接口契约」写 `driver/types.ts`（纯类型 + 接口，无运行时代码）。`LastPlays` 复用现有 view.ts 里 `lastPlays` 的形状（`Record<Seat, {combo}|'pass'|null>`）。
- [ ] **Step 2**：`npm run typecheck` 干净（纯类型文件，应无报错）。
- [ ] **Step 3**：Commit `feat(guandan-online): GameDriver 接口 + 快照/事件类型`。

---

### Task 2: LocalDriver——抽出本地牌局逻辑 + 事件（含单测）

**Files:** Create `src/games/guandan/driver/local-driver.ts` + `tests/local-driver.test.ts`

**Interfaces:**
- Consumes: Task 1 `GameDriver/GameSnapshot/TributePrompt`；引擎全套。
- Produces: `class LocalDriver implements GameDriver`，构造 `new LocalDriver(opts?: { shuffle?: (n)=>number[]; schedule?: (fn,ms)=>number; clearScheduled?: (id)=>void })`（默认 `randomShuffle`/`setTimeout`/`clearTimeout`；单测注入即时 `schedule=(fn)=>{fn();return 0}`）。

把 view.ts 现有这些函数的**逻辑**搬进来（不带 DOM）：`startNewDeal`（发牌+排序+首攻）、`applyPlay`/`applyPass`（含 `lastPlays`/`lastActor` 维护、`wasLead` 清圈、`speak` → 改 fire `onSpeak`）、`afterAction`（isDealOver → fire `onResult`；否则若非我回合 → `scheduleAi`）、`scheduleAi`（AI 用 `choosePlay`，延时用注入 schedule）、`timeoutSeat`（=现 autoPlayTimeout 的 choosePlay 兜底）、`nextDealOrResult`（=现 showResult 的 settle 部分 + nextDeal 的 planTribute 分流：抗贡 fire onChange+onHint 直接开局；否则 fire `onTribute`）、`freshMatch`、进贡 resolve（applyTribute + startNewDeal + 起 AI）。`settleDeal` 在 driver 内做（match 更新）。

- [ ] **Step 1: 写失败单测** `tests/local-driver.test.ts`（即时 schedule、固定 shuffle）：
  - `start()` 后 `snapshot().state` 有 4×27 张、`started===true`；非我回合时 AI 已自动推进（turn 前移或本局推进）。
  - 人类 `play(合法单张)` → snapshot.state.turn 前移、该座 lastPlays 有值、onChange 被触发；非法 `play` → 返回 false、state 不变。
  - 全程 onSpeak 在出牌/不要时被调用（报牌文案非空）。
  - 一局打完（注入 choosePlay 自对到底）→ onResult 触发一次。
  - 进贡：构造「非抗贡」名次 → `nextDealOrResult()` → onTribute 触发、`prompt.plan.exchanges` 非空；调 `prompt.resolve(autoReturn 兜底)` → onChange 触发、新局开始。
- [ ] **Step 2**：`npm test -- local-driver` RED（模块缺失）。
- [ ] **Step 3**：实现 `local-driver.ts`（搬逻辑 + 事件）。
- [ ] **Step 4**：`npm test -- local-driver` GREEN + `npm run typecheck` 干净 + 全套 `npm test` 绿。
- [ ] **Step 5**：Commit `feat(guandan-online): LocalDriver 抽出本地牌局逻辑+AI+进贡(单测)`。

---

### Task 3: view.ts 接 driver（渲染读镜像，零回归）—— 第 1 步：引入 driver + onChange 镜像

**Files:** Modify `src/games/guandan/ui/view.ts`

只做「渲染来源切换」，**不动渲染函数体**：
- mount 顶部 `let state/match/lastPlays/lastActor/started` 保留为**镜像**变量。
- 新建 `const driver = new LocalDriver()`；`driver.onChange(() => { const s = driver.snapshot(); state = s.state; match = s.match; lastPlays = s.lastPlays; lastActor = s.lastActor; started = s.started; renderAll(); })`。
- 把现有内联 `applyPlay/applyPass/afterAction/scheduleAi/autoPlayTimeout/startNewDeal/nextDeal/freshMatch/startDealAfterTribute/showTribute-onDone/showResult-settle` 这些**逻辑**调用点逐个改为 driver 方法/事件（分步，见 Task 4/5）。本任务先把「开始游戏」与「出牌/不要/超时」三条主路径切到 driver，并用 onChange 统一渲染。

- [ ] **Step 1**：引入 driver + onChange 镜像 + onSpeak→speak + onHint→showHint 订阅。
- [ ] **Step 2**：`handlePlay`→`driver.play(cards)`；`handlePass`→`driver.pass()`；start 遮罩点击→`driver.start()`；`tickTurn` 超时→`driver.timeoutSeat(seat)`。删掉 view 内联的 `applyPlay/applyPass/afterAction/scheduleAi/autoPlayTimeout`（逻辑已在 driver）。
- [ ] **Step 3**：`npm run typecheck` + `npm test` 绿。
- [ ] **Step 4: 真机冒烟（关键）**：本地 18099 + Playwright——开始游戏→发牌→人类出一手合法牌→AI 接着出；验：手牌渲染/张数/出牌区/语音不报错/倒计时在跑；手牌透明(轮到我 z8、别家压到 dim)行为照旧。截图比对无回归。
- [ ] **Step 5**：Commit `refactor(guandan): view 出牌/不要/开始/超时 改走 LocalDriver(onChange统一渲染)`。

---

### Task 4: view.ts 接 driver —— 第 2 步：局终结算 + 下一局 + 进贡弹层

**Files:** Modify `src/games/guandan/ui/view.ts`

- [ ] **Step 1**：`driver.onResult(() => showResult())`；`showResult` 删掉内部 `settleDeal`（driver 已结算，view 只读 snapshot 的 match/名次渲染弹层）；弹层「下一局」按钮→`driver.nextDealOrResult()`；「再来一盘」→`driver.freshMatch()`。
- [ ] **Step 2**：`driver.onTribute((p) => showTribute(p.dealt, p.plan, p.level, p.resolve))`；`showTribute` 的 `onDone(returns)` 改为调 `p.resolve(returns)`（driver 内 applyTribute+开局）；删 view 内联 `nextDeal/startDealAfterTribute` 逻辑（移交 driver）。
- [ ] **Step 3**：`npm run typecheck` + `npm test` 绿。
- [ ] **Step 4: 真机冒烟**：自对局打完一局→结算弹层（升级数/名次/末游剩牌）→「下一局」→进贡弹层（造一个含人类收贡的局面验手选≤10；及抗贡提示）→开新局。双贡 UI 也过一眼。截图比对无回归。
- [ ] **Step 5**：Commit `refactor(guandan): view 结算/下一局/进贡弹层 改走 LocalDriver 事件`。

---

### Task 5: 清理 + 全量真机冒烟回归

**Files:** Modify `src/games/guandan/ui/view.ts`（删残留死代码）

- [ ] **Step 1**：删 view.ts 里已移交 driver 的死代码与未用 import（`startMatch/settleDeal/planTribute/applyTribute/...` 若 view 不再直接用则移除 import；`scheduleAi/autoPlayTimeout/applyPlay/applyPass/nextDeal/startDealAfterTribute` 残骸清掉）。`npm run typecheck` 干净（无未用）。
- [ ] **Step 2: 全量真机冒烟（桌面+手机各一遍）**：开始游戏(点后才发牌)→整局出牌/不要/逢人配/对王→倒计时超时托管→结算→下一局进贡(单贡/双贡/抗贡/人类还贡)→升级→再来一盘；逐项核对本地模式 UI 全行为：牌面/列叠/旋转、出牌-不要按钮位置与颜色与 hover、手牌透明(轮我恢复/别家压到 dim/不要标签)、语音报牌、末游剩牌、顶栏级别居中。截图与重构前比对，确认零回归。
- [ ] **Step 3**：Commit `refactor(guandan): 清理 view 移交后的死代码；本地模式全量冒烟零回归`。

---

## Self-Review

- **Spec coverage**：SPEC「客户端驱动层改造」要的 `GameDriver`(T1)/`LocalDriver`(T2)/view 读 view-model 调 driver(T3-4)/本地零回归(T3-5 冒烟)/引擎唯一真相(全程 import) 均有任务。`OnlineDriver` + `?debug` 分流明确属 Plan 3，本计划仅打好接口缝（已在 Global Constraints 写明）。
- **Placeholder 扫描**：无 TBD。T2 的「搬逻辑」列了具体函数清单；冒烟步列了具体核对项。
- **类型一致**：`GameSnapshot{state,match,lastPlays,lastActor,started}`、`TributePrompt{dealt,plan,level,resolve}`、`GameDriver` 方法名（start/play/pass/timeoutSeat/nextDealOrResult/freshMatch/onChange/onResult/onTribute/onSpeak/onHint/snapshot/dispose）全计划统一。
- **风险**：view.ts 紧耦合大文件——故 INLINE 执行 + 每任务真机冒烟，分 3 步(T3 动作/T4 弹层/T5 清理)逐步切、可随时回退单步。镜像变量法让渲染函数体零改动是降回归的关键。
