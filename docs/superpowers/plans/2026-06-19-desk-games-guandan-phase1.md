# desk-games 一期（游戏厅壳 + 掼蛋单局对 AI）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做一个游戏厅首页（游戏列表→点击进入），首发掼蛋单局对 3 AI，规则零错。

**Architecture:** 纯函数引擎（无 DOM，唯一真相）+ DOM/CSS 界面 + 启发式 AI；外层游戏厅壳用 hash 路由把每个 GameModule 挂到首页列表。Vite 构建单 HTML 文件。掼蛋按标准淮安规则，"无 bug"靠 vitest 穷举单测 + 模糊自对局 + Playwright 真机冒烟三层兜。

**Tech Stack:** TypeScript（strict）+ Vitest + Vite + vite-plugin-singlefile；零运行时依赖；内嵌霞鹜文楷子集字体。

## Global Constraints
- `src/games/*/engine/` 与 `src/shell/` **绝不 import DOM**；UI/AI 不复制规则判定，engine 唯一真相。
- 掼蛋规则 = `projects/desk-games/SPEC.md`「掼蛋规则」节，逐字为准：两副 108 张、4 座逆时针 `0下/1右/2上/3左`、`(i+1)%4` 推进、`0&2` 对家、各 27 张、打 2、红心 2 逢人配（0~2 张，不组四大天王）。
- 牌型集合（恰好这些）：单/对/三同/三带二/顺子(5)/连对(3连对,6)/钢板(2连三,6)/炸弹(≥4)/同花顺(5)/四大天王(2大+2小)。
- 炸弹强弱：`4炸 < 5炸 < 同花顺 < 6炸 < 7炸 < 8炸 < 四大天王`；炸弹类压一切非炸弹。
- 单张序：`3<4<…<K<A<级牌(2)<小王<大王`；顺子/连对/钢板用**自然序**（A 可高可低、不循环；级牌按自然点）。
- 首攻随机一位玩家；逆时针跟牌；接风（出牌权落到已出完者→对家接，否则 `(i+1)%4` 顺延下一位有牌者）。
- 牌用 `id:0..107` 唯一标识，任意时刻 4 手牌+已出牌并集 = 全 108 张（守恒不变量）。
- TS strict；每个规则改动先红后绿；禁注释报错绕过。
- 公网信息脱敏：象棋外链 URL 不进仓库（占位 + 本地配置）。

---

## 文件结构（先锁定，再拆任务）
```
desk-games/
├── package.json tsconfig.json vite.config.ts index.html
├── src/
│   ├── main.ts                         # 入口：建壳 + 注册游戏
│   ├── shell/
│   │   ├── types.ts                    # GameModule 接口 + GameEntry
│   │   ├── registry.ts                 # 注册表（掼蛋内置 + 象棋外链占位）
│   │   ├── home.ts                     # 列表首页渲染
│   │   ├── router.ts                   # hash 路由：list ↔ mount(游戏)
│   │   └── shell.css
│   ├── games/guandan/
│   │   ├── engine/
│   │   │   ├── types.ts                # Card/Combo/State 等类型
│   │   │   ├── cards.ts                # 建牌/发牌/单张序/序列化
│   │   │   ├── combos.ts               # 牌型识别 + 比大小（不含通配）
│   │   │   ├── wild.ts                 # 逢人配：含红心2 的识别（封装 combos）
│   │   │   ├── legal.ts                # 合法跟牌枚举
│   │   │   └── game.ts                 # 单局状态机：出牌/不要/接风/名次
│   │   ├── ai/ai.ts                    # choosePlay 启发式（纯函数）
│   │   ├── ui/{view.ts,render.ts,guandan.css}   # GameModule 实现 + DOM
│   │   └── index.ts                    # 导出 guandanModule: GameModule
│   └── ui/fonts/                       # 内嵌字体子集(woff2,OFL)+许可证
└── tests/*.test.ts
```

## 类型契约（engine/types.ts，所有任务共用，逐字一致）
```ts
export type Suit = 'S' | 'H' | 'D' | 'C';                 // ♠♥♦♣
export type Rank = 2|3|4|5|6|7|8|9|10|11|12|13|14;        // 2..10, J=11 Q=12 K=13 A=14
export type Card =
  | { kind: 'normal'; suit: Suit; rank: Rank; id: number } // id 唯一 0..107
  | { kind: 'joker'; big: boolean; id: number };           // big=true 大王, false 小王
export const LEVEL: Rank = 2;                              // 一期固定打 2

export type ComboType =
  | 'single' | 'pair' | 'triple' | 'tripleWithPair'
  | 'straight' | 'consecPairs' | 'consecTriples'
  | 'bomb' | 'straightFlush' | 'kingBomb';

// key=主点数（顺子/连对/钢板取最高位自然序；三带二取三同点；单/对/三取该点）
// power=跨牌型比较用的全序（仅炸弹类间 + 压非炸弹时用）；非炸弹 power=0
export interface Combo { type: ComboType; cards: Card[]; length: number; key: number; power: number; }

export type Seat = 0 | 1 | 2 | 3;                          // 0下 1右 2上 3左；逆时针 (i+1)%4
```
派生约定：
- 单张点序值 `rankValue(card, level)`：3→3 … A→14，级牌→15，小王→16，大王→17。
- `power` 量纲（仅炸弹类>0）：`4炸=100+key … 8炸=400+key`、`同花顺=250+key`、`四大天王=99999`。即 4炸(1xx)<5炸(2xx 区间需保证 <同花顺<6炸)。**实现时用分档常量保证 SPEC 的强弱链**：`bombPower(n张)`：n=4→1_000_000+key，n=5→2_000_000+key，同花顺→3_000_000+key，n=6→4_000_000+key，n=7→5_000_000+key，n=8→6_000_000+key，四大天王→9_000_000。任务 4/5 以此为准。

---

### Task 1: 项目脚手架 + 工具链
**Files:**
- Create: `package.json` `tsconfig.json` `vite.config.ts` `index.html` `src/main.ts` `tests/smoke.test.ts`
- Create 空目录占位：`src/shell/` `src/games/guandan/engine/` `src/games/guandan/ai/` `src/games/guandan/ui/`

**Interfaces:** Produces：可运行的 `npm test`/`npm run build`/`npm run typecheck`。

- [ ] Step 1: 写 `package.json`（scripts: `dev`=vite, `build`=`tsc --noEmit && vite build`, `test`=`vitest run`, `typecheck`=`tsc --noEmit`；devDeps: typescript ^5.5, vite ^5.4, vite-plugin-singlefile ^2, vitest ^2）。
- [ ] Step 2: `tsconfig.json`（`strict:true`, `noUncheckedIndexedAccess:true`, `target ES2020`, `moduleResolution bundler`）。
- [ ] Step 3: `vite.config.ts`：引 `viteSingleFile()`，`build.assetsInlineLimit` 设大（≥4MB 以内联字体）。
- [ ] Step 4: `index.html`：`<div id="app"></div>` + `<script type="module" src="/src/main.ts">`。`src/main.ts` 暂渲染 `app.textContent='desk-games'`。
- [ ] Step 5: `tests/smoke.test.ts`：`it('1+1', () => expect(1+1).toBe(2))`。
- [ ] Step 6: `npm install` → `npm test`（PASS）→ `npm run build`（产出 `dist/index.html`）→ `npm run typecheck`（无错）。
- [ ] Step 7: `git init` + `.gitignore`(node_modules,dist) + commit `chore: scaffold desk-games`。

**验收**：三命令全过、dist 单文件存在。

---

### Task 2: 牌模型 + 牌堆 + 发牌 + 单张序
**Files:** Create `src/games/guandan/engine/types.ts`（上方契约全文）、`engine/cards.ts`、`tests/cards.test.ts`

**Interfaces:** Produces:
- `makeDeck(): Card[]`（108 张，id 0..107 唯一）
- `deal(deck: Card[], shuffle: (n:number)=>number[]): Card[][]`（返回 4 手各 27；`shuffle` 为可注入的洗牌索引生成器，便于确定性测试）
- `rankValue(c: Card, level: Rank): number`（3..14，级牌→15，小王→16，大王→17）
- `sortHand(cards: Card[], level: Rank): Card[]`（升序，稳定）
- `cardStr(c: Card): string`（如 `S2`/`HA`/`jB`/`jS`，调试/测试用）

- [ ] Step 1: 写 `tests/cards.test.ts`：① `makeDeck().length===108` 且 `new Set(ids).size===108`；② 普通牌每种花色点数恰 2 张、大小王各 2 张；③ `deal` 用恒等 shuffle → 4×27、并集=全牌；④ `rankValue(级牌2)=15 > rankValue(A)=14`，`大王=17>小王=16>级牌`。
- [ ] Step 2: 运行测试 → FAIL（函数未定义）。
- [ ] Step 3: 实现 `types.ts` + `cards.ts`。
- [ ] Step 4: 运行 → PASS。
- [ ] Step 5: commit `feat(guandan): card model + deal + ranking`。

**验收**：cards.test 全绿；牌数/唯一性/单张序正确。

---

### Task 3: 牌型识别 + 比大小（不含逢人配）
**Files:** Create `engine/combos.ts`、`tests/combos.test.ts`

**Interfaces:** Produces:
- `identify(cards: Card[], level: Rank): Combo | null`（输入一组牌，返回唯一牌型或 null=非法）
- `beats(a: Combo, b: Combo): boolean`（a 能否压 b：同型同长比 key；炸弹类按 power 压非炸弹/互比）
- `bombPower(combo)` 内部用上方分档常量。
- 约定：含王的牌（除四大天王）不参与顺子/连对/钢板；四大天王=恰 2 大+2 小。

- [ ] Step 1: 写 `tests/combos.test.ts` 穷举各型**正例+反例**：
  - 单/对/三：`identify([S5,H5])→pair key=5`；`[S5,H6]→null`。
  - 三带二：`333+22→tripleWithPair key=3`；`333+2→null`；`333+44`(对)→OK。
  - 顺子：`34567→straight key=7`；`A2345→straight key=5(自然低)`；`10JQKA→key=14`；`JQKA2`(2 非自然连)→null；长度≠5→null。
  - 连对：`334455→consecPairs key=5`；`33445`→null；`AA2233`(跨循环)→null。
  - 钢板：`333444→consecTriples key=4`；`333445`→null。
  - 炸弹：`5555→bomb 4炸 key=5`；`55555→5炸`。
  - 同花顺：`同花♠34567→straightFlush key=7`；非同花→普通顺子。
  - 四大天王：`大大小小→kingBomb`。
  - 比大小：`66 beats 55`；`5555(炸) beats 任意对子`；power 链：`bomb4 < bomb5 < straightFlush < bomb6 < bomb7 < bomb8 < kingBomb`（逐对断言）；同型不同长不可比→`beats=false`。
- [ ] Step 2: 运行 → FAIL。
- [ ] Step 3: 实现 `combos.ts`（识别按"分组计数 + 连续性"判定；`beats` 先判炸弹类覆盖再同型比 key）。
- [ ] Step 4: 运行 → PASS（含全部反例）。
- [ ] Step 5: commit `feat(guandan): combo identify + compare (no wildcard)`。

**验收**：combos.test 全绿，牌型集合与炸弹链与 SPEC 完全一致。

---

### Task 4: 逢人配（红心级牌通配）
**Files:** Create `engine/wild.ts`、`tests/combos-wild.test.ts`

**Interfaces:** Produces:
- `identifyWithWild(cards: Card[], level: Rank): Combo | null`：cards 可含 0~2 张红心级牌（`kind:'normal',suit:'H',rank:level`）当通配；返回这组牌**能构成的最大可行牌型**（无则 null）。通配不可用于 kingBomb。
- `wildCount(cards, level): number`。
- 内部：把通配枚举指派为各候选普通牌，复用 `identify`，取合法且 key 最优解。

- [ ] Step 1: 写 `tests/combos-wild.test.ts`：
  - `H2(wild)+S5 → pair key=5`（配成对）；`H2+H2+S5 → triple? ` 视输入张数定（2 wild+1 → triple key=5）。
  - 顺子缺张：`3 4 _ 6 7`(用 1 wild 配 5)→straight key=7。
  - 连对/钢板含 wild：`33 44 H2x?`…（给具体张：`3 3 4 4 H2 H2`→consecPairs 334455? wild 双配 5 5 → key=5`）。
  - 炸弹：`5 5 5 H2 → bomb 4炸 key=5`；`5 5 5 H2 H2 → 5炸`。
  - 同花顺：`♠3 4 5 6 H2 → straightFlush`（wild 配 ♠7 或 ♠2？取最优 key）。
  - **禁止**：`大 大 小 H2 → null`（wild 不可凑四大天王，只 3 王也非 kingBomb）。
  - 单张 wild：`identifyWithWild([H2]) → single key=15`（按级牌）。
- [ ] Step 2: 运行 → FAIL。
- [ ] Step 3: 实现 `wild.ts`：分离 wild 与实牌，对 1~2 张 wild 做候选点/花色枚举（炸弹/同花顺/顺子需考虑花色与点），调 `identify` 校验，返回 key 最大的合法 Combo；kingBomb 路径排除 wild。
- [ ] Step 4: 运行 → PASS。
- [ ] Step 5: commit `feat(guandan): 逢人配 wildcard combos`。

**验收**：combos-wild.test 全绿；wild 各型正确、不越级凑天王炸。

---

### Task 5: 合法跟牌枚举
**Files:** Create `engine/legal.ts`、`tests/legal.test.ts`

**Interfaces:** Produces:
- `enumerateLeads(hand: Card[], level: Rank): Combo[]`（首攻：手牌能组的所有合法牌型，去重）
- `enumerateFollows(hand: Card[], current: Combo, level: Rank): Combo[]`（能压 current 的所有出法，含炸弹）
- `isLegalPlay(cards: Card[], current: Combo | null, hand: Card[], level: Rank): boolean`（UI 校验：所选 cards 是合法牌型且(首攻|压过 current)且 ⊆ hand）

- [ ] Step 1: 写 `tests/legal.test.ts`：
  - 手 `[S3,S4,S5,S6,S7,H9,H9]`，current=`pair 8` → follows 含 `pair 9`、不含单/顺；current=null → leads 含 `straight 3-7`、`pair 9` 等。
  - 有炸弹时 follows 始终含该炸弹（任意 current）。
  - `isLegalPlay`：选不属手牌的牌→false；选非法组合→false；首攻任意合法→true；跟牌未压过→false。
  - 含 wild：手有 `H2`，current=`pair 9` → follows 含 `H2 + 单张配对` 压过的对子（如 `H2+10` 配成 1010? 不——`H2+10→pair 10` 压 9）。
- [ ] Step 2: 运行 → FAIL。
- [ ] Step 3: 实现 `legal.ts`（生成候选子集→`identifyWithWild`→筛 `beats(current)`；用 Map 去重；炸弹单独枚举所有 ≥4 同点/同花顺/天王炸）。注意性能：27 张枚举须按牌型结构化生成，**不**做 2^27 全子集。
- [ ] Step 4: 运行 → PASS。
- [ ] Step 5: commit `feat(guandan): legal play enumeration`。

**验收**：legal.test 全绿；枚举不爆栈、含炸弹与 wild。

---

### Task 6: 单局状态机（出牌/不要/接风/名次）
**Files:** Create `engine/game.ts`、`tests/game.test.ts`

**Interfaces:** Produces:
- `createDeal(hands: Card[][], firstLeader: Seat, level: Rank): DealState`
- `DealState { hands: Card[][]; current: { combo: Combo; by: Seat } | null; turn: Seat; passesInRow: number; finished: Seat[]; level: Rank; }`
- `play(s: DealState, seat: Seat, cards: Card[]): DealState`（不可变；非法抛错）
- `pass(s: DealState, seat: Seat): DealState`
- `isDealOver(s): boolean`（finished.length===4 或 3——末游可不必出）→ 约定 finished 记 4 个名次（最后剩 1 家自动末游）。
- `ranking(s): Seat[]`（头游→末游）；`levelGain(s): { team: 0|1; gain: 1|2|3 }`（头游方按对家名次）。

- [ ] Step 1: 写 `tests/game.test.ts`：
  - 构造确定手牌小局，脚本化出牌打到 4 人空：断言 `ranking` 唯一排列、`finished` 顺序正确。
  - **接风**：构造头游出完且本圈无人压 → 下一手 `turn === 头游对家`（且 current 清空、可自由出）。
  - 三家连续 `pass` → 最后出牌者 `turn` 重获出牌权、current 清空。
  - **不变量**（每步后）：四手牌+已出（用 finished 推进推算）并集 id 集合 = 108、无重复。
  - 非法出牌（不压过/不属手牌）→ 抛错，状态不变。
  - `levelGain`：对家二游→gain 3；三游→2；末游→1。
- [ ] Step 2: 运行 → FAIL。
- [ ] Step 3: 实现 `game.ts`（纯函数不可变更新；turn 用 `(i+1)%4` 跳过 finished；接风：当 `current.by` 已 finished 且一圈结束，下一 leader=对家或顺延；牌数守恒断言可在 dev 下加）。
- [ ] Step 4: 运行 → PASS。
- [ ] Step 5: commit `feat(guandan): single-deal state machine + 接风`。

**验收**：game.test 全绿；接风/名次/守恒正确。

---

### Task 7: AI 出牌策略
**Files:** Create `ai/ai.ts`、`tests/ai.test.ts`

**Interfaces:** Produces:
- `choosePlay(s: DealState, seat: Seat): Card[] | null`（null=不要；返回的 cards 必合法）

- [ ] Step 1: 写 `tests/ai.test.ts`：
  - 返回值要么 null（仅当非首攻且可不要），要么 `isLegalPlay(返回, s.current?.combo??null, hand, level)===true`。
  - 首攻时必不返回 null（手里有牌就得出）。
  - 跑 200 个随机局面，`choosePlay` 永远合法、不抛错。
  - 倾向性（弱断言）：手握小单且非跟牌时优先出小牌；对家是 current.by 时更可能 pass（统计型，给宽松阈值）。
- [ ] Step 2: 运行 → FAIL。
- [ ] Step 3: 实现 `ai.ts`（首攻：选 `enumerateLeads` 中"消耗散牌/小牌优先、留炸弹"的一手；跟牌：`enumerateFollows` 取最小压制；对家领先则倾向 pass；用 `rankValue` 排序）。
- [ ] Step 4: 运行 → PASS。
- [ ] Step 5: commit `feat(guandan): heuristic AI`。

**验收**：ai.test 全绿；AI 永远合规、不卡死。

---

### Task 8: 游戏厅壳（注册表 + 路由 + 首页列表）
**Files:** Create `src/shell/{types.ts,registry.ts,home.ts,router.ts,shell.css}`、改 `src/main.ts`、`tests/shell-router.test.ts`、`src/shell/links.example.ts`(占位)

**Interfaces:** Produces:
- `interface GameModule { id: string; name: string; desc: string; mount(root: HTMLElement): () => void; }`
- `type GameEntry = { kind:'internal'; module: GameModule } | { kind:'external'; id:string; name:string; desc:string; url:string };`
- `registry: GameEntry[]`（掼蛋 internal 占位 stub + 象棋 external，url 从 `links.ts`(gitignore) 读，缺省占位 `#`）
- `parseHash(hash:string): {view:'home'} | {view:'game', id:string}`
- `route(registry, hash, root): cleanup`（home→渲染列表；game→internal `mount`，external 不在 SPA 内路由）

- [ ] Step 1: 写 `tests/shell-router.test.ts`：`parseHash('')→home`；`parseHash('#/guandan')→{game,guandan}`；用假 GameModule + jsdom 容器验证 `route` 调 `mount` 并能 `cleanup`。（vitest 配 `environment:'jsdom'` 仅此测试文件，或用 happy-dom）
- [ ] Step 2: 运行 → FAIL。
- [ ] Step 3: 实现 shell；`main.ts` 挂 `#app` + `window.onhashchange`；列表渲染卡片（internal 点击改 hash，external `<a target=_blank>`）；象棋 url 走 `links.ts`(gitignore，example 占位)。
- [ ] Step 4: 运行 → PASS；`npm run build` 通过；浏览器手验首页列表（先用掼蛋 stub）。
- [ ] Step 5: commit `feat(shell): game list home + hash router`。

**验收**：router 测绿；首页列出掼蛋+象棋、进出正常、象棋外链占位不泄漏真实 URL。

---

### Task 9: 掼蛋 UI（DOM+CSS）+ 接入壳 + 字体子集
**Files:** Create `src/games/guandan/ui/{view.ts,render.ts,guandan.css}`、`src/games/guandan/index.ts`、`src/ui/fonts/`(子集)、改 `registry.ts` 用真模块
**Interfaces:** Consumes Task 2–7 全部 engine/ai；Produces `guandanModule: GameModule`。

- [ ] Step 1: 字体子集：列出 UI 固定汉字（牌型名/「出牌」「不要」「头游」「重新发牌」「红心」「级牌」…）→ `/tmp` pyftsubset 生成 woff2 子集放 `src/ui/fonts/` + OFL 许可证（参考 xiangqi 流程）。
- [ ] Step 2: `view.ts` 实现 `mount(root)`：`new` 一局（随机首攻+发牌）→ 渲染 → 绑交互 → 返回 unmount（清定时器/监听）。
- [ ] Step 3: `render.ts`：四座布局（自下/对上/对手左右，CSS grid）、手牌扇形（CSS transform）、选牌高亮上移、「出牌」(调 `isLegalPlay` 才放行)/「不要」、中央亮各家上一手、轮次高亮、名次角标。
- [ ] Step 4: 交互流：人类出牌/不要 → `play`/`pass` → 推进；轮到 AI → `choosePlay` → 短延迟+滑动动画 → 应用 → 循环；局终弹名次+应升级数+「重新发牌」。
- [ ] Step 5: `guandan.css` 卡牌样式（红黑花色、王、选中态）；固定文字用 `--font-display` 嵌入字体。
- [ ] Step 6: `registry.ts` 换上真 `guandanModule`；`npm run build`；浏览器手验打一局。
- [ ] Step 7: commit `feat(guandan): DOM card UI + shell 接入`。

**验收**：能在浏览器完整打一局；选牌/出牌/不要/AI 自动/名次全对；字形各端一致。

---

### Task 10: 模糊测试（自对局）+ 真机冒烟
**Files:** Create `tests/fuzz.test.ts`、临时 `/tmp/desk-e2e.mjs`(Playwright，不进仓库)

- [ ] Step 1: `tests/fuzz.test.ts`：用 seeded RNG（注入 shuffle）跑 **1000 局**全 AI 自对局（4 个 `choosePlay`）。每局每步断言：① 出牌合法 ② 牌数守恒=108 ③ 不死循环（步数上限保护，超限即 fail）。局终断言 `ranking` 是 0..3 排列。
- [ ] Step 2: 运行 → 期望 PASS（若暴露规则/状态机 bug，回对应任务修，红→绿）。
- [ ] Step 3: Playwright（系统 Chrome，`channel:'chrome'`）：起 `npm run dev` 或开 `dist/index.html`，进掼蛋，人类自动选「不要」推进、AI 打完一局，断言出现名次。脚本放 `/tmp`，跑完删。
- [ ] Step 4: commit `test(guandan): fuzz self-play + e2e smoke`。

**验收**：1000 局模糊全过（守恒/合法/终止）；真机一局打完显示名次。

---

## Self-Review（对照 SPEC）
- **Spec 覆盖**：架构(T8)/牌型+比大小(T3)/逢人配(T4)/合法跟牌(T5)/单局+接风+名次+升级数(T6)/AI(T7)/UI 四座交互(T9)/首页列表+象棋外链(T8)/测试三层(T2-7 穷举 + T10 模糊+真机)——均有任务。
- **占位扫描**：无 TBD；各 Task 给了接口签名 + 具体测试用例（含反例）；实现步骤指明算法要点。
- **类型一致**：`Card/Combo/ComboType/Seat/DealState` 在契约节定义一次，各任务引用同名；`identify`/`identifyWithWild`/`beats`/`enumerateLeads`/`enumerateFollows`/`isLegalPlay`/`createDeal`/`play`/`pass`/`ranking`/`levelGain`/`choosePlay`/`GameModule` 签名前后一致。
- **变体**：连对=3/钢板=2/炸弹链/wild 不组天王炸/打2单局/随机首攻/逆时针——已写入 Global Constraints 与对应任务断言。
