/**
 * 牌面陈列图：把各种牌渲染到一张真浏览器截图里，人眼验收牌面（花色图 / 小丑图 / 字体 / 金「配」）。
 *
 *   node scripts/cardface-gallery.mjs   →  tmp/cardface-gallery.png
 *
 * 用共享的 cardFace 渲染，加载共享 CSS + 字体。这是 #19 抽取后「牌面对不对」的视觉证据，
 * 也能复用给 #20 干瞪眼牌桌（含王的指派药丸）。
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tmp', 'cardface-gallery.png');

// 渲染入口：用共享 cardFace 摆一批牌
const entry = `
import { cardFace } from '${ROOT}/src/ui/cards/card-face';
const wrap = document.createElement('div');
wrap.style.cssText = 'display:flex;flex-direction:column;gap:14px;padding:24px;background:#1a3a1a;width:1100px;';
function row(label, cards) {
  const r = document.createElement('div'); r.style.cssText='display:flex;gap:8px;align-items:flex-end;';
  const t = document.createElement('div'); t.textContent=label; t.style.cssText='color:#e8d9b0;width:90px;font:13px sans-serif;';
  r.appendChild(t);
  for (const c of cards) r.appendChild(c);
  wrap.appendChild(r);
}
const N = (suit,rank) => cardFace({kind:'normal',suit,rank,id:Math.random()});
row('黑桃', [3,7,10,11,12,13,14].map(r=>N('S',r)));
row('红心', [2,5,9,14].map(r=>N('H',r)));
row('方块', [4,6,10,13].map(r=>N('D',r)));
row('梅花', [2,8,11,14].map(r=>N('C',r)));
row('大小王', [cardFace({kind:'joker',big:true,id:1}), cardFace({kind:'joker',big:false,id:2})]);
row('逢人配', [cardFace({kind:'normal',suit:'H',rank:2,id:3},{cornerBadge:{text:'配',className:'dgc-card__suit--wild'}})]);
row('王带指派', [cardFace({kind:'joker',big:true,id:4},{assignedRank:6}), cardFace({kind:'joker',big:false,id:5},{assignedRank:13})]);
const sm = (suit,rank) => cardFace({kind:'normal',suit,rank,id:Math.random()},{small:true});
row('出牌区小牌', [sm('S',14), sm('H',13), sm('C',10), cardFace({kind:'joker',big:true,id:9},{small:true})]);
document.body.appendChild(wrap);
`;

const out = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'ts', sourcefile: 'gallery.ts' },
  bundle: true, format: 'iife', write: false, platform: 'browser', loader: { '.css': 'empty' },
});

// 共享 CSS + 字体全内联（cardFace 不 import CSS，这里手动拼）
const css = [
  'src/ui/theme.css', 'src/ui/cards/card-face.css', 'src/ui/cards/joker-img.css', 'src/ui/cards/rank-font.css',
].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
// #20 的药丸样式还没进 card-face.css，这里临时给个样式好看指派效果
const pill = `.dgc-card__assign{position:absolute;left:50%;bottom:4px;transform:translateX(-50%);background:linear-gradient(135deg,#e6c667,#c9a84c);color:#3a2a10;font:700 12px 'GDRank',serif;border-radius:8px;padding:1px 7px;box-shadow:0 1px 2px rgba(0,0,0,.4);}`;
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0}body{margin:0}${css}${pill}</style></head><body></body></html>`;

mkdirSync(join(ROOT, 'tmp'), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newContext({ deviceScaleFactor: 2 }).then((c) => c.newPage());
await page.setContent(html, { waitUntil: 'domcontentloaded' });
await page.addScriptTag({ content: out.outputFiles[0].text });
await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve()));
await page.waitForTimeout(200);
const el = await page.$('body > div');
await el.screenshot({ path: OUT });
await browser.close();
console.log(`✓ 牌面陈列图 → ${OUT}`);
