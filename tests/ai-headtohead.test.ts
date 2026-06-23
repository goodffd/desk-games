import { describe, it, expect } from 'vitest';
import { makeDeck, deal } from '../src/games/guandan/engine/cards';
import { createDeal, play, pass, isDealOver, ranking, type DealState } from '../src/games/guandan/engine/game';
import { choosePlay } from '../src/games/guandan/ai/ai';
import { legacyChoosePlay } from './helpers/legacy-ai';
import type { Rank, Seat } from '../src/games/guandan/engine/types';

const LEVEL: Rank = 2;
const GAMES = 500;
const MAX_STEPS = 2000;
type Policy = (s: DealState, seat: Seat) => ReturnType<typeof choosePlay>;

function makeLCG(seed: number): () => number {
  let st = seed >>> 0;
  return () => (st = (Math.imul(st, 1664525) + 1013904223) >>> 0);
}
function seededShuffle(seed: number) {
  return (n: number): number[] => {
    const next = makeLCG(seed);
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = next() % (i + 1); [p[i], p[j]] = [p[j]!, p[i]!]; }
    return p;
  };
}

/** 跑一整局，按座位策略出牌，返回 ranking（finish 顺序）。 */
function playDeal(seed: number, policyOf: (seat: Seat) => Policy): Seat[] {
  const deck = makeDeck();
  const hands = deal(deck, seededShuffle(seed));
  const firstLeader = (makeLCG(seed + 0xbeef)() % 4) as Seat;
  let s = createDeal(hands, firstLeader, LEVEL);
  let step = 0;
  while (!isDealOver(s)) {
    if (++step > MAX_STEPS) break;
    const seat = s.turn;
    const chosen = policyOf(seat)(s, seat);
    s = chosen === null ? pass(s, seat) : play(s, seat, chosen);
  }
  return ranking(s);
}

/** 名次→得分：头游3 二游2 三游1 末游0。 */
function teamPoints(rank: Seat[], teamSeats: Seat[]): number {
  const pts = [3, 2, 1, 0];
  return teamSeats.reduce((sum: number, seat) => sum + pts[rank.indexOf(seat)]!, 0);
}

describe('新 AI vs 老 AI 对打', () => {
  it(`新队胜率 ≥ 60%（${GAMES} 局，轮换座位）`, () => {
    let newWins = 0, ties = 0, newPointsTotal = 0;
    for (let g = 0; g < GAMES; g++) {
      // 偶数局：新队={0,2}；奇数局：新队={1,3}（消除位次偏置）
      const newSeats: Seat[] = g % 2 === 0 ? [0, 2] : [1, 3];
      const isNew = (seat: Seat) => newSeats.includes(seat);
      const rank = playDeal(g, (seat) => (isNew(seat) ? choosePlay : legacyChoosePlay));
      const np = teamPoints(rank, newSeats);
      const op = 6 - np; // 总分恒为 3+2+1+0=6
      newPointsTotal += np;
      if (np > op) newWins++; else if (np === op) ties++;
    }
    const winRate = newWins / GAMES;
    const avgNewPoints = newPointsTotal / GAMES;
    // eslint-disable-next-line no-console
    console.log(`新队胜率=${(winRate * 100).toFixed(1)}% 平局=${ties} 平均队分=${avgNewPoints.toFixed(2)}/6`);
    expect(winRate).toBeGreaterThanOrEqual(0.6);
    expect(avgNewPoints).toBeGreaterThan(3); // 平均强于均势(3)
  });
});
