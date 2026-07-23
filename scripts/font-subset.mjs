/**
 * DGFont 子集化：从 src/** 的显示文案精确提取固定汉字，用隔离 venv 的 pyftsubset 子集化
 * 完整 Noto Sans SC(OFL) → src/ui/fonts/DGFont.woff2（真 wOF2），并把成品字体的实际 cmap
 * 覆盖码点 dump 到 DGFont.subset.json（测试据此验「显示字 ⊆ 子集」，防漏字）。
 *
 *   node scripts/font-subset.mjs            # 子集化 + 写 woff2 + 写 subset.json
 *   node scripts/font-subset.mjs --list     # 只打印提取到的字，不子集化（对账用）
 *
 * 前置（一次性，产物在 gitignore 的 tmp/fontbuild/，不入库）：
 *   python3 -m venv tmp/fontbuild/venv && tmp/fontbuild/venv/bin/pip install "fonttools[woff]" brotli
 *   下载 Noto Sans SC 可变字体并实例化到 Regular → tmp/fontbuild/NotoSansSC-Regular.ttf
 *
 * 提取口径必须与 tests/font-subset.test.ts 保持一致（各自实现、互为独立校验）：
 *   剥掉注释（/*..*​/ 与 //..）后，收集 [·‐-※　-鿿豈-﫿＀-￯]
 *   作为「显示汉字/标点」；子集另恒含 ASCII 可打印区(0x20-0x7e) 让混排数字/字母也走 DGFont。
 */
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const FONTS = join(ROOT, 'src', 'ui', 'fonts');
const BUILD = join(ROOT, 'tmp', 'fontbuild');
const SRC_TTF = join(BUILD, 'NotoSansSC-Regular.ttf');
const PYFTSUBSET = join(BUILD, 'venv', 'bin', 'pyftsubset');
const PY = join(BUILD, 'venv', 'bin', 'python');
const OUT_WOFF2 = join(FONTS, 'DGFont.woff2');
const OUT_JSON = join(FONTS, 'DGFont.subset.json');

/** 剥注释：先块注释再行注释。跟测试同款（保守但一致）。 */
export function stripComments(text, ext) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, '');   // /* ... */
  if (ext === '.ts') t = t.replace(/\/\/[^\n]*/g, ''); // // ...（css 无行注释）
  return t;
}
/** 需要 CJK 字体绘制的显示字（汉字 + 中文标点 + 全角 + 间隔号）。 */
const DISPLAY_RE = /[·‐-※　-〿㐀-鿿豈-﫿＀-￯]/gu;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (['.ts', '.css'].includes(extname(p))) acc.push(p);
  }
  return acc;
}

function collectDisplayChars() {
  const chars = new Set();
  for (const file of walk(SRC)) {
    const stripped = stripComments(readFileSync(file, 'utf8'), extname(file));
    for (const m of stripped.matchAll(DISPLAY_RE)) chars.add(m[0]);
  }
  return chars;
}

const display = collectDisplayChars();
const cjkOnly = [...display].filter((c) => /[㐀-鿿]/u.test(c));
console.log(`提取：显示字/标点 ${display.size} 个（其中 CJK 汉字 ${cjkOnly.length} 个），含「干」「瞪」「眼」：${['干', '瞪', '眼'].every((c) => display.has(c))}`);

if (process.argv.includes('--list')) {
  console.log([...display].sort().join(''));
  process.exit(0);
}

if (!existsSync(SRC_TTF)) { console.error(`✗ 缺完整字体 ${SRC_TTF}（见脚本头「前置」）`); process.exit(1); }
if (!existsSync(PYFTSUBSET)) { console.error(`✗ 缺 pyftsubset ${PYFTSUBSET}（见脚本头「前置」）`); process.exit(1); }

// 子集码点 = ASCII 可打印(0x20-0x7e) + 提取到的显示字
const asciiPrintable = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i));
const unicodes = [...new Set([...asciiPrintable, ...display])]
  .map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
  .join(',');

console.log('子集化中（pyftsubset → woff2）…');
execFileSync(PYFTSUBSET, [
  SRC_TTF,
  `--unicodes=${unicodes}`,
  '--flavor=woff2',
  '--layout-features=*',
  '--no-hinting',
  '--desubroutinize',
  `--output-file=${OUT_WOFF2}`,
], { stdio: 'inherit' });

// 读成品字体的实际 cmap → 侧车 json（测试据此校验，防提取口径漂移漏字）
const cmapJson = execFileSync(PY, ['-c', `
import json, sys
from fontTools.ttLib import TTFont
f = TTFont(r"${OUT_WOFF2}")
cps = sorted(set().union(*[t.cmap.keys() for t in f["cmap"].tables]))
sys.stdout.write(json.dumps(cps))
`], { encoding: 'utf8' });
const cps = JSON.parse(cmapJson);
writeFileSync(OUT_JSON, JSON.stringify({ note: 'DGFont.woff2 的实际 cmap 码点；由 scripts/font-subset.mjs 与 woff2 同步产出。勿手改。', codepoints: cps }) + '\n');

const size = statSync(OUT_WOFF2).size;
const magic = readFileSync(OUT_WOFF2).subarray(0, 4).toString('hex');
console.log(`✓ DGFont.woff2 ${(size / 1024).toFixed(1)}KB，magic ${magic}（wOF2=774f4632），cmap ${cps.length} 码点 → DGFont.subset.json`);
