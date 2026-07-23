/**
 * 重建牌面 DOM fixture（tests/card-face-dom.fixture.json）。
 *
 *   node scripts/gen-cardface-fixture.mjs
 *
 * 只有**故意改动牌面 DOM 结构**时才需要跑它——平时那个 fixture 是回归基线，不该动。
 * 用 esbuild 把 cardEl 打包（CSS import 忽略）、在 jsdom 里渲染每张样本牌、前缀归一化后写盘。
 * 与 tests/card-face-dom.test.ts 的 samples/normalize 保持一致。
 */
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = join(ROOT, 'tests', 'card-face-dom.fixture.json');
const TMP = join(ROOT, 'tmp', 'cardface-bundle.mjs');

const dom = new JSDOM('<!DOCTYPE html><body></body>');
globalThis.document = dom.window.document;
globalThis.window = dom.window;

// 入口：与测试里的 samples/normalize/renderNormalized 一字对应
const entry = `
import { cardEl } from '${ROOT}/src/games/guandan/ui/render';
const LEVEL = 2;
function normalize(html) {
  return html
    .replace(/\\bgd-card/g, 'X-card').replace(/\\bdgc-card/g, 'X-card')
    .replace(/\\bgd-joker/g, 'X-joker').replace(/\\bdgc-joker/g, 'X-joker')
    .replace(/\\bgd-suit-/g, 'X-suit-').replace(/\\bdgc-suit-/g, 'X-suit-');
}
function samples() {
  const out = []; const suits = ['S','H','D','C']; let id = 0;
  for (const s of suits) for (let r = 2; r <= 14; r++) out.push({ key: s+r, card: { kind:'normal', suit:s, rank:r, id:id++ } });
  out.push({ key:'jokerBig', card:{ kind:'joker', big:true, id:id++ } });
  out.push({ key:'jokerSmall', card:{ kind:'joker', big:false, id:id++ } });
  out.push({ key:'wild', card:{ kind:'normal', suit:'H', rank:2, id:id++ } });
  out.push({ key:'small', card:{ kind:'normal', suit:'S', rank:14, id:id++ }, small:true });
  out.push({ key:'smallJoker', card:{ kind:'joker', big:true, id:id++ }, small:true });
  out.push({ key:'selected', card:{ kind:'normal', suit:'D', rank:13, id:id++ }, selected:true });
  return out;
}
export const fixture = (() => {
  const r = {};
  for (const sm of samples()) {
    const el = cardEl(sm.card, LEVEL, sm.small);
    if (sm.selected) el.classList.add('is-selected');
    el.setAttribute('data-card-id', '0');
    r[sm.key] = normalize(el.outerHTML);
  }
  return r;
})();
`;

const out = await build({
  stdin: { contents: entry, resolveDir: ROOT, loader: 'ts', sourcefile: 'gen-entry.ts' },
  bundle: true, format: 'esm', write: false, platform: 'browser',
  loader: { '.css': 'empty', '.png': 'dataurl' },
});
writeFileSync(TMP, out.outputFiles[0].text);
const mod = await import(pathToFileURL(TMP).href);
writeFileSync(FIXTURE, JSON.stringify(mod.fixture, null, 2) + '\n');
console.log(`✓ 已重建 ${FIXTURE}（${Object.keys(mod.fixture).length} 张样本）`);
