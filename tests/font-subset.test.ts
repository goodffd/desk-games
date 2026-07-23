import { describe, it, expect } from 'vitest';
import subset from '../src/ui/fonts/DGFont.subset.json';

/**
 * 守着 DGFont 子集不漏字：src/** 每个显示汉字/中文标点都必须在 DGFont.woff2 的实际 cmap 里
 *（cmap 码点由 scripts/font-subset.mjs 与 woff2 同步 dump 到 DGFont.subset.json）。
 * 新增会显示的固定汉字后若忘了重跑子集化，这条会红——不靠人记得。
 *
 * 提取口径与 scripts/font-subset.mjs 保持一致（此处独立实现，互为校验）：剥注释后收集
 * [·‐-※　-〿㐀-鿿豈-﫿＀-￯]。ASCII 由子集脚本恒含，不在此校验。
 * 玩家昵称等任意文本走系统字体、emoji/符号(♠→①…)非汉字走系统 fallback，均不纳入。
 */
function stripComments(text: string, isTs: boolean): string {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, '');
  if (isTs) t = t.replace(/\/\/[^\n]*/g, '');
  return t;
}
const DISPLAY_RE = /[·‐-※　-〿㐀-鿿豈-﫿＀-￯]/gu;

const files = import.meta.glob('/src/**/*.{ts,css}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

describe('DGFont 子集覆盖全站固定显示汉字', () => {
  it('src/** 每个显示汉字/中文标点都在 DGFont.subset.json 的 cmap 里', () => {
    const covered = new Set<number>(subset.codepoints);
    const missing = new Map<string, string>();   // 字 → 首次出现的文件
    for (const [path, raw] of Object.entries(files)) {
      for (const m of stripComments(raw, path.endsWith('.ts')).matchAll(DISPLAY_RE)) {
        const ch = m[0];
        if (!covered.has(ch.codePointAt(0)!) && !missing.has(ch)) missing.set(ch, path);
      }
    }
    if (missing.size) {
      const report = [...missing]
        .map(([ch, p]) => `「${ch}」U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}  ${p}`)
        .join('\n  ');
      throw new Error(`DGFont 漏了 ${missing.size} 个显示字，重跑 scripts/font-subset.mjs：\n  ${report}`);
    }
    expect(missing.size).toBe(0);
  });

  it('子集非空且含游戏名「干瞪眼」', () => {
    expect(subset.codepoints.length).toBeGreaterThan(400);
    for (const ch of '干瞪眼') expect(subset.codepoints).toContain(ch.codePointAt(0));
  });
});
