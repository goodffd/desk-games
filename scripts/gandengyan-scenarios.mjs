/**
 * 干瞪眼 #17 live-smoke 四场景（真 Chrome + 真 WS，盯住单测抓不到的东西）：
 *   npm run smoke:gandengyan:scenarios
 *
 *   场景一 歧义：GY_DEAL_SEED=3 让庄(座0)拿到 王+7+8，领出选它 → 弹二选一，选完发出的包带对指派
 *          （中央桌面牌的王药丸显示被指成的点数，证 assign 真的过了 WS 一个来回）。
 *   场景二 5 人环形：布局不重叠、自己恒在底部（没压掉掼蛋的锚定）。
 *   场景三 掉线→重连：乙断线，甲看到乙「掉线」；乙重连，甲看到乙回来（peer-offline/back，#20 归并）。
 *   场景四 离开清理：离开牌桌回大厅、无残留、无泄漏定时器报错。
 *
 * 需要先构建：npm run build && npm run build:server。SMOKE_HEADED=1 肉眼看。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.SMOKE_PORT || '18097';
const BASE = `http://127.0.0.1:${PORT}`;
const log = (...a) => console.log('  ', ...a);
const step = (s) => console.log(`\n▶ ${s}`);

function requireBuilt() {
  for (const [f, cmd] of [['dist/index.html', 'npm run build'], ['server/gandengyan-match-driver.bundle.mjs', 'npm run build:server']]) {
    if (!existsSync(join(ROOT, f))) { console.error(`✗ 缺 ${f} → 先跑 ${cmd}`); process.exit(1); }
  }
}
async function waitForServer(t = 20000) {
  const end = Date.now() + t;
  while (Date.now() < end) { try { const r = await fetch(`${BASE}/gandengyan`); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('服务没起来');
}
async function enter(ctx, nick) {
  const p = await ctx.newPage();
  p.setDefaultTimeout(6000);
  p.on('pageerror', (e) => console.error('   [页面异常]', e.message));
  await p.goto(`${BASE}/gandengyan`, { waitUntil: 'domcontentloaded' });
  await p.getByPlaceholder('起个名字').fill(nick);
  await p.getByRole('button', { name: '进入大厅' }).click();
  await p.getByRole('button', { name: '建房', exact: true }).waitFor({ timeout: 15000 });
  return p;
}
const seats = (page) => page.locator('.gy__board .gy__seat');

async function scenarioAmbiguity(browser) {
  step('场景一 歧义：庄拿 王+7+8 领出 → 弹二选一，选完发出的包带对指派');
  const a = await enter(await browser.newContext(), '甲');
  await a.getByRole('button', { name: '3', exact: true }).click();
  await a.getByRole('button', { name: '建房', exact: true }).click();
  await a.getByRole('button', { name: '开打' }).click();          // 庄=座0=甲，直接领出
  await a.locator('.gy__hand').waitFor({ timeout: 20000 });
  // 从手牌里挑 小王 + 一张7 + 一张8
  const hand = await a.locator('.gy__hand .dgc-card').evaluateAll((els) => els.map((el) => ({
    id: el.getAttribute('data-card-id'),
    rank: el.classList.contains('dgc-card--joker') ? 'J' : (el.querySelector('.dgc-card__rank')?.textContent || '?'),
  })));
  const pick = [hand.find((c) => c.rank === 'J'), hand.find((c) => c.rank === '7'), hand.find((c) => c.rank === '8')];
  if (pick.some((c) => !c)) throw new Error(`庄手里没凑齐 王+7+8：${JSON.stringify(hand)}`);
  for (const c of pick) await a.locator(`.gy__hand .dgc-card[data-card-id="${c.id}"]`).click();
  await a.getByRole('button', { name: '出牌' }).click();
  const chips = a.locator('.gy__chooser .gy__chip');
  await chips.first().waitFor({ timeout: 5000 });
  const n = await chips.count();
  if (n !== 2) throw new Error(`王+7+8 应弹 2 解(678/789)，实弹 ${n}`);
  log(`弹出二选一，${n} 个牌型标识`);
  await chips.first().click();
  // 出成功：桌面中央出现这一手，王带药丸显示被指成的点数（6 或 9）
  await a.locator('.gy__cur .dgc-card__assign').first().waitFor({ timeout: 5000 });
  const rank = (await a.locator('.gy__cur .dgc-card__assign').first().innerText()).trim();
  if (!['6', '9'].includes(rank)) throw new Error(`王被指成了 ${rank}，应为 6(678) 或 9(789)`);
  log(`选完发出，桌面王药丸显示 ${rank}（678/789 之一）——指派真的过了 WS 一个来回 ✓`);
  await a.context().close();
}

async function scenarioFiveRing(browser) {
  step('场景二 5 人环形：5 座不重叠、自己恒在底部');
  const a = await enter(await browser.newContext(), '甲');
  await a.getByRole('button', { name: '5', exact: true }).click();
  await a.getByRole('button', { name: '建房', exact: true }).click();
  await a.getByRole('button', { name: '开打' }).click();          // 空座补 AI，5 座满
  await a.locator('.gy__hand').waitFor({ timeout: 20000 });
  const pos = await seats(a).evaluateAll((els) => els.map((el) => ({
    left: parseFloat(el.style.left), top: parseFloat(el.style.top),
    mine: el.querySelector('.gy__seat-name')?.textContent?.includes('你') || false,
  })));
  if (pos.length !== 5) throw new Error(`应 5 座，实 ${pos.length}`);
  const keys = new Set(pos.map((p) => `${p.left.toFixed(1)},${p.top.toFixed(1)}`));
  if (keys.size !== 5) throw new Error(`5 座有重叠：${[...keys].join(' | ')}`);
  const me = pos.find((p) => p.mine);
  if (!me) throw new Error('找不到「你」那一座');
  const lowest = Math.max(...pos.map((p) => p.top));
  if (Math.abs(me.top - lowest) > 0.5 || Math.abs(me.left - 50) > 0.5) {
    throw new Error(`「你」不在正下方（left=${me.left} top=${me.top}，最低 top=${lowest}）`);
  }
  log(`5 座各就各位不重叠，「你」在正下方 left≈50 top≈${me.top}（掼蛋锚定没被压掉）✓`);
  await a.context().close();
}

async function scenarioDisconnect(browser) {
  step('场景三 掉线→重连：乙断线甲看到「掉线」，乙回来甲看到恢复');
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await enter(ctxA, '甲');
  await a.getByRole('button', { name: '2', exact: true }).click();
  await a.getByRole('button', { name: '建房', exact: true }).click();
  const code = (await a.locator('.cr-room__code').first().innerText()).replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const b = await enter(ctxB, '乙');
  await b.getByPlaceholder('6 位房号').fill(code);
  await b.getByRole('button', { name: '加入' }).first().click();
  await b.getByRole('button', { name: '＋ 入座' }).first().click();
  await a.getByRole('button', { name: '开打' }).click();
  await a.locator('.gy__hand').waitFor({ timeout: 20000 });
  await b.locator('.gy__hand').waitFor({ timeout: 20000 });

  await b.close();                                                // 乙断线（关页=断 WS，进宽限期）
  const tagHas = async (kw) => (await seats(a).locator('.gy__seat-tag').allInnerTexts()).join('').includes(kw);
  await a.waitForFunction(() => [...document.querySelectorAll('.gy__board .gy__seat-tag')].some((e) => e.textContent.includes('掉线')), { timeout: 8000 });
  log('乙断线，甲的牌桌上乙那座显示「掉线」（不是「AI」）✓');

  const b2 = await ctxB.newPage();                               // 乙重连（同 context=带 savedRoom 令牌自动 rejoin）
  b2.setDefaultTimeout(6000);
  await b2.goto(`${BASE}/gandengyan`, { waitUntil: 'domcontentloaded' });
  await b2.locator('.gy__hand').waitFor({ timeout: 20000 });     // 回到牌桌
  await a.waitForFunction(() => ![...document.querySelectorAll('.gy__board .gy__seat-tag')].some((e) => e.textContent.includes('掉线')), { timeout: 8000 });
  if (await tagHas('掉线')) throw new Error('乙重连后甲这边仍显示掉线');
  log('乙重连回牌桌，甲这边「掉线」消失 ✓');
  await ctxA.close(); await ctxB.close();
}

async function scenarioLeave(browser) {
  step('场景四 离开清理：回大厅、无 .gy 残留、无泄漏定时器报错');
  const errors = [];
  const c = await enter(await browser.newContext(), '丙');
  c.on('pageerror', (e) => errors.push(e.message));
  await c.getByRole('button', { name: '2', exact: true }).click();
  await c.getByRole('button', { name: '建房', exact: true }).click();
  await c.getByRole('button', { name: '开打' }).click();
  await c.locator('.gy__hand').waitFor({ timeout: 20000 });
  await c.getByRole('button', { name: '返回大厅' }).click();
  await c.locator('.home').waitFor({ timeout: 10000 });
  if (await c.locator('.gy').count()) throw new Error('离开后牌桌 DOM 残留');
  await c.waitForTimeout(2000);
  if (errors.length) throw new Error(`离开后仍有页面报错（疑似泄漏定时器）：${errors.join(' / ')}`);
  log('回到大厅、无 .gy 残留、2s 无泄漏报错 ✓');
  await c.context().close();
}

requireBuilt();
const server = spawn(process.execPath, [join(ROOT, 'server', 'server.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT, GY_AI_DELAY: '60', GY_DEAL_SEED: '3' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

let browser, failure = null;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: process.env.SMOKE_HEADED !== '1' });
  await scenarioAmbiguity(browser);
  await scenarioFiveRing(browser);
  await scenarioDisconnect(browser);
  await scenarioLeave(browser);
} catch (e) { failure = e; }
finally { if (browser) await browser.close().catch(() => {}); server.kill('SIGTERM'); }

if (failure) {
  console.error(`\n✗ 场景冒烟失败：${failure.message}`);
  if (serverLog.trim()) console.error('--- 服务端输出 ---\n' + serverLog.trim());
  process.exit(1);
}
console.log('\n✓ #17 四场景通过：歧义指派 / 5人环形自己在底 / 掉线→重连 / 离开清理');
