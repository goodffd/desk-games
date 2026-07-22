import { describe, it, expect } from 'vitest';
import { createDeal, play, pass, isDealOver, settle } from '../../src/games/gandengyan/engine/game';
import type { DealState } from '../../src/games/gandengyan/engine/game';
import type { Card, Seat } from '../../src/games/gandengyan/engine/types';
import { cards } from './mk';

/** 用构造手牌开一局；牌堆可给可不给（不给=牌堆已空） */
function deal(hands: string[], opts: { dealer?: Seat; deck?: string } = {}): DealState {
  return createDeal({
    hands: hands.map((h) => cards(h)),
    deck: opts.deck ? cards(opts.deck) : [],
    dealer: opts.dealer ?? 0,
  });
}

/** 守恒：牌堆 + 各家手牌 + 已出牌，一张不多一张不少 */
function totalCards(s: DealState): number {
  return s.deck.length + s.hands.reduce((n, h) => n + h.length, 0) + s.played.length;
}

/** 按牌面挑出手里的某几张（测试里按 'S5 H5' 这种写法出牌） */
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

describe('createDeal — 开局', () => {
  it('庄先领出，桌面为空', () => {
    const s = deal(['S3 H4', 'S5 H6', 'S7 H8'], { dealer: 2 });
    expect(s.turn).toBe(2);
    expect(s.current).toBeNull();
    expect(s.winner).toBeNull();
    expect(isDealOver(s)).toBe(false);
  });

  it('座位数取自手牌数组长度', () => {
    expect(deal(['S3', 'S4']).seatCount).toBe(2);
    expect(deal(['S3', 'S4', 'S5', 'S6', 'S7']).seatCount).toBe(5);
  });
});

describe('出牌与跟牌', () => {
  it('领出可以是任意合法牌型', () => {
    const s0 = deal(['S3 H3 D9', 'S5 H6 D7']);
    const s1 = play(s0, 0, pick(s0, 0, 'S3 H3'));
    expect(s1.current).toMatchObject({ by: 0 });
    expect(s1.current!.combo).toMatchObject({ type: 'pair', key: 3 });
    expect(s1.turn).toBe(1);
    expect(s1.hands[0]).toHaveLength(1);
  });

  it('跟牌必须大一级', () => {
    const s0 = deal(['S5 H9', 'S6 H8 DA']);
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    expect(() => play(s1, 1, pick(s1, 1, 'H8'))).toThrow(/压不住|不合法/);
    expect(() => play(s1, 1, pick(s1, 1, 'DA'))).toThrow(/压不住|不合法/);
    const s2 = play(s1, 1, pick(s1, 1, 'S6'));
    expect(s2.current!.combo.key).toBe(6);
  });

  it('不是自己的回合不能出牌', () => {
    const s0 = deal(['S5 H9', 'S6 H8']);
    expect(() => play(s0, 1, pick(s0, 1, 'S6'))).toThrow(/回合/);
  });

  it('不能出手里没有的牌', () => {
    const s0 = deal(['S5 H9', 'S6 H8']);
    const notMine = cards('DK');
    expect(() => play(s0, 0, notMine)).toThrow(/手里/);
  });

  it('不成牌型的一把牌出不出去', () => {
    const s0 = deal(['S5 H9', 'S6 H8']);
    expect(() => play(s0, 0, pick(s0, 0, 'S5 H9'))).toThrow(/不合法|牌型/);
  });

  it('出牌后守恒：手牌减少的正好进了已出牌', () => {
    const s0 = deal(['S3 H3 D9', 'S5 H6 D7'], { deck: 'C2 CK' });
    const before = totalCards(s0);
    const s1 = play(s0, 0, pick(s0, 0, 'S3 H3'));
    expect(totalCards(s1)).toBe(before);
    expect(s1.played).toHaveLength(2);
  });

  it('不改动传入的状态（纯函数）', () => {
    const s0 = deal(['S3 H3 D9', 'S5 H6 D7']);
    const handBefore = s0.hands[0]!.length;
    play(s0, 0, pick(s0, 0, 'S3 H3'));
    expect(s0.hands[0]).toHaveLength(handBefore);
    expect(s0.current).toBeNull();
  });
});

describe('过牌', () => {
  it('领出时不能过牌', () => {
    const s0 = deal(['S5 H9', 'S6 H8']);
    expect(() => pass(s0, 0)).toThrow(/领出/);
  });

  it('跟牌时要得起也可以过牌', () => {
    const s0 = deal(['S5 H9', 'S6 H8', 'SK HQ']);
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    const s2 = pass(s1, 1);            // 座 1 手里有 6，压得住，但选择不出
    expect(s2.turn).toBe(2);
    expect(s2.hands[1]).toHaveLength(2);
  });

  it('不是自己的回合不能过牌', () => {
    const s0 = deal(['S5 H9', 'S6 H8']);
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    expect(() => pass(s1, 0)).toThrow(/回合/);
  });
});

describe('一轮结束：只有该轮赢家摸 1 张，并由他领出下一轮', () => {
  it('3 人局：其余两家都过 → 出牌者摸 1 张、拿到出牌权', () => {
    const s0 = deal(['S5 H9', 'S6 H8', 'SK HQ'], { deck: 'C7 C8' });
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    const s2 = pass(s1, 1);
    const s3 = pass(s2, 2);

    expect(s3.current).toBeNull();       // 新一轮，桌面清空
    expect(s3.turn).toBe(0);             // 由该轮赢家领出
    expect(s3.hands[0]).toHaveLength(2); // 出掉 1 张又摸回 1 张
    expect(s3.hands[1]).toHaveLength(2); // 别人一张不摸
    expect(s3.hands[2]).toHaveLength(2);
    expect(s3.deck).toHaveLength(1);
  });

  it('2 人局：对手一过就结束本轮', () => {
    const s0 = deal(['S5 H9', 'S6 H8'], { deck: 'C7' });
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    const s2 = pass(s1, 1);
    expect(s2.current).toBeNull();
    expect(s2.turn).toBe(0);
    expect(s2.hands[0]).toHaveLength(2);
    expect(s2.deck).toHaveLength(0);
  });

  it('该轮赢家是最后出牌的人，不一定是领出的人', () => {
    const s0 = deal(['S5 H9', 'S6 H8', 'SK HQ'], { deck: 'C7' });
    let s = play(s0, 0, pick(s0, 0, 'S5'));
    s = play(s, 1, pick(s, 1, 'S6'));   // 座 1 压上
    s = pass(s, 2);
    s = pass(s, 0);
    expect(s.turn).toBe(1);              // 座 1 赢下这轮
    expect(s.hands[1]).toHaveLength(2);  // 出 1 摸 1
    expect(s.hands[0]).toHaveLength(1);
  });

  it('牌堆见底后不再补：轮照常结束，只是没得摸', () => {
    const s0 = deal(['S5 H9', 'S6 H8'], { deck: '' });
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    const s2 = pass(s1, 1);
    expect(s2.deck).toHaveLength(0);
    expect(s2.hands[0]).toHaveLength(1); // 出掉了就是出掉了，没得补
    expect(s2.turn).toBe(0);
  });

  it('整轮全程守恒', () => {
    const s0 = deal(['S5 H9', 'S6 H8', 'SK HQ'], { deck: 'C7 C8' });
    const before = totalCards(s0);
    let s = play(s0, 0, pick(s0, 0, 'S5'));
    expect(totalCards(s)).toBe(before);
    s = pass(s, 1); expect(totalCards(s)).toBe(before);
    s = pass(s, 2); expect(totalCards(s)).toBe(before);
  });
});

describe('局终：先打完手牌者赢，本局立刻结束', () => {
  it('打空手牌即胜，不再排后面的名次', () => {
    const s0 = deal(['S5', 'S6 H8', 'SK HQ'], { deck: 'C7 C8 C9' });
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    expect(s1.winner).toBe(0);
    expect(isDealOver(s1)).toBe(true);
  });

  it('局终后不能再出牌或过牌', () => {
    const s0 = deal(['S5', 'S6 H8'], { deck: 'C7' });
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    expect(() => play(s1, 1, pick(s1, 1, 'S6'))).toThrow(/已结束/);
    expect(() => pass(s1, 1)).toThrow(/已结束/);
  });

  it('赢家不摸牌——出完就赢了，轮不到摸', () => {
    const s0 = deal(['S5', 'S6 H8'], { deck: 'C7 C8' });
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    expect(s1.hands[0]).toHaveLength(0);
    expect(s1.deck).toHaveLength(2);
  });
});

// 结算的完整规则（炸弹倍数、个人倍数、春天）见 settle.test.ts；这里只守状态机这一侧：
// 局终能算、未终止不能算、底分等比。注意这两局里输家从头到尾没出过牌 → 都吃春天 ×2。
describe('settle — 与状态机的接线', () => {
  it('输家按剩牌张数赔，赢家收各家之和', () => {
    const s0 = deal(['S5', 'S6 H8', 'SK HQ DJ']);
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    const r = settle(s1, 1);
    expect(r.winner).toBe(0);
    expect(r.pay).toEqual([0, 2 * 2, 3 * 2]);   // 两家都没出过牌 → 各吃春天 ×2
    expect(r.gain).toBe(10);
  });

  it('底分可调', () => {
    const s0 = deal(['S5', 'S6 H8']);
    const s1 = play(s0, 0, pick(s0, 0, 'S5'));
    expect(settle(s1, 10)).toMatchObject({ pay: [0, 40], gain: 40 }); // 2 张 × 春天 2 × 底分 10
  });

  it('本局没结束就结算 → 抛错', () => {
    expect(() => settle(deal(['S5 H9', 'S6 H8']), 1)).toThrow(/未结束/);
  });
});

describe('含炸弹的一整局：三个逃生口都走一遍，再打到局终', () => {
  it('单张 2 压单张 → 小炸压 2 → 大炸压小炸 → 局终', () => {
    const s0 = deal(
      ['S3 H4 D6 C7 S8 H9', 'S2 H2 S5 H5 D5', 'SA HA DA C9 CT'],
      { dealer: 0, deck: 'CJ CQ CK' },
    );
    const total = totalCards(s0);
    let s = s0;

    s = play(s, 0, pick(s, 0, 'S3'));                       // 领出单张 3
    s = play(s, 1, pick(s, 1, 'S2'));                       // 逃生口②：单张 2 压任意单张
    expect(s.current!.combo).toMatchObject({ type: 'single' });

    // 逃生口③：炸弹压任意非炸——连 2 都压得住
    s = play(s, 2, pick(s, 2, 'SA HA DA'));
    expect(s.current!.combo).toMatchObject({ type: 'bomb', length: 3, key: 14 });

    // 座 0 手里没有炸，压不住；报错必须说清是炸弹的规矩，不能拿大一法则搪塞
    expect(() => play(s, 0, pick(s, 0, 'H9'))).toThrow(/张炸/);
    s = pass(s, 0);

    // 座 1 有 3 张炸，但点数 5 压不住点数 14——同张数比点数
    expect(() => play(s, 1, pick(s, 1, 'S5 H5 D5'))).toThrow(/点数更大/);
    s = pass(s, 1);

    expect(s.turn).toBe(2);                                  // 座 2 赢下这轮
    expect(s.hands[2]).toHaveLength(3);                      // 出 3 张、摸回 1 张
    expect(totalCards(s)).toBe(total);

    // 收尾：随便打到局终，全程守恒
    let steps = 0;
    while (!isDealOver(s) && steps++ < 200) {
      const seat = s.turn;
      const hand = s.hands[seat]!;
      if (s.current === null) {
        s = play(s, seat, [hand[0]!]);
      } else {
        let moved = false;
        for (const c of hand) {
          try { s = play(s, seat, [c]); moved = true; break; } catch { /* 压不住就试下一张 */ }
        }
        if (!moved) s = pass(s, seat);
      }
      expect(totalCards(s)).toBe(total);
    }
    expect(isDealOver(s)).toBe(true);
    expect(s.hands[s.winner!]).toHaveLength(0);
  });

  it('王炸压得住 4 张炸，且没人压得住王炸', () => {
    // 座 1 给 5 张，出掉 4 张之后手里还有牌，本局才不会提前结束
    const s0 = deal(['jB jS S3', 'SA HA DA CA C9', 'S9 H9 D9 S4'], { dealer: 0, deck: 'CT' });
    let s = play(s0, 0, pick(s0, 0, 'S3'));
    s = play(s, 1, pick(s, 1, 'SA HA DA CA'));               // 4 张炸
    expect(s.hands[1]).toHaveLength(1);                      // 没打空，局还在

    // 座 2 的 3 张炸压不住 4 张炸——张数优先
    expect(() => play(s, 2, pick(s, 2, 'S9 H9 D9'))).toThrow(/张数更多/);
    s = pass(s, 2);

    // 座 0 用王炸压 4 张炸，正好打空手牌
    const jokers = s.hands[0]!.filter((c) => c.kind === 'joker');
    expect(jokers).toHaveLength(2);
    s = play(s, 0, jokers);
    expect(s.current!.combo.type).toBe('jokerBomb');
    expect(s.winner).toBe(0);
  });
});

describe('打完一整局：构造手牌，从头走到底', () => {
  it('3 人局全流程：跟牌 / 过牌 / 摸牌 / 局终，全程守恒且轮次合法', () => {
    // 座 0 庄（6 张），座 1、2 各 5 张；牌堆 3 张
    const s0 = deal(
      ['S3 H4 D5 C6 S7 H8', 'S4 H5 D6 C7 S8', 'S5 H6 D7 C8 S9'],
      { dealer: 0, deck: 'CT CJ CQ' },
    );
    const total = totalCards(s0);
    expect(s0.hands[0]).toHaveLength(6);

    let s = s0;
    let steps = 0;
    // 全场策略：轮到谁就出能压住的最小一手；压不住就过；领出就出最小的单张。
    while (!isDealOver(s) && steps++ < 200) {
      const seat = s.turn;
      const hand = s.hands[seat]!;
      let moved = false;
      if (s.current === null) {
        s = play(s, seat, [hand[0]!]);           // 领出：随手出一张
        moved = true;
      } else {
        const need = s.current.combo;
        if (need.type === 'single') {
          const hit = hand.find((c) => c.kind === 'normal' && c.rank === need.key + 1);
          if (hit) { s = play(s, seat, [hit]); moved = true; }
        }
        if (!moved) { s = pass(s, seat); moved = true; }
      }
      expect(moved).toBe(true);
      expect(totalCards(s)).toBe(total);          // 每一步都守恒
      expect(s.turn).toBeGreaterThanOrEqual(0);
      expect(s.turn).toBeLessThan(s.seatCount);
      expect(s.passesInRow).toBeLessThan(s.seatCount);
    }

    expect(isDealOver(s)).toBe(true);
    expect(s.winner).not.toBeNull();
    expect(s.hands[s.winner!]).toHaveLength(0);
    expect(totalCards(s)).toBe(total);

    const r = settle(s, 1);
    expect(r.pay[s.winner!]).toBe(0);
    expect(r.gain).toBe(r.pay.reduce((a, b) => a + b, 0));
  });
});
