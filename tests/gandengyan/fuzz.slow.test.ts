import { describe, it, expect } from 'vitest';
import { createDeal, play, pass, isDealOver, settle } from '../../src/games/gandengyan/engine/game';
import type { DealState } from '../../src/games/gandengyan/engine/game';
import { enumerateLeads, enumerateFollows, isLegalPlay } from '../../src/games/gandengyan/engine/legal';
import { makeDeck, dealHands } from '../../src/games/gandengyan/engine/cards';
import type { Seat } from '../../src/games/gandengyan/engine/types';
import { makeLCG, seededShuffle } from '../helpers/rng';
import { slowCount } from '../helpers/slow-knobs';

/**
 * 干瞪眼单局引擎的模糊测试：随机对局跑到底，用不变量罩住整个状态机。
 *
 * 跟掼蛋那套最大的区别在**终止性怎么保证**。掼蛋的模糊测试靠一个步数上限抛错，
 * 把终止当异常闸门；干瞪眼里「全圈无人能动 → 本局终止」是**正常路径**。
 * 照抄的后果是：一旦枚举器漏解，僵局会被提前误判，本局看似正常结束、步数远不到上限，
 * 测试全绿而 bug 直达生产。所以这里除了守恒与合法性，还必须有**分支命中计数器**——
 * 跑完要能说出「僵局命中几局、出牌权顺延几次、王炸出过几次」，
 * 顺延一次都没命中就直接判失败：那说明这条规则的绿灯是假的。
 */

const DECK_SIZE = 54;
/**
 * 默认 4000 局（约 22 秒）。这个数字是量出来的，不是拍的：
 * 种子固定为 `0..GAMES-1`，所以命中分布每次跑都一样，不会 flaky。
 * 600 局时僵局 0 次、顺延 2 次；4000 局时僵局 2 次、顺延 18 次、王炸 110 次——
 * 稀有分支要有足够余量，闸门才不会因为一点无关改动就掉到 0。
 */
const GAMES = slowCount('GDY_FUZZ_GAMES', 4000);

/**
 * 步数上界，按座位数推出来，不是拍脑袋的常数：
 * - 出牌步 ≤ 54：每次出牌至少去掉一张，而手牌前后总共只经手过这副牌的 54 张
 * - 跟牌过：每次出牌之后最多 (座位数-1) 次就结束本轮
 * - 顺延过：成串出现，每串 ≤ 座位数（第 座位数 次即终止本局），串被出牌隔开，故 ≤ (54+1) 串
 * 合计 ≤ 54 + 54×(座位数-1) + (54+1)×座位数 = 109 × 座位数
 */
function stepBound(seatCount: number): number {
  return DECK_SIZE * seatCount + (DECK_SIZE + 1) * seatCount;
}

function totalCards(s: DealState): number {
  return s.deck.length + s.hands.reduce((n, h) => n + h.length, 0) + s.played.length;
}

/**
 * 三种打法。**多打法是模糊测试的标准做法，不是为了凑命中数**——单一策略只会
 * 反复走同一片状态空间。实测：全用均匀随机时，4000 局才命中 1 次出牌权顺延、
 * 0 次僵局，因为均匀随机会把王早早当百搭甩出去；而「最后剩一张王」恰恰是
 * 「留着王当百搭、小步慢走」这种打法才会走到的结局，也是真实牌桌上很常见的一种。
 */
type Style = 'random' | 'hoardWild' | 'dumpBig';

/** 从候选里挑一手。`options` 非空。 */
function chooseIndex(options: readonly { cards: readonly unknown[]; assign: readonly unknown[] }[], style: Style, rnd: () => number): number {
  if (style === 'random') return rnd() % options.length;

  const score = (i: number): number => {
    const o = options[i]!;
    return style === 'hoardWild'
      ? o.cards.length * 10 + o.assign.length * 100   // 出得越少越好，且尽量别动王
      : -o.cards.length;                               // dumpBig：一次多甩
  };
  let best = 0;
  for (let i = 1; i < options.length; i++) if (score(i) < score(best)) best = i;
  return best;
}

interface Counters {
  deals: number;
  stalemates: number;
  leadPasses: number;
  jokerBombs: number;
  springs: number;
  bySeatCount: Map<number, number>;
}

/** 跑完一局，逐步校验不变量。任何异常都带上局号/步数/座位/种子，可单种子复现。 */
function playOneDeal(seed: number, counters: Counters): void {
  const seatCount = 2 + (seed % 4);            // 2~5 人，每档都跑到
  const dealer: Seat = seed % seatCount;
  const { hands, deck } = dealHands(makeDeck(), seatCount, dealer, seededShuffle(seed));
  let s = createDeal({ hands, deck, dealer });

  const where = (step: number, seat: number): string =>
    `seed=${seed} 局=${seed} 步=${step} 座=${seat} 人数=${seatCount}`;

  expect(totalCards(s), `${where(0, dealer)}：开局牌数不对`).toBe(DECK_SIZE);
  counters.bySeatCount.set(seatCount, (counters.bySeatCount.get(seatCount) ?? 0) + 1);

  const rnd = makeLCG(seed ^ 0x5eed);
  const bound = stepBound(seatCount);
  let step = 0;

  // 同一局里各座打法不同，尽量把状态空间铺开
  const STYLES: Style[] = ['random', 'hoardWild', 'dumpBig'];
  const styleOf = (seat: number): Style => STYLES[(seed + seat) % STYLES.length]!;

  while (!isDealOver(s)) {
    if (step >= bound) {
      throw new Error(`${where(step, s.turn)}：步数超上界（实际 ${step} / 理论上界 ${bound}）`);
    }
    const prev = s;
    const seat = prev.turn;
    const hand = prev.hands[seat]!;

    if (prev.current === null) {
      const options = enumerateLeads(hand);
      if (options.length === 0) {
        s = pass(prev, seat);                  // 领出方确实无牌可出 → 顺延
        counters.leadPasses++;
        expect(s.leadPassesInRow, `${where(step, seat)}：顺延计数没往上走`)
          .toBe(prev.leadPassesInRow + 1);
      } else {
        const p = options[chooseIndex(options, styleOf(seat), rnd)]!;
        expect(isLegalPlay(hand, p.cards, p.assign, null), `${where(step, seat)}：领出的一手不合法`).toBe(true);
        s = play(prev, seat, p.cards, p.assign);
        if (p.combo.type === 'jokerBomb') counters.jokerBombs++;
      }
    } else {
      const options = enumerateFollows(hand, prev.current.combo);
      // 要得起也允许过：留一成概率走这条路，把「憋牌」这一层也跑到
      if (options.length === 0 || rnd() % 10 === 0) {
        s = pass(prev, seat);
      } else {
        const p = options[chooseIndex(options, styleOf(seat), rnd)]!;
        expect(isLegalPlay(hand, p.cards, p.assign, prev.current.combo), `${where(step, seat)}：跟的一手压不住`).toBe(true);
        s = play(prev, seat, p.cards, p.assign);
        if (p.combo.type === 'jokerBomb') counters.jokerBombs++;
      }
    }

    // ── 每一步都要成立的不变量 ──
    expect(totalCards(s), `${where(step, seat)}：牌数不守恒`).toBe(DECK_SIZE);
    expect(s.deck.length, `${where(step, seat)}：牌堆变多了`).toBeLessThanOrEqual(prev.deck.length);
    expect(prev.deck.length - s.deck.length, `${where(step, seat)}：一步摸了不止一张`).toBeLessThanOrEqual(1);
    expect(s.turn, `${where(step, seat)}：轮次越界`).toBeGreaterThanOrEqual(0);
    expect(s.turn, `${where(step, seat)}：轮次越界`).toBeLessThan(seatCount);
    expect(s.passesInRow, `${where(step, seat)}：过牌计数越界`).toBeLessThan(seatCount);

    const played = s.played.length > prev.played.length;
    if (played) {
      expect(s.passesInRow, `${where(step, seat)}：有人出牌后过牌计数没归零`).toBe(0);
      expect(s.leadPassesInRow, `${where(step, seat)}：有人出牌后顺延计数没归零`).toBe(0);
      expect(s.hands[seat]!.length, `${where(step, seat)}：出了牌手牌却没变少`).toBeLessThan(hand.length);
    } else {
      // 没人出牌 → 必然是过牌，两个计数至少有一个往上走（或本轮/本局就此结束）
      const advanced = s.passesInRow > prev.passesInRow
        || s.leadPassesInRow > prev.leadPassesInRow
        || s.current === null && prev.current !== null   // 一轮结束
        || isDealOver(s);
      expect(advanced, `${where(step, seat)}：既没出牌也没推进任何计数`).toBe(true);
    }

    step++;
  }

  // ── 局终不变量 ──
  counters.deals++;
  if (s.stalemate) counters.stalemates++;

  const r = settle(s, 1);
  expect(r.gain, `${where(step, s.turn)}：结算不零和`).toBe(r.pay.reduce((a, b) => a + b, 0));

  if (r.winner === null) {
    expect(s.stalemate, `${where(step, s.turn)}：没有赢家却不是僵局`).toBe(true);
    expect(r.pay.every((p) => p === 0), `${where(step, s.turn)}：并列僵局却有人赔分`).toBe(true);
    expect(r.gain).toBe(0);
  } else {
    expect(r.pay[r.winner], `${where(step, s.turn)}：赢家不该赔分`).toBe(0);
    if (!s.stalemate) {
      expect(s.hands[r.winner]!.length, `${where(step, s.turn)}：赢家手里还有牌`).toBe(0);
    }
    for (let seat = 0; seat < seatCount; seat++) {
      if (seat === r.winner) continue;
      if (!s.hasPlayed[seat]) counters.springs++;
      expect(r.pay[seat], `${where(step, seat)}：输家赔付应为正`).toBeGreaterThan(0);
    }
  }
}

describe('干瞪眼单局模糊测试', () => {
  it(`跑 ${GAMES} 局随机对局：全程守恒、合法、必定终止`, () => {
    const counters: Counters = {
      deals: 0, stalemates: 0, leadPasses: 0, jokerBombs: 0, springs: 0, bySeatCount: new Map(),
    };

    for (let seed = 0; seed < GAMES; seed++) playOneDeal(seed, counters);

    // eslint-disable-next-line no-console
    console.log(
      `干瞪眼 fuzz：${counters.deals} 局｜僵局 ${counters.stalemates}｜出牌权顺延 ${counters.leadPasses} 次｜`
      + `王炸 ${counters.jokerBombs} 次｜春天 ${counters.springs} 次｜`
      + `人数分布 ${[...counters.bySeatCount.entries()].sort().map(([k, v]) => `${k}人:${v}`).join(' ')}`,
    );

    expect(counters.deals).toBe(GAMES);

    // 2~5 人每档都得真跑到，否则「座位数进维度」只是句口号
    for (const seatCount of [2, 3, 4, 5]) {
      expect(counters.bySeatCount.get(seatCount) ?? 0, `${seatCount} 人局一次都没跑到`).toBeGreaterThan(0);
    }

    // 分支命中计数器：一次都没触达 = 这条规则的绿灯是假的
    expect(counters.leadPasses, '出牌权顺延一次都没命中——僵局那条路等于没被 fuzz 覆盖过').toBeGreaterThan(0);
    expect(counters.jokerBombs, '王炸一次都没出过').toBeGreaterThan(0);
    // 「本局以僵局收场」只报不断言：它比顺延还稀有（要 2 人局双方同时只剩一张王），
    // 命中数会随局数变动，硬断言等于把默认局数变成载荷。这条路另有定向用例守着
    // （tests/gandengyan/stalemate.test.ts，在快轨）。
  });
});
