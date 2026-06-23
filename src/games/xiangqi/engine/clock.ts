import type { Color } from './types';

// 棋钟纯状态机：无 DOM、不可变更新，可被 vitest 穷举单测。
// 超时判负属对局管理而非棋盘规则，故独立于 Game.status，由 UI 层接 flagged 显示。
export type ClockMode = 'banker' | 'byoyomi'; // 包干 / 读秒

export interface ClockConfig {
  mode: ClockMode;
  mainMs: number; // 基本时间（包干=总时长；读秒=基本时间）
  byoyomiMs: number; // 读秒每步时长（byoyomi 模式用）
}

export interface SideClock {
  mainMs: number;
  inByoyomi: boolean;
  periodMs: number; // 当前读秒剩余（inByoyomi 时有意义）
}

export interface ClockState {
  config: ClockConfig;
  red: SideClock;
  black: SideClock;
  running: Color | null; // 当前在走的一方（其钟在跑）
  flagged: Color | null; // 已超时判负的一方
}

function freshSide(config: ClockConfig): SideClock {
  return { mainMs: config.mainMs, inByoyomi: false, periodMs: config.byoyomiMs };
}

export function createClock(config: ClockConfig): ClockState {
  return { config, red: freshSide(config), black: freshSide(config), running: null, flagged: null };
}

// 轮到 side 行棋：其钟开始跑；读秒态下重置该方 period（新一手满血）。
export function startTurn(s: ClockState, side: Color): ClockState {
  if (s.flagged) return s;
  const cur = side === 'red' ? s.red : s.black;
  const next = cur.inByoyomi ? { ...cur, periodMs: s.config.byoyomiMs } : cur;
  return {
    ...s,
    running: side,
    red: side === 'red' ? next : s.red,
    black: side === 'black' ? next : s.black,
  };
}

// 扣 running 方时间。包干 main→0 判负；读秒 main→0 进读秒（不判负），period→0 判负。
export function tick(s: ClockState, elapsedMs: number): ClockState {
  if (!s.running || s.flagged) return s;
  const cur = s.running === 'red' ? s.red : s.black;
  let { mainMs, inByoyomi, periodMs } = cur;
  let flag = false;
  if (!inByoyomi) {
    mainMs -= elapsedMs;
    if (mainMs <= 0) {
      const overflow = -mainMs; // 本次 tick 超出剩余 main 的部分，须计入读秒，不能丢
      mainMs = 0;
      if (s.config.mode === 'banker') flag = true;
      else {
        inByoyomi = true;
        periodMs = s.config.byoyomiMs - overflow;
        if (periodMs <= 0) { periodMs = 0; flag = true; }
      }
    }
  } else {
    periodMs -= elapsedMs;
    if (periodMs <= 0) {
      periodMs = 0;
      flag = true;
    }
  }
  const next: SideClock = { mainMs, inByoyomi, periodMs };
  return {
    ...s,
    red: s.running === 'red' ? next : s.red,
    black: s.running === 'black' ? next : s.black,
    flagged: flag ? s.running : s.flagged,
  };
}

// 毫秒 → mm:ss（向上取整、下限 0）
export function fmt(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(t / 60);
  const sec = t % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// 钟面文字：读秒态显示「读秒 N」，否则 mm:ss
export function display(side: SideClock): string {
  if (side.inByoyomi) return '读秒 ' + Math.max(0, Math.ceil(side.periodMs / 1000));
  return fmt(side.mainMs);
}
