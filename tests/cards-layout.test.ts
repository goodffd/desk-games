import { describe, it, expect } from 'vitest';
import { seatRing } from '../src/ui/cards/layout';

describe('seatRing — 座位环形布局', () => {
  it('视角座（v=0）恒在正下方中央', () => {
    for (const n of [2, 3, 4, 5]) {
      const ring = seatRing(n);
      expect(ring[0]!.leftPct).toBeCloseTo(50, 5);   // 水平居中
      expect(ring[0]!.topPct).toBeGreaterThan(50);    // 在下半
      expect(ring[0]!.edge).toBe('bottom');
    }
  });

  it('座位数就是环上的锚点数', () => {
    for (const n of [2, 3, 4, 5]) expect(seatRing(n)).toHaveLength(n);
  });

  it('★ 几何契约：n=4 复现掼蛋的 0下 / 1右 / 2上 / 3左', () => {
    const ring = seatRing(4);
    expect(ring.map((a) => a.edge)).toEqual(['bottom', 'right', 'top', 'left']);
    // 右座在右半、顶座在上半、左座在左半
    expect(ring[1]!.leftPct).toBeGreaterThan(50);
    expect(ring[2]!.topPct).toBeLessThan(50);
    expect(ring[3]!.leftPct).toBeLessThan(50);
  });

  it('2 人局：自己在下、对手在上', () => {
    const ring = seatRing(2);
    expect(ring[0]!.edge).toBe('bottom');
    expect(ring[1]!.edge).toBe('top');
    expect(ring[1]!.topPct).toBeLessThan(50);
  });

  it('3 人局：自己在下，另两家分居左右上方', () => {
    const ring = seatRing(3);
    expect(ring[0]!.edge).toBe('bottom');
    expect(ring[1]!.leftPct).toBeGreaterThan(50);   // 右
    expect(ring[2]!.leftPct).toBeLessThan(50);      // 左
  });

  it('5 人局：不重叠（任意两座锚点不同）', () => {
    const ring = seatRing(5);
    const keys = new Set(ring.map((a) => `${a.leftPct.toFixed(1)},${a.topPct.toFixed(1)}`));
    expect(keys.size).toBe(5);
  });

  it('椭圆半径可调，锚点随之缩放', () => {
    const wide = seatRing(4, 45, 40);
    expect(wide[1]!.leftPct).toBeCloseTo(95, 5);    // 50 + 45
    expect(wide[2]!.topPct).toBeCloseTo(10, 5);     // 50 - 40
  });
});
