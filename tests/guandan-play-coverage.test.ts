import { describe, it, expect } from 'vitest';
import { sampledCoverage, pokesOut, type RectLike } from '../src/games/guandan/ui/view';

/** 造矩形：r(左, 上, 宽, 高) */
const r = (left: number, top: number, width: number, height: number): RectLike =>
  ({ left, top, width, height, right: left + width, bottom: top + height });

describe('pokesOut —「我出的牌手牌盖不住」判定', () => {
  it('完整盖住 → 不淡（覆盖 81/81）：本来就看不见，淡了反而从半透明底下透出来', () => {
    const play = r(20, 20, 40, 40);
    const hand = [r(0, 0, 100, 100)];
    expect(sampledCoverage(play, hand)).toBe(81);
    expect(pokesOut(play, hand)).toBe(false);
  });

  it('完全不相交 → 不淡（覆盖 0/81）：桌面端空间够时就是这样，正常展示', () => {
    const play = r(200, 200, 40, 40);
    const hand = [r(0, 0, 100, 100)];
    expect(sampledCoverage(play, hand)).toBe(0);
    expect(pokesOut(play, hand)).toBe(false);
  });

  it('露出一截 → 淡：右半截探出手牌之外', () => {
    const play = r(60, 20, 80, 40);        // 手牌只盖到 x=100，右边 40px 露在外面
    const hand = [r(0, 0, 100, 100)];
    const c = sampledCoverage(play, hand);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(81);
    expect(pokesOut(play, hand)).toBe(true);
  });

  it('阶梯形手牌：整块落在两列空档里算不相交，跨在列与空档上算露出来', () => {
    const hand = [r(0, 0, 40, 60), r(70, 0, 40, 60)];   // 两列之间 40~70 是空的
    expect(pokesOut(r(45, 10, 20, 20), hand)).toBe(false);
    expect(pokesOut(r(20, 10, 40, 20), hand)).toBe(true);
  });

  it('没有手牌时不淡（手牌打完 / 观战）', () => {
    expect(pokesOut(r(0, 0, 40, 40), [])).toBe(false);
  });
});
