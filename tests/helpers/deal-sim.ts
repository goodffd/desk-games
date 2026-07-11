/**
 * AI 对打模拟台架（供 ai-improvement 基准用）。
 * 忠实单局：按座位策略跑完一整局，统计头游胜率 / 双下率 / 平均升级。
 * 座位轮换消除位次偏置（偶数局新队={0,2}，奇数局={1,3}）。
 */
import { makeDeck, deal } from '../../src/games/guandan/engine/cards';
import { createDeal, play, pass, isDealOver, ranking, type DealState } from '../../src/games/guandan/engine/game';
import type { Card, Rank, Seat } from '../../src/games/guandan/engine/types';

export type Policy = (s: DealState, seat: Seat) => Card[] | null;

const LEVEL: Rank = 2;
const MAX_STEPS = 4000;

export function makeLCG(seed: number): () => number {
  let st = seed >>> 0;
  return () => (st = (Math.imul(st, 1664525) + 1013904223) >>> 0);
}
export function seededShuffle(seed: number) {
  return (n: number): number[] => {
    const next = makeLCG(seed);
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = next() % (i + 1); [p[i], p[j]] = [p[j]!, p[i]!]; }
    return p;
  };
}

/** 跑一整局，按座位策略出牌，返回 ranking（头游→末游）。 */
export function playDeal(seed: number, policyOf: (seat: Seat) => Policy): Seat[] {
  const hands = deal(makeDeck(), seededShuffle(seed));
  const firstLeader = (makeLCG(seed + 0xbeef)() % 4) as Seat;
  let s = createDeal(hands, firstLeader, LEVEL);
  for (let step = 0; step < MAX_STEPS && !isDealOver(s); step++) {
    const seat = s.turn;
    const chosen = policyOf(seat)(s, seat);
    s = chosen === null ? pass(s, seat) : play(s, seat, chosen);
  }
  return ranking(s);
}

/** 头游在本队 → 升级数（队友二游 3=双下 / 三游 2 / 末游 1）；头游在对家 → 0。 */
export function teamUpgrade(rank: Seat[], teamSeats: Seat[]): number {
  const champion = rank[0]!;
  if (!teamSeats.includes(champion)) return 0;
  const partner = teamSeats.find(seat => seat !== champion)!;
  const partnerPlace = rank.indexOf(partner); // 1=二游 2=三游 3=末游
  return 4 - partnerPlace;
}

export interface BenchResult {
  winRate: number;       // "新队"头游胜率
  doubleDownRate: number; // "新队"双下率（升3级）
  avgUpgrade: number;     // "新队"平均升级级数
  games: number;
}

/** newPolicy 队 vs oldPolicy 队，games 局轮换座位。返回新队统计。 */
export function benchmark(newPolicy: Policy, oldPolicy: Policy, games: number): BenchResult {
  let newWins = 0, doubleDowns = 0, upgradeTotal = 0;
  for (let g = 0; g < games; g++) {
    const newSeats: Seat[] = g % 2 === 0 ? [0, 2] : [1, 3];
    const isNew = (seat: Seat) => newSeats.includes(seat);
    const rank = playDeal(g, (seat) => (isNew(seat) ? newPolicy : oldPolicy));
    const up = teamUpgrade(rank, newSeats);
    upgradeTotal += up;
    if (rank[0]! === newSeats[0]! || rank[0]! === newSeats[1]!) newWins++;
    if (up === 3) doubleDowns++;
  }
  return { winRate: newWins / games, doubleDownRate: doubleDowns / games, avgUpgrade: upgradeTotal / games, games };
}
