import { describe, it, expect } from 'vitest';
import { OPENINGS, buildBookIndex, lookupBook } from '../../../src/games/xiangqi/engine/openings';
import { applyMove } from '../../../src/games/xiangqi/engine/game';
import { initialBoard } from '../../../src/games/xiangqi/engine/board';
import { chineseToMove } from '../../../src/games/xiangqi/engine/notation';

describe('开局库索引', () => {
  it('全书每条谱线合法（重放无异常）', () => {
    expect(() => buildBookIndex()).not.toThrow();
  });

  it('初始局面命中红方首着（中炮/仙人指路）', () => {
    const idx = buildBookIndex();
    const e = lookupBook(idx, initialBoard(), 'red');
    expect(e).not.toBeNull();
    const zhs = e!.moves.map((m) => m.zh);
    expect(zhs).toContain('炮二平五');
    expect(zhs).toContain('兵七进一');
  });

  it('炮二平五后命中黑方应着', () => {
    const idx = buildBookIndex();
    const b1 = applyMove(initialBoard(), chineseToMove(initialBoard(), 'red', '炮二平五'));
    const e = lookupBook(idx, b1, 'black');
    expect(e).not.toBeNull();
    expect(e!.moves.map((m) => m.zh)).toContain('马8进7');
  });

  it('出谱局面返回 null', () => {
    const idx = buildBookIndex();
    // 兵一进一（边兵）不是任何开局首着 → 黑方局面不在书内
    const off = applyMove(initialBoard(), chineseToMove(initialBoard(), 'red', '兵一进一'));
    expect(lookupBook(idx, off, 'black')).toBeNull();
  });

  it('OPENINGS 含 10+ 套', () => {
    expect(OPENINGS.length).toBeGreaterThanOrEqual(10);
  });
});
