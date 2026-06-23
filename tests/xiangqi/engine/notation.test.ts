import { describe, it, expect } from 'vitest';
import { moveToIccs, iccsToMove, moveToChinese, chineseToMove } from '../../../src/games/xiangqi/engine/notation';
import { initialBoard, emptyBoard } from '../../../src/games/xiangqi/engine/board';

describe('ICCS 记法', () => {
  it('着法 → ICCS', () => {
    expect(moveToIccs({ from: { row: 7, col: 7 }, to: { row: 7, col: 4 } })).toBe('h7-e7');
    expect(moveToIccs({ from: { row: 0, col: 0 }, to: { row: 1, col: 0 } })).toBe('a0-a1');
  });

  it('ICCS → 着法往返一致', () => {
    const m = { from: { row: 9, col: 1 }, to: { row: 7, col: 2 } };
    expect(iccsToMove(moveToIccs(m))).toEqual(m);
  });

  it('非法 ICCS 抛错', () => {
    expect(() => iccsToMove('z9-a1')).toThrow();
    expect(() => iccsToMove('h7e7')).toThrow();
  });
});

describe('中文记谱 — 生成', () => {
  const b = initialBoard();

  it('红方常规着法', () => {
    expect(moveToChinese(b, { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } })).toBe('炮二平五');
    expect(moveToChinese(b, { from: { row: 9, col: 7 }, to: { row: 7, col: 6 } })).toBe('马二进三');
    expect(moveToChinese(b, { from: { row: 9, col: 1 }, to: { row: 7, col: 2 } })).toBe('马八进七');
    expect(moveToChinese(b, { from: { row: 6, col: 0 }, to: { row: 5, col: 0 } })).toBe('兵九进一');
    expect(moveToChinese(b, { from: { row: 9, col: 0 }, to: { row: 8, col: 0 } })).toBe('车九进一');
  });

  it('黑方用阿拉伯数字', () => {
    expect(moveToChinese(b, { from: { row: 2, col: 7 }, to: { row: 2, col: 4 } })).toBe('炮2平5');
    expect(moveToChinese(b, { from: { row: 0, col: 7 }, to: { row: 2, col: 6 } })).toBe('马2进3');
  });

  it('同纵线 2 子用前/后', () => {
    const t = emptyBoard();
    t[9][4] = { type: 'general', color: 'red' };
    t[0][4] = { type: 'general', color: 'black' };
    t[3][2] = { type: 'cannon', color: 'red' };
    t[5][2] = { type: 'cannon', color: 'red' };
    expect(moveToChinese(t, { from: { row: 3, col: 2 }, to: { row: 1, col: 2 } })).toBe('前炮进二');
    expect(moveToChinese(t, { from: { row: 5, col: 2 }, to: { row: 4, col: 2 } })).toBe('后炮进一');
  });

  it('同纵线 3 兵用一二三（前→后）', () => {
    const t = emptyBoard();
    t[9][4] = { type: 'general', color: 'red' };
    t[0][4] = { type: 'general', color: 'black' };
    t[3][4] = { type: 'soldier', color: 'red' };
    t[5][4] = { type: 'soldier', color: 'red' };
    t[6][4] = { type: 'soldier', color: 'red' };
    expect(moveToChinese(t, { from: { row: 5, col: 4 }, to: { row: 4, col: 4 } })).toBe('二兵进一');
    expect(moveToChinese(t, { from: { row: 3, col: 4 }, to: { row: 2, col: 4 } })).toBe('一兵进一'); // 最前
    expect(moveToChinese(t, { from: { row: 6, col: 4 }, to: { row: 5, col: 4 } })).toBe('三兵进一'); // 最后
  });
});

describe('中文记谱 — 解析与往返', () => {
  const b = initialBoard();

  it('常规式解析', () => {
    expect(chineseToMove(b, 'red', '炮二平五')).toEqual({ from: { row: 7, col: 7 }, to: { row: 7, col: 4 } });
    expect(chineseToMove(b, 'red', '马二进三')).toEqual({ from: { row: 9, col: 7 }, to: { row: 7, col: 6 } });
    expect(chineseToMove(b, 'black', '炮2平5')).toEqual({ from: { row: 2, col: 7 }, to: { row: 2, col: 4 } });
    expect(chineseToMove(b, 'black', '马2进3')).toEqual({ from: { row: 0, col: 7 }, to: { row: 2, col: 6 } });
  });

  it('开局四着 生成→解析 往返一致', () => {
    const moves = [
      { mv: { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } }, color: 'red' as const },
      { mv: { from: { row: 0, col: 1 }, to: { row: 2, col: 2 } }, color: 'black' as const },
      { mv: { from: { row: 9, col: 1 }, to: { row: 7, col: 2 } }, color: 'red' as const },
      { mv: { from: { row: 0, col: 7 }, to: { row: 2, col: 6 } }, color: 'black' as const },
    ];
    for (const { mv, color } of moves) {
      const zh = moveToChinese(b, mv);
      expect(chineseToMove(b, color, zh)).toEqual(mv);
    }
  });

  it('前/后 与 序数 解析', () => {
    const t = emptyBoard();
    t[9][4] = { type: 'general', color: 'red' };
    t[0][4] = { type: 'general', color: 'black' };
    t[3][2] = { type: 'cannon', color: 'red' };
    t[5][2] = { type: 'cannon', color: 'red' };
    expect(chineseToMove(t, 'red', '前炮进二')).toEqual({ from: { row: 3, col: 2 }, to: { row: 1, col: 2 } });
    expect(chineseToMove(t, 'red', '后炮进一')).toEqual({ from: { row: 5, col: 2 }, to: { row: 4, col: 2 } });
  });

  it('马/象/士 进退接目标纵线 解析正确', () => {
    const t = emptyBoard();
    t[9][4] = { type: 'general', color: 'red' };
    t[0][4] = { type: 'general', color: 'black' };
    t[4][2] = { type: 'elephant', color: 'red' };
    expect(chineseToMove(t, 'red', '相七进五')).toEqual({ from: { row: 4, col: 2 }, to: { row: 2, col: 4 } });
  });

  it('位置式 生成→解析 真往返（红前后 / 红序数 / 黑前后）', () => {
    const r2 = emptyBoard();
    r2[9][4] = { type: 'general', color: 'red' };
    r2[0][4] = { type: 'general', color: 'black' };
    r2[3][2] = { type: 'cannon', color: 'red' };
    r2[5][2] = { type: 'cannon', color: 'red' };
    for (const mv of [
      { from: { row: 3, col: 2 }, to: { row: 1, col: 2 } },
      { from: { row: 5, col: 2 }, to: { row: 4, col: 2 } },
    ]) {
      expect(chineseToMove(r2, 'red', moveToChinese(r2, mv))).toEqual(mv);
    }

    const r3 = emptyBoard();
    r3[9][4] = { type: 'general', color: 'red' };
    r3[0][4] = { type: 'general', color: 'black' };
    r3[3][4] = { type: 'soldier', color: 'red' };
    r3[5][4] = { type: 'soldier', color: 'red' };
    r3[6][4] = { type: 'soldier', color: 'red' };
    for (const mv of [
      { from: { row: 3, col: 4 }, to: { row: 2, col: 4 } },
      { from: { row: 5, col: 4 }, to: { row: 4, col: 4 } },
      { from: { row: 6, col: 4 }, to: { row: 5, col: 4 } },
    ]) {
      expect(chineseToMove(r3, 'red', moveToChinese(r3, mv))).toEqual(mv);
    }

    const bk = emptyBoard();
    bk[9][4] = { type: 'general', color: 'red' };
    bk[0][4] = { type: 'general', color: 'black' };
    bk[4][2] = { type: 'cannon', color: 'black' };
    bk[6][2] = { type: 'cannon', color: 'black' };
    for (const mv of [
      { from: { row: 6, col: 2 }, to: { row: 8, col: 2 } },
      { from: { row: 4, col: 2 }, to: { row: 5, col: 2 } },
    ]) {
      expect(chineseToMove(bk, 'black', moveToChinese(bk, mv))).toEqual(mv);
    }
  });
});
