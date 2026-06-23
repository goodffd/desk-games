import { describe, it, expect } from 'vitest';
import { emptyBoard } from '../../../src/games/xiangqi/engine/board';
import { pseudoLegalMoves } from '../../../src/games/xiangqi/engine/moves';
import type { Board, Color, PieceType, Square } from '../../../src/games/xiangqi/engine/types';

function place(b: Board, row: number, col: number, type: PieceType, color: Color) {
  b[row][col] = { type, color };
}

// 把着法目标集合化，便于无序比较
function dests(b: Board, from: Square): Set<string> {
  return new Set(pseudoLegalMoves(b, from).map((s) => `${s.row},${s.col}`));
}
function has(b: Board, from: Square, to: [number, number]): boolean {
  return dests(b, from).has(`${to[0]},${to[1]}`);
}

describe('将/帅 general', () => {
  it('九宫内上下左右各一步', () => {
    const b = emptyBoard();
    place(b, 8, 4, 'general', 'red'); // 九宫中心
    const d = dests(b, { row: 8, col: 4 });
    expect(d).toEqual(new Set(['9,4', '7,4', '8,3', '8,5']));
  });

  it('不能走出九宫', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red'); // 九宫左下角
    const d = dests(b, { row: 9, col: 3 });
    // 只能 row8col3 与 row9col4，col2 出宫、row10 越界都不行
    expect(d).toEqual(new Set(['8,3', '9,4']));
  });

  it('不吃己方子', () => {
    const b = emptyBoard();
    place(b, 8, 4, 'general', 'red');
    place(b, 7, 4, 'advisor', 'red');
    expect(has(b, { row: 8, col: 4 }, [7, 4])).toBe(false);
  });
});

describe('士/仕 advisor', () => {
  it('九宫内斜走一步', () => {
    const b = emptyBoard();
    place(b, 8, 4, 'advisor', 'red');
    const d = dests(b, { row: 8, col: 4 });
    expect(d).toEqual(new Set(['9,3', '9,5', '7,3', '7,5']));
  });
  it('在角上只能回中心', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'advisor', 'red');
    expect(dests(b, { row: 9, col: 3 })).toEqual(new Set(['8,4']));
  });
});

describe('象/相 elephant', () => {
  it('田字四向', () => {
    const b = emptyBoard();
    place(b, 9, 2, 'elephant', 'red');
    expect(dests(b, { row: 9, col: 2 })).toEqual(new Set(['7,0', '7,4']));
  });
  it('塞象眼被堵则不可行', () => {
    const b = emptyBoard();
    place(b, 7, 2, 'elephant', 'red');
    place(b, 8, 3, 'soldier', 'black'); // 堵右下象眼
    const d = dests(b, { row: 7, col: 2 });
    expect(d.has('9,4')).toBe(false); // 右下被堵
    expect(d.has('9,0')).toBe(true); // 左下仍可
    expect(d.has('5,0')).toBe(true);
    expect(d.has('5,4')).toBe(true);
  });
  it('不能过河（红象 row<=4 不可达）', () => {
    const b = emptyBoard();
    place(b, 5, 2, 'elephant', 'red');
    const d = dests(b, { row: 5, col: 2 });
    // 向上到 row3 越河禁止；只能向下 row7
    expect(d.has('3,0')).toBe(false);
    expect(d.has('3,4')).toBe(false);
    expect(d.has('7,0')).toBe(true);
    expect(d.has('7,4')).toBe(true);
  });
});

describe('马 horse', () => {
  it('中心八方', () => {
    const b = emptyBoard();
    place(b, 5, 4, 'horse', 'red');
    expect(dests(b, { row: 5, col: 4 })).toEqual(
      new Set(['3,3', '3,5', '7,3', '7,5', '4,2', '6,2', '4,6', '6,6'])
    );
  });
  it('蹩马腿：腿位有子则该两个方向被封', () => {
    const b = emptyBoard();
    place(b, 5, 4, 'horse', 'red');
    place(b, 4, 4, 'soldier', 'red'); // 堵上方马腿
    const d = dests(b, { row: 5, col: 4 });
    expect(d.has('3,3')).toBe(false);
    expect(d.has('3,5')).toBe(false);
    // 其余方向不受影响
    expect(d.has('7,3')).toBe(true);
    expect(d.has('4,2')).toBe(true);
  });
});

describe('车 chariot', () => {
  it('直线滑动，遇己方子前停，吃敌方子', () => {
    const b = emptyBoard();
    place(b, 5, 4, 'chariot', 'red');
    place(b, 5, 6, 'soldier', 'red'); // 右侧己方
    place(b, 2, 4, 'soldier', 'black'); // 上方敌方
    const d = dests(b, { row: 5, col: 4 });
    expect(d.has('5,5')).toBe(true); // 到己方子前
    expect(d.has('5,6')).toBe(false); // 不吃己方
    expect(d.has('5,7')).toBe(false); // 不能越过己方
    expect(d.has('2,4')).toBe(true); // 吃敌方
    expect(d.has('1,4')).toBe(false); // 不能越过敌方
    expect(d.has('3,4')).toBe(true); // 敌方前一格
  });
});

describe('炮 cannon', () => {
  it('无炮架时沿空路移动，不能直接吃相邻敌子', () => {
    const b = emptyBoard();
    place(b, 5, 4, 'cannon', 'red');
    place(b, 5, 5, 'soldier', 'black'); // 相邻敌子，无炮架
    const d = dests(b, { row: 5, col: 4 });
    expect(d.has('5,5')).toBe(false); // 无架不可吃
    expect(d.has('5,3')).toBe(true); // 空格可走
    expect(d.has('4,4')).toBe(true);
  });
  it('隔一个炮架吃子；不能隔两个', () => {
    const b = emptyBoard();
    place(b, 5, 4, 'cannon', 'red');
    place(b, 5, 6, 'soldier', 'red'); // 炮架
    place(b, 5, 7, 'chariot', 'black'); // 架后第一个敌子，可吃
    place(b, 2, 4, 'soldier', 'black'); // 上方第一个子（架）
    place(b, 1, 4, 'soldier', 'black'); // 架后敌子
    const d = dests(b, { row: 5, col: 4 });
    expect(d.has('5,7')).toBe(true); // 隔一架吃
    expect(d.has('5,5')).toBe(true); // 架前空格可移动
    expect(d.has('5,6')).toBe(false); // 不吃炮架本身（己方且是架）
    expect(d.has('2,4')).toBe(false); // 第一个子不可吃（无架）
    expect(d.has('1,4')).toBe(true); // 隔一架（row2 那个）吃 row1
  });
});

describe('兵/卒 soldier', () => {
  it('红兵过河前只能向前（row 减小），不能横走/后退', () => {
    const b = emptyBoard();
    place(b, 6, 4, 'soldier', 'red'); // 未过河
    expect(dests(b, { row: 6, col: 4 })).toEqual(new Set(['5,4']));
  });
  it('红兵过河后可前进与左右', () => {
    const b = emptyBoard();
    place(b, 4, 4, 'soldier', 'red'); // 已过河（row<=4）
    const d = dests(b, { row: 4, col: 4 });
    expect(d).toEqual(new Set(['3,4', '4,3', '4,5'])); // 不能后退到 row5
  });
  it('黑卒方向相反（向前 = row 增大）', () => {
    const b = emptyBoard();
    place(b, 3, 4, 'soldier', 'black'); // 未过河
    expect(dests(b, { row: 3, col: 4 })).toEqual(new Set(['4,4']));
    const b2 = emptyBoard();
    place(b2, 5, 4, 'soldier', 'black'); // 已过河（row>=5）
    expect(dests(b2, { row: 5, col: 4 })).toEqual(new Set(['6,4', '5,3', '5,5']));
  });
  it('红兵到底线不能再前进，只能横走', () => {
    const b = emptyBoard();
    place(b, 0, 4, 'soldier', 'red'); // 已到黑方底线
    expect(dests(b, { row: 0, col: 4 })).toEqual(new Set(['0,3', '0,5']));
  });
});
