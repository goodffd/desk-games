import { describe, it, expect } from 'vitest';
import { emptyBoard } from '../../../src/games/xiangqi/engine/board';
import { hasUndefendedCaptureThreat } from '../../../src/games/xiangqi/engine/game';
import type { Board, Color, PieceType } from '../../../src/games/xiangqi/engine/types';

function place(b: Board, r: number, c: number, t: PieceType, color: Color) { b[r][c] = { type: t, color }; }

describe('捉判定·排除献/兑（捉子自身挂着不算捉）', () => {
  // 红将放 col3、避开与黑将照面，确保吃子着法合法（不暴露己方将）
  it('安全的车捉无根马 → 算捉', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    place(b, 5, 0, 'chariot', 'red'); // 红车安全（无黑子攻击）
    place(b, 5, 4, 'horse', 'black'); // 黑马无根；红车沿横线可吃 (5,0)->(5,4)
    expect(hasUndefendedCaptureThreat(b, 'red')).toBe(true);
  });

  it('挂着的捉子（车捉马但车自身被无根攻击）→ 不算捉（献/兑）', () => {
    const b = emptyBoard();
    place(b, 9, 3, 'general', 'red');
    place(b, 0, 4, 'general', 'black');
    place(b, 5, 4, 'chariot', 'red'); // 红车
    place(b, 5, 6, 'horse', 'black'); // 黑马无根，红车横线可吃 (5,4)->(5,6)（红将不在 col4，不暴露）
    place(b, 3, 4, 'chariot', 'black'); // 黑车沿 col4 攻击红车(5,4) 且红车无根 → 红车挂着
    expect(hasUndefendedCaptureThreat(b, 'red')).toBe(false); // 红车挂着，捉马实为送/兑，不算捉
  });
});
