import { describe, it, expect } from 'vitest';
import { createClock, startTurn, tick, fmt, display } from '../../../src/games/xiangqi/engine/clock';
import type { ClockConfig } from '../../../src/games/xiangqi/engine/clock';

const banker: ClockConfig = { mode: 'banker', mainMs: 10000, byoyomiMs: 30000 };
const byo: ClockConfig = { mode: 'byoyomi', mainMs: 5000, byoyomiMs: 3000 };

describe('clock 初始化与基本走时', () => {
  it('createClock 初值', () => {
    const s = createClock(banker);
    expect(s.red.mainMs).toBe(10000);
    expect(s.black.mainMs).toBe(10000);
    expect(s.red.inByoyomi).toBe(false);
    expect(s.running).toBeNull();
    expect(s.flagged).toBeNull();
  });

  it('startTurn 设 running', () => {
    expect(startTurn(createClock(banker), 'red').running).toBe('red');
  });

  it('tick 只扣 running 方', () => {
    let s = startTurn(createClock(banker), 'red');
    s = tick(s, 1000);
    expect(s.red.mainMs).toBe(9000);
    expect(s.black.mainMs).toBe(10000);
  });

  it('running=null 时 tick 不变', () => {
    const s = createClock(banker);
    expect(tick(s, 1000)).toEqual(s);
  });
});

describe('包干判负', () => {
  it('main 归 0 → flagged', () => {
    let s = startTurn(createClock(banker), 'black');
    s = tick(s, 10000);
    expect(s.black.mainMs).toBe(0);
    expect(s.flagged).toBe('black');
  });
  it('flagged 后 tick 幂等', () => {
    let s = startTurn(createClock(banker), 'black');
    s = tick(s, 12000);
    expect(tick(s, 1000)).toEqual(s);
  });
});

describe('读秒', () => {
  it('main 耗尽进读秒、不判负', () => {
    let s = startTurn(createClock(byo), 'red');
    s = tick(s, 5000);
    expect(s.red.mainMs).toBe(0);
    expect(s.red.inByoyomi).toBe(true);
    expect(s.red.periodMs).toBe(3000);
    expect(s.flagged).toBeNull();
  });
  it('读秒 period 归 0 → flagged', () => {
    let s = startTurn(createClock(byo), 'red');
    s = tick(s, 5000);
    s = tick(s, 3000);
    expect(s.red.periodMs).toBe(0);
    expect(s.flagged).toBe('red');
  });
  it('startTurn 在读秒态重置 period（新一手满血）', () => {
    let s = startTurn(createClock(byo), 'red');
    s = tick(s, 5000);
    s = tick(s, 1500);
    expect(s.red.periodMs).toBe(1500);
    s = startTurn(s, 'red');
    expect(s.red.periodMs).toBe(3000);
  });
});

describe('格式化', () => {
  it('fmt mm:ss 向上取整、下限 0', () => {
    expect(fmt(0)).toBe('0:00');
    expect(fmt(1)).toBe('0:01');
    expect(fmt(59000)).toBe('0:59');
    expect(fmt(60000)).toBe('1:00');
    expect(fmt(125000)).toBe('2:05');
    expect(fmt(-100)).toBe('0:00');
  });
  it('display 读秒态显示秒数', () => {
    expect(display({ mainMs: 0, inByoyomi: true, periodMs: 12000 })).toBe('读秒 12');
    expect(display({ mainMs: 90000, inByoyomi: false, periodMs: 0 })).toBe('1:30');
  });
});
