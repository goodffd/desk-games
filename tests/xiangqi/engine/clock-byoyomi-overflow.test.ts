import { describe, it, expect } from 'vitest';
import { createClock, startTurn, tick } from '../../../src/games/xiangqi/engine/clock';

// 回归：读秒模式下单次 tick 打穿 main 进入读秒时，旧代码把 period 重置为满血、丢掉溢出时间，
// 导致本该判负/已耗时的对局重置读秒继续。修复后溢出须计入读秒周期。
describe('clock byoyomi 跨界溢出', () => {
  it('单 tick 打穿 main → 读秒扣掉溢出，而非满血', () => {
    const s = startTurn(createClock({ mode: 'byoyomi', mainMs: 1000, byoyomiMs: 30000 }), 'red');
    const after = tick(s, 1200); // main 剩 1000，elapsed 1200，溢出 200
    expect(after.red.inByoyomi).toBe(true);
    expect(after.red.periodMs).toBe(29800); // 30000 - 200，旧 bug 会是 30000
    expect(after.flagged).toBeNull();
  });

  it('单 tick 同时打穿 main + 整个读秒 → 判负', () => {
    const s = startTurn(createClock({ mode: 'byoyomi', mainMs: 1000, byoyomiMs: 30000 }), 'red');
    const after = tick(s, 1000 + 30000 + 5); // main + period 全打穿
    expect(after.red.periodMs).toBe(0);
    expect(after.flagged).toBe('red'); // 旧 bug 会重置满血、不判负
  });
});
