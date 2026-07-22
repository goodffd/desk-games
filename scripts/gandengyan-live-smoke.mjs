/**
 * 干瞪眼联机真机冒烟：一条命令跑完 建房(选人数) / 加入 / 入座 / 开打 / 出牌 / 打完一整局。
 *
 *   npm run smoke:gandengyan
 *
 * 自己起服务、自己收摊；跑完杀掉进程，失败退非零码。
 * 需要先构建：`npm run build && npm run build:server`（缺了会提示）。
 *
 * 环境变量：SMOKE_PORT（默认 18098）、SMOKE_HEADED=1（开有头浏览器肉眼看）
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.SMOKE_PORT || '18098';
const BASE = `http://127.0.0.1:${PORT}`;

const log = (...a) => console.log('  ', ...a);
const step = (s) => console.log(`\n▶ ${s}`);

function requireBuilt() {
  const missing = [
    ['dist/index.html', 'npm run build'],
    ['server/gandengyan-match-driver.bundle.mjs', 'npm run build:server'],
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
    try { const r = await fetch(`${BASE}/gandengyan`); if (r.ok) return; } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`服务在 ${timeoutMs}ms 内没起来（${BASE}）`);
}

async function enterLobby(ctx, nick) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(4000);   // 别用 30s 默认值：牌桌元素随时重渲染，卡住一次就吃掉半分钟
  page.on('pageerror', (e) => console.error('   [页面异常]', e.message));
  await page.goto(`${BASE}/gandengyan`, { waitUntil: 'domcontentloaded' });
  const input = page.getByPlaceholder('起个名字');
  await input.waitFor({ timeout: 15000 });
  await input.fill(nick);
  await input.blur();
  await page.getByRole('button', { name: '进入大厅' }).click();
  await page.getByRole('button', { name: '建房', exact: true }).waitFor({ timeout: 15000 });
  return page;
}

/**
 * 轮到自己时走一步。**策略故意选最省的**：能「不要」就不要，只有轮到自己领出
 * （不要被禁用）时才出一张牌——领出任意单张都合法，一次就成。
 *
 * 这个冒烟要证明的是「界面能出牌、一局能打完、结算出得来」，不是「打得好」。
 * 早先那版逐张试牌，每轮十几次浏览器往返，180 秒只推进 9 手——测的是我的驱动策略，
 * 不是产品。
 */
async function takeTurn(page) {
  const play = page.getByRole('button', { name: '出牌' });
  const pass = page.getByRole('button', { name: '不要' });
  if (await play.isDisabled().catch(() => true)) return false;

  if (!(await pass.isDisabled().catch(() => true))) { await pass.click(); return true; }

  // 不要被禁用 = 轮到自己领出：出一张就行
  const cards = page.locator('.gy__hand .gy__card');
  for (let i = 0; i < 8; i++) {
    // **每轮重读张数**：手牌随时在重渲染，缓存下来的下标一变就指空
    if (i >= await cards.count().catch(() => 0)) return false;
    try {
      await cards.nth(i).click();
      await play.click();
      const chip = page.locator('.gy__chooser .gy__chip').first();
      if (await chip.count()) await chip.click();
      if (await play.isDisabled().catch(() => true)) return true;
      await cards.nth(i).click();      // 出不掉（比如单张王）：取消这张换下一张
    } catch { return false; }          // 元素被重渲染冲掉：这轮算了，下轮再来
  }
  return false;
}

async function runSmoke(browser) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();

  step('甲：进大厅 → 建 3 人房（真人只有 2 个，第 3 座补 AI）');
  const a = await enterLobby(ctxA, '干甲');
  await a.locator('.gy__select').selectOption('3');
  await a.getByRole('button', { name: '建房', exact: true }).click();
  const codeEl = a.locator('.gy__code').first();
  await codeEl.waitFor({ timeout: 15000 });
  const code = (await codeEl.innerText()).replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error(`房号读不出来：${JSON.stringify(code)}`);
  log(`房号 ${code}`);

  step('乙：进大厅 → 输房号加入 → 入座');
  const b = await enterLobby(ctxB, '干乙');
  await b.getByPlaceholder('6 位房号').fill(code);
  await b.getByRole('button', { name: '加入' }).first().click();
  const take = b.getByRole('button', { name: '＋ 入座' }).first();
  await take.waitFor({ timeout: 15000 });
  await take.click();
  log('乙已入座');

  step('昵称全服唯一：拿掼蛋那边占过的名字来注册会被拒');
  const ctxD = await browser.newContext();
  const d = await ctxD.newPage();
  await d.goto(`${BASE}/guandan`, { waitUntil: 'domcontentloaded' });
  await d.getByPlaceholder('比如：阿东').fill('干甲');       // 干瞪眼里已被占
  await d.getByRole('button', { name: '进入大厅' }).click();
  await d.getByText('昵称已被占用，换一个').waitFor({ timeout: 10000 });
  log('掼蛋那边拿同名注册被拒 —— 两个游戏共用一套占用表');
  await ctxD.close();

  step('甲：开打，双方进牌桌');
  await a.getByRole('button', { name: '开打' }).click();
  await a.locator('.gy__hand').waitFor({ timeout: 20000 });   // 开局较慢，这一处单独给足
  await b.locator('.gy__hand').waitFor({ timeout: 20000 });
  const handA = await a.locator('.gy__hand .gy__card').count();
  const handB = await b.locator('.gy__hand .gy__card').count();
  // 庄多发一张，但**庄是随机的**（首局庄随机，SPEC 如此），可能落在 AI 座上——
  // 所以不能假设房主就是庄；只断言每人 5 或 6 张。
  log(`甲 ${handA} 张、乙 ${handB} 张（庄 6 张、其余 5 张；本局庄未必是真人）`);
  for (const [who, n] of [['甲', handA], ['乙', handB]]) {
    if (n < 5 || n > 6) throw new Error(`${who} 起手 ${n} 张，应为 5 或 6`);
  }
  const deck = await a.locator('.gy__deck').innerText();
  log(`公开态：${deck}`);

  step('两人轮流出牌，打到本局结束');
  let moved = 0;
  const deadline = Date.now() + 180000;   // 硬上限：三分钟打不完就算失败，不无限磨
  for (let i = 0; Date.now() < deadline; i++) {
    if (await a.locator('.gy__over').count() || await b.locator('.gy__over').count()) break;
    if (await takeTurn(a)) moved++;
    else if (await takeTurn(b)) moved++;
    else await a.waitForTimeout(300);    // 都不是自己的回合：等 AI 那一手
    if (process.env.SMOKE_DEBUG && i % 5 === 4) {
      const dbg = async (p, who) => {
        const seatTxt = await p.locator('.gy__seat--turn .gy__seat-name').first().innerText().catch(() => '?');
        const playDis = await p.getByRole('button', { name: '出牌' }).isDisabled().catch(() => 'err');
        const hint = await p.locator('.gy__hint').innerText().catch(() => '');
        const cards = await p.locator('.gy__hand .gy__card').count();
        return `${who}[轮到:${seatTxt} 出牌禁用:${playDis} 手牌:${cards} 提示:${hint || '-'}]`;
      };
      log(`第 ${i + 1} 轮 ` + (await dbg(a, '甲')) + ' ' + (await dbg(b, '乙')));
    } else if (i % 20 === 19) log(`…第 ${i + 1} 轮，真人已出手 ${moved} 次`);
  }
  const over = (await a.locator('.gy__over').count()) || (await b.locator('.gy__over').count());
  if (!over) throw new Error(`没能在步数内打完（真人动了 ${moved} 手）`);
  log(`打完了，真人共出手 ${moved} 次`);
  log('结算：' + (await a.locator('.gy__over').first().innerText().catch(() => '(在乙那边)')));
}

requireBuilt();

const server = spawn(process.execPath, [join(ROOT, 'server', 'server.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT, GY_AI_DELAY: process.env.GY_AI_DELAY || '60' }, stdio: ['ignore', 'pipe', 'pipe'],
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
console.log('\n✓ 冒烟通过：建房选人数 / 加入 / 入座 / 昵称全服唯一 / 开打 / 出牌 / 打完一整局');
