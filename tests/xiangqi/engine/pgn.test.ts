import { describe, it, expect } from 'vitest';
import { Game } from '../../../src/games/xiangqi/engine/game';
import { emptyBoard } from '../../../src/games/xiangqi/engine/board';
import { gameToPgn, pgnToGame } from '../../../src/games/xiangqi/engine/pgn';

function playOpening(): Game {
  const g = new Game();
  g.move({ from: { row: 7, col: 7 }, to: { row: 7, col: 4 } }); // 炮二平五
  g.move({ from: { row: 0, col: 1 }, to: { row: 2, col: 2 } }); // 马８进７
  g.move({ from: { row: 9, col: 1 }, to: { row: 7, col: 2 } }); // 马八进七
  return g;
}

describe('PGN', () => {
  it('导出含 tags 与双轨着法', () => {
    const pgn = gameToPgn(playOpening(), { red: '甲', black: '乙' });
    expect(pgn).toContain('[Red "甲"]');
    expect(pgn).toContain('[Black "乙"]');
    expect(pgn).toContain('h7-e7');
    expect(pgn).toContain('{炮二平五}');
    expect(pgn).toContain('1.');
  });

  it('导出→导入→局面逐手一致', () => {
    const g = playOpening();
    const back = pgnToGame(gameToPgn(g));
    expect(back.board).toEqual(g.board);
    expect(back.turn).toBe(g.turn);
    expect(back.getMoves()).toEqual(g.getMoves());
  });

  it('从残局起始局面（带 FEN tag）往返一致', () => {
    const g = playOpening();
    const pgn = gameToPgn(g);
    expect(pgn).not.toContain('[FEN'); // 普通开局起始=初始局面，不写 FEN tag
    const back = pgnToGame(pgn);
    expect(back.board).toEqual(g.board);
  });

  it('自定义起始局面（写 FEN tag）往返一致', () => {
    const b = emptyBoard();
    b[9][4] = { type: 'general', color: 'red' };
    b[0][3] = { type: 'general', color: 'black' };
    b[5][0] = { type: 'chariot', color: 'red' };
    const g = Game.fromPosition(b, 'red');
    expect(g.move({ from: { row: 5, col: 0 }, to: { row: 7, col: 0 } })).toBe(true);
    const pgn = gameToPgn(g);
    expect(pgn).toContain('[FEN');
    const back = pgnToGame(pgn);
    expect(back.startPosition.board).toEqual(b);
    expect(back.startPosition.turn).toBe('red');
    expect(back.getMoves()).toEqual(g.getMoves());
    expect(back.board).toEqual(g.board);
  });
});
