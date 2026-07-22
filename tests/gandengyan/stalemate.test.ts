import { describe, it, expect } from 'vitest';
import { createDeal, play, pass, isDealOver, settle } from '../../src/games/gandengyan/engine/game';
import type { DealState } from '../../src/games/gandengyan/engine/game';
import { hasAnyPlay } from '../../src/games/gandengyan/engine/legal';
import { identify, beats } from '../../src/games/gandengyan/engine/combos';
import { makeDeck } from '../../src/games/gandengyan/engine/cards';
import type { Card, Combo, Rank, Seat, WildAssign } from '../../src/games/gandengyan/engine/types';
import { seededShuffle } from '../helpers/rng';
import { cards } from './mk';

function deal(hands: string[], opts: { dealer?: Seat; deck?: string } = {}): DealState {
  return createDeal({
    hands: hands.map((h) => cards(h)),
    deck: opts.deck ? cards(opts.deck) : [],
    dealer: opts.dealer ?? 0,
  });
}

function pick(s: DealState, seat: Seat, spec: string): Card[] {
  const want = spec.trim().split(/\s+/);
  const hand = [...s.hands[seat]!];
  return want.map((tok) => {
    const R: Record<string, number> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
    const suit = tok[0]!;
    const rank = R[tok.slice(1)!] ?? Number(tok.slice(1));
    const i = hand.findIndex((c) => c.kind === 'normal' && c.suit === suit && c.rank === rank);
    if (i < 0) throw new Error(`座 ${seat} 手里没有 ${tok}`);
    return hand.splice(i, 1)[0]!;
  });
}

const WILD_RANKS: Rank[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/**
 * 独立 oracle：这手牌在当前语境下到底有没有牌可出？
 *
 * **暴力穷举所有子集 × 所有指派**，走的是跟引擎完全无关的一条路。
 * 这条独立性是本票的要害：僵局判定若拿引擎自己的枚举器去验，等于同义反复——
 * 枚举器一旦漏解，僵局会被**提前误判**，本局正常结束、步数远不到上限，
 * 于是测试全绿而 bug 直达生产。那是这类引擎最阴的一种错法。
 */
function bruteForceHasPlay(hand: readonly Card[], current: Combo | null): boolean {
  const n = hand.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset: Card[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(hand[i]!);
    const jokers = subset.filter((c) => c.kind === 'joker');

    const ok = (assign: WildAssign[]): boolean => {
      const combo = identify(subset, assign);
      if (!combo) return false;
      return current === null || beats(current, combo);
    };

    if (ok([])) return true;
    if (jokers.length === 1) {
      for (const r of WILD_RANKS) if (ok([{ jokerId: jokers[0]!.id, rank: r }])) return true;
    } else if (jokers.length === 2) {
      for (const a of WILD_RANKS) {
        for (const b of WILD_RANKS) {
          if (ok([{ jokerId: jokers[0]!.id, rank: a }, { jokerId: jokers[1]!.id, rank: b }])) return true;
        }
      }
    }
  }
  return false;
}

describe('hasAnyPlay 与独立的暴力穷举逐个对照', () => {
  it('只剩一张王 → 领出时确实无牌可出', () => {
    expect(hasAnyPlay(cards('jB'), null)).toBe(false);
    expect(bruteForceHasPlay(cards('jB'), null)).toBe(false);
  });

  it('两张王 → 领出时出得了（王炸）', () => {
    expect(hasAnyPlay(cards('jB jS'), null)).toBe(true);
    expect(bruteForceHasPlay(cards('jB jS'), null)).toBe(true);
  });

  it('只要手里还有一张普通牌，领出就永远卡不住', () => {
    for (const spec of ['S3', 'S2', 'jB S9', 'jB jS SA', 'S3 H7 DK']) {
      expect(hasAnyPlay(cards(spec), null)).toBe(true);
    }
  });

  it('随机手牌 × 各种桌面牌，两条独立实现全部一致', () => {
    const contexts: (Combo | null)[] = [
      null,
      identify(cards('S7')),
      identify(cards('S2')),
      identify(cards('S7 H7')),
      identify(cards('S3 H4 D5')),
      identify(cards('S9 H9 D9')),
      identify(cards('S9 H9 D9 C9')),
      identify(cards('jB jS')),
    ];
    const deck = makeDeck();
    let checked = 0;
    for (let seed = 0; seed < 40; seed++) {
      const size = 1 + (seed % 6);                       // 1~6 张，含只剩一张的极端
      const hand = seededShuffle(seed)(deck.length).slice(0, size).map((i) => deck[i]!);
      for (const cur of contexts) {
        expect(
          hasAnyPlay(hand, cur),
          `seed=${seed} 手牌=[${hand.map((c) => c.id).join(',')}] 桌面=${cur ? cur.type : '空'}`,
        ).toBe(bruteForceHasPlay(hand, cur));
        checked++;
      }
    }
    expect(checked).toBe(320); // 确实跑了这么多组，不是循环没进去
  });
});

describe('领出方无牌可出 → 允许过牌，出牌权顺延', () => {
  it('只剩一张王的人轮到领出时可以过，权交下家，仍是领出状态', () => {
    const s0 = deal(['jB', 'S5 H6', 'S8 H9'], { dealer: 0 });
    const s1 = pass(s0, 0);
    expect(s1.turn).toBe(1);
    expect(s1.current).toBeNull();
    expect(isDealOver(s1)).toBe(false);
  });

  it('出得了的人在领出时仍然不许过', () => {
    const s0 = deal(['S5 H6', 'S8 H9'], { dealer: 0 });
    expect(() => pass(s0, 0)).toThrow(/必须出牌/);
  });

  it('顺延到出得了的人手上，牌局照常继续', () => {
    const s0 = deal(['jB', 'S5 H6', 'S8 H9'], { dealer: 0 });
    let s = pass(s0, 0);
    s = play(s, 1, pick(s, 1, 'S5'));
    expect(s.current!.by).toBe(1);
    expect(s.turn).toBe(2);
  });

  it('有人出牌后，顺延计数清零（不会攒到误判僵局）', () => {
    const s0 = deal(['jB', 'S5 H6', 'jS'], { dealer: 0 });
    let s = pass(s0, 0);              // 座 0 卡住
    s = play(s, 1, pick(s, 1, 'S5')); // 座 1 出牌 → 计数清零
    expect(s.leadPassesInRow).toBe(0);
    expect(isDealOver(s)).toBe(false);
  });
});

describe('全圈无人能动 → 本局终止', () => {
  it('2 人局、牌堆空、双方各剩一张王 —— 不会死循环', () => {
    let s = deal(['jB', 'jS'], { dealer: 0, deck: '' });
    s = pass(s, 0);
    expect(isDealOver(s)).toBe(false);   // 才转了一家，还没绕完一圈
    s = pass(s, 1);
    expect(isDealOver(s)).toBe(true);
    expect(s.stalemate).toBe(true);
  });

  it('并列最少 → 本局无人收分', () => {
    let s = deal(['jB', 'jS'], { dealer: 0, deck: '' });
    s = pass(s, 0);
    s = pass(s, 1);
    const r = settle(s, 1);
    expect(r.winner).toBeNull();
    expect(r.pay).toEqual([0, 0]);
    expect(r.gain).toBe(0);
  });

  it('僵局终止后不能再出牌或过牌', () => {
    let s = deal(['jB', 'jS'], { dealer: 0, deck: '' });
    s = pass(s, 0);
    s = pass(s, 1);
    expect(() => pass(s, 0)).toThrow(/已结束/);
  });

  it('牌堆还有牌也照样终止——没人能出牌就摸不到牌', () => {
    // 摸牌只发生在一轮结束时、且只有该轮赢家摸。全员卡住时根本产生不了赢家。
    let s = deal(['jB', 'jS'], { dealer: 0, deck: 'S3 H4 D5' });
    s = pass(s, 0);
    s = pass(s, 1);
    expect(s.stalemate).toBe(true);
    expect(s.deck).toHaveLength(3);
  });
});

describe('单副牌下僵局的可达范围（结构性事实，别被将来的改动悄悄推翻）', () => {
  it('卡住的手牌有且只有「恰好一张王」', () => {
    // 领出可以出任意合法牌型，而任何一张普通牌都是合法单张 → 有普通牌就卡不住；
    // 两张王能出王炸 → 也卡不住。于是卡住 ⟺ 手里正好一张王。
    expect(hasAnyPlay(cards('jB'), null)).toBe(false);
    expect(hasAnyPlay(cards('jS'), null)).toBe(false);
    expect(hasAnyPlay(cards('jB jS'), null)).toBe(true);
    for (const spec of ['S3', 'jB S3', 'jB jS S3']) expect(hasAnyPlay(cards(spec), null)).toBe(true);
  });

  it('一副牌只有两张王 → 3 人以上不可能全圈卡死', () => {
    // 三家要同时卡住得有三个「只剩一张王」的人，牌不够。这里正面验一次：
    // 三人局里就算两家各持一张王，第三家只要有普通牌就能领出，牌局继续。
    let s = deal(['jB', 'jS', 'S3'], { dealer: 0, deck: '' });
    s = pass(s, 0);
    s = pass(s, 1);
    expect(isDealOver(s)).toBe(false);      // 轮到座 2，它出得了
    expect(hasAnyPlay(s.hands[2]!, null)).toBe(true);
    expect(() => pass(s, 2)).toThrow(/必须出牌/);
  });
});

describe('定向用例：#5 起就挂着的那个卡死路径', () => {
  it('手持「大王 + 5」，跟牌出掉 5 拿到出牌权后只剩一张王 → 能过，不卡死', () => {
    const s0 = deal(['S4 H8', 'jB S5', 'S9 HT'], { dealer: 0, deck: '' });
    let s = play(s0, 0, pick(s0, 0, 'S4'));   // 座 0 领出单张 4
    s = play(s, 1, pick(s, 1, 'S5'));         // 座 1 跟单张 5（大一）
    expect(s.hands[1]).toHaveLength(1);       // 座 1 只剩一张王

    s = pass(s, 2);                            // 座 2 跟不上 6
    s = pass(s, 0);                            // 座 0 也跟不上
    expect(s.turn).toBe(1);                    // 座 1 赢下这轮，轮到它领出
    expect(s.current).toBeNull();
    expect(s.deck).toHaveLength(0);            // 牌堆空，摸不到牌解套

    // 换成 #8 之前的规则，这里就彻底卡死了：出不了，也不许过
    expect(hasAnyPlay(s.hands[1]!, null)).toBe(false);
    s = pass(s, 1);
    expect(s.turn).toBe(2);
    expect(isDealOver(s)).toBe(false);         // 座 2 手里有普通牌，牌局继续
  });
});
