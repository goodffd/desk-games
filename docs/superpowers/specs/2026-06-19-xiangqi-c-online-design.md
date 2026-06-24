> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 子项目 C：联网在线对战（自建 WS 服务器，全 app 托管）设计

日期：2026-06-19（架构由 WebRTC P2P 改为自建 WS——owner 有常年运行的 Linux 服务器）
状态：设计已锁定，待写实现计划
范围：C 联网在线对战。v3 最后一块。

## 问题
让封福东与家人朋友远程下一盘，用 owner 自己的 Linux 服务器，零账号、零第三方。

## 架构决策（owner 拍板）
- **整个 app 托管在 owner 的 Linux 服务器**：一个 Node 服务同时（①静态托管构建好的前端 ②`/ws` WS 房间端点），**同端口**（http upgrade）。
- **TLS**：部署时用 **Let's Encrypt 申请免费证书**（需域名，纯 IP 不发证；无域名可用 DuckDNS 等免费子域）→ **https + 同源 `wss://`**（推荐）；暂无证书则 **http + 同源 `ws://`** 兜底。页面与 WS 同源，**无混合内容问题**。前端 WS 地址由页面 `location` 推导（http→`ws://`、https→`wss://`），**两种都自动适配、零代码改动**——证书纯属部署步骤。
- 服务器是**纯哑中转**：管房间 + 转发消息，不跑棋规（互信、不防作弊）→ 极小极稳。
- 访问从"双击文件"变为"访问服务器网址"（联机本就需要）；离线单文件构建保留作本地对弈（file:// 下隐藏联机入口）。

## 组件

### 1. `server/`（独立子包，Node + ws）
- 一个 Node http 服务：静态托管 `dist/`（构建好的前端）+ 在 `/ws` 升级为 WebSocket。
- 房间：客户端发 `{t:'create'}` → 服务器分配**短房间码**（如 6 位）回 `{t:'created',code}`；另一端发 `{t:'join',code}` → 配对成功双方收 `{t:'paired',color}`（先到=red，后到=black）；满员/失效码回 `{t:'error',msg}`。
- 转发：房间内收到 move/resign/draw-*/undo-* 等**对局消息**，原样转发给房间内另一端。
- 断开：一端断线 → 另一端收 `{t:'peer-left'}`，房间清理。
- 依赖：`ws`（仅服务端，独立 `server/package.json`，**不进前端打包**）。无数据库、无状态持久化（内存房间表）。

### 2. 前端 `src/ui/online.ts`：`OnlineSession`（WS 客户端）
- `connect()`：`new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/ws')`。
- `createRoom()` → 发 create，`onState('waiting', code)`；`joinRoom(code)` → 发 join。
- 配对成功 → `onPaired(color)`；`send(msg)`；`onMessage(msg)`；`onState('connecting'|'paired'|'closed')`。
- file:// 下（无 host）`connect` 不可用 → 联机入口禁用并提示"请通过服务器网址访问联机"。

### 3. 消息协议（WS JSON）
配对：`create / created(code) / join(code) / paired(color) / peer-left / error(msg)`。
对局（房间内转发，复用）：`{t:'move',iccs}` / `resign` / `draw-offer|draw-accept|draw-decline` / `undo-request|undo-accept|undo-decline`。

### 4. 前端联机模式（main.ts + index.html）
- 模式区加「联机」。面板：创建房间(显示短码)/输房间码加入 + 连接状态。
- 配对后：本地执 paired 返回的颜色（host red / guest black）；棋盘只接受本地回合点击；远端着法经 controller 落子 + 动画。
- 在局控件：认输/求和/悔棋（请求）；收到对方 draw-offer/undo-request 弹接受/拒绝；断线提示。
- 结果（认输/求和/接受悔棋）走 UI 层覆盖（不改 engine 棋盘判定）。
- 复制房间码：`navigator.clipboard` 在 http 不可用 → 降级（选中文本 + execCommand 或仅展示供手输）。

## 非目标（C 内）
- 无匹配大厅/排行榜/账号（仅房间码邀请）。
- 无断线重连（断线结束联机）。
- 不防作弊（互信，服务器不校验棋规）。
- 自动部署（部署由 owner 按 DEPLOY.md 执行；证书申请同样在部署期，指南随附）。

## 验收标准
- **server 单测**（Node，两个内存 ws 客户端）：create→code；join 配对双方 paired(red/black)；对局消息按房间转发给另一端；满员/坏码 error；一端断 → 另一端 peer-left。
- 前端 online encode/connect 逻辑 + 协议派发可测部分单测。
- **端到端冒烟**（本机起 server + 两个 Playwright 页面，同房间码）：配对→主机走子→客机更新→客机走子→主机更新；认输/求和接受/悔棋接受各往返、双方状态一致；零 console 错误。
- `npm test` + `npm run typecheck` + 前端 `npm run build` 单文件全绿；既有功能不回归。
- 联机界面截图 owner 点头。
- **部署交付 `DEPLOY.md`**：systemd 常驻部署步骤 + Let's Encrypt 免费证书申请指南（域名 → certbot/nginx 反代 → https/wss）；由 owner 在其服务器执行（不自动部署，红线）。

## 实现顺序
1. `server/`：WS 房间服务（create/join/转发/断开）+ Node 单测。
2. `src/ui/online.ts` 前端 WS 客户端（connect/房间/收发）。
3. 前端联机模式 UI + 协议派发 + 引擎集成（复用 controller/render/动画）。
4. 端到端两客户端冒烟 + 截图。

## 已知限制（写入注释/SPEC）
- HTTP（非 https）：浏览器标"不安全"（casual 可接受）；安全上下文 API（clipboard）已降级规避。
- 服务器需公网可达，家人朋友跨网才连得上。
- 无重连；互信不防作弊。
- 联机仅经服务器网址访问；file:// 单文件仅本地对弈。
