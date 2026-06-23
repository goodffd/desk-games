import { describe, it, expect } from 'vitest';
import { pixelToSquare, pointX, pointY, MARGIN, CELL } from '../../../src/games/xiangqi/ui/render';

describe('pixelToSquare（点击像素 → 棋盘交点）', () => {
  it('交点正中映射到对应格', () => {
    expect(pixelToSquare(pointX(0), pointY(0))).toEqual({ row: 0, col: 0 });
    expect(pixelToSquare(pointX(4), pointY(9))).toEqual({ row: 9, col: 4 });
    expect(pixelToSquare(pointX(8), pointY(5))).toEqual({ row: 5, col: 8 });
  });

  it('交点附近小偏移仍命中', () => {
    expect(pixelToSquare(pointX(4) + 10, pointY(2) - 8)).toEqual({ row: 2, col: 4 });
  });

  it('两交点正中间（超容差）返回 null', () => {
    expect(pixelToSquare(MARGIN + CELL / 2, MARGIN + CELL / 2)).toBeNull();
  });

  it('棋盘外返回 null', () => {
    expect(pixelToSquare(-20, -20)).toBeNull();
    expect(pixelToSquare(pointX(8) + CELL, pointY(9))).toBeNull();
  });
});
