# desk-games

## 是什么
桌游合集：统一首页(游戏列表) → 点击进入具体游戏。首发**掼蛋**(内置)，**中国象棋**作为内置联机模块。一期目标=掼蛋单局对 AI、规则零错。

## 技术栈
- **TypeScript**：纯函数规则引擎 + vitest 穷举/模糊单测——"无 bug"的核心杠杆（掼蛋、象棋两引擎同一打法）。
- **Vite + vite-plugin-singlefile**：构建为单个 HTML（JS/CSS/字体全内联），`file://` 双击可运行，零运行时依赖。
- **DOM + CSS**：卡牌渲染与交互（扇形手牌、多选、动画），不用 Canvas。
- **嵌入字体**：霞鹜文楷子集(OFL)，保证四系统固定文字字形一致（牌型名/提示/名次等）。掼蛋字体在 `src/ui/fonts/`，象棋自带子集在 `src/games/xiangqi/ui/fonts/`，同一 `pyftsubset` 子集化流程。
- **壳路由**：hash 路由(`#/` 列表，`#/guandan`、`#/xiangqi` 游戏)，零框架 vanilla TS。
- **联机后端**：单 node 进程(`server/server.mjs`)一端口托管整厅——掼蛋走 `/ws-guandan`、象棋走 `/ws`，两者隔离；服务端只依赖 `ws`，掼蛋引擎 esbuild 打成 `*.bundle.mjs` 自包含。部署见 `DEPLOY.md`。

## 目录结构
```
desk-games/
├── SPEC.md / CLAUDE.md / README.md / DEPLOY.md   # 规格 / 规范 / 简介 / 部署
├── package.json / tsconfig*.json / vite.config.ts / index.html
├── src/
│   ├── shell/                    # 游戏厅壳：模块注册表 + 列表页 + hash 路由
│   │   ├── registry.ts           # GameModule 接口 + 内置游戏登记(掼蛋/象棋)
│   │   ├── home.ts               # 游戏列表首页 (DOM)
│   │   └── router.ts             # hash 路由：列表 ↔ mount(游戏)
│   ├── games/
│   │   ├── guandan/              # 掼蛋（内置：单机对 AI + 联机）
│   │   │   ├── engine/           # 纯逻辑无 DOM·唯一真相：cards/combos/legal/wild(逢人配)/game(单局)/match(整盘)/types
│   │   │   ├── ai/               # choosePlay 策略 + decompose(手牌分解)
│   │   │   ├── driver/           # 本地/联机驱动抽象 local·online·types
│   │   │   ├── online/           # 联机协议 protocol·session + 大厅/房间/昵称 UI
│   │   │   ├── ui/               # DOM+CSS 渲染/交互/动画 + 花色图/名次字体/报牌语音
│   │   │   └── index.ts          # GameModule 导出
│   │   └── xiangqi/              # 中国象棋（内置联机模块，实现详见 SPEC.md《中国象棋》节）
│   │       ├── engine/           # 纯逻辑无 DOM：board/moves/rules/fen/game/types
│   │       │   ├── repetition.ts # 长将长捉/重复局面判负
│   │       │   ├── endgames.ts · openings.ts   # 残局库 · 开局库
│   │       │   └── clock.ts · notation.ts · pgn.ts · browse.ts · ai.ts  # 读秒·中文记谱·PGN·打谱·AI
│   │       └── ui/               # 渲染/交互/动画/主题/音效/联机/存档 + fonts/(霞鹜文楷子集)
│   ├── ui/fonts/                 # 掼蛋共享字体子集(woff2, OFL) + 许可证
│   └── main.ts                   # 入口：装壳 + 注册游戏
├── server/                       # 联机服务端：单 node 进程托管整厅
│   ├── server.mjs                # 路由 /·/guandan·/xiangqi + /ws(象棋)·/ws-guandan(掼蛋)
│   ├── rooms.mjs · guandan-rooms.mjs        # 象棋房间(vendored) · 掼蛋房间
│   ├── guandan-match-driver.ts   # 服务端掼蛋引擎驱动 →(esbuild)→ *.bundle.mjs
│   └── build.mjs · package.json  # 打包脚本 · 仅依赖 ws
├── docs/superpowers/{specs,plans}/  # 各特性设计文档(掼蛋 + 象棋；象棋设计文档已从旧 xiangqi-game 仓库迁入)
└── tests/                        # 引擎穷举单测 + 模糊测试：guandan/ + xiangqi/
```
**约定**：`engine/` 绝不 import DOM；UI/AI 不复制规则逻辑（engine 唯一真相）。游戏模块之间不互相依赖，只经 shell 的 GameModule 接口接入。

## 运行 / 验证命令
- 安装：`npm install`
- 开发：`npm run dev`（Vite dev server）
- 构建：`npm run build`（`tsc --noEmit && vite build` → `dist/index.html` 单文件）
- **验证**（对应全局"改完主动跑验证"）：`npm test`（vitest，引擎单测+模糊测试必须全绿）+ `npm run typecheck`。改规则必先加/改单测、红→绿。
- 真机冒烟：Playwright + 系统 Chrome（`channel:'chrome'`），掼蛋打完一整局验名次、象棋打完整局验胜负；联机走多 context 真路径（建房/加入/对弈/重连）。

## 外部依赖
- 一期：零运行时依赖、无 API key、无账号、无后端。
- 象棋现为**内置联机模块**，无外链 URL。联机走同源 `/ws`（与大厅同源部署）。原外链 URL 注入机制（links 文件）已随象棋内置一并移除。

## 特殊约束
- **"无 bug"硬指标**：规则改动先加/改单测，红→绿，禁止注释报错绕过。engine 是规则唯一真相，UI/AI 不另写判定。
- **逢人配(红心2)** 是最大 bug 源：牌型识别与 AI 枚举都须正确处理 0~2 张万能牌的最优指派；不可组四大天王。须有针对性穷举单测。
- **固定文字用内嵌字体子集**：新增要显示的固定汉字必须重跑子集化(`/tmp` pyftsubset)，否则掉系统字体、各端不一致；玩家昵称等任意文本走系统无衬线。
- **公网信息脱敏**：desk-games 大厅自身的公网部署信息（域名/端口/内网 IP）绝不入库（象棋现与大厅同源部署）。
- 分期（掼蛋）：一期单局对 AI；二期升级/进贡整局；三期联机（联机服务端已上线）。象棋作为内置联机模块已并入并上线。每期单测全绿+真机冒烟才进下一期。
