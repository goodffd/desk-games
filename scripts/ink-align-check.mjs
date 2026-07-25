/** 同一套 CSS，Chrome 与 WebKit(Safari 引擎) 各量一遍墨迹对齐。真机是 iPhone → 以 WebKit 为准。 */
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = `
import { cardFace } from '${ROOT}/src/ui/cards/card-face';
const w = document.createElement('div');
w.style.cssText='display:flex;gap:20px;padding:20px;background:#1a3a1a;align-items:flex-start;';
w.appendChild(cardFace({kind:'joker',big:true,id:1},{assignedRank:6}));
w.appendChild(cardFace({kind:'joker',big:true,id:2},{assignedRank:6,small:true}));
document.body.appendChild(w);
`;
const out = await build({ stdin: { contents: entry, resolveDir: ROOT, loader: 'ts', sourcefile: 'w.ts' }, bundle: true, format: 'iife', write: false, platform: 'browser', loader: { '.css': 'empty' } });
const css = ['src/ui/theme.css', 'src/ui/cards/card-face.css', 'src/ui/cards/joker-img.css', 'src/ui/cards/rank-font.css'].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0}body{margin:0}${css}</style></head><body></body></html>`;

const SWEEP = process.argv.includes('--sweep');
const DPR = 3;   // 真 iPhone

async function scan(page, handle, dpr) {
  const buf = await handle.screenshot();
  const uri = 'data:image/png;base64,' + buf.toString('base64');
  return page.evaluate(async ({ uri, dpr }) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = uri; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    const maxX = Math.floor(cv.width * 0.55), maxY = Math.floor(cv.height * 0.35);
    const thr = Math.max(1, Math.floor(dpr / 3));
    let goldTop = null, wordTop = null;
    for (let y = 0; y < maxY; y++) {
      let ng = 0, nr = 0;
      for (let x = 0; x < maxX; x++) {
        const o = (y * cv.width + x) * 4;
        const R = d[o], G = d[o + 1], B = d[o + 2], A = d[o + 3];
        if (A < 200) continue;
        if (R > 140 && R - B > 40 && G > B + 20 && G < R - 10 && R < 235) ng++;
        if (R > 150 && G < 90 && B < 90) nr++;
      }
      if (goldTop === null && ng >= thr) goldTop = y;
      if (wordTop === null && nr >= thr) wordTop = y;
      if (goldTop !== null && wordTop !== null) break;
    }
    return { goldTop, wordTop };
  }, { uri, dpr });
}

const VIEWS = [[390, 844, 3, '手机'], [900, 900, 2, '桌面']];
for (const [name, engine] of [['Chrome ', chromium], ['WebKit ', webkit]]) {
 const browser = await engine.launch(name.trim() === 'Chrome' ? { channel: 'chrome' } : {});
 for (const [VW, VH, VD, VL] of VIEWS) {
  const page = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: VD }).then((c) => c.newPage());
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.addScriptTag({ content: out.outputFiles[0].text });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const cards = await page.$$('.dgc-card');
  for (let i = 0; i < cards.length; i++) {
    const kind = i === 0 ? '手牌大牌' : '出牌小牌';
    if (!SWEEP) {
      const r = await scan(page, cards[i], VD);
      const cs = await cards[i].evaluate((el) => getComputedStyle(el.querySelector('.dgc-card__assign')).top);
      const f = (v) => (v === null ? 'null' : (v / VD).toFixed(2));
      console.log(`${name}${VL} ${kind}: JOKER 墨迹顶 ${f(r.wordTop)} / 点数墨迹顶 ${f(r.goldTop)} → 差 ${f(r.goldTop - r.wordTop)}px  [top=${cs}]`);
    } else {
      const rows = [];
      for (let t = 0.5; t <= 5.01; t += 0.5) {
        await cards[i].evaluate((el, tv) => { el.querySelector('.dgc-card__assign').style.top = tv + 'px'; }, +t.toFixed(2));
        await page.waitForTimeout(30);
        const r = await scan(page, cards[i], VD);
        if (r.goldTop === null || r.wordTop === null) continue;
        rows.push(`${t}→${((r.goldTop - r.wordTop) / VD).toFixed(2)}`);
      }
      console.log(`${name}${VL} ${kind} 扫描(top→差): ${rows.join('  ')}`);
    }
  }
  await page.close();
 }
 await browser.close();
}
