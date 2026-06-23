import { describe, it, expect } from 'vitest';
import { positionKey } from '../../../src/games/xiangqi/engine/game';
import { initialBoard, cloneBoard } from '../../../src/games/xiangqi/engine/board';

// 回归：chariot 与 cannon 首字母同为 'c'，旧 positionKey 用 type[0] 会把"车在X格"与"炮在X格"
// 哈希成同一 key，污染重复局面判定（误判长将/长捉）。修复后必须区分。
describe('positionKey', () => {
  it('车与炮在同一格产生不同 key（修复 chariot/cannon 碰撞）', () => {
    const b1 = initialBoard();
    const b2 = cloneBoard(b1);
    b2[9][0]!.type = 'cannon'; // 红车(9,0) 改成炮，其余不变
    expect(positionKey(b1, 'red')).not.toBe(positionKey(b2, 'red'));
  });

  it('同一局面 + 同一行棋方 → key 相等（稳定性）', () => {
    expect(positionKey(initialBoard(), 'red')).toBe(positionKey(initialBoard(), 'red'));
    expect(positionKey(initialBoard(), 'red')).not.toBe(positionKey(initialBoard(), 'black'));
  });
});
