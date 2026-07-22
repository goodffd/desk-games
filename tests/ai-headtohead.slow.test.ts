import { describe, it, expect } from 'vitest';
import { makeDeck, deal } from '../src/games/guandan/engine/cards';
import { createDeal, play, pass, isDealOver, ranking, type DealState } from '../src/games/guandan/engine/game';
import { choosePlay } from '../src/games/guandan/ai/ai';
import { legacyChoosePlay } from './helpers/legacy-ai';
import { makeLCG, seededShuffle } from './helpers/rng';
import { slowCount } from './helpers/slow-knobs';
import type { Rank, Seat } from '../src/games/guandan/engine/types';

const LEVEL: Rank = 2;
const GAMES = slowCount('BENCH_GAMES', 500);
const MAX_STEPS = 2000;
type Policy = (s: DealState, seat: Seat) => ReturnType<typeof choosePlay>;

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

/**
 * 忠实掼蛋头游制：头游（ranking[0]）所在的队赢这一局，无平局。
 * 升级级数看队友名次（队友排第几名，rank 用 0-based 索引）：
 *   - 头游队的两人占 1名+2名（双下）→ 升 3 级
 *   - 头游队占 1名+3名 → 升 2 级
 *   - 头游队占 1名+4名 → 升 1 级
 *   - 头游在对家 → 本队 0 级
 * @returns 新队这一局的升级级数（0/1/2/3）。
 */
function teamUpgrade(rank: Seat[], teamSeats: Seat[]): number {
  const champion = rank[0]!; // 头游座位
  if (!teamSeats.includes(champion)) return 0; // 头游在对家，本队不赢
  // 头游在本队：队友（另一个本队座位）的名次（0-based finish 索引）决定级数
  const partner = teamSeats.find(seat => seat !== champion)!;
  const partnerPlace = rank.indexOf(partner); // 0=1名 1=2名 2=3名 3=4名
  // partnerPlace=1 → 双下升3；=2 → 升2；=3 → 升1
  return 4 - partnerPlace;
}

describe('新 AI vs 老 AI 对打', () => {
  it(`新队头游胜率 ≥ 60%（${GAMES} 局，轮换座位）`, () => {
    let newWins = 0; // 头游 ∈ 新队的局数（忠实头游制，无平局）
    let doubleDowns = 0; // 新队拿 1名+2名（双下）的局数
    let upgradeTotal = 0; // 新队升级级数总和（含 0 级的输局）
    for (let g = 0; g < GAMES; g++) {
      // 偶数局：新队={0,2}；奇数局：新队={1,3}（消除位次偏置）
      const newSeats: Seat[] = g % 2 === 0 ? [0, 2] : [1, 3];
      const isNew = (seat: Seat) => newSeats.includes(seat);
      const rank = playDeal(g, (seat) => (isNew(seat) ? choosePlay : legacyChoosePlay));
      const up = teamUpgrade(rank, newSeats);
      upgradeTotal += up;
      if (rank[0]! === newSeats[0]! || rank[0]! === newSeats[1]!) newWins++; // 头游 ∈ 新队 = 赢
      if (up === 3) doubleDowns++; // 升 3 级 = 双下（1名+2名）
    }
    const winRate = newWins / GAMES;
    const avgUpgrade = upgradeTotal / GAMES;
    const doubleDownRate = doubleDowns / GAMES;
    // eslint-disable-next-line no-console
    console.log(
      `新队头游胜率=${(winRate * 100).toFixed(1)}% ` +
      `平均升级=${avgUpgrade.toFixed(2)}级 ` +
      `双下率=${(doubleDownRate * 100).toFixed(1)}%`,
    );
    expect(winRate).toBeGreaterThanOrEqual(0.6);
  });
});
