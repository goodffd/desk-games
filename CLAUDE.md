# desk-games

## 是什么
桌游合集：统一首页(游戏列表) → 点击进入具体游戏。首发**掼蛋**(内置)，**中国象棋**作为内置联机模块。一期目标=掼蛋单局对 AI、规则零错。

## 技术栈
- **TypeScript**：纯函数规则引擎 + vitest 穷举/模糊单测——"无 bug"的核心杠杆（同 xiangqi-game 打法）。
- **Vite + vite-plugin-singlefile**：构建为单个 HTML（JS/CSS/字体全内联），`file://` 双击可运行，零运行时依赖。
- **DOM + CSS**：卡牌渲染与交互（扇形手牌、多选、动画），不用 Canvas。
- **嵌入字体**：霞鹜文楷子集(OFL)，保证四系统固定文字字形一致（牌型名/提示/名次等）。可从 xiangqi-game 复用同一子集流程。
- **壳路由**：hash 路由(`#/` 列表，`#/guandan` 游戏)，零框架 vanilla TS。
- 一期**无后端**（纯前端单机对 AI）；联机(三期)再引入 Node+ws 哑中转，参考 xiangqi-game/server。

## 目录结构
```
desk-games/
├── SPEC.md / CLAUDE.md / README.md
├── package.json / tsconfig.json / vite.config.ts / index.html
├── src/
│   ├── shell/                 # 游戏厅壳：模块注册表 + 列表页 + hash 路由
│   │   ├── registry.ts        # GameModule 接口 + 内置游戏登记(掼蛋/象棋)
│   │   ├── home.ts            # 游戏列表首页 (DOM)
│   │   └── router.ts          # hash 路由：列表 ↔ mount(游戏)
│   ├── games/
│   │   └── guandan/
│   │       ├── engine/        # 纯逻辑，无 DOM，唯一真相
│   │       │   ├── cards.ts   # 牌/牌堆/发牌/单张大小
│   │       │   ├── combos.ts  # 牌型识别 + 比大小 + 逢人配指派
│   │       │   ├── legal.ts   # 合法跟牌枚举
│   │       │   └── game.ts    # 单局状态机：出牌/不要/接风/名次
│   │       ├── ai/            # choosePlay 纯函数策略
│   │       └── ui/           # DOM+CSS 渲染 + 交互 + 动画
│   ├── ui/fonts/             # 内嵌字体子集(woff2, OFL) + 许可证
│   └── main.ts               # 入口：装壳 + 注册游戏
└── tests/                    # 引擎穷举单测 + 模糊测试(.test.ts)
```
**约定**：`engine/` 绝不 import DOM；UI/AI 不复制规则逻辑（engine 唯一真相）。游戏模块之间不互相依赖，只经 shell 的 GameModule 接口接入。

## 运行 / 验证命令
- 安装：`npm install`
- 开发：`npm run dev`（Vite dev server）
- 构建：`npm run build`（`tsc --noEmit && vite build` → `dist/index.html` 单文件）
- **验证**（对应全局"改完主动跑验证"）：`npm test`（vitest，引擎单测+模糊测试必须全绿）+ `npm run typecheck`。改规则必先加/改单测、红→绿。
- 真机冒烟：Playwright + 系统 Chrome（`channel:'chrome'`），打完一整局验名次（参考 xiangqi-game 冒烟打法）。

## 外部依赖
- 一期：零运行时依赖、无 API key、无账号、无后端。
- 象棋现为**内置联机模块**，无外链 URL。联机走同源 `/ws`（与大厅同源部署）。`src/shell/links.ts`/`links.example.ts` 为历史遗留文件（待清理），不再需要外链 URL 注入。

## 特殊约束
- **"无 bug"硬指标**：规则改动先加/改单测，红→绿，禁止注释报错绕过。engine 是规则唯一真相，UI/AI 不另写判定。
- **逢人配(红心2)** 是最大 bug 源：牌型识别与 AI 枚举都须正确处理 0~2 张万能牌的最优指派；不可组四大天王。须有针对性穷举单测。
- **固定文字用内嵌字体子集**：新增要显示的固定汉字必须重跑子集化(`/tmp` pyftsubset)，否则掉系统字体、各端不一致；玩家昵称等任意文本走系统无衬线。
- **公网信息脱敏**：desk-games 大厅自身的公网部署信息（域名/端口/内网 IP）绝不入库（象棋现与大厅同源部署）。
- 分期：一期单局对 AI；二期升级/进贡整局；三期联机。每期单测全绿+真机冒烟才进下一期。
