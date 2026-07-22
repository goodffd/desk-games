import { describe, it, expect } from 'vitest';
import { identify, beats } from '../../src/games/gandengyan/engine/combos';
import { cards } from './mk';

/** 认牌型；认不出来就直接炸测试，省得每处写非空断言 */
function id(spec: string) {
  const combo = identify(cards(spec));
  if (!combo) throw new Error(`本该认得出牌型：${spec}`);
  return combo;
}

describe('identify — 普通牌型：单张 / 对子 / 顺子 / 连对', () => {
  it('单张：关键点数按权重，2 最大', () => {
    expect(id('S3')).toMatchObject({ type: 'single', length: 1, key: 3 });
    expect(id('SA')).toMatchObject({ type: 'single', length: 1, key: 14 });
    expect(id('S2')).toMatchObject({ type: 'single', length: 1, key: 15 });
  });

  it('对子：两张同点', () => {
    expect(id('S5 H5')).toMatchObject({ type: 'pair', length: 2, key: 5 });
    expect(id('S2 H2')).toMatchObject({ type: 'pair', length: 2, key: 15 });
  });

  it('两张不同点不成牌型', () => {
    expect(identify(cards('S5 H6'))).toBeNull();
  });

  it('顺子：最短 3 张，关键点数取最高位', () => {
    expect(id('S3 H4 D5')).toMatchObject({ type: 'run', length: 3, key: 5 });
    expect(id('S3 H4 D5 C6')).toMatchObject({ type: 'run', length: 4, key: 6 });
    expect(id('SQ HK DA')).toMatchObject({ type: 'run', length: 3, key: 14 });
  });

  it('顺子不看花色（干瞪眼没有同花顺）', () => {
    expect(id('S3 S4 S5')).toMatchObject({ type: 'run', key: 5 });
  });

  it('2 不入顺：任何带 2 的连牌都不是顺子', () => {
    expect(identify(cards('SA H2 D3'))).toBeNull();   // A23 环绕，不认
    expect(identify(cards('SK HA D2'))).toBeNull();   // KA2，不认
    expect(identify(cards('S2 H3 D4'))).toBeNull();   // 234，不认
  });

  it('A 只当最高位：A23 / A2345 都不是顺子', () => {
    expect(identify(cards('SA H2 D3 C4 S5'))).toBeNull();
  });

  it('不连的三张不是顺子', () => {
    expect(identify(cards('S3 H4 D6'))).toBeNull();
  });

  it('顺子长度不限', () => {
    expect(id('S3 H4 D5 C6 S7 H8 D9 CT SJ HQ DK CA')).toMatchObject({ type: 'run', length: 12, key: 14 });
  });

  it('连对：最短 2 对，关键点数取最高位', () => {
    expect(id('S3 H3 D4 C4')).toMatchObject({ type: 'pairRun', length: 4, key: 4 });
    expect(id('S3 H3 D4 C4 S5 H5')).toMatchObject({ type: 'pairRun', length: 6, key: 5 });
  });

  it('连对里也不许有 2', () => {
    expect(identify(cards('SA HA S2 H2'))).toBeNull();
  });

  it('不连的两对不是连对', () => {
    expect(identify(cards('S3 H3 D5 C5'))).toBeNull();
  });

  // 三张同点是炸弹、双王是王炸，都归 bombs.test.ts 管；这里只守住「王还不能百搭」这条线。
  it('王的百搭还没开：单张王与「王 + 普通牌」都不成牌型（是 #7 的事）', () => {
    expect(identify(cards('jB'))).toBeNull();
    expect(identify(cards('jS'))).toBeNull();
    expect(identify(cards('jB S5'))).toBeNull();
    expect(identify(cards('jB S5 H5'))).toBeNull();
  });

  it('空牌不成牌型', () => {
    expect(identify([])).toBeNull();
  });
});

describe('beats — 大一法则', () => {
  it('同牌型同张数、关键点数正好大一级才压得住', () => {
    expect(beats(id('S5'), id('H6'))).toBe(true);
    expect(beats(id('S5'), id('H7'))).toBe(false);  // 大两级不行
    expect(beats(id('S5'), id('H5'))).toBe(false);  // 同级不行
    expect(beats(id('S5'), id('H4'))).toBe(false);  // 小的不行
  });

  it('上家出 5，手里 K 和 A 只能干瞪眼——这就是这个游戏的名字', () => {
    const five = id('S5');
    expect(beats(five, id('HK'))).toBe(false);
    expect(beats(five, id('HA'))).toBe(false);
    expect(beats(five, id('H6'))).toBe(true);
  });

  it('牌型必须相同', () => {
    expect(beats(id('S5'), id('H6 D6'))).toBe(false);
    expect(beats(id('S5 H5'), id('D6'))).toBe(false);
  });

  it('顺子与连对跟牌张数必须相等：345 接不了 4567', () => {
    expect(beats(id('S3 H4 D5'), id('C4 S5 H6'))).toBe(true);
    expect(beats(id('S3 H4 D5'), id('C4 S5 H6 D7'))).toBe(false);
    expect(beats(id('S3 H3 D4 C4'), id('S4 H4 D5 C5'))).toBe(true);
    expect(beats(id('S3 H3 D4 C4'), id('S4 H4 D5 C5 S6 H6'))).toBe(false);
  });

  it('大一链条封顶在 A：K→A 走得通，A 之上没有下一级', () => {
    expect(beats(id('SK'), id('HA'))).toBe(true);
    // A 之上唯一能出的单张是 2，而它走的是逃生口不是大一（见 bombs.test.ts）。
    // 这里只钉一件事：链条本身到 A 为止，没有第 15 级的普通牌型。
    expect(id('H2').key).toBeGreaterThan(id('SA').key);
  });

  it('2 出了之后没有普通牌接得上（只有炸弹能压，见 bombs.test.ts）', () => {
    const two = id('S2');
    for (const spec of ['H3', 'HA', 'H2']) expect(beats(two, id(spec))).toBe(false);
  });

  it('顶格顺子（含 A）之上没有普通顺子可接', () => {
    const top = id('SQ HK DA');
    // 没有任何 3 张顺子的关键点数是 15：2 不入顺，A 已封顶
    expect(beats(top, id('SJ HQ DK'))).toBe(false);
    expect(beats(id('SJ HQ DK'), top)).toBe(true);
  });

  it('顶格连对之上也没有连对可接', () => {
    const top = id('SK HK DA CA');
    expect(beats(id('SQ HQ DK CK'), top)).toBe(true);
    expect(beats(top, id('S3 H3 D4 C4'))).toBe(false);
  });
});
