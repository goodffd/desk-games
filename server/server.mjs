// desk-games 游戏大厅 合并服务（一个进程 / 一个端口托管整个大厅）：
//   /            → 游戏大厅(desk-games 单文件 SPA)
//   /xiangqi/*   → 中国象棋(单文件 SPA)
//   /ws          → 象棋联机 WebSocket（RoomRegistry，自 xiangqi-game vendored 而来）
// 纯 node + ws，零其它依赖。域名/端口绝不硬编：PORT、CERT_DIR 由 systemd 注入（脱敏，不入库）。
// 注：rooms.mjs 当前自 xiangqi-game/server/rooms.mjs 复制而来；待象棋作为大厅内置模块完整接入后再统一。
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { RoomRegistry } from './rooms.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const HUB_INDEX = join(__dir, '..', 'dist', 'index.html');          // 游戏大厅(desk-games)
const XQ_INDEX = join(__dir, '..', 'xiangqi-dist', 'index.html');   // 象棋
const PORT = process.env.PORT || 8080;
const CERT_DIR = process.env.CERT_DIR;
const useTls = !!(CERT_DIR && existsSync(`${CERT_DIR}/fullchain.pem`) && existsSync(`${CERT_DIR}/privkey.pem`));

const handler = (req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
  // 子路径路由：/xiangqi* → 象棋；其余 → 大厅。两者均 vite 单文件 SPA。
  const file = (path === '/xiangqi' || path.startsWith('/xiangqi/')) ? XQ_INDEX : HUB_INDEX;
  try {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  } catch { res.writeHead(500).end('build missing — run npm run build'); }
};

const server = useTls
  ? createHttpsServer({ key: readFileSync(`${CERT_DIR}/privkey.pem`), cert: readFileSync(`${CERT_DIR}/fullchain.pem`) }, handler)
  : createHttpServer(handler);

const reg = new RoomRegistry();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1 << 20 });
wss.on('connection', (ws) => {
  const client = { send: (m) => { try { ws.send(JSON.stringify(m)); } catch {} } };
  ws.on('message', (data) => { try { reg.handle(client, JSON.parse(data.toString())); } catch {} });
  ws.on('close', () => reg.leave(client));
});

server.listen(PORT, () => console.log(`hub on :${PORT} (${useTls ? 'https/wss' : 'http/ws'}; / → 大厅, /xiangqi → 象棋, /ws → 联机)`));
