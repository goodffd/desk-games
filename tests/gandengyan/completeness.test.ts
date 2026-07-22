import { describe, it, expect } from 'vitest';
import { identify, beats, comboIdentity } from '../../src/games/gandengyan/engine/combos';
import { enumerateLeads, enumerateFollows, isLegalPlay } from '../../src/games/gandengyan/engine/legal';
import { makeDeck } from '../../src/games/gandengyan/engine/cards';
import type { Card, Rank, WildAssign } from '../../src/games/gandengyan/engine/types';
import { seededShuffle } from '../helpers/rng';
import { cards } from './mk';

/**
 * 枚举器的**双向完备性**。
 *
 * 干瞪眼手牌只有 5~8 张，「所有子集 × 所有指派」可以真的暴力穷举完
 * ——这是相对掼蛋 27 张手牌的结构性优势，必须用满。
 *
 * 于是有了两个互相独立的实现：
 *   生产用 `enumerateLeads` 按牌型结构生成；测试用下面这个暴力 oracle 穷举。
 * 双向对照，任何一边漏解或多解都会当场红。**枚举器与校验器不一致**是这类引擎
 * 最容易发生也最难自查的 bug——一个说合法、另一个不产出，玩家就会遇到
 * 「这牌明明能出，界面却不让我点」。
 */

const WILD_RANKS: Rank[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

/** 暴力 oracle：穷举手牌的所有子集 × 所有指派，返回所有能认出来的牌型标识。 */
function bruteForceIdentities(hand: readonly Card[]): Set<string> {
  const out = new Set<string>();
  const n = hand.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset: Card[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(hand[i]!);
    const jokers = subset.filter((c) => c.kind === 'joker');

    const record = (assign: WildAssign[]): void => {
      const combo = identify(subset, assign);
      if (combo) out.add(comboIdentity(combo));
    };

    record([]);
    if (jokers.length === 1) {
      for (const r of WILD_RANKS) record([{ jokerId: jokers[0]!.id, rank: r }]);
    } else if (jokers.length === 2) {
      for (const a of WILD_RANKS) {
        for (const b of WILD_RANKS) {
          record([{ jokerId: jokers[0]!.id, rank: a }, { jokerId: jokers[1]!.id, rank: b }]);
        }
      }
    }
  }
  return out;
}

/** 从整副牌里按种子抓一手，控制在暴力穷举扛得住的规模 */
function randomHand(seed: number, size: number): Card[] {
  const deck = makeDeck();
  return seededShuffle(seed)(deck.length).slice(0, size).map((i) => deck[i]!);
}

describe('枚举器与暴力 oracle 双向一致', () => {
  const HANDS: { label: string; hand: Card[] }[] = [
    { label: '双王 + 三张普通牌', hand: cards('jB jS S5 H6 D7') },
    { label: '单王 + 一对', hand: cards('jB S8 H8') },
    { label: '双王 + 一对', hand: cards('jB jS S8 H8') },
    { label: '带 2 与王', hand: cards('jB S2 H2 D3') },
    { label: '四张同点 + 王', hand: cards('jB S5 H5 D5 C5') },
    { label: '一条长顺 + 王', hand: cards('jB S3 H4 D5 C6 S7') },
    { label: '全是 2', hand: cards('S2 H2 D2 C2') },
    ...Array.from({ length: 12 }, (_, i) => ({
      label: `随机手牌 seed=${i}（7 张）`,
      hand: randomHand(i, 7),
    })),
  ];

  it.each(HANDS)('$label：枚举器产出 ⊆ 暴力穷举，且暴力穷举 ⊆ 枚举器产出', ({ hand }) => {
    const structural = new Set(enumerateLeads(hand).map((p) => comboIdentity(p.combo)));
    const brute = bruteForceIdentities(hand);

    const missing = [...brute].filter((k) => !structural.has(k));
    const extra = [...structural].filter((k) => !brute.has(k));
    expect(missing, `枚举器漏了这些牌型：${missing.join(' ')}`).toEqual([]);
    expect(extra, `枚举器多产出了暴力穷举认不出的牌型：${extra.join(' ')}`).toEqual([]);
  });

  it.each(HANDS)('$label：枚举器产出的每一手都能被识别器原样认回，且牌确实在手里', ({ hand }) => {
    const handIds = new Set(hand.map((c) => c.id));
    for (const p of enumerateLeads(hand)) {
      const again = identify(p.cards, p.assign);
      expect(again).not.toBeNull();
      expect(comboIdentity(again!)).toBe(comboIdentity(p.combo));
      for (const c of p.cards) expect(handIds.has(c.id)).toBe(true);
      expect(new Set(p.cards.map((c) => c.id)).size).toBe(p.cards.length); // 同一张牌不会被用两次
      expect(isLegalPlay(hand, p.cards, p.assign, null)).toBe(true);
    }
  });
});

describe('enumerateFollows：产出的每一手都真的压得住桌面', () => {
  it.each([
    { label: '桌面单张 7', current: 'S7' },
    { label: '桌面一对 7', current: 'S7 H7' },
    { label: '桌面顺子 345', current: 'S3 H4 D5' },
    { label: '桌面 3 张炸', current: 'S9 H9 D9' },
    { label: '桌面王炸', current: 'jB jS' },
  ])('$label', ({ current }) => {
    const cur = identify(cards(current))!;
    for (let seed = 0; seed < 10; seed++) {
      const hand = randomHand(seed + 100, 7);
      const follows = enumerateFollows(hand, cur);
      for (const p of follows) {
        expect(beats(cur, p.combo)).toBe(true);
        expect(isLegalPlay(hand, p.cards, p.assign, cur)).toBe(true);
      }
      // 反向：领出能出、但压不住桌面的，一定不在 follows 里
      const leadIds = new Set(follows.map((p) => `${p.cards.map((c) => c.id).sort().join(',')}#${comboIdentity(p.combo)}`));
      for (const p of enumerateLeads(hand)) {
        const key = `${p.cards.map((c) => c.id).sort().join(',')}#${comboIdentity(p.combo)}`;
        expect(leadIds.has(key)).toBe(beats(cur, p.combo));
      }
    }
  });

  it('王炸摆在桌面上时，谁也跟不了', () => {
    const cur = identify(cards('jB jS'))!;
    for (let seed = 0; seed < 8; seed++) {
      expect(enumerateFollows(randomHand(seed + 200, 8), cur)).toHaveLength(0);
    }
  });
});
