import { describe, it, expect } from 'vitest';
import { toFen, fromFen } from '../../../src/games/xiangqi/engine/fen';
import { initialBoard, emptyBoard } from '../../../src/games/xiangqi/engine/board';

const INIT_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

describe('FEN', () => {
  it('初始局面 → 标准 FEN', () => {
    expect(toFen(initialBoard(), 'red')).toBe(INIT_FEN);
  });

  it('FEN → 局面往返一致（初始）', () => {
    const { board, turn } = fromFen(INIT_FEN);
    expect(board).toEqual(initialBoard());
    expect(turn).toBe('red');
  });

  it('自定义残局往返一致', () => {
    const b = emptyBoard();
    b[0][4] = { type: 'general', color: 'black' };
    b[9][4] = { type: 'general', color: 'red' };
    b[5][0] = { type: 'chariot', color: 'red' };
    const fen = toFen(b, 'black');
    const back = fromFen(fen);
    expect(back.board).toEqual(b);
    expect(back.turn).toBe('black');
  });

  it('非法 FEN 抛错', () => {
    expect(() => fromFen('rnbakabnr/9/9 w')).toThrow(); // 行数不足
    expect(() => fromFen(INIT_FEN.replace(' w', ''))).toThrow(); // 缺轮走方
    expect(() => fromFen('xnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w')).toThrow(); // 非法字符
    expect(() => fromFen('rnbakabn0/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w')).toThrow(); // '0' 空位计数非法
    expect(() => fromFen('rnbakabnr1/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w')).toThrow(); // 超过 9 列
  });

  it('容忍轮走方后的多余字段（步数时钟）', () => {
    const { turn } = fromFen('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w 0 1');
    expect(turn).toBe('red');
  });
});
