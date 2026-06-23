import { describe, it, expect } from 'vitest';
import { emptyBoard, initialBoard } from '../../../src/games/xiangqi/engine/board';
import { allLegalMoves, applyMove, computeStatus } from '../../../src/games/xiangqi/engine/game';
import { evaluate, searchBestMove, chooseMove, AI_LEVELS } from '../../../src/games/xiangqi/engine/ai';
import type { Board, Color, PieceType } from '../../../src/games/xiangqi/engine/types';
import { squaresEqual } from '../../../src/games/xiangqi/engine/types';

function place(b: Board, row: number, col: number, type: PieceType, color: Color) {
  b[row][col] = { type, color };
}

describe('evaluate 子力评估', () => {
  it('多一只车的一方分数为正（对称）', () => {
    const b = initialBoard();
    b[0][0] = null; // 去掉黑车
    expect(evaluate(b, 'red')).toBeGreaterThan(0);
    expect(evaluate(b, 'black')).toBeLessThan(0);
    expect(evaluate(b, 'red')).toBe(-evaluate(b, 'black'));
  });
});

describe('searchBestMove', () => {
  it('找到一步杀', () => {
    const b = emptyBoard();
    place(b, 0, 4, 'general', 'black');
    place(b, 9, 3, 'general', 'red');
    place(b, 1, 0, 'chariot', 'red'); // 封黑方二线
    place(b, 2, 8, 'chariot', 'red'); // 一步可上底线将杀
    const best = searchBestMove(b, 'red', 3);
    expect(best).not.toBeNull();
    const after = applyMove(b, best!);
    expect(computeStatus(after, 'black')).toBe('red_win'); // 选出的着法直接将杀
  });

  it('吃掉白送的无根子', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 5, 'general', 'black');
    place(b, 5, 0, 'chariot', 'red');
    place(b, 5, 5, 'chariot', 'black'); // 无保护，白送
    const best = searchBestMove(b, 'red', 2);
    expect(best).not.toBeNull();
    expect(squaresEqual(best!.from, { row: 5, col: 0 })).toBe(true);
    expect(squaresEqual(best!.to, { row: 5, col: 5 })).toBe(true);
  });

  it('初始局面返回一个合法着法', () => {
    const b = initialBoard();
    const best = searchBestMove(b, 'red', 2);
    expect(best).not.toBeNull();
    const legal = allLegalMoves(b, 'red');
    expect(legal.some((m) => squaresEqual(m.from, best!.from) && squaresEqual(m.to, best!.to))).toBe(true);
  });

  it('不被水平线效应骗：开局不弃炮窜底吃马（会被回吃）', () => {
    let b = initialBoard();
    b = applyMove(b, { from: { row: 6, col: 4 }, to: { row: 5, col: 4 } }); // 红兵进，轮黑
    const m = searchBestMove(b, 'black', 3);
    // 炮(2,1)→(9,1) 隔红炮吃红马，但黑炮随即被红车(9,0)吃回 → 实为送子，不应选
    const bad = squaresEqual(m!.from, { row: 2, col: 1 }) && squaresEqual(m!.to, { row: 9, col: 1 });
    expect(bad).toBe(false);
  });

  it('不吃有根子做亏本买卖（车不吃受保护的卒）', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 5, 'general', 'black');
    place(b, 5, 4, 'chariot', 'red');
    place(b, 5, 7, 'soldier', 'black'); // 卒
    place(b, 0, 7, 'chariot', 'black'); // 守住卒(同列)
    const m = searchBestMove(b, 'red', 3);
    const takesGuardedPawn = squaresEqual(m!.to, { row: 5, col: 7 });
    expect(takesGuardedPawn).toBe(false); // 车换卒亏 800，不应做
  });

  it('无合法着法返回 null', () => {
    const b = emptyBoard();
    place(b, 0, 4, 'general', 'black');
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 0, 'chariot', 'red');
    place(b, 1, 0, 'chariot', 'red'); // 黑被将死，黑无着法
    expect(searchBestMove(b, 'black', 2)).toBeNull();
  });
});

describe('chooseMove 棋力分档', () => {
  it('三档齐全且深度递增', () => {
    expect(AI_LEVELS.beginner.depth).toBeLessThan(AI_LEVELS.easy.depth);
    expect(AI_LEVELS.easy.depth).toBeLessThan(AI_LEVELS.medium.depth);
    expect(AI_LEVELS.beginner.blunderChance).toBeGreaterThan(0);
  });

  it('中级仍能找一步杀', () => {
    const b = emptyBoard();
    place(b, 0, 4, 'general', 'black');
    place(b, 9, 3, 'general', 'red');
    place(b, 1, 0, 'chariot', 'red');
    place(b, 2, 8, 'chariot', 'red');
    const m = chooseMove(b, 'red', 'medium', () => 0.99); // 不触发失误
    const after = applyMove(b, m!);
    expect(computeStatus(after, 'black')).toBe('red_win');
  });

  it('入门触发失误时走合法随机着法', () => {
    const b = initialBoard();
    const m = chooseMove(b, 'red', 'beginner', () => 0); // rand=0 → 命中失误分支
    expect(m).not.toBeNull();
    const legal = allLegalMoves(b, 'red');
    expect(legal.some((x) => squaresEqual(x.from, m!.from) && squaresEqual(x.to, m!.to))).toBe(true);
  });

  it('入门不触发失误时走搜索着法（合法）', () => {
    const b = initialBoard();
    const m = chooseMove(b, 'red', 'beginner', () => 0.99); // rand 高 → 不失误，走搜索
    expect(m).not.toBeNull();
    const legal = allLegalMoves(b, 'red');
    expect(legal.some((x) => squaresEqual(x.from, m!.from) && squaresEqual(x.to, m!.to))).toBe(true);
  });

  it('无合法着法返回 null', () => {
    const b = emptyBoard();
    place(b, 0, 4, 'general', 'black');
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 0, 'chariot', 'red');
    place(b, 1, 0, 'chariot', 'red');
    expect(chooseMove(b, 'black', 'easy')).toBeNull();
  });
});
