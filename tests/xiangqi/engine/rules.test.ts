import { describe, it, expect } from 'vitest';
import { emptyBoard } from '../../../src/games/xiangqi/engine/board';
import { isInCheck, generalsFacing, findGeneral, isSquareAttacked } from '../../../src/games/xiangqi/engine/rules';
import type { Board, Color, PieceType } from '../../../src/games/xiangqi/engine/types';

function place(b: Board, row: number, col: number, type: PieceType, color: Color) {
  b[row][col] = { type, color };
}

describe('findGeneral', () => {
  it('找到对应颜色的将', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    expect(findGeneral(b, 'red')).toEqual({ row: 9, col: 4 });
    expect(findGeneral(b, 'black')).toEqual({ row: 0, col: 4 });
  });
});

describe('isInCheck', () => {
  it('车直线将军', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    place(b, 5, 4, 'chariot', 'black'); // 黑车直线照着红将（中间无子）
    expect(isInCheck(b, 'red')).toBe(true);
  });

  it('车被挡住则不算将军', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    place(b, 5, 4, 'chariot', 'black');
    place(b, 7, 4, 'soldier', 'red'); // 挡住
    expect(isInCheck(b, 'red')).toBe(false);
  });

  it('马将军（蹩马腿成立时）', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    place(b, 7, 3, 'horse', 'black'); // 马卧槽位，攻击 row9col4
    expect(isInCheck(b, 'red')).toBe(true);
  });

  it('炮隔架将军', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    place(b, 5, 4, 'cannon', 'black'); // 黑炮
    place(b, 7, 4, 'soldier', 'red'); // 炮架
    expect(isInCheck(b, 'red')).toBe(true);
  });

  it('无威胁时不算将军', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 3, 'general', 'black');
    place(b, 5, 0, 'chariot', 'black');
    expect(isInCheck(b, 'red')).toBe(false);
  });
});

describe('generalsFacing / 将帅照面', () => {
  it('同列无子相对 = 照面', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    expect(generalsFacing(b)).toBe(true);
    // 照面等价于双方均被将
    expect(isInCheck(b, 'red')).toBe(true);
    expect(isInCheck(b, 'black')).toBe(true);
  });

  it('中间有子则不照面', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    place(b, 5, 4, 'soldier', 'red');
    expect(generalsFacing(b)).toBe(false);
  });

  it('不同列不照面', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 3, 'general', 'black');
    expect(generalsFacing(b)).toBe(false);
  });
});

describe('isSquareAttacked', () => {
  it('被敌方车攻击的格', () => {
    const b = emptyBoard();
    place(b, 5, 4, 'chariot', 'red');
    expect(isSquareAttacked(b, { row: 5, col: 8 }, 'red')).toBe(true);
    expect(isSquareAttacked(b, { row: 4, col: 3 }, 'red')).toBe(false);
  });
});
