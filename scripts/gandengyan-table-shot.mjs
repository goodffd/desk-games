/**
 * 截一张干瞪眼真机牌桌图给人看效果。起服务 → 3 人房（甲乙 + AI 补位）→ 开打 → 出一手 → 截图。
 *   node scripts/gandengyan-table-shot.mjs  →  tmp/gandengyan-table.png
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = '18094';
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE}/gandengyan`); if (r.ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('服务没起来');
}
async function enter(ctx, nick) {
  const p = await ctx.newPage();
  p.setDefaultTimeout(6000);
  await p.goto(`${BASE}/gandengyan`, { waitUntil: 'domcontentloaded' });
  await p.getByPlaceholder('起个名字').fill(nick);
  await p.getByPlaceholder('起个名字').blur();
  await p.getByRole('button', { name: '进入大厅' }).click();
  await p.getByRole('button', { name: '建房', exact: true }).waitFor();
  return p;
}

const server = spawn(process.execPath, [join(ROOT, 'server', 'server.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT, GY_AI_DELAY: '80' }, stdio: 'ignore',
});
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const a = await enter(await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 }), '阿甲');
  await a.locator('.gy__select').selectOption('3');
  await a.getByRole('button', { name: '建房', exact: true }).click();
  const code = (await a.locator('.gy__code').first().innerText()).replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const b = await enter(await browser.newContext(), '阿乙');
  await b.getByPlaceholder('6 位房号').fill(code);
  await b.getByRole('button', { name: '加入' }).first().click();
  await b.getByRole('button', { name: '＋ 入座' }).first().click();
  await a.getByRole('button', { name: '开打' }).click();
  await a.locator('.gy__hand').waitFor();
  await a.waitForTimeout(800);
  // 甲若轮到就出一张，让桌面有出牌
  const play = a.getByRole('button', { name: '出牌' });
  if (!(await play.isDisabled().catch(() => true))) {
    await a.locator('.gy__hand .dgc-card').first().click().catch(() => {});
    await play.click({ timeout: 1500 }).catch(() => {});
    const chip = a.locator('.gy__chooser .gy__chip').first();
    if (await chip.count()) await chip.click().catch(() => {});
  }
  await a.waitForTimeout(1200);   // 等 AI 走一手，桌面/座位有内容
  await a.locator('.gy').screenshot({ path: join(ROOT, 'tmp', 'gandengyan-table.png') });
  console.log('✓ tmp/gandengyan-table.png');
} catch (e) {
  console.error('截图失败：', e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}
