# desk-games

## 是什么
桌游合集：统一首页(游戏列表) → 点击进入具体游戏。三个内置游戏：**掼蛋**、**中国象棋**、**干瞪眼**，均含联机。

## 技术选型的理由（依赖清单看 `package.json`，这里只记为什么）
- **纯函数规则引擎 + vitest 穷举/模糊单测**是"无 bug"的核心杠杆，三个引擎同一打法。
- **构建成单个 HTML**（JS/CSS/字体全内联）：`file://` 双击就能跑，零运行时依赖。
- 卡牌用 **DOM + CSS**，不用 Canvas。
- **真路径 pathname 路由**（pushState+popstate，非 hash），零框架 vanilla TS。
- **固定文字用内嵌字体子集**（霞鹜文楷 OFL）：保证四系统字形一致。掼蛋/干瞪眼共享 `src/ui/fonts/`，象棋自带 `src/games/xiangqi/ui/fonts/`，同一 `pyftsubset` 流程。
- **联机后端**：单 node 进程一端口托管整厅，各游戏 ws 路径隔离；服务端只依赖 `ws`，各游戏引擎 esbuild 打成 `*.bundle.mjs` 自包含。**engine 改了必须重打 bundle 并一起部署。** 部署见 `DEPLOY.md`。

## 结构约定（目录树自己 `ls`，这里只记看不出来的规矩）
- `src/games/<game>/engine/` 是**规则唯一真相**：绝不 import DOM，UI/AI 不另写判定、不复制规则逻辑。
- **游戏模块之间不互相依赖**，只经 `src/shell/` 的 `GameModule` 接口接入。要共用的东西走共享层：`src/ui/cards/`（牌面 `dgc-*`）、`src/ui/cardroom/screens/`（联机三屏 `cr-*`）、`src/ui/theme.css`（设计 token）。
- 掼蛋「单机」= 联机 1 人 + 3 AI，没有独立的本地驱动。
- `server/rooms.mjs` 是从旧 xiangqi-game 仓库 vendored 进来的，别按本仓风格重构它。
- 视觉/牌面改动有闸门：`scripts/cardcss-check.mjs`（牌面 CSS 基线）、`scripts/ui-proof.mjs`（联机三屏像素哈希）、`scripts/font-subset.mjs` + `tests/font-subset.test.ts`（字体子集漏字）、`scripts/ink-align-check.mjs`（指派点数双引擎墨迹对齐）。动了对应部分必须先跑，基线要更新用 `--save`。

## 运行 / 验证命令
- 安装：`npm install`
- 开发：`npm run dev`（Vite dev server）
- 构建：`npm run build`（`tsc --noEmit && vite build` → `dist/index.html` 单文件）

### 真机脚本（Playwright + 系统 Chrome `channel:'chrome'`，各自起服务、自己收摊，失败退非零码）

跑之前要有构建产物：`npm run build && npm run build:server`，缺了会提示。`SMOKE_HEADED=1` 开有头浏览器肉眼看，`SMOKE_PORT` 换端口。

| 命令 | 覆盖 | 什么时候跑 |
|---|---|---|
| `npm run smoke:guandan` | 掼蛋：建房 / 加入 / 入座 / 开打 / 观战 / 断线重连 | 动了房间层 / 联机协议 / 会话重连 |
| `npm run smoke:gandengyan` | 干瞪眼：建房选人数 / 加入 / 入座 / 昵称全服唯一 / 开打 / 出牌·不要链路 | 同上 |
| `npm run smoke:gandengyan:scenarios` | 干瞪眼四场景：歧义指派 / 5 人环形 / 掉线→重连 / 离开清理 | 动了干瞪眼 UI 或房间层 |
| `npm run accept:gandengyan` | 干瞪眼打完整局：赢家判定 + 赔付明细 + 离开清理 | 动了干瞪眼引擎 / 结算 |
| `npm run ui-proof` | 联机三屏像素哈希（基线 `scripts/ui-proof.baseline.json`） | 动了三屏 / 牌面 / 主题；改基线用 `-- --save` |

**动了房间层 / 联机协议 / 会话重连，必须跑对应 smoke**——单测替代不了：房间层三层各自绿、合起来仍可能坏，只有真浏览器 + 真 WebSocket 能证明「两个人真的能坐到一张桌上打，断了还能回来」。

**发版前这几条全过一遍，不挑"最近改了哪块"。** 理由：`accept:gandengyan` 与 `smoke:gandengyan` 曾同时红着没人发现——脚本把「轮到我但必须过」（出牌键因 `mustPass` 禁用）误判成「不是我的回合」，永不点「不要」，整局冻死。按需触发的规矩挡不住脚本自身腐坏，只有定期全跑才会暴露。写真机脚本时记住：**判「不是我的回合」要两个动作键同时禁用**，单看出牌键会误伤 `mustPass`。

### 测试分快慢两轨

| 轨 | 命令 | 内容 | 什么时候跑 |
|---|---|---|---|
| **快轨** | `npm test` | 除慢轨外的全部测试（引擎穷举单测、协议、驱动、壳、象棋） | **每次改完都跑**，秒级返回 |
| **慢轨** | `npm run test:slow` | `*.slow.test.ts`：模糊测试 + AI 对打基准 | 动了引擎 / AI / 洗牌时跑；**提交前跑一次**；发版必跑 |
| 两轨 | `npm run test:all` | 先快后慢 | 发版前 |

**验证**（对应全局"改完主动跑验证"）：`npm test` + `npm run typecheck` 是日常底线；改规则必先加/改单测、红→绿。**动了引擎 / AI / 洗牌就必须补跑 `npm run test:slow`**——快轨绿不代表模糊测试绿。

分轨的理由：慢轨那 4 个文件占全量测试时间的 **94%**（单局模糊测试一个就 450s）。混在一起日常验证要等 7 分半，结果是没人愿意在提交前跑，测试等于白写。

**新增慢测试的判据**：单文件耗时上到十几秒、或本质是"跑 N 局看统计"的，命名成 `*.slow.test.ts` 即自动进慢轨（`vite.config.ts` 按此 glob 排除，`vitest.slow.config.ts` 按此 glob 收入）。

**局数旋钮**（`tests/helpers/slow-knobs.ts`）：`FUZZ_GAMES`(1000) / `FUZZ_MATCHES`(50) / `BENCH_GAMES`(500) / `GDY_FUZZ_GAMES`(4000)。**默认值就是提交基线**；调小只为本地冒烟"这条还跑得通吗"，调小时会打警告——那个规模下统计类门槛不具代表性，**绿灯不作数**，不可拿来当提交或发版依据。
例：`FUZZ_GAMES=20 FUZZ_MATCHES=2 BENCH_GAMES=20 GDY_FUZZ_GAMES=50 npm run test:slow`（约 10 秒）。
注意干瞪眼的 fuzz 带**分支命中闸门**（出牌权顺延、王炸各须命中 ≥1 次）；局数调得太小会因为撞不到稀有分支而报红，那是设计如此，不是测试坏了。

## 双轨交接约束

- 任意轨道完成代码、配置、脚本、测试或文档修改后，必须运行 `git status --short`。
- 如果存在未提交改动，必须提醒用户 commit、stash，或明确确认保留未提交状态。
- 未提交改动不得静默交给另一轨继续处理。
- 切换轨道前必须满足其一：已 commit、已 stash，或用户明确确认保留未提交改动。

## 外部依赖
- 前端零运行时依赖、无 API key、无账号；服务端只依赖 `ws`。
- 三个游戏全部内置，无外链 URL，联机一律走同源 ws（与大厅同源部署）。

## 特殊约束
- **"无 bug"硬指标**：规则改动先加/改单测，红→绿，禁止注释报错绕过。engine 是规则唯一真相，UI/AI 不另写判定。
- **逢人配（当前级牌的红心，随级牌变，不是固定红心 2）** 是最大 bug 源：牌型识别与 AI 枚举都须正确处理 0~2 张万能牌的最优指派；不可组四大天王。须有针对性穷举单测。
- **固定文字用内嵌字体子集**：新增要显示的固定汉字必须重跑子集化(`/tmp` pyftsubset)，否则掉系统字体、各端不一致；玩家昵称等任意文本走系统无衬线。
- **公网信息脱敏**：desk-games 大厅自身的公网部署信息（域名/端口/内网 IP）绝不入库（象棋现与大厅同源部署）。
- 上线一个新能力的门槛：**单测全绿 + 真机冒烟**，两样缺一不进下一步。

## Agent skills

### Issue tracker

Issue 与 PRD 走 GitHub Issues（仓库 `goodffd/desk-games`，用 `gh` CLI）；外部 PR 暂不进 triage 队列。见 `docs/agents/issue-tracker.md`。

### Triage labels

用五个规范角色的默认标签名：`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文（single-context）：根 `CONTEXT.md` + `docs/adr/`，两者按需由 `/domain-modeling` 惰性创建，不存在时静默跳过。见 `docs/agents/domain.md`。
