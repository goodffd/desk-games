import { describe, it, expect } from 'vitest';
import { ENDGAMES, EndgameLine } from '../../../src/games/xiangqi/engine/endgames';
import { fromFen } from '../../../src/games/xiangqi/engine/fen';
import { Game, applyMove } from '../../../src/games/xiangqi/engine/game';
import { chineseToMove } from '../../../src/games/xiangqi/engine/notation';
import { opponent } from '../../../src/games/xiangqi/engine/types';

describe('残局库数据', () => {
  it('至少 6 个残局', () => {
    expect(ENDGAMES.length).toBeGreaterThanOrEqual(6);
  });

  it('每个残局 FEN 可加载、Game.fromPosition 不抛、目标合法', () => {
    for (const eg of ENDGAMES) {
      const { board, turn } = fromFen(eg.fen);
      expect(() => Game.fromPosition(board, turn)).not.toThrow();
      expect(['红胜', '和']).toContain(eg.goal);
      expect(eg.name).toBeTruthy();
    }
  });

  it('每个残局的解法从 FEN 起逐手合法重放', () => {
    for (const eg of ENDGAMES) {
      let { board, turn } = fromFen(eg.fen);
      for (const zh of eg.solution) {
        const m = chineseToMove(board, turn, zh); // 非法/无法解析会抛 → 暴露数据错误
        board = applyMove(board, m);
        turn = opponent(turn);
      }
    }
  });
});

describe('EndgameLine 步进', () => {
  const eg = ENDGAMES[0];
  it('起始停在残局 FEN 局面', () => {
    const line = new EndgameLine(eg);
    const start = fromFen(eg.fen);
    expect(line.position().board).toEqual(start.board);
    expect(line.position().turn).toBe(start.turn);
    expect(line.moves()).toEqual([]);
    expect(line.canPrev()).toBe(false);
    expect(line.canNext()).toBe(eg.solution.length > 0);
  });

  it('next/prev 推进回退，moves 与解法前缀一致', () => {
    const line = new EndgameLine(eg);
    if (eg.solution.length === 0) return;
    line.next();
    expect(line.moves()).toEqual(eg.solution.slice(0, 1));
    expect(line.canPrev()).toBe(true);
    line.prev();
    expect(line.moves()).toEqual([]);
  });
});
