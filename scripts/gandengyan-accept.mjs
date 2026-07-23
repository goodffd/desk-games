/**
 * 干瞪眼 #13 回填验收（慢、opt-in，非递归 smoke）：
 *   npm run accept:gandengyan
 *
 * 两条 #13 一直没验到的 AC：
 *   AC3 —— 两个浏览器窗口打完一整局，验赢家判定与赔付明细（.gy__result 结算弹层）。
 *   AC4 —— 离开游戏时清理干净：回到大厅列表、牌桌无残留、无泄漏定时器报错。
 *
 * 对局必终止的道理：牌堆有限，摸牌只发给「赢下这轮的人」，牌堆耗尽后手牌只减不增。
 * 真人策略「跟牌即快过、领出甩最大同点数一组（对/三张炸）」让三家齐缩，最快把某家清空结束。
 *
 * 需要先构建：npm run build && npm run build:server。SMOKE_HEADED=1 肉眼看。
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
    ['server/gandengyan-match-driver.bundle.mjs', 'npm run build:server'],
  ].filter(([f]) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    for (const [f, cmd] of missing) console.error(`✗ 缺 ${f} → 先跑 ${cmd}`);
    process.exit(1);
  }
}
async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/gandengyan`); if (r.ok) return; } catch { /* 未起 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`服务 ${timeoutMs}ms 内没起来`);
}
async function enterLobby(ctx, nick) {
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
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
 * 我的回合：跟牌即快过（让局推进）；轮到领出（不要被禁用）就甩掉「最大的同点数一组」——
 * 对/三张炸一次去 2-3 张，三家齐缩，最快把某家清空、结束本局。只剩王的领出会落回快过分支
 * （无合法领出时不要按钮是启用的），不走这里。
 */
async function takeTurn(page) {
  const play = page.getByRole('button', { name: '出牌' });
  const pass = page.getByRole('button', { name: '不要' });
  if (await play.isDisabled().catch(() => true)) return false;        // 出牌禁用=不是我的回合
  if (!(await pass.isDisabled().catch(() => true))) {                 // 不要可点=跟牌/无牌可领：快过
    try { await pass.click({ timeout: 1200 }); return true; } catch { return false; }
  }
  // 领出：读手牌点数，选最大的同点数一组
  const hand = await page.locator('.gy__hand .dgc-card').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-card-id'),
      rank: el.classList.contains('dgc-card--joker') ? 'JOKER' : (el.querySelector('.dgc-card__rank')?.textContent || '?'),
    })),
  );
  const groups = {};
  for (const c of hand) if (c.rank !== 'JOKER' && c.id) (groups[c.rank] ||= []).push(c.id);
  let ids = null;
  for (const g of Object.values(groups)) if (!ids || g.length > ids.length) ids = g;
  if (!ids) ids = hand[0]?.id ? [hand[0].id] : [];                   // 兜底：手里只剩王，出一张
  if (!ids.length) return false;
  try {
    for (const id of ids) await page.locator(`.gy__hand .dgc-card[data-card-id="${id}"]`).click({ timeout: 1000 });
    await play.click({ timeout: 1200 });
    const chip = page.locator('.gy__chooser .gy__chip').first();
    if (await chip.count()) await chip.click({ timeout: 1000 });
    return true;
  } catch { return false; }
}

async function acFullGame(browser) {
  step('AC3：两个浏览器窗口打完一整局，验赢家判定与赔付明细');
  const a = await enterLobby(await browser.newContext(), '验甲');
  await a.getByRole('button', { name: '3', exact: true }).click();
  await a.getByRole('button', { name: '建房', exact: true }).click();
  const code = (await a.locator('.cr-room__code').first().innerText()).replace(/[^A-Z0-9]/g, '').slice(0, 6);
  log(`3 人房 ${code}（验甲 + 验乙 + 1 AI）`);
  const b = await enterLobby(await browser.newContext(), '验乙');
  await b.getByPlaceholder('6 位房号').fill(code);
  await b.getByRole('button', { name: '加入' }).first().click();
  await b.getByRole('button', { name: '＋ 入座' }).first().click();
  await a.getByRole('button', { name: '开打' }).click();
  await a.locator('.gy__hand').waitFor({ timeout: 20000 });
  await b.locator('.gy__hand').waitFor({ timeout: 20000 });

  let moved = 0;
  const deadline = Date.now() + 150000;
  for (let i = 0; Date.now() < deadline; i++) {
    if (await a.locator('.gy__result').count() || await b.locator('.gy__result').count()) break;
    if (await takeTurn(a)) moved++;
    else if (await takeTurn(b)) moved++;
    else await a.waitForTimeout(250);
    if (i % 30 === 29) log(`…第 ${i + 1} 轮，真人已出手/过 ${moved} 次`);
  }
  const resPage = (await a.locator('.gy__result').count()) ? a : b;
  if (!(await resPage.locator('.gy__result').count())) throw new Error(`150s 内没打完（真人动了 ${moved} 次）`);

  const title = (await resPage.locator('.gy__result-title').innerText()).trim();
  const payRows = await resPage.locator('.gy__result-pay').allInnerTexts();
  const cardRows = await resPage.locator('.gy__result-cards').allInnerTexts();
  log(`结算：「${title}」`);
  log(`赔付明细：${payRows.map((p, i) => `座${i} ${cardRows[i] ?? ''} ${p}`).join(' | ')}`);
  // 赢家判定：标题含「赢」或「僵局」；赔付明细每座一行，且恰有一行是收分(+)其余是付分(-)或—
  if (!/赢|僵局/.test(title)) throw new Error(`结算标题异常：${title}`);
  if (payRows.length < 2) throw new Error(`赔付明细不足：${JSON.stringify(payRows)}`);
  const winners = payRows.filter((p) => p.includes('+'));
  const stalemate = /僵局/.test(title);
  if (!stalemate && winners.length !== 1) throw new Error(`应恰有 1 个收分赢家，实得 ${winners.length}：${JSON.stringify(payRows)}`);
  log(`✓ 打完一整局，赢家判定与赔付明细齐（真人共动 ${moved} 次）`);
  await a.context().close(); await b.context().close();
}

async function acCleanLeave(browser) {
  step('AC4：离开游戏时清理干净（回大厅列表、牌桌无残留、无泄漏定时器报错）');
  const errors = [];
  const c = await enterLobby(await browser.newContext(), '验丙');
  c.on('pageerror', (e) => errors.push(e.message));
  await c.getByRole('button', { name: '2', exact: true }).click();
  await c.getByRole('button', { name: '建房', exact: true }).click();
  await c.getByRole('button', { name: '开打' }).click();          // 1 真人 + 1 AI，直接开打进牌桌
  await c.locator('.gy__hand').waitFor({ timeout: 20000 });
  log('进了牌桌（定时器在跑）');
  await c.getByRole('button', { name: '返回大厅' }).click();
  await c.locator('.home').waitFor({ timeout: 10000 });            // 回到游戏列表首页
  const gyLeft = await c.locator('.gy').count();
  if (gyLeft) throw new Error(`离开后牌桌 DOM 仍残留 ${gyLeft} 个 .gy`);
  if (!(await c.locator('.game-card').count())) throw new Error('离开后没回到游戏列表');
  await c.waitForTimeout(2000);                                    // 等 2s：泄漏的倒计时定时器会在拆掉的 DOM 上报错
  if (errors.length) throw new Error(`离开后仍有页面报错（疑似泄漏定时器）：${errors.join(' / ')}`);
  log('✓ 回到大厅列表、无 .gy 残留、2s 内无泄漏报错');
  await c.context().close();
}

requireBuilt();
const server = spawn(process.execPath, [join(ROOT, 'server', 'server.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT, GY_AI_DELAY: process.env.GY_AI_DELAY || '40' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

let browser, failure = null;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: process.env.SMOKE_HEADED !== '1' });
  await acFullGame(browser);
  await acCleanLeave(browser);
} catch (e) { failure = e; }
finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}
if (failure) {
  console.error(`\n✗ 验收失败：${failure.message}`);
  if (serverLog.trim()) console.error('--- 服务端输出 ---\n' + serverLog.trim());
  process.exit(1);
}
console.log('\n✓ #13 回填验收通过：打完一整局(赢家+赔付) / 离开清理干净');
