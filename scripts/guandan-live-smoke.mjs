/**
 * 掼蛋联机真机冒烟：一条命令跑完 建房 / 加入 / 入座 / 开打 / 断线重连 的真路径。
 *
 *   npm run smoke:guandan
 *
 * 自己起服务、自己收摊；跑完杀掉进程，失败退非零码。
 * 需要先构建（下面会检查并提示）：`npm run build && npm run build:server`。
 *
 * 为什么值得留在仓库里：抽公共房间层（#11）与上线前（#17）都要跑同一套，
 * 而单测替代不了它——房间层三层各自绿、合起来仍可能坏，只有真浏览器 + 真 WebSocket
 * 能证明「两个人真的能坐到一张桌上打，断了还能回来」。
 *
 * 环境变量：
 *   SMOKE_PORT     服务端口，默认 18099
 *   SMOKE_HEADED   设为 1 则开有头浏览器（本地肉眼看）
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.SMOKE_PORT || '18099';
const BASE = `http://127.0.0.1:${PORT}`;

const log = (...a) => console.log('  ', ...a);
const step = (s) => console.log(`\n▶ ${s}`);

function requireBuilt() {
  const missing = [
    ['dist/index.html', 'npm run build'],
    ['server/guandan-match-driver.bundle.mjs', 'npm run build:server'],
  ].filter(([f]) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error('✗ 缺构建产物：');
    for (const [f, cmd] of missing) console.error(`    ${f}  →  先跑 ${cmd}`);
    process.exit(1);
  }
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/guandan`);
      if (r.ok) return;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`服务在 ${timeoutMs}ms 内没起来（${BASE}）`);
}

/** 进大厅：填昵称 → 进入大厅，返回该 page */
async function enterLobby(ctx, nick) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('   [页面异常]', e.message));
  await page.goto(`${BASE}/guandan`, { waitUntil: 'domcontentloaded' });
  const input = page.getByPlaceholder('比如：阿东');
  await input.waitFor({ timeout: 15000 });
  await input.fill(nick);
  await input.blur();                       // 先失焦再点，避免输入还没提交就被按钮抢走
  await page.getByRole('button', { name: '进入大厅' }).click();
  await page.getByRole('button', { name: '建房邀请' }).waitFor({ timeout: 15000 });
  return page;
}

async function runSmoke(browser) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  step('甲：进大厅 → 建房');
  const a = await enterLobby(ctxA, '冒烟甲');
  await a.getByRole('button', { name: '建房邀请' }).click();
  const codeEl = a.locator('.gd-room__codewrap');
  await codeEl.waitFor({ timeout: 15000 });
  const code = (await codeEl.innerText()).replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error(`房号读不出来，拿到的是 ${JSON.stringify(code)}`);
  log(`房号 ${code}`);

  step('乙：进大厅 → 输房号加入 → 入座');
  const b = await enterLobby(ctxB, '冒烟乙');
  await b.getByPlaceholder('6 位房号').fill(code);
  await b.locator('.gd-lobby__joinrow button').click();
  await b.locator('.gd-room__table').waitFor({ timeout: 15000 });
  const take = b.getByRole('button', { name: '＋ 入座' }).first();
  await take.waitFor({ timeout: 15000 });
  await take.click();
  log('乙已入座');

  step('甲：确认看得到乙，然后开打');
  await a.locator('.gd-room__table').getByText('冒烟乙').waitFor({ timeout: 15000 });
  log('甲看到了乙');
  await a.getByRole('button', { name: '开打' }).click();

  step('双方进牌桌');
  await a.locator('.gd-game').waitFor({ timeout: 20000 });
  await b.locator('.gd-game').waitFor({ timeout: 20000 });
  log('甲乙都在牌桌上');

  step('乙：断线重连（刷新页面走会话令牌自动 rejoin）');
  await b.reload({ waitUntil: 'domcontentloaded' });
  await b.locator('.gd-game').waitFor({ timeout: 20000 });
  log('乙重连后回到了牌桌');

  step('甲：牌桌仍在，未被对方断线拖垮');
  if (!(await a.locator('.gd-game').isVisible())) throw new Error('甲的牌桌没了');
  log('甲的牌桌还在');
}

requireBuilt();

const server = spawn(process.execPath, [join(ROOT, 'server', 'server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

let browser;
let failure = null;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: process.env.SMOKE_HEADED !== '1' });
  await runSmoke(browser);
} catch (e) {
  failure = e;
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}

if (failure) {
  console.error(`\n✗ 冒烟失败：${failure.message}`);
  if (serverLog.trim()) console.error('--- 服务端输出 ---\n' + serverLog.trim());
  process.exit(1);
}
console.log('\n✓ 冒烟通过：建房 / 加入 / 入座 / 开打 / 断线重连 全程真路径');
