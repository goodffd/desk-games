import { describe, it, expect } from 'vitest';
import { emptyBoard } from '../../../src/games/xiangqi/engine/board';
import { Game, hasUndefendedCaptureThreat } from '../../../src/games/xiangqi/engine/game';
import type { Board, Color, PieceType, Square } from '../../../src/games/xiangqi/engine/types';

function place(b: Board, row: number, col: number, type: PieceType, color: Color) {
  b[row][col] = { type, color };
}
const sq = (row: number, col: number): Square => ({ row, col });

describe('hasUndefendedCaptureThreat 无根子捉子', () => {
  it('威胁可吃的无根敌子 → true', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 5, 'general', 'black');
    place(b, 5, 4, 'chariot', 'red');
    place(b, 5, 7, 'horse', 'black'); // 无保护
    expect(hasUndefendedCaptureThreat(b, 'red')).toBe(true);
  });

  it('被吃子有根（受保护）→ false', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 5, 'general', 'black');
    place(b, 5, 4, 'chariot', 'red');
    place(b, 5, 7, 'horse', 'black');
    place(b, 4, 7, 'soldier', 'black'); // 黑卒(4,7)向前守(5,7)
    expect(hasUndefendedCaptureThreat(b, 'red')).toBe(false);
  });

  it('只威胁对方将（将军非捉子）→ false', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    place(b, 0, 0, 'chariot', 'red'); // 横线照着黑将，但将不算捉
    expect(hasUndefendedCaptureThreat(b, 'red')).toBe(false);
  });
});

describe('长将判负（集成：强制长将序列）', () => {
  it('红用车步步将军循环 → 三次重复后红判负', () => {
    const b = emptyBoard();
    place(b, 0, 4, 'general', 'black');
    place(b, 9, 0, 'general', 'red');
    place(b, 0, 0, 'chariot', 'red'); // 横线将军黑将
    const g = Game.fromPosition(b, 'black');
    expect(g.status).toBe('playing');
    const moves: [Square, Square][] = [
      [sq(0, 4), sq(1, 4)], // 黑将避
      [sq(0, 0), sq(1, 0)], // 红车再将
      [sq(1, 4), sq(0, 4)],
      [sq(1, 0), sq(0, 0)], // 将
      [sq(0, 4), sq(1, 4)],
      [sq(0, 0), sq(1, 0)], // 将
      [sq(1, 4), sq(0, 4)],
      [sq(1, 0), sq(0, 0)], // 将 → 触发三次重复
    ];
    for (let i = 0; i < moves.length; i++) {
      const ok = g.move({ from: moves[i][0], to: moves[i][1] });
      expect(ok, `第 ${i + 1} 步应合法`).toBe(true);
    }
    expect(g.status).toBe('black_win'); // 红长将判负
  });
});

describe('消极循环判和（集成）', () => {
  it('双方车来回不将不捉 → 三次重复判和', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 5, 'general', 'black');
    place(b, 9, 0, 'chariot', 'red');
    place(b, 0, 8, 'chariot', 'black');
    const g = Game.fromPosition(b, 'red');
    const moves: [Square, Square][] = [
      [sq(9, 0), sq(8, 0)],
      [sq(0, 8), sq(1, 8)],
      [sq(8, 0), sq(9, 0)],
      [sq(1, 8), sq(0, 8)],
      [sq(9, 0), sq(8, 0)],
      [sq(0, 8), sq(1, 8)],
      [sq(8, 0), sq(9, 0)],
      [sq(1, 8), sq(0, 8)], // → 三次重复
    ];
    for (const [from, to] of moves) expect(g.move({ from, to })).toBe(true);
    expect(g.status).toBe('draw');
  });
});
