import { describe, it, expect } from 'vitest';
import { GameController } from '../../../src/games/xiangqi/ui/controller';
import { Game } from '../../../src/games/xiangqi/engine/game';
import { emptyBoard } from '../../../src/games/xiangqi/engine/board';

describe('GameController 交互状态机', () => {
  it('点己方子 → 选中并给出合法着法', () => {
    const c = new GameController();
    c.click({ row: 7, col: 1 }); // 红炮
    expect(c.selected).toEqual({ row: 7, col: 1 });
    expect(c.legalDests.length).toBeGreaterThan(0);
  });

  it('选中后点合法目标 → 走子、换边、清选择', () => {
    const c = new GameController();
    c.click({ row: 6, col: 4 }); // 选红兵
    c.click({ row: 5, col: 4 }); // 进一步（合法）
    expect(c.turn).toBe('black');
    expect(c.board[5][4]).toEqual({ type: 'soldier', color: 'red' });
    expect(c.board[6][4]).toBeNull();
    expect(c.selected).toBeNull();
    expect(c.legalDests).toEqual([]);
  });

  it('选中后点非法/空格 → 取消选择，不走子', () => {
    const c = new GameController();
    c.click({ row: 6, col: 4 }); // 选红兵
    c.click({ row: 4, col: 4 }); // 非法目标（兵不能跨两格），且非己方子
    expect(c.turn).toBe('red'); // 没走
    expect(c.selected).toBeNull(); // 选择被清
    expect(c.board[6][4]).toEqual({ type: 'soldier', color: 'red' });
  });

  it('轮红时点黑子 → 不选中', () => {
    const c = new GameController();
    c.click({ row: 3, col: 4 }); // 黑卒
    expect(c.selected).toBeNull();
    expect(c.legalDests).toEqual([]);
  });

  it('选中后改点另一己方子 → 切换选择', () => {
    const c = new GameController();
    c.click({ row: 7, col: 1 }); // 红炮
    c.click({ row: 9, col: 0 }); // 改选红车
    expect(c.selected).toEqual({ row: 9, col: 0 });
    expect(c.legalDests.length).toBeGreaterThan(0);
  });

  it('悔棋恢复上一步', () => {
    const c = new GameController();
    c.click({ row: 6, col: 4 });
    c.click({ row: 5, col: 4 });
    c.undo();
    expect(c.turn).toBe('red');
    expect(c.board[6][4]).toEqual({ type: 'soldier', color: 'red' });
    expect(c.board[5][4]).toBeNull();
    expect(c.selected).toBeNull();
  });

  it('重开 → 回到初始红先', () => {
    const c = new GameController();
    c.click({ row: 6, col: 4 });
    c.click({ row: 5, col: 4 });
    c.reset();
    expect(c.turn).toBe('red');
    expect(c.board[6][4]).toEqual({ type: 'soldier', color: 'red' });
  });

  it('lastMove 初始为 null', () => {
    expect(new GameController().lastMove).toBeNull();
  });

  it('走子后 lastMove 记录 from/to（供高亮）', () => {
    const c = new GameController();
    c.click({ row: 6, col: 4 });
    c.click({ row: 5, col: 4 });
    expect(c.lastMove).toEqual({ from: { row: 6, col: 4 }, to: { row: 5, col: 4 } });
  });

  it('重开清空 lastMove', () => {
    const c = new GameController();
    c.click({ row: 6, col: 4 });
    c.click({ row: 5, col: 4 });
    c.reset();
    expect(c.lastMove).toBeNull();
  });

  it('applyExternalMove 吃子时置 lastCapture=true（供联机收子音效）', () => {
    const b = emptyBoard();
    b[9][4] = { type: 'general', color: 'red' };
    b[0][3] = { type: 'general', color: 'black' }; // 错开纵线，避免将帅照面
    b[5][0] = { type: 'chariot', color: 'red' };
    b[5][4] = { type: 'soldier', color: 'black' }; // 红车横吃黑卒
    const c = new GameController(Game.fromPosition(b, 'red'));
    const ok = c.applyExternalMove({ from: { row: 5, col: 0 }, to: { row: 5, col: 4 } });
    expect(ok).toBe(true);
    expect(c.lastCapture).toBe(true);
  });

  it('applyExternalMove 走空格时 lastCapture=false，不残留上一步吃子值', () => {
    const b = emptyBoard();
    b[9][4] = { type: 'general', color: 'red' };
    b[0][3] = { type: 'general', color: 'black' };
    b[5][0] = { type: 'chariot', color: 'red' };
    const c = new GameController(Game.fromPosition(b, 'red'));
    c.lastCapture = true; // 预置脏值，模拟上一步吃过子
    const ok = c.applyExternalMove({ from: { row: 5, col: 0 }, to: { row: 5, col: 1 } });
    expect(ok).toBe(true);
    expect(c.lastCapture).toBe(false);
  });

  it('终局后点击不再响应', () => {
    // 注入一个黑将被双车将死的残局（红胜）
    const b = emptyBoard();
    b[0][4] = { type: 'general', color: 'black' };
    b[9][3] = { type: 'general', color: 'red' };
    b[0][0] = { type: 'chariot', color: 'red' };
    b[1][0] = { type: 'chariot', color: 'red' };
    const c = new GameController(Game.fromPosition(b, 'black'));
    expect(c.status).toBe('red_win');
    c.click({ row: 0, col: 4 });
    expect(c.selected).toBeNull(); // 终局后无反应
  });
});
