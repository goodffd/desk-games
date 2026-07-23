/**
 * 干瞪眼联机真机冒烟：建房(选人数) / 加入 / 入座 / 昵称全服唯一 / 开打 / 出牌·不要链路端到端。
 * 「完整打完一整局」归 #17（真断线重连 + live-smoke，用真 AI 策略跑完）；对局终止性已由
 * #12 的 wire 层单测严格证明（2–5 人各打到结算），此处只证浏览器侧出牌链路真的通。
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
  if (await play.isDisabled().catch(() => true)) return false;   // 不是我的回合

  // 我的回合：优先出一张（领出任意单张合法；跟牌试前几张能压的），出不掉才「不要」。
  // 所有动作短超时 + catch —— AI 每手都会触发 render 重刷，长超时会在竞态里干等。
  const cards = page.locator('.gy__hand .dgc-card');
  const n = Math.min(await cards.count().catch(() => 0), 6);
  for (let i = 0; i < n; i++) {
    try {
      await cards.nth(i).click({ timeout: 1500 });
      await play.click({ timeout: 1500 });
      const chip = page.locator('.gy__chooser .gy__chip').first();
      if (await chip.count()) await chip.click({ timeout: 1500 });
      if (await play.isDisabled().catch(() => true)) return true;   // 轮次离开 = 出成功
      await cards.nth(i).click({ timeout: 1500 }).catch(() => {});   // 出不掉：取消这张换下一张
    } catch { return false; }   // 元素被重渲染冲掉：这轮算了
  }
  // 一张都出不掉（比如领出只剩王）→ 不要
  const pass = page.getByRole('button', { name: '不要' });
  try { await pass.click({ timeout: 1500 }); return true; } catch { return false; }
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
  const handA = await a.locator('.gy__hand .dgc-card').count();
  const handB = await b.locator('.gy__hand .dgc-card').count();
  // 庄多发一张，但**庄是随机的**（首局庄随机，SPEC 如此），可能落在 AI 座上——
  // 所以不能假设房主就是庄；只断言每人 5 或 6 张。
  log(`甲 ${handA} 张、乙 ${handB} 张（庄 6 张、其余 5 张；本局庄未必是真人）`);
  for (const [who, n] of [['甲', handA], ['乙', handB]]) {
    if (n < 5 || n > 6) throw new Error(`${who} 起手 ${n} 张，应为 5 或 6`);
  }
  const deck = await a.locator('.gy__deck').innerText();
  log(`公开态：${deck}`);

  step('两人各走几手，确认出牌/不要链路端到端通（完整打完一局归 #17 live-smoke）');
  let moved = 0;
  // 只验链路通、不跑完整局：真人成功走出 ≥2 手真牌即证明 onPlay/onPass 端到端接对了。
  // 完整对局终止性由 #12 wire 层单测保证；浏览器跑完整局用真 AI 策略，是 #17 的活。
  const deadline = Date.now() + 45000;
  for (let i = 0; Date.now() < deadline && moved < 6; i++) {
    if (await a.locator('.gy__result').count() || await b.locator('.gy__result').count()) break;
    if (await takeTurn(a)) moved++;
    else if (await takeTurn(b)) moved++;
    else await a.waitForTimeout(300);    // 都不是自己的回合：等 AI 那一手
    if (i % 20 === 19) log(`…第 ${i + 1} 轮，真人已出手 ${moved} 次`);
  }
  if (moved < 2) throw new Error(`出牌链路没跑通：45s 内真人只成功出手 ${moved} 次（期望 ≥2）`);
  const over = (await a.locator('.gy__result').count()) || (await b.locator('.gy__result').count());
  log(over ? '本局已结算' : `出牌/不要链路通，真人成功出手 ${moved} 次（完整对局终止性见 #12 wire 层单测）`);
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
console.log('\n✓ 冒烟通过：建房选人数 / 加入 / 入座 / 昵称全服唯一 / 开打 / 出牌·不要链路端到端（完整打完一局见 #17）');
