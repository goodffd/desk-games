# 部署（desk-games 大厅 + 掼蛋联机）

> 公网域名 / 端口 / 内网 IP / 证书路径**绝不入库**（同象棋脱敏红线）。真实值在生产机的 systemd unit
> 与 owner 私记里。下方用占位符；`$DEPLOY_HOST`/`$APP_DIR` 等执行时按实际替换。

## 架构

一个 node 进程（`server/server.mjs`）一个端口托管整个大厅，systemd 常驻：

- `/`            → 游戏大厅（`dist/index.html` 单文件 SPA）
- `/xiangqi/*`   → 象棋（`xiangqi-dist/index.html`）
- `/guandan`     → 掼蛋（大厅 SPA 内置模块；正常=联机，`?debug`=本地对 AI）
- `/ws`          → 象棋联机 WebSocket（vendored `rooms.mjs`）
- `/ws-guandan`  → **掼蛋联机 WebSocket**（`guandan-rooms.mjs` + `guandan-match-driver.bundle.mjs`，与象棋隔离）

`CERT_DIR` 注入了 Let's Encrypt 证书 → 全程 https/wss；`PORT` 由 systemd 注入。客户端用
`wss://${location.host}/ws-guandan` 同源连接，无需额外配置。

## 构建产物（本地）

```bash
npm install
npm test && npm run typecheck     # 必须全绿
npm run build                     # → dist/index.html（单文件，JS/CSS/字体/语音全内联）
npm run build:server              # → server/guandan-match-driver.bundle.mjs（esbuild 把 engine 打成服务端 JS）
```

服务端运行时只依赖 `ws`（`server/package.json`）；引擎走 `*.bundle.mjs`（自包含，无外部依赖）。

## 部署（更新流程）

生产机：`$DEPLOY_USER@$DEPLOY_HOST`（免密 ed25519），应用目录 `$APP_DIR`，systemd `desk-games.service`，
node 走 nvm 全路径（systemd ExecStart 已写死，不依赖登录 shell 的 PATH）。

```bash
# 1) 备份（回滚用）
ssh $DEPLOY_USER@$DEPLOY_HOST 'cp $APP_DIR/server/server.mjs{,.bak.$(date +%s)}; cp $APP_DIR/dist/index.html{,.bak.$(date +%s)}'

# 2) 传产物：dist + 改动的 server 文件
scp dist/index.html $DEPLOY_USER@$DEPLOY_HOST:$APP_DIR/dist/index.html
scp server/server.mjs server/guandan-rooms.mjs server/guandan-match-driver.bundle.mjs \
    server/package.json server/package-lock.json $DEPLOY_USER@$DEPLOY_HOST:$APP_DIR/server/
# 仅 server 依赖变化时才需：ssh ... 'cd $APP_DIR/server && npm install --omit=dev'（ws 通常已装）

# 3) 重启
ssh $DEPLOY_USER@$DEPLOY_HOST 'systemctl restart desk-games && systemctl is-active desk-games'
```

## 部署后验证（业务真路径，不可省）

```bash
# 服务端本地自测（https，自签忽略用 -k；公网证书有效不用 -k）
ssh $DEPLOY_USER@$DEPLOY_HOST 'curl -sSk https://127.0.0.1:$PORT/guandan | grep -c gd-lobby'   # >0 = 新联机客户端

# 公网真路径（Playwright，多 context）：建房→输房号加入→开打→各端各看各 27 张、108 全不重叠（隐藏手牌零泄漏）
# 见 sandbox/2026-06-21-guandan-online-smoke/（smoke-online.mjs 本地真 server；公网改 URL 即可）
```

回滚：`cp $APP_DIR/server/server.mjs.bak.<ts> $APP_DIR/server/server.mjs`（+ dist 同理）→ restart。

## 注意

- 掼蛋联机服务端是 desk-games 自己的（`guandan-rooms.mjs`/`/ws-guandan`），与象棋 `/ws` 各自独立、互不影响。
- HTML 响应带 `Cache-Control: no-store`（防 iOS Safari 缓存旧代码）。
- 整盘「再来一盘」走服务端 `restart`（房主，留座重开）。
