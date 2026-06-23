import type { Color, GameStatus } from './types';

// 一步着法在循环裁决中关心的属性
export interface PlyInfo {
  mover: Color;
  gaveCheck: boolean; // 走后是否将对方军（将）
  chaseThreat: boolean; // 走后是否（非将地）威胁吃一枚无根非将敌子且非献/兑（捉）
}

type Level = 0 | 1 | 2; // 0 闲 / 1 长打 / 2 长将

// 某方在一个循环里的攻击等级：全将=2；全打(将|捉)非全将=1；含任一闲步=0
function offenseLevel(plies: PlyInfo[]): Level {
  if (plies.length === 0) return 0;
  const kinds = plies.map((p) => (p.gaveCheck ? 'check' : p.chaseThreat ? 'chase' : 'idle'));
  if (kinds.some((k) => k === 'idle')) return 0;
  return kinds.every((k) => k === 'check') ? 2 : 1;
}

/**
 * 对一个已确认的重复循环（红黑交替若干步）裁决。
 * 攻击等级：长将2 > 长打1 > 闲0。等级相同→和；不同→高等级方必变、判负。
 * 覆盖长将/长捉/一将一捉/一将一闲/长将vs长捉/双方长打/消极循环。
 * 诚实边界：原则化核心，不等于官方整本「棋例」。
 */
export function adjudicateRepetition(cycle: PlyInfo[]): GameStatus {
  const rl = offenseLevel(cycle.filter((p) => p.mover === 'red'));
  const bl = offenseLevel(cycle.filter((p) => p.mover === 'black'));
  if (rl === bl) return 'draw';
  return rl > bl ? 'black_win' : 'red_win'; // 高等级方判负
}
