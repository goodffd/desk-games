import { describe, it, expect } from 'vitest';
import { emptyBoard } from '../../../src/games/xiangqi/engine/board';
import { isInCheck } from '../../../src/games/xiangqi/engine/rules';
import {
  Game,
  legalMovesFrom,
  allLegalMoves,
  computeStatus,
} from '../../../src/games/xiangqi/engine/game';
import type { Board, Color, PieceType, Square } from '../../../src/games/xiangqi/engine/types';

function place(b: Board, row: number, col: number, type: PieceType, color: Color) {
  b[row][col] = { type, color };
}
function key(s: Square) {
  return `${s.row},${s.col}`;
}

describe('Game 初始', () => {
  it('红先，进行中', () => {
    const g = new Game();
    expect(g.turn).toBe('red');
    expect(g.status).toBe('playing');
  });
  it('初始红车(9,0)合法着法：纵向到(8,0)..可走，横向被马挡', () => {
    const g = new Game();
    const d = new Set(g.legalMoves({ row: 9, col: 0 }).map(key));
    expect(d.has('8,0')).toBe(true); // 纵向第一步
    expect(d.has('9,1')).toBe(false); // 横向被己方马挡
  });
});

describe('legalMovesFrom 过滤送将', () => {
  it('被牵制的子不能走（走后己方被将）', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 3, 'general', 'black');
    place(b, 5, 4, 'horse', 'red'); // 挡在红将与黑车之间
    place(b, 0, 4, 'chariot', 'black'); // 黑车在 col4 盯着红将
    // 马一动 col4 露出 → 红被将，故无合法着法
    expect(legalMovesFrom(b, { row: 5, col: 4 })).toEqual([]);
  });

  it('将帅照面：挡在中间的车只能沿同列走，横向暴露照面则非法', () => {
    const b = emptyBoard();
    place(b, 9, 4, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    place(b, 7, 4, 'chariot', 'red'); // 挡住照面
    const moves = legalMovesFrom(b, { row: 7, col: 4 });
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(m.col).toBe(4); // 任何横走都会照面，全部被禁
  });
});

describe('move / undo', () => {
  it('落子后换边、棋子移动；悔棋完全复原', () => {
    const g = new Game();
    const before = JSON.stringify(g.board);
    const ok = g.move({ from: { row: 6, col: 4 }, to: { row: 5, col: 4 } }); // 红兵进一
    expect(ok).toBe(true);
    expect(g.turn).toBe('black');
    expect(g.board[6][4]).toBeNull();
    expect(g.board[5][4]).toEqual({ type: 'soldier', color: 'red' });
    const undone = g.undo();
    expect(undone).toBe(true);
    expect(g.turn).toBe('red');
    expect(JSON.stringify(g.board)).toBe(before);
  });

  it('拒绝非法着法，状态不变', () => {
    const g = new Game();
    const before = JSON.stringify(g.board);
    const ok = g.move({ from: { row: 6, col: 4 }, to: { row: 4, col: 4 } }); // 兵一次走两格
    expect(ok).toBe(false);
    expect(g.turn).toBe('red');
    expect(JSON.stringify(g.board)).toBe(before);
  });

  it('不能移动对方的子', () => {
    const g = new Game();
    const ok = g.move({ from: { row: 3, col: 4 }, to: { row: 4, col: 4 } }); // 轮红却动黑卒
    expect(ok).toBe(false);
  });
});

describe('将死 checkmate', () => {
  it('黑将被双车闷死 → 红胜', () => {
    const b = emptyBoard();
    place(b, 0, 4, 'general', 'black');
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 0, 'chariot', 'red'); // 横线将军
    place(b, 1, 0, 'chariot', 'red'); // 封住第二行
    expect(isInCheck(b, 'black')).toBe(true);
    expect(allLegalMoves(b, 'black')).toEqual([]);
    expect(computeStatus(b, 'black')).toBe('red_win');
  });
});

describe('困毙 stalemate（无棋可走判负）', () => {
  it('黑将无路可走且未被将 → 仍判红胜', () => {
    const b = emptyBoard();
    place(b, 0, 3, 'general', 'black');
    place(b, 9, 5, 'general', 'red');
    place(b, 2, 4, 'chariot', 'red'); // 封 (0,4)
    place(b, 2, 3, 'soldier', 'red'); // 封 (1,3)，但不攻击 (0,3)
    expect(isInCheck(b, 'black')).toBe(false); // 不是将军
    expect(allLegalMoves(b, 'black')).toEqual([]); // 但无棋可走
    expect(computeStatus(b, 'black')).toBe('red_win'); // 困毙判负
  });
});

describe('随机对局模糊测试', () => {
  it('连续走合法着法 300 步：不抛异常、棋子数不增、双方将在局中', () => {
    const g = new Game();
    for (let ply = 0; ply < 300; ply++) {
      if (g.status !== 'playing') break;
      const moves = allLegalMoves(g.board, g.turn);
      expect(moves.length).toBeGreaterThan(0); // playing 必有着法
      const m = moves[Math.floor(Math.random() * moves.length)];
      const ok = g.move(m);
      expect(ok).toBe(true);
      const count = g.board.flat().filter(Boolean).length;
      expect(count).toBeLessThanOrEqual(32);
      expect(count).toBeGreaterThanOrEqual(2); // 至少两将（将被吃即终局，不会继续）
    }
  });
});
