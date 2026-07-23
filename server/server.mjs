// desk-games 游戏大厅 合并服务（一个进程 / 一个端口托管整个大厅）：
//   /            → 游戏大厅(desk-games 单文件 SPA)，/xiangqi 亦由前端路由 mount（象棋已内置）
//   /ws          → 象棋联机 WebSocket（RoomRegistry，自 xiangqi-game vendored 而来）
//   /ws-guandan  → 掼蛋联机 WebSocket
// 纯 node + ws，零其它依赖。域名/端口绝不硬编：PORT、CERT_DIR 由 systemd 注入（脱敏，不入库）。
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { RoomRegistry } from './rooms.mjs';
import { RoomRegistry as GuandanRooms } from './guandan-rooms.mjs';
import { RoomRegistry as GandengyanRooms } from './gandengyan-rooms.mjs';
import { NickRegistry } from './card-rooms.mjs';
import { MatchDriver } from './guandan-match-driver.bundle.mjs';
import { GandengyanDriver } from './gandengyan-match-driver.bundle.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const HUB_INDEX = join(__dir, '..', 'dist', 'index.html');          // 游戏大厅(desk-games)，象棋已内置
const PORT = process.env.PORT || 8080;
const CERT_DIR = process.env.CERT_DIR;
const useTls = !!(CERT_DIR && existsSync(`${CERT_DIR}/fullchain.pem`) && existsSync(`${CERT_DIR}/privkey.pem`));

const handler = (req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
  // 所有 HTTP 请求均返回大厅 SPA；/xiangqi 由前端路由 mount（象棋已内置大厅）
  const file = HUB_INDEX;
  try {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  } catch { res.writeHead(500).end('build missing — run npm run build'); }
};

const server = useTls
  ? createHttpsServer({ key: readFileSync(`${CERT_DIR}/privkey.pem`), cert: readFileSync(`${CERT_DIR}/fullchain.pem`) }, handler)
  : createHttpServer(handler);

const reg = new RoomRegistry();
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
wss.on('connection', (ws) => {
  const client = { send: (m) => { try { ws.send(JSON.stringify(m)); } catch {} } };
  ws.on('message', (data) => { try { reg.handle(client, JSON.parse(data.toString())); } catch {} });
  ws.on('close', () => reg.leave(client));
});

// 掼蛋联机：独立 RoomRegistry + /ws-guandan，与象棋 /ws 并存（owner: 跟象棋隔离）
const TRIBUTE_TIMEOUT = Number(process.env.GD_TRIBUTE_TIMEOUT) || 30000;
const TURN_TIMEOUT = Number(process.env.GD_TURN_TIMEOUT) || 20000; // 回合超时 20s：客户端倒计时由服务端 turnRemainMs 播种,显示到 0 ≈ 服务端到点托管(无 3s 空等);可 env 覆写便于冒烟
const DISCONNECT_GRACE = Number(process.env.GD_DISCONNECT_GRACE) || 10000; // 掉线宽限单次 10s：掉线不立刻全速AI,靠回合超时代打,给重连窗口
const DISCONNECT_MISSES = Number(process.env.GD_DISCONNECT_MISSES) || 2;   // 连续 2 手没回来才转全速AI；重连随时收座清零
const DEAL_RESULT_LINGER = Number(process.env.GD_DEAL_RESULT_LINGER) || 4500; // 单局结算停留 4.5s 再续局：让玩家看清名次与末游剩牌（否则一闪而过）
// 昵称全服唯一：两个牌类游戏各有大厅，但共用同一套占用表（owner 2026-07-22 拍板）
const nicks = new NickRegistry();
const gReg = new GuandanRooms(undefined, () => new MatchDriver({}), TRIBUTE_TIMEOUT, TURN_TIMEOUT, DISCONNECT_GRACE, DISCONNECT_MISSES, DEAL_RESULT_LINGER, nicks);
const gwss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
gwss.on('connection', (ws) => {
  const client = { send: (m) => { try { ws.send(JSON.stringify(m)); } catch {} } };
  ws.on('message', (data) => { try { gReg.handle(client, JSON.parse(data.toString())); } catch {} });
  ws.on('close', () => gReg.leave(client));
});

// 干瞪眼联机：同一套公共房间层，独立注册表 + /ws-gandengyan
/** 生产用真随机洗牌（驱动里的默认实现是不洗牌，那是给测试用的确定性桩） */
const realShuffle = (n) => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
// 冒烟专用：GY_DEAL_SEED 设了就用确定性洗牌 + 固定座 0 为庄，让 live-smoke 能复现「某家拿到歧义手」。
// 仅当 env 显式设置时生效（同 GY_AI_DELAY），生产留空 = realShuffle + 随机庄。
const dealSeed = process.env.GY_DEAL_SEED != null && process.env.GY_DEAL_SEED !== '' ? Number(process.env.GY_DEAL_SEED) : null;
const seededShuffle = (seed) => (n) => {
  let s = seed >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const yReg = new GandengyanRooms(
  undefined,
  (room) => new GandengyanDriver({
    shuffle: dealSeed != null ? seededShuffle(dealSeed) : realShuffle,
    seatCount: room.seatCount,
    dealer: dealSeed != null ? 0 : Math.floor(Math.random() * room.seatCount),   // 冒烟固定庄=座0 全确定性；生产随机
  }),
  TURN_TIMEOUT, DISCONNECT_GRACE, DISCONNECT_MISSES, nicks,
  process.env.GY_AI_DELAY ? Number(process.env.GY_AI_DELAY) : null,   // 冒烟可调小；生产留空=1.2~2.5s 观感延迟
);
const ywss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
ywss.on('connection', (ws) => {
  const client = { send: (m) => { try { ws.send(JSON.stringify(m)); } catch {} } };
  ws.on('message', (data) => { try { yReg.handle(client, JSON.parse(data.toString())); } catch {} });
  ws.on('close', () => yReg.leave(client));
});

// WS 心跳：定期 ping，未回 pong 的半开连接(掉线/合盖/手机切后台没走完 TCP FIN)予以 terminate——
// terminate 触发 close → 走正常 leave 清理(座位释放/掉线宽限)。否则僵尸连接一直"占"着座，
// 真人刷新重连被拒「座位已占」、对手也永远收不到掉线通知。两个 wss 都挂。
const HEARTBEAT_MS = Number(process.env.GD_HEARTBEAT) || 30000;
function heartbeat(wsServer) {
  wsServer.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });
  const timer = setInterval(() => {
    for (const ws of wsServer.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, HEARTBEAT_MS);
  wsServer.on('close', () => clearInterval(timer));
}
heartbeat(wss);
heartbeat(gwss);
heartbeat(ywss);

// 统一升级路由：按路径分派到对应 WebSocketServer
server.on('upgrade', (req, socket, head) => {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (pathname === '/ws-gandengyan') {
    ywss.handleUpgrade(req, socket, head, (ws) => ywss.emit('connection', ws, req));
  } else if (pathname === '/ws-guandan') {
    gwss.handleUpgrade(req, socket, head, (ws) => gwss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => console.log(`hub on :${PORT} (${useTls ? 'https/wss' : 'http/ws'}; / → 大厅, /xiangqi → 大厅内 mount(象棋内置), /ws → 联机)`));
