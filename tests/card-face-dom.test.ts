// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { Card, Rank, Suit } from '../src/games/guandan/engine/types';
import baseline from './card-face-dom.fixture.json';

/**
 * 牌面 DOM 回归防线。
 *
 * 抽取共享牌面（#19）本质是「搬文件 + 类名 gd-* → dgc-*」——DOM 结构除类名前缀外
 * 应逐字节不变。fixture 是抽取前掼蛋 cardEl 产出的 outerHTML（前缀已归一化到 X-）；
 * 抽取后 cardEl 内部改调共享 cardFace，产出的 DOM 前缀归一化后必须与 fixture 逐字节一致。
 *
 * 为什么不用截图哈希：牌桌发牌随机、哈希不稳；而牌面视觉 = DOM × CSS × 图片资产，
 * DOM 用这个测试锁、图片/字体用文件字节、CSS 用 scripts/cardcss-check.mjs 锁，
 * 合起来等价于「像素不变」，且无浏览器不确定性、跑得快。是 #4/#11「冻结基线」在牌面上的等价物。
 *
 * 要重建 fixture：删掉 card-face-dom.fixture.json，跑 node scripts/gen-cardface-fixture.mjs。
 */

import { cardEl } from '../src/games/guandan/ui/render';

const base = baseline as Record<string, string>;
const LEVEL: Rank = 2;

/** 把 gd- / dgc- 前缀归一到统一形式，好让抽取前后逐字节可比 */
function normalize(html: string): string {
  return html
    .replace(/\bgd-card/g, 'X-card').replace(/\bdgc-card/g, 'X-card')
    .replace(/\bgd-joker/g, 'X-joker').replace(/\bdgc-joker/g, 'X-joker')
    .replace(/\bgd-suit-/g, 'X-suit-').replace(/\bdgc-suit-/g, 'X-suit-');
}

function samples(): { key: string; card: Card; small?: boolean; selected?: boolean }[] {
  const out: { key: string; card: Card; small?: boolean; selected?: boolean }[] = [];
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  let id = 0;
  for (const s of suits) {
    for (let r = 2; r <= 14; r++) {
      out.push({ key: `${s}${r}`, card: { kind: 'normal', suit: s, rank: r as Rank, id: id++ } });
    }
  }
  out.push({ key: 'jokerBig', card: { kind: 'joker', big: true, id: id++ } });
  out.push({ key: 'jokerSmall', card: { kind: 'joker', big: false, id: id++ } });
  out.push({ key: 'wild', card: { kind: 'normal', suit: 'H', rank: 2, id: id++ } });          // 逢人配（H + 级牌）
  out.push({ key: 'small', card: { kind: 'normal', suit: 'S', rank: 14, id: id++ }, small: true });
  out.push({ key: 'smallJoker', card: { kind: 'joker', big: true, id: id++ }, small: true });
  out.push({ key: 'selected', card: { kind: 'normal', suit: 'D', rank: 13, id: id++ }, selected: true });
  return out;
}

function renderNormalized(sm: { card: Card; small?: boolean; selected?: boolean }): string {
  const el = cardEl(sm.card, LEVEL, sm.small);
  if (sm.selected) el.classList.add('is-selected');
  el.setAttribute('data-card-id', '0');
  return normalize(el.outerHTML);
}

describe('牌面 DOM 抽取前后归一化一致', () => {
  const current: Record<string, string> = {};
  for (const s of samples()) current[s.key] = renderNormalized(s);

  it('样本集覆盖不变（54 普通牌 + 王 + 逢人配 + small + selected）', () => {
    expect(Object.keys(current).sort()).toEqual(Object.keys(base).sort());
  });
  for (const key of Object.keys(base)) {
    it(`${key} 的 DOM 结构逐字节一致`, () => {
      expect(current[key]).toBe(base[key]);
    });
  }
});
