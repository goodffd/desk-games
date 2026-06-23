import { describe, it, expect } from 'vitest';
import { initialBoard, pieceAt } from '../../../src/games/xiangqi/engine/board';
import { ROWS, COLS } from '../../../src/games/xiangqi/engine/types';

describe('initialBoard', () => {
  it('是 10 行 × 9 列', () => {
    const b = initialBoard();
    expect(b.length).toBe(ROWS);
    for (const row of b) expect(row.length).toBe(COLS);
  });

  it('共 32 枚棋子，红黑各 16', () => {
    const b = initialBoard();
    const flat = b.flat().filter((p) => p !== null);
    expect(flat.length).toBe(32);
    expect(flat.filter((p) => p!.color === 'red').length).toBe(16);
    expect(flat.filter((p) => p!.color === 'black').length).toBe(16);
  });

  it('两将位置正确（红 row9col4 / 黑 row0col4）', () => {
    const b = initialBoard();
    expect(pieceAt(b, { row: 9, col: 4 })).toEqual({ type: 'general', color: 'red' });
    expect(pieceAt(b, { row: 0, col: 4 })).toEqual({ type: 'general', color: 'black' });
  });

  it('车在四角', () => {
    const b = initialBoard();
    expect(pieceAt(b, { row: 9, col: 0 })).toEqual({ type: 'chariot', color: 'red' });
    expect(pieceAt(b, { row: 9, col: 8 })).toEqual({ type: 'chariot', color: 'red' });
    expect(pieceAt(b, { row: 0, col: 0 })).toEqual({ type: 'chariot', color: 'black' });
    expect(pieceAt(b, { row: 0, col: 8 })).toEqual({ type: 'chariot', color: 'black' });
  });

  it('炮位正确（红 row7 col1/col7）', () => {
    const b = initialBoard();
    expect(pieceAt(b, { row: 7, col: 1 })).toEqual({ type: 'cannon', color: 'red' });
    expect(pieceAt(b, { row: 7, col: 7 })).toEqual({ type: 'cannon', color: 'red' });
    expect(pieceAt(b, { row: 2, col: 1 })).toEqual({ type: 'cannon', color: 'black' });
  });

  it('兵卒位正确（红 row6 的 0/2/4/6/8）', () => {
    const b = initialBoard();
    for (const col of [0, 2, 4, 6, 8]) {
      expect(pieceAt(b, { row: 6, col })).toEqual({ type: 'soldier', color: 'red' });
      expect(pieceAt(b, { row: 3, col })).toEqual({ type: 'soldier', color: 'black' });
    }
    // 兵之间的空位
    expect(pieceAt(b, { row: 6, col: 1 })).toBeNull();
  });
});
