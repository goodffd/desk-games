import { describe, it, expect } from 'vitest';
import { adjudicateRepetition } from '../../../src/games/xiangqi/engine/repetition';
import type { PlyInfo } from '../../../src/games/xiangqi/engine/repetition';
import type { Color } from '../../../src/games/xiangqi/engine/types';

function ply(mover: Color, gaveCheck: boolean, chaseThreat: boolean): PlyInfo {
  return { mover, gaveCheck, chaseThreat };
}
// 构造一个交替的循环（红黑各 n 步），按模板设置 check/chase
function cycle(reds: PlyInfo[], blacks: PlyInfo[]): PlyInfo[] {
  const out: PlyInfo[] = [];
  for (let i = 0; i < Math.max(reds.length, blacks.length); i++) {
    if (reds[i]) out.push(reds[i]);
    if (blacks[i]) out.push(blacks[i]);
  }
  return out;
}

describe('adjudicateRepetition 循环裁决', () => {
  it('红长将（红步步将，黑不将）→ 红判负', () => {
    const c = cycle([ply('red', true, false), ply('red', true, false)], [ply('black', false, false), ply('black', false, false)]);
    expect(adjudicateRepetition(c)).toBe('black_win');
  });

  it('黑长将 → 黑判负', () => {
    const c = cycle([ply('red', false, false), ply('red', false, false)], [ply('black', true, false), ply('black', true, false)]);
    expect(adjudicateRepetition(c)).toBe('red_win');
  });

  it('双方长将 → 和棋', () => {
    const c = cycle([ply('red', true, false), ply('red', true, false)], [ply('black', true, false), ply('black', true, false)]);
    expect(adjudicateRepetition(c)).toBe('draw');
  });

  it('红长捉无根子（黑纯消极）→ 红判负', () => {
    const c = cycle([ply('red', false, true), ply('red', false, true)], [ply('black', false, false), ply('black', false, false)]);
    expect(adjudicateRepetition(c)).toBe('black_win');
  });

  it('黑长捉（红消极）→ 黑判负', () => {
    const c = cycle([ply('red', false, false), ply('red', false, false)], [ply('black', false, true), ply('black', false, true)]);
    expect(adjudicateRepetition(c)).toBe('red_win');
  });

  it('双方消极重复 → 和棋', () => {
    const c = cycle([ply('red', false, false), ply('red', false, false)], [ply('black', false, false), ply('black', false, false)]);
    expect(adjudicateRepetition(c)).toBe('draw');
  });

  it('一将一闲（红只将一次，另一步闲）→ 不算长将 → 和', () => {
    const c = cycle([ply('red', true, false), ply('red', false, false)], [ply('black', false, false), ply('black', false, false)]);
    expect(adjudicateRepetition(c)).toBe('draw');
  });

  it('双方都捉（都不消极）→ 和', () => {
    const c = cycle([ply('red', false, true), ply('red', false, true)], [ply('black', false, true), ply('black', false, true)]);
    expect(adjudicateRepetition(c)).toBe('draw');
  });
});

const chk = (m: Color): PlyInfo => ({ mover: m, gaveCheck: true, chaseThreat: false });
const cha = (m: Color): PlyInfo => ({ mover: m, gaveCheck: false, chaseThreat: true });
const idl = (m: Color): PlyInfo => ({ mover: m, gaveCheck: false, chaseThreat: false });

describe('裁决·攻击等级层次', () => {
  it('单方长将 vs 闲 → 长将方负', () => {
    expect(adjudicateRepetition([chk('red'), idl('black'), chk('red'), idl('black')])).toBe('black_win');
    expect(adjudicateRepetition([chk('black'), idl('red'), chk('black'), idl('red')])).toBe('red_win');
  });
  it('双方长将 → 和', () => {
    expect(adjudicateRepetition([chk('red'), chk('black'), chk('red'), chk('black')])).toBe('draw');
  });
  it('单方长捉 vs 闲 → 长捉方负', () => {
    expect(adjudicateRepetition([cha('red'), idl('black'), cha('red'), idl('black')])).toBe('black_win');
  });
  it('一将一捉(全打) vs 闲 → 该方负', () => {
    expect(adjudicateRepetition([chk('red'), idl('black'), cha('red'), idl('black')])).toBe('black_win');
  });
  it('一将一闲(含闲) → 和', () => {
    expect(adjudicateRepetition([chk('red'), idl('black'), idl('red'), idl('black')])).toBe('draw');
  });
  it('长将 vs 长捉 → 长将方负（将更严重）', () => {
    expect(adjudicateRepetition([chk('red'), cha('black'), chk('red'), cha('black')])).toBe('black_win');
    expect(adjudicateRepetition([cha('red'), chk('black'), cha('red'), chk('black')])).toBe('red_win');
  });
  it('双方长捉 → 和', () => {
    expect(adjudicateRepetition([cha('red'), cha('black'), cha('red'), cha('black')])).toBe('draw');
  });
  it('消极循环 → 和', () => {
    expect(adjudicateRepetition([idl('red'), idl('black'), idl('red'), idl('black')])).toBe('draw');
  });
});
