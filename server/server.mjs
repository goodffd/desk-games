// desk-games 游戏厅 静态服务（一期无后端，单文件 SPA）。
// 纯 node 内置模块、零依赖。CERT_DIR 指向 certbot live 目录则跑 https，否则 http。
// 域名/端口绝不硬编：PORT、CERT_DIR 由 systemd 注入（脱敏，不入库）。
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createHttpServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dir, '..', 'dist', 'index.html'); // vite-plugin-singlefile 单文件产物
const PORT = process.env.PORT || 8090;
const CERT_DIR = process.env.CERT_DIR;
const useTls = !!(CERT_DIR && existsSync(`${CERT_DIR}/fullchain.pem`) && existsSync(`${CERT_DIR}/privkey.pem`));

const handler = (req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
  try {
    // 单文件 SPA：所有路径都回 index.html（前端 hash 路由），no-store 保证更新即生效
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(INDEX));
  } catch {
    res.writeHead(500).end('build missing — run npm run build');
  }
};

const server = useTls
  ? createHttpsServer({ key: readFileSync(`${CERT_DIR}/privkey.pem`), cert: readFileSync(`${CERT_DIR}/fullchain.pem`) }, handler)
  : createHttpServer(handler);

server.listen(PORT, () => console.log(`desk-games on :${PORT} (${useTls ? 'https' : 'http'}, single-file ${INDEX})`));
