import { describe, it, expect } from 'vitest';
import { easeInOutQuad, lerp } from '../../../src/games/xiangqi/ui/anim';

describe('easeInOutQuad 缓动', () => {
  it('端点与中点', () => {
    expect(easeInOutQuad(0)).toBe(0);
    expect(easeInOutQuad(1)).toBe(1);
    expect(easeInOutQuad(0.5)).toBeCloseTo(0.5, 6);
  });
  it('越界夹紧到 [0,1]', () => {
    expect(easeInOutQuad(-1)).toBe(0);
    expect(easeInOutQuad(2)).toBe(1);
  });
  it('单调不减', () => {
    let prev = -1;
    for (let i = 0; i <= 10; i++) {
      const v = easeInOutQuad(i / 10);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('lerp 线性插值', () => {
  it('端点与中点', () => {
    expect(lerp(10, 30, 0)).toBe(10);
    expect(lerp(10, 30, 1)).toBe(30);
    expect(lerp(10, 30, 0.5)).toBe(20);
  });
});
