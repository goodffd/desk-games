/**
 * WS 协议构造器单测（Plan 3 Task 1）。
 * 运行期验 c2s.* 发包形状；类型一致性由 typecheck 保。
 */
import { describe, it, expect } from 'vitest';
import { c2s } from '../src/games/guandan/online/protocol';

describe('protocol c2s 发包构造器', () => {
  it('形状与服务端字段对齐', () => {
    expect(c2s.hello('阿东')).toEqual({ t: 'hello', nick: '阿东' });
    expect(c2s.create(false)).toEqual({ t: 'create', isPrivate: false });
    expect(c2s.join('ABC123')).toEqual({ t: 'join', code: 'ABC123' });
    expect(c2s.takeSeat(2)).toEqual({ t: 'take-seat', seat: 2 });
    expect(c2s.start()).toEqual({ t: 'start' });
    expect(c2s.match()).toEqual({ t: 'match' });
    expect(c2s.lobby()).toEqual({ t: 'lobby' });
    expect(c2s.spectate('XYZ789')).toEqual({ t: 'spectate', code: 'XYZ789' });
    expect(c2s.play([1, 2, 3])).toEqual({ t: 'play', cardIds: [1, 2, 3] });
    expect(c2s.pass()).toEqual({ t: 'pass' });
    expect(c2s.tributeReturn(42)).toEqual({ t: 'tribute-return', cardId: 42 });
    expect(c2s.restart()).toEqual({ t: 'restart' });
    expect(c2s.rejoin('ABC123', 'TK', '阿东')).toEqual({ t: 'rejoin', code: 'ABC123', token: 'TK', nick: '阿东' });
  });

  it('JSON 往返不丢字段（WS 走 JSON.stringify）', () => {
    const msg = c2s.play([10, 20]);
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });
});
