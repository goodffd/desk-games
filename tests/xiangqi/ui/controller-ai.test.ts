import { describe, it, expect } from 'vitest';
import { GameController } from '../../../src/games/xiangqi/ui/controller';

describe('GameController 人机模式', () => {
  it('AI 执黑：红走后 maybeAiMove 让黑落子并轮回红', () => {
    const c = new GameController();
    c.setAi('black', 'easy');
    c.click({ row: 6, col: 4 });
    c.click({ row: 5, col: 4 }); // 红兵进 → 轮黑
    expect(c.turn).toBe('black');
    const m = c.maybeAiMove();
    expect(m).not.toBeNull();
    expect(c.turn).toBe('red'); // AI 走完轮回红
    expect(c.selected).toBeNull();
  });

  it('AI 走子后 lastMove = 该着法（供高亮）', () => {
    const c = new GameController();
    c.setAi('black', 'easy');
    c.click({ row: 6, col: 4 });
    c.click({ row: 5, col: 4 });
    const m = c.maybeAiMove();
    expect(c.lastMove).toEqual(m);
  });

  it('非 AI 回合：maybeAiMove 不动', () => {
    const c = new GameController();
    c.setAi('black', 'easy');
    expect(c.turn).toBe('red'); // 轮红，AI 执黑
    expect(c.maybeAiMove()).toBeNull();
    expect(c.turn).toBe('red');
  });

  it('双人模式：maybeAiMove 始终不动', () => {
    const c = new GameController(); // 默认双人
    c.click({ row: 6, col: 4 });
    c.click({ row: 5, col: 4 }); // 轮黑
    expect(c.maybeAiMove()).toBeNull();
  });

  it('reset 保留人机设置', () => {
    const c = new GameController();
    c.setAi('black', 'easy');
    c.click({ row: 6, col: 4 });
    c.click({ row: 5, col: 4 });
    c.reset();
    expect(c.aiColor).toBe('black');
    expect(c.turn).toBe('red');
  });

  it('关闭 AI 回到双人', () => {
    const c = new GameController();
    c.setAi('black', 'easy');
    c.setAi(null);
    expect(c.aiColor).toBeNull();
  });
});
