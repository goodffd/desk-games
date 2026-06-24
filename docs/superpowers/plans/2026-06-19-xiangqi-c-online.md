> **来源说明**：本文档原属独立项目 `xiangqi-game`（已归档，仓库即将删除）。中国象棋已于 2026-06-23 作为内置联机模块并入 `desk-games`（见 `2026-06-23-xiangqi-internal-module*.md`）。**文中的目录结构 / 路径 / 部署方式 / `xiangqi-dist` 等均指并入前的独立项目布局**；现行代码位于 `src/games/xiangqi/`，部署与大厅同源（象棋走 `/ws`）。本文保留为象棋规则与功能的设计依据记录。

---

# 子项目 C：联网在线对战（自建 WS 服务器）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development。Steps use checkbox (`- [ ]`)。

**Goal:** owner 的 Linux 服务器上一个 Node 哑中转服务（静态托管前端 + `/ws` 房间），前端联机模式按房间码配对、走着法/认输/求和/悔棋；HTTP 同源 ws://（部署期可加 Let's Encrypt 升 https/wss，前端相对地址零改动）。

**Architecture:** `server/`（独立 JS 子包）：`rooms.mjs` 纯房间登记/转发逻辑（可单测，不依赖 socket）+ `server.mjs`（http 静态 + ws 接 RoomRegistry）。`src/ui/online.ts` 前端 WS 客户端（相对地址连同源 /ws）。main.ts 联机模式复用在局协议（move/resign/draw/undo）+ UI 派发 + render/动画。服务器纯转发不跑棋规（互信）。

**Tech Stack:** 前端 TS（无新前端依赖）；服务端 Node ESM + `ws`（独立 `server/package.json`，不进前端打包）。**分支：** `v3-c-online`。

**复用**：`iccsToMove`/`moveToIccs`(notation)、`controller`、render/动画、`Color`/`Move`。

---

## Task 1：服务器房间逻辑 RoomRegistry（纯逻辑，可单测）

**Files:** Create `server/rooms.mjs`; Create `tests/rooms.test.ts`

RoomRegistry 操作抽象 client（`{ send(msgObj) }`），不碰真 socket → 可用假 client 单测。

- [ ] **Step 1: 写失败测试** — `tests/rooms.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RoomRegistry } from '../server/rooms.mjs';

function fakeClient() { const sent: any[] = []; return { sent, send: (m: any) => sent.push(m) }; }

describe('RoomRegistry', () => {
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123'); }); // 注入定长码生成器（测试可控）

  it('create 分配房间码并回 created', () => {
    const a = fakeClient();
    reg.handle(a, { t: 'create' });
    expect(a.sent).toEqual([{ t: 'created', code: 'ABC123' }]);
  });

  it('join 配对：双方收 paired（host=red, guest=black）', () => {
    const a = fakeClient(); const b = fakeClient();
    reg.handle(a, { t: 'create' });
    reg.handle(b, { t: 'join', code: 'ABC123' });
    expect(a.sent).toContainEqual({ t: 'paired', color: 'red' });
    expect(b.sent).toContainEqual({ t: 'paired', color: 'black' });
  });

  it('坏码 / 满员 → error', () => {
    const a = fakeClient(); const b = fakeClient(); const c = fakeClient();
    reg.handle(a, { t: 'join', code: 'NOPE' });
    expect(a.sent[0].t).toBe('error');
    reg.handle(b, { t: 'create' });
    const d = fakeClient();
    reg.handle(c, { t: 'join', code: 'ABC123' }); // b 的房（注入码固定 ABC123）
    reg.handle(d, { t: 'join', code: 'ABC123' }); // 已满
    expect(d.sent[d.sent.length - 1].t).toBe('error');
  });

  it('对局消息转发给房间内另一端', () => {
    const a = fakeClient(); const b = fakeClient();
    reg.handle(a, { t: 'create' });
    reg.handle(b, { t: 'join', code: 'ABC123' });
    reg.handle(a, { t: 'move', iccs: 'h7-e7' });
    expect(b.sent).toContainEqual({ t: 'move', iccs: 'h7-e7' });
    reg.handle(b, { t: 'undo-request' });
    expect(a.sent).toContainEqual({ t: 'undo-request' });
  });

  it('一端离开 → 另一端收 peer-left，房间清理', () => {
    const a = fakeClient(); const b = fakeClient();
    reg.handle(a, { t: 'create' });
    reg.handle(b, { t: 'join', code: 'ABC123' });
    reg.leave(a);
    expect(b.sent).toContainEqual({ t: 'peer-left' });
    const c = fakeClient();
    reg.handle(c, { t: 'join', code: 'ABC123' });
    expect(c.sent[c.sent.length - 1].t).toBe('error'); // 房已清理
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/rooms.test.ts` → FAIL（模块不存在）。

- [ ] **Step 3: 写 `server/rooms.mjs`**:
```js
// 纯房间登记 + 转发逻辑（不依赖真 socket；client 只需有 send(msgObj)）。互信，不校验棋规。
const RELAY = new Set(['move', 'resign', 'draw-offer', 'draw-accept', 'draw-decline', 'undo-request', 'undo-accept', 'undo-decline']);

function defaultCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混 0O1I
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class RoomRegistry {
  constructor(codeGen = defaultCode) {
    this.codeGen = codeGen;
    this.rooms = new Map(); // code -> { host, guest|null }
  }
  _newCode() {
    let c = this.codeGen();
    while (this.rooms.has(c)) c = this.codeGen();
    return c;
  }
  handle(client, msg) {
    if (msg.t === 'create') {
      const code = this._newCode();
      this.rooms.set(code, { host: client, guest: null });
      client._room = code; client._role = 'host';
      client.send({ t: 'created', code });
      return;
    }
    if (msg.t === 'join') {
      const room = this.rooms.get(msg.code);
      if (!room || room.guest) { client.send({ t: 'error', msg: '房间不存在或已满' }); return; }
      room.guest = client; client._room = msg.code; client._role = 'guest';
      room.host.send({ t: 'paired', color: 'red' });
      room.guest.send({ t: 'paired', color: 'black' });
      return;
    }
    if (RELAY.has(msg.t)) {
      const room = this.rooms.get(client._room);
      if (!room) return;
      const other = client._role === 'host' ? room.guest : room.host;
      if (other) other.send(msg);
    }
  }
  leave(client) {
    const code = client._room;
    if (!code) return;
    const room = this.rooms.get(code);
    if (!room) return;
    const other = room.host === client ? room.guest : room.host;
    if (other) other.send({ t: 'peer-left' });
    this.rooms.delete(code);
  }
}
```

- [ ] **Step 4:** `npx vitest run tests/rooms.test.ts` → PASS（5 例）。`npm test` 全绿。

- [ ] **Step 5: 提交**
```bash
git add server/rooms.mjs tests/rooms.test.ts
git commit -m "feat(server): WS 房间登记/转发纯逻辑 RoomRegistry（可单测）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：WS 服务器入口 + 静态托管（server.mjs）

**Files:** Create `server/server.mjs`; Create `server/package.json`; Create `server/README.md`（占位，DEPLOY 在 Task 5）

- [ ] **Step 1: 写 `server/package.json`**:
```json
{
  "name": "xiangqi-server",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": { "start": "node server.mjs" },
  "dependencies": { "ws": "^8.18.0" }
}
```

- [ ] **Step 2: 写 `server/server.mjs`**（http 静态托管 ../dist + /ws）:
```js
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { WebSocketServer } from 'ws';
import { RoomRegistry } from './rooms.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dir, '..', 'dist'); // 构建产物（npm run build 生成）
const PORT = process.env.PORT || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

const http = createServer(async (req, res) => {
  let path = decodeURIComponent((req.url || '/').split('?')[0]);
  if (path === '/' || path === '') path = '/index.html';
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) { res.writeHead(403).end('forbidden'); return; } // 防目录穿越
  try {
    const buf = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream' }).end(buf);
  } catch { res.writeHead(404).end('not found'); }
});

const reg = new RoomRegistry();
const wss = new WebSocketServer({ server: http, path: '/ws' });
wss.on('connection', (ws) => {
  const client = { send: (m) => { try { ws.send(JSON.stringify(m)); } catch {} } };
  ws._client = client;
  ws.on('message', (data) => { try { reg.handle(client, JSON.parse(data.toString())); } catch {} });
  ws.on('close', () => reg.leave(client));
});

http.listen(PORT, () => console.log(`xiangqi server on :${PORT} (静态 ${DIST}, ws /ws)`));
```
（注：`ws._client` 与 `client` 是同一会话句柄；RoomRegistry 在 client 上挂 `_room`/`_role`，故对 close 用同一 `client` 对象 leave。）

- [ ] **Step 3:** 装服务端依赖并冒烟启动（本机）：`cd server && npm install`（装 ws；不影响前端）。`node server.mjs` 应打印监听（Ctrl-C 停）。前端 `npm run build` 先产出 dist。**注意：`server/node_modules` 要进 .gitignore**（确认根 .gitignore 的 `node_modules/` 是否覆盖子目录；不覆盖则补 `server/node_modules/`）。

- [ ] **Step 4: 提交**（不含 node_modules）
```bash
git add server/server.mjs server/package.json server/README.md .gitignore
git commit -m "feat(server): Node http 静态托管 + /ws WebSocket 入口（接 RoomRegistry）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：前端 WS 客户端 OnlineSession（online.ts）

**Files:** Create `src/ui/online.ts`; Create `tests/online.test.ts`

- [ ] **Step 1: 写失败测试**（测纯函数 wsUrl 派生；连接靠端到端冒烟）— `tests/online.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { deriveWsUrl } from '../src/ui/online';

describe('WS 地址派生', () => {
  it('http 页面 → ws://同主机/ws', () => {
    expect(deriveWsUrl({ protocol: 'http:', host: 'srv:8080' } as Location)).toBe('ws://srv:8080/ws');
  });
  it('https 页面 → wss://同主机/ws', () => {
    expect(deriveWsUrl({ protocol: 'https:', host: 'x.com' } as Location)).toBe('wss://x.com/ws');
  });
  it('file:// → 空（联机不可用）', () => {
    expect(deriveWsUrl({ protocol: 'file:', host: '' } as Location)).toBe('');
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/online.test.ts` → FAIL。

- [ ] **Step 3: 写 `src/ui/online.ts`**:
```ts
export type OnlineMsg =
  | { t: 'create' } | { t: 'created'; code: string }
  | { t: 'join'; code: string } | { t: 'paired'; color: 'red' | 'black' }
  | { t: 'error'; msg: string } | { t: 'peer-left' }
  | { t: 'move'; iccs: string } | { t: 'resign' }
  | { t: 'draw-offer' } | { t: 'draw-accept' } | { t: 'draw-decline' }
  | { t: 'undo-request' } | { t: 'undo-accept' } | { t: 'undo-decline' };

export type OnlineState = 'idle' | 'connecting' | 'open' | 'closed';

// 同源 WS 地址：http→ws、https→wss；file:// 无 host → 空（联机不可用）
export function deriveWsUrl(loc: Location): string {
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return '';
  return (loc.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + loc.host + '/ws';
}

export class OnlineSession {
  private ws: WebSocket | null = null;
  onMessage: (m: OnlineMsg) => void = () => {};
  onState: (s: OnlineState) => void = () => {};

  available(): boolean { return deriveWsUrl(location) !== ''; }

  private open(then: () => void): void {
    const url = deriveWsUrl(location);
    if (!url) { this.onState('closed'); return; }
    this.onState('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { this.onState('open'); then(); };
    ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data) as OnlineMsg); } catch {} };
    ws.onclose = () => this.onState('closed');
    ws.onerror = () => this.onState('closed');
  }
  createRoom(): void { this.open(() => this.send({ t: 'create' })); }
  joinRoom(code: string): void { this.open(() => this.send({ t: 'join', code })); }
  send(m: OnlineMsg): void { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  close(): void { this.ws?.close(); this.ws = null; }
}
```

- [ ] **Step 4:** `npx vitest run tests/online.test.ts` → PASS。`npm run typecheck`。
- [ ] **Step 5: 提交**
```bash
git add src/ui/online.ts tests/online.test.ts
git commit -m "feat(ui): OnlineSession WS 客户端（同源相对地址 + 房间收发）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：前端联机模式 UI + 协议派发 + 引擎集成

**Files:** Modify `index.html`、`src/ui/style.css`、`src/ui/main.ts`、`src/ui/controller.ts`

复用在局协议（move/resign/draw/undo），连接 UI 用房间码。

- [ ] **Step 1: controller.ts 加远端着法入口**——`GameController` 加：
```ts
  // 应用一步外部（远端）着法，绕过本地选子/颜色校验（颜色由联机层保证）。
  applyExternalMove(m: Move): boolean {
    const moved = this.game.move(m);
    if (moved) this.lastMove = m;
    this.clearSelection();
    return moved;
  }
```

- [ ] **Step 2: index.html** — `.controls` 加 `<button id="online" class="btn">联机</button>`；`.stage` 内 `.online-panel`（创建/加入/房间码/状态）+ `.online-actions`（认输/求和/悔棋）+ `.online-offer`（接受/拒绝），均默认 hidden。结构：
```html
        <div class="online-panel" id="online-panel" hidden>
          <div class="online-row">
            <button id="o-create" class="btn btn-primary">创建房间(执红)</button>
            <button id="o-join" class="btn">加入房间(执黑)</button>
            <button id="o-exit" class="btn">退出联机</button>
          </div>
          <div class="online-status" id="o-status">未连接</div>
          <div class="online-code-out" id="o-code-out" hidden>房间码：<b id="o-code"></b> <button id="o-copy" class="btn">复制</button>（发给对方）</div>
          <div class="online-code-in" id="o-code-in" hidden>
            <input id="o-code-input" class="num" maxlength="6" placeholder="房间码" style="width:110px" />
            <button id="o-code-submit" class="btn btn-primary">加入</button>
          </div>
        </div>
        <div class="online-actions" id="online-actions" hidden>
          <button id="o-resign" class="btn">认输</button>
          <button id="o-draw" class="btn">求和</button>
          <button id="o-undo" class="btn">请求悔棋</button>
        </div>
        <div class="online-offer" id="online-offer" hidden>
          <span id="o-offer-text"></span>
          <button id="o-accept" class="btn btn-primary">接受</button>
          <button id="o-decline" class="btn">拒绝</button>
        </div>
```

- [ ] **Step 3: style.css 追加**:
```css
/* ===== 联机 ===== */
.online-panel { margin-top: 16px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.online-panel[hidden], .online-actions[hidden], .online-offer[hidden], .online-code-out[hidden], .online-code-in[hidden] { display: none; }
.online-row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.online-status { font-size: 13px; color: var(--paper-dim); }
.online-code-out b { font-family: monospace; font-size: 18px; letter-spacing: 2px; color: var(--gold); }
.online-code-in { display: flex; gap: 8px; align-items: center; }
.online-actions { margin-top: 12px; display: flex; gap: 10px; justify-content: center; }
.online-offer { margin-top: 10px; display: flex; gap: 10px; align-items: center; justify-content: center; font-size: 13px; color: var(--gold); }
```

- [ ] **Step 4: main.ts 接线**——refs + 状态 + 函数 + 监听。要点（完整代码实现时按现有 main.ts 落位）：
  - 状态：`let online: OnlineSession|null; let onlineColor: Color|null; let onlineResult: string|null; let pendingOffer: 'draw'|'undo'|null;`
  - `enterOnline()`：若 `!new OnlineSession().available()`（file://）则提示"请通过服务器网址访问联机"并 return；否则显面板、隐藏 `.controls`/book-line/clocks、停钟。
  - `exitOnline()`：online?.close()、清状态、复原 `.controls`、controller.reset()、refresh。
  - `onlineBtn` 切 enter/exit。`o-create`→`online.createRoom()`；`o-join`→显示房间码输入；`o-code-submit`→`online.joinRoom(code)`；`o-copy`→复制房间码（http 降级：选中 input 文本 / `document.execCommand('copy')`，clipboard 不可用时忽略）。
  - `online.onState`：connecting/open/closed → 更新 `#o-status`；closed 且已配对 → `onlineResult='对方已断线'`、隐藏 actions。
  - `online.onMessage` 派发：
    - `created`：显 `#o-code-out`、`#o-code` = code，状态"等待对方加入"。
    - `paired`：`onlineColor = m.color`；`controller.reset()`；隐藏面板、显 `.online-actions`；refresh。
    - `error`：状态显 m.msg。
    - `move`：`controller.applyExternalMove(iccsToMove(m.iccs))`；有 lastMove 则 `playMoveAnimation(lastMove, refresh)` 否则 refresh。
    - `resign`：`onlineResult='对方认输，你赢了'`；隐藏 actions；updateStatus。
    - `draw-offer`：`pendingOffer='draw'`；`#o-offer-text='对方求和'`；显 offer。
    - `draw-accept`：`onlineResult='和棋'`；隐藏 actions；updateStatus。 `draw-decline`：状态"对方拒绝求和"。
    - `undo-request`：`pendingOffer='undo'`；显 offer。 `undo-accept`：`controller.undo();controller.undo();refresh()`。 `undo-decline`：状态提示。
    - `peer-left`：`onlineResult='对方已断线'`；隐藏 actions；updateStatus。
  - `updateStatus()` 顶部加 `if (onlineResult) { statusEl.className='seal over'; turnTextEl.textContent=onlineResult; return; }`
  - canvas click 守卫最前：`if (browsing || inEndgame) return;` 改为也含联机闸 `if (browsing || inEndgame || (online && onlineColor && (onlineResult || controller.turn !== onlineColor))) return;`
  - 本地走子成功后（`if (moved)` 分支）：若 `online && onlineColor` 则 `online.send({ t:'move', iccs: moveToIccs(controller.lastMove!) })`。
  - 在局按钮：`o-resign`→send resign + onlineResult='你已认输' + 隐藏 actions + updateStatus；`o-draw`→send draw-offer + 状态；`o-undo`→send undo-request + 状态；`o-accept`/`o-decline`→按 pendingOffer 发 accept/decline（draw-accept 设和棋；undo-accept 双方各退一手 controller.undo×2）。

- [ ] **Step 5:** `npm run typecheck` + `npm test`（既有不回归）+ `npm run build` 单文件。
- [ ] **Step 6: 提交**
```bash
git add index.html src/ui/style.css src/ui/main.ts src/ui/controller.ts
git commit -m "feat(ui): 联机对战模式（房间码配对 + 着法/认输/求和/悔棋协议）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：部署 + 证书指南 DEPLOY.md（交付文档）

**Files:** Create `DEPLOY.md`

- [ ] **Step 1: 写 `DEPLOY.md`**，含：
  1. **构建前端**：`npm run build` → `dist/`。
  2. **拷到服务器**：把 `dist/` + `server/` 拷到 Linux 服务器（如 `/opt/xiangqi/`）。
  3. **装服务端依赖**：`cd /opt/xiangqi/server && npm install --omit=dev`。
  4. **systemd 常驻**：`/etc/systemd/system/xiangqi.service`（`ExecStart=/usr/bin/node /opt/xiangqi/server/server.mjs`，`Environment=PORT=8080`，`Restart=always`，`User=` 指定）；`systemctl enable --now xiangqi`。
  5. **HTTP 直跑**：浏览器访问 `http://服务器IP:8080` 即玩（同源 ws:// 自动）。
  6. **可选 HTTPS（Let's Encrypt 免费证书）**：需域名指向服务器（无则申请免费子域如 DuckDNS）；`nginx` 反代 8080 + `certbot --nginx -d 域名` 自动签发+续期；之后访问 `https://域名`，前端相对地址自动 `wss://`，无需改代码。
  7. **防火墙**：放行端口（80/443 或 8080）。
- [ ] **Step 2: 提交**
```bash
git add DEPLOY.md
git commit -m "docs: C 联机部署 + Let's Encrypt 证书指南（owner 自行部署）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## 验证（控制器执行，非任务）
端到端两客户端冒烟：本机 `npm run build` + `node server/server.mjs`（PORT 测试端口）；两个 Playwright 页面访问 `http://localhost:PORT`；page1 创建房间→拿码；page2 输码加入→双方 paired；page1 走子→page2 棋盘更新；认输/求和接受/悔棋接受各往返、双方状态一致；零 console 错误。截图联机界面。

## 完成判据（C）
- rooms / online 单测；`npm test`/`typecheck`/前端 `build` 全绿、既有不回归；`cd server && npm install` 成功。
- 端到端两客户端冒烟全过；联机界面截图 owner 点头。
- `DEPLOY.md` 交付（部署 + 证书指南）。部署由 owner 执行。

## 已知限制（写入注释/SPEC）
- 互信不防作弊；无重连；服务器需公网可达；HTTP 下浏览器标"不安全"（加证书消除）；联机仅经服务器网址，file:// 单文件仅本地。
