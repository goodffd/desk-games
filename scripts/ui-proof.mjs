/**
 * UI 视觉回归证明。
 *
 *   npm run ui-proof            # 截图 + 打印每屏 sha256
 *   npm run ui-proof -- --save  # 把当前哈希写进 scripts/ui-proof.baseline.json
 *
 * 为什么存在：掼蛋的三屏与牌桌是 DOM 视图，**零单测覆盖**，唯一的联机 smoke 只断言
 * `.gd-game` 元素在不在——它抓不到座位错位、字形变了、层序塌了。抽共享层要动掼蛋的
 * 三屏（#21）与牌面（#19），没有一个能断言「像素没变」的东西，「零回归」就只是口号。
 *
 * 这就是那个东西：固定视口 + 等字体加载完 + 盖掉随机房号，把每一屏截成 PNG 取 sha256。
 * 动手**前**跑一次存基线，动手后再跑，哈希一致 = 零视觉变化；不一致就并排看两张 PNG 人眼裁决。
 * 是 #4/#11「冻结基线」在 DOM 层的等价物。
 *
 * 目前覆盖掼蛋三屏（昵称 / 大厅 / 房间）。牌面证明在 #19 动牌面时补上。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.UIPROOF_PORT || '18096';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = join(ROOT, 'tmp', 'ui-proof');
const BASELINE = join(ROOT, 'scripts', 'ui-proof.baseline.json');
const SAVE = process.argv.includes('--save');

const log = (...a) => console.log('  ', ...a);

function requireBuilt() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('✗ 缺 dist/index.html —— 先跑 npm run build'); process.exit(1);
  }
}
async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/guandan`); if (r.ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`服务在 ${timeoutMs}ms 内没起来（${BASE}）`);
}

/** 截当前页，盖掉随机内容，等字体就位，返回 { sha, file } */
async function shoot(page, name) {
  // 房号是随机的：截图前统一成占位串，否则哈希每次都变
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('.gd-room__codewrap, .gd-room__code, .cr-room__codewrap, .cr-room__code')) {
      el.textContent = 'CODE00';
    }
  });
  // 字体真正加载完再截——DGFont 上线前后差异全在这一刻显形
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
  await page.waitForTimeout(150);
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${name}.png`);
  const buf = await page.screenshot({ path: file, animations: 'disabled' });
  return { sha: createHash('sha256').update(buf).digest('hex'), file };
}

async function capture(browser) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1200}, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('   [页面异常]', e.message));
  const out = {};

  await page.goto(`${BASE}/guandan`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('比如：阿东').waitFor({ timeout: 15000 });
  out.nickname = await shoot(page, 'nickname');

  await page.getByPlaceholder('比如：阿东').fill('证据甲');
  await page.getByPlaceholder('比如：阿东').blur();
  await page.getByRole('button', { name: '进入大厅' }).click();
  await page.getByRole('button', { name: '建房邀请' }).waitFor({ timeout: 15000 });
  out.lobby = await shoot(page, 'lobby');

  await page.getByRole('button', { name: '建房邀请' }).click();
  await page.locator('.gd-room__table, .cr-room__table').waitFor({ timeout: 15000 });
  out.room = await shoot(page, 'room');

  await ctx.close();
  return out;
}

requireBuilt();
const server = spawn(process.execPath, [join(ROOT, 'server', 'server.mjs')], {
  cwd: ROOT, env: { ...process.env, PORT }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

let browser; let result = null; let failure = null;
try {
  await waitForServer();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  result = await capture(browser);
} catch (e) { failure = e; } finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
}

if (failure) {
  console.error(`\n✗ ui-proof 失败：${failure.message}`);
  if (serverLog.trim()) console.error('--- 服务端输出 ---\n' + serverLog.trim());
  process.exit(1);
}

const hashes = Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.sha]));
console.log('\n屏幕哈希：');
for (const [k, v] of Object.entries(result)) log(`${k.padEnd(10)} ${v.sha.slice(0, 16)}…  ${v.file}`);

if (SAVE) {
  writeFileSync(BASELINE, JSON.stringify(hashes, null, 2) + '\n');
  console.log(`\n✓ 已存基线 → ${BASELINE}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.log('\n（无基线；--save 存一份）');
  process.exit(0);
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const changed = Object.keys(hashes).filter((k) => base[k] !== hashes[k]);
if (changed.length) {
  console.error(`\n✗ 这些屏变了：${changed.join(', ')}`);
  for (const k of changed) console.error(`    ${k}: 基线 ${(base[k] || '(无)').slice(0, 16)}… → 现在 ${hashes[k].slice(0, 16)}…  看 ${result[k].file}`);
  process.exit(1);
}
console.log('\n✓ 三屏哈希与基线一致，零视觉变化');
