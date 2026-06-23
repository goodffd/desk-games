import { describe, it, expect } from 'vitest';
import { Game } from '../../../src/games/xiangqi/engine/game';
import { initialBoard } from '../../../src/games/xiangqi/engine/board';

describe('Game 起始局面与着法列表', () => {
  it('新局起始局面=初始摆子、红先、着法列表空', () => {
    const g = new Game();
    expect(g.getMoves()).toEqual([]);
    const sp = g.startPosition;
    expect(sp.turn).toBe('red');
    expect(sp.board).toEqual(initialBoard());
  });

  it('走子后 getMoves 记录着法，undo 弹出', () => {
    const g = new Game();
    const m = { from: { row: 7, col: 7 }, to: { row: 7, col: 4 } }; // 炮二平五
    expect(g.move(m)).toBe(true);
    expect(g.getMoves()).toEqual([m]);
    g.undo();
    expect(g.getMoves()).toEqual([]);
  });

  it('startPosition 返回深拷贝，外部改动不影响内部', () => {
    const g = new Game();
    const sp = g.startPosition;
    sp.board[0][0] = null;
    expect(g.startPosition.board[0][0]).not.toBeNull();
  });
});
