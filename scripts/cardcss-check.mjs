/**
 * 牌面 CSS 无损闸门。
 *
 *   node scripts/cardcss-check.mjs --save   # 在抽取前存基线
 *   node scripts/cardcss-check.mjs          # 抽取后比对
 *
 * 抽取共享牌面时，牌面 CSS 规则会「分家」（纯牌面 → card-face.css，牌×容器耦合留 guandan.css）
 * 并「改前缀」（gd- → dgc-）。这道闸门证明：**规则总集逐字节不变，只是换了文件和前缀**。
 * 从所有相关 CSS 文件里抓出每一条含牌类（gd-card/gd-joker/gd-suit- 或 dgc- 版）的规则，
 * 把前缀归一化、规则体归一化空白，排序后整体取 sha256。抽取前后一致 = CSS 无损。
 *
 * 它补 DOM 测试（tests/card-face-dom.test.ts）的另一半：DOM 测试锁「牌长什么结构」，
 * 这个锁「牌套什么样式」，合起来等价于「像素不变」。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'cardcss.baseline.json');
const SAVE = process.argv.includes('--save');

// 抽取前后可能涉及的所有文件；不存在的跳过
const FILES = [
  'src/games/guandan/ui/guandan.css',
  'src/games/guandan/ui/joker-img.css',
  'src/games/guandan/ui/rank-font.css',
  'src/ui/cards/card-face.css',
  'src/ui/cards/joker-img.css',
  'src/ui/cards/rank-font.css',
];

/** 一条 CSS 规则的 selector 是否牵涉牌类（而非 .gd-play__cards 这种碰巧含 card 子串的） */
function touchesCard(selector) {
  return /\b(gd|dgc)-card\b|\b(gd|dgc)-card__|\b(gd|dgc)-card--|\b(gd|dgc)-joker|\b(gd|dgc)-suit-/.test(selector);
}

/** 把 selector/body 里的 gd-/dgc- 前缀统一成 X-，好让抽取前后可比 */
function norm(s) {
  return s
    .replace(/\bdgc-card/g, 'X-card').replace(/\bgd-card/g, 'X-card')
    .replace(/\bdgc-joker/g, 'X-joker').replace(/\bgd-joker/g, 'X-joker')
    .replace(/\bdgc-suit-/g, 'X-suit-').replace(/\bgd-suit-/g, 'X-suit-')
    .replace(/\s+/g, ' ').trim();
}

/** 极简 CSS 规则切分：只处理平铺规则与 @media 块内规则（够本项目用） */
function extractRules(css, wrapper = '') {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    // @media / @font-face 等 at 块
    if (css[i] === '@') {
      const braceStart = css.indexOf('{', i);
      const atPrelude = css.slice(i, braceStart).replace(/\s+/g, ' ').trim();
      // 找匹配的闭括号
      let depth = 0, j = braceStart;
      for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (depth === 0) break; } }
      const inner = css.slice(braceStart + 1, j);
      if (/^@media/.test(atPrelude)) rules.push(...extractRules(inner, atPrelude));       // media 里的规则带上 media 前缀做上下文
      else { // @font-face 等整块当一条
        if (touchesCard(atPrelude) || /GDRank|GDWild/.test(inner)) rules.push(norm(`${wrapper}|${atPrelude}{${inner}}`));
      }
      i = j + 1; continue;
    }
    const braceStart = css.indexOf('{', i);
    if (braceStart === -1) break;
    const selector = css.slice(i, braceStart);
    // selector 里可能没有 } 之前的注释残留；简单起见取到 {
    let depth = 0, j = braceStart;
    for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (depth === 0) break; } }
    const body = css.slice(braceStart + 1, j);
    const sel = selector.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
    if (sel && touchesCard(sel)) rules.push(norm(`${wrapper}|${sel}{${body}}`));
    i = j + 1;
  }
  return rules;
}

const all = [];
for (const rel of FILES) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) continue;
  all.push(...extractRules(readFileSync(p, 'utf8')));
}
all.sort();
const digest = createHash('sha256').update(all.join('\n')).digest('hex');

console.log(`牌面 CSS 规则数: ${all.length}`);
console.log(`归一化 sha256: ${digest}`);

if (SAVE) {
  writeFileSync(BASELINE, JSON.stringify({ count: all.length, digest, rules: all }, null, 2) + '\n');
  console.log(`✓ 已存基线 → ${BASELINE}`);
  process.exit(0);
}
if (!existsSync(BASELINE)) { console.log('（无基线；--save 存一份）'); process.exit(0); }
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
if (base.digest === digest) { console.log('\n✓ 牌面 CSS 规则总集与基线逐字节一致（分家+改前缀无损）'); process.exit(0); }
console.error(`\n✗ 牌面 CSS 变了：规则数 ${base.count} → ${all.length}`);
const bset = new Set(base.rules), cset = new Set(all);
for (const r of base.rules) if (!cset.has(r)) console.error(`  少了: ${r.slice(0, 100)}`);
for (const r of all) if (!bset.has(r)) console.error(`  多了: ${r.slice(0, 100)}`);
process.exit(1);
