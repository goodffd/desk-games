import { describe, it, expect } from 'vitest';
import { emptyBoard } from '../../../src/games/xiangqi/engine/board';
import { Game } from '../../../src/games/xiangqi/engine/game';
import type { Board, Color, PieceType, Square } from '../../../src/games/xiangqi/engine/types';

function place(b: Board, row: number, col: number, type: PieceType, color: Color) {
  b[row][col] = { type, color };
}
const sq = (row: number, col: number): Square => ({ row, col });

// 两车在各自行上单向行进、永不重复局面，可凑足任意步数的无吃子序列。
function marchBoard(): Board {
  const b = emptyBoard();
  place(b, 9, 3, 'general', 'red'); // 红帅 (9,3)
  place(b, 0, 5, 'general', 'black'); // 黑将 (0,5)，与红帅不同列、不照面
  place(b, 5, 0, 'chariot', 'red'); // 红车沿第 5 行向右行进
  place(b, 4, 8, 'chariot', 'black'); // 黑车沿第 4 行向左行进
  return b;
}

describe('自然限着（连续无吃子判和）', () => {
  it('默认上限为 120 plies（60 回合）', () => {
    expect(new Game().naturalLimitPlies).toBe(120);
  });

  it('连续达到上限的无吃子着法 → 判和', () => {
    const g = Game.fromPosition(marchBoard(), 'red', { naturalLimitPlies: 6 });
    const moves: [Square, Square][] = [
      [sq(5, 0), sq(5, 1)], // 红 1
      [sq(4, 8), sq(4, 7)], // 黑 1
      [sq(5, 1), sq(5, 2)], // 红 2
      [sq(4, 7), sq(4, 6)], // 黑 2
      [sq(5, 2), sq(5, 3)], // 红 3
      [sq(4, 6), sq(4, 5)], // 黑 3 → 第 6 个无吃子着法
    ];
    for (let i = 0; i < moves.length; i++) {
      expect(g.move({ from: moves[i][0], to: moves[i][1] }), `第 ${i + 1} 步应合法`).toBe(true);
    }
    expect(g.movesWithoutCapture).toBe(6);
    expect(g.status).toBe('draw');
  });

  it('同样 6 步在默认上限下不判和（仍在进行）', () => {
    const g = Game.fromPosition(marchBoard(), 'red'); // 默认 120
    const moves: [Square, Square][] = [
      [sq(5, 0), sq(5, 1)],
      [sq(4, 8), sq(4, 7)],
      [sq(5, 1), sq(5, 2)],
      [sq(4, 7), sq(4, 6)],
      [sq(5, 2), sq(5, 3)],
      [sq(4, 6), sq(4, 5)],
    ];
    for (const [from, to] of moves) expect(g.move({ from, to })).toBe(true);
    expect(g.movesWithoutCapture).toBe(6);
    expect(g.status).toBe('playing');
  });

  it('吃子重置计数器 → 不因之前的无吃子着法判和', () => {
    const b = marchBoard();
    place(b, 5, 4, 'soldier', 'black'); // 红车行进途中可吃的黑卒
    const g = Game.fromPosition(b, 'red', { naturalLimitPlies: 6 });
    const moves: [Square, Square][] = [
      [sq(5, 0), sq(5, 1)], // 红 1（无吃，count 1）
      [sq(4, 8), sq(4, 7)], // 黑 1（count 2）
      [sq(5, 1), sq(5, 4)], // 红 吃黑卒 → count 归 0
      [sq(4, 7), sq(4, 6)], // 黑（count 1）
      [sq(5, 4), sq(5, 3)], // 红（count 2）
      [sq(4, 6), sq(4, 5)], // 黑（count 3）
      [sq(5, 3), sq(5, 2)], // 红（count 4）
      [sq(4, 5), sq(4, 4)], // 黑（count 5）
    ];
    for (let i = 0; i < moves.length; i++) {
      expect(g.move({ from: moves[i][0], to: moves[i][1] }), `第 ${i + 1} 步应合法`).toBe(true);
    }
    expect(g.movesWithoutCapture).toBe(5); // 吃子后只累计 5 步，未达上限 6
    expect(g.status).toBe('playing');
  });

  it('undo 恢复无吃子计数与判和状态', () => {
    const g = Game.fromPosition(marchBoard(), 'red', { naturalLimitPlies: 6 });
    const moves: [Square, Square][] = [
      [sq(5, 0), sq(5, 1)],
      [sq(4, 8), sq(4, 7)],
      [sq(5, 1), sq(5, 2)],
      [sq(4, 7), sq(4, 6)],
      [sq(5, 2), sq(5, 3)],
      [sq(4, 6), sq(4, 5)],
    ];
    for (const [from, to] of moves) g.move({ from, to });
    expect(g.status).toBe('draw');

    expect(g.undo()).toBe(true);
    expect(g.status).toBe('playing'); // 撤回判和那一步
    expect(g.movesWithoutCapture).toBe(5); // 计数器回退

    // 重走第 6 步，应再次触发判和（证明计数器被正确恢复）
    expect(g.move({ from: sq(4, 6), to: sq(4, 5) })).toBe(true);
    expect(g.movesWithoutCapture).toBe(6);
    expect(g.status).toBe('draw');
  });
});
