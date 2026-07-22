import { describe, it, expect } from 'vitest';
import { createDeal, play, pass, isDealOver, settle } from '../../src/games/gandengyan/engine/game';
import type { DealState } from '../../src/games/gandengyan/engine/game';
import type { Card, Seat } from '../../src/games/gandengyan/engine/types';
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

/**
 * 结算测试一律**穿过 settle() 断言最终数字**，不去断言「本局出了几个炸」
 * 这类只为喂结算而存在的中间字段——那些是内部表示，钉死它们就是把测试焊在实现上。
 */

describe('golden 表：owner 亲自确认过的两个算例', () => {
  it('算例一：剩「大王 / 小王 / 2 / 7 / 8」，无炸弹 ⇒ 5 张 × 2×2×2 = 40', () => {
    // 座 1 领出一张 8（手里另留一张 8），座 0 用 9 大一级压上、正好打空手牌获胜。
    const s0 = deal(['S9', 'H8 jB jS S2 S7 S8'], { dealer: 1 });
    const s1 = play(s0, 1, pick(s0, 1, 'H8'));
    const s2 = play(s1, 0, pick(s1, 0, 'S9'));

    expect(isDealOver(s2)).toBe(true);
    expect(s2.winner).toBe(0);
    expect(s2.hands[1]).toHaveLength(5);

    const r = settle(s2, 1);
    expect(r.pay).toEqual([0, 40]);   // 5 张 × 2^0 炸 × (王×2 · 王×2 · 2×2) = 40
    expect(r.gain).toBe(40);
  });

  it('算例二：5 人局 + 4 个炸 + 春天 + 剩「大王/小王/2/2/2」⇒ 5120 底分', () => {
    const s0 = deal(
      [
        'S3 H3 D3 C3 S9 H9',   // 座 0：庄，出 3333
        'S5 H5 D5 C5 ST',      // 座 1：出 5555
        'S6 H6 D6 C6 SJ',      // 座 2：出 6666
        'S7 H7 D7 C7 SQ',      // 座 3：出 7777，再出 SQ 打空获胜
        'jB jS S2 H2 D2',      // 座 4：全程一张没出 → 春天
      ],
      { dealer: 0, deck: '' },
    );

    let s = play(s0, 0, pick(s0, 0, 'S3 H3 D3 C3'));   // 炸 1
    s = play(s, 1, pick(s, 1, 'S5 H5 D5 C5'));         // 炸 2（张数同、点数更大）
    s = play(s, 2, pick(s, 2, 'S6 H6 D6 C6'));         // 炸 3
    s = play(s, 3, pick(s, 3, 'S7 H7 D7 C7'));         // 炸 4
    for (const seat of [4, 0, 1, 2] as Seat[]) s = pass(s, seat);
    expect(s.turn).toBe(3);                             // 座 3 赢下这轮，领出
    s = play(s, 3, pick(s, 3, 'SQ'));                   // 打空手牌获胜

    expect(s.winner).toBe(3);
    expect(s.hands[4]).toHaveLength(5);

    const r = settle(s, 1);
    // 座 4：5 张 × 2⁴(四个炸) × 2⁵(两张王 + 三张 2 逐张翻) × 2(春天) = 5120
    expect(r.pay[4]).toBe(5120);
    // 其余输家：只吃全场炸弹倍数
    expect(r.pay[0]).toBe(2 * 16);   // 剩 S9 H9
    expect(r.pay[1]).toBe(1 * 16);
    expect(r.pay[2]).toBe(1 * 16);
    expect(r.pay[3]).toBe(0);        // 赢家
    expect(r.gain).toBe(5120 + 32 + 16 + 16);
  });
});

describe('炸弹倍数：全场共享，每个炸一律 ×2 连乘，不分大小', () => {
  /**
   * 造一局：座 1（庄）先把 `bombSpecs` 里的炸一个个领出去（座 0 每次都过、一轮即结束），
   * 最后座 1 领出一张 8、座 0 用 9 大一级压上打空获胜。
   * 座 1 固定剩「S7 SA」两张，不含王也不含 2，好把炸弹倍数单独量出来。
   */
  function payWithBombs(...bombSpecs: string[]): number {
    const s0 = deal(['S9', `${bombSpecs.join(' ')} H8 S7 SA`.trim()], { dealer: 1, deck: '' });
    let s = s0;
    for (const spec of bombSpecs) {
      s = play(s, 1, pick(s, 1, spec));      // 座 1 领出一个炸
      s = pass(s, 0);                        // 两人局：对手一过本轮即结束，座 1 继续领出
    }
    s = play(s, 1, pick(s, 1, 'H8'));        // 领出单张 8
    s = play(s, 0, pick(s, 0, 'S9'));        // 座 0 大一级压上，打空获胜
    expect(s.winner).toBe(0);
    expect(s.hands[1]).toHaveLength(2);
    return settle(s, 1).pay[1]!;
  }

  it('0 个炸 → ×1；1 个 → ×2；2 个 → ×4', () => {
    const none = payWithBombs();
    expect(none).toBe(2);                                        // 2 张，无任何倍数
    expect(payWithBombs('S3 H3 D3')).toBe(none * 2);
    expect(payWithBombs('S3 H3 D3', 'S4 H4 D4')).toBe(none * 4);
  });

  it('不分炸的大小：3 张炸与 4 张炸都只算 ×2', () => {
    expect(payWithBombs('S3 H3 D3')).toBe(payWithBombs('S4 H4 D4 C4'));
  });

  it('王炸同样计入全场倍数', () => {
    const s0 = deal(['S9', 'jB jS H8 S7 SA'], { dealer: 1, deck: '' });
    let s = play(s0, 1, s0.hands[1]!.filter((c) => c.kind === 'joker'));  // 领出王炸
    s = pass(s, 0);
    s = play(s, 1, pick(s, 1, 'H8'));
    s = play(s, 0, pick(s, 0, 'S9'));
    expect(s.winner).toBe(0);
    expect(settle(s, 1).pay[1]).toBe(2 * 2);   // 2 张 × 一个炸
  });

  it('炸弹倍数是全场共享的：谁打的炸都一样算到每个输家头上', () => {
    const s0 = deal(['S9', 'S3 H3 D3 H8 S7', 'SA SK'], { dealer: 1, deck: '' });
    let s = play(s0, 1, pick(s0, 1, 'S3 H3 D3'));   // 座 1 打的炸
    s = pass(s, 2);
    s = pass(s, 0);
    expect(s.turn).toBe(1);                          // 一轮结束，座 1 继续领出
    s = play(s, 1, pick(s, 1, 'H8'));
    s = pass(s, 2);                                  // 座 2 跟不上单张 9
    s = play(s, 0, pick(s, 0, 'S9'));                // 座 0 大一级压上，打空获胜
    expect(s.winner).toBe(0);
    const r = settle(s, 1);
    expect(r.pay[1]).toBe(1 * 2);                    // 座 1 剩 S7，吃全场炸弹倍数
    expect(r.pay[2]).toBe(2 * 2 * 2);                // 座 2 剩 2 张 × 炸弹 2 × 春天 2（只过牌没出牌）
  });
});

describe('个人倍数：逐张相乘，只作用于该输家自己', () => {
  /** 造一局：座 1 领出一张 8、座 0 用 9 压上打空获胜；座 1 剩下 `rest` */
  function loserKeeps(rest: string) {
    const s0 = deal(['S9', `H8 ${rest}`], { dealer: 1 });
    const s1 = play(s0, 1, pick(s0, 1, 'H8'));
    return settle(play(s1, 0, pick(s1, 0, 'S9')), 1);
  }

  it('每张王 ×2，逐张相乘', () => {
    expect(loserKeeps('S3').pay[1]).toBe(1);
    expect(loserKeeps('jB').pay[1]).toBe(2);
    expect(loserKeeps('jB jS').pay[1]).toBe(2 * 2 * 2);        // 2 张牌 × 2 × 2
  });

  it('每张 2 ×2，逐张相乘', () => {
    expect(loserKeeps('S2').pay[1]).toBe(2);
    expect(loserKeeps('S2 H2').pay[1]).toBe(2 * 2 * 2);
    expect(loserKeeps('S2 H2 D2').pay[1]).toBe(3 * 2 * 2 * 2);
  });

  it('王与 2 一起翻', () => {
    expect(loserKeeps('jB S2').pay[1]).toBe(2 * 2 * 2);
  });

  it('不做「手里剩炸弹加倍」：三张 8 就按 3 张算，不额外翻', () => {
    expect(loserKeeps('S3 H3 D3').pay[1]).toBe(3);
  });

  it('普通大牌不翻——只有王和 2 有个人倍数', () => {
    expect(loserKeeps('SA SK SQ').pay[1]).toBe(3);
  });
});

describe('春天：整局一张牌都没打出去过 ×2', () => {
  it('从头到尾没出过牌的输家额外 ×2', () => {
    // 座 0 一手打空，座 1 全程没机会出牌
    const s0 = deal(['S9 H9', 'S3 H4'], { dealer: 0 });
    const done = play(s0, 0, pick(s0, 0, 'S9 H9'));
    expect(done.winner).toBe(0);
    expect(settle(done, 1).pay[1]).toBe(2 * 2);   // 2 张 × 春天 2
  });

  it('出过哪怕一张牌，就不算春天', () => {
    const s0 = deal(['S9', 'H8 S3 H4'], { dealer: 1 });
    const s1 = play(s0, 1, pick(s0, 1, 'H8'));
    const done = play(s1, 0, pick(s1, 0, 'S9'));
    expect(settle(done, 1).pay[1]).toBe(2);       // 2 张，无春天
  });

  it('过牌不算出牌——只过不出照样是春天', () => {
    const s0 = deal(['S3 H9', 'S4 H5', 'SK HQ'], { dealer: 0 });
    let s = play(s0, 0, pick(s0, 0, 'S3'));
    s = play(s, 1, pick(s, 1, 'S4'));
    s = pass(s, 2);                                // 座 2 只过牌
    s = pass(s, 0);
    expect(s.turn).toBe(1);
    s = play(s, 1, pick(s, 1, 'H5'));              // 座 1 打空获胜
    expect(s.winner).toBe(1);
    const r = settle(s, 1);
    expect(r.pay[2]).toBe(2 * 2);                  // 座 2：2 张 × 春天
    expect(r.pay[0]).toBe(1);                      // 座 0 出过牌，不算春天
  });
});

describe('零和与边界', () => {
  it('各输家赔付之和恒等于赢家得分', () => {
    const s0 = deal(['S9', 'H8 jB S2 S7', 'H9 SA SK'], { dealer: 1 });
    let s = play(s0, 1, pick(s0, 1, 'H8'));
    s = play(s, 2, pick(s, 2, 'H9'));
    s = pass(s, 0);
    s = pass(s, 1);
    s = play(s, 2, pick(s, 2, 'SA'));
    s = pass(s, 0);
    s = pass(s, 1);
    s = play(s, 2, pick(s, 2, 'SK'));
    expect(s.winner).toBe(2);
    const r = settle(s, 1);
    expect(r.gain).toBe(r.pay.reduce((a, b) => a + b, 0));
  });

  it('底分可调，整体等比放大', () => {
    const mk = (base: number) => {
      const s0 = deal(['S9', 'H8 jB S2'], { dealer: 1 });
      const s1 = play(s0, 1, pick(s0, 1, 'H8'));
      return settle(play(s1, 0, pick(s1, 0, 'S9')), base);
    };
    expect(mk(10).pay[1]).toBe(mk(1).pay[1]! * 10);
  });

  it('不封顶：数字大就是大，不做上限截断', () => {
    // 两张王 + 三张 2 + 春天，无炸弹：5 × 2⁵ × 2 = 320
    const s0 = deal(['S9 H9', 'jB jS S2 H2 D2'], { dealer: 0 });
    const done = play(s0, 0, pick(s0, 0, 'S9 H9'));
    expect(settle(done, 1).pay[1]).toBe(320);
  });

  it('并列僵局 → 全场赔付为 0', () => {
    let s = deal(['jB', 'jS'], { dealer: 0, deck: '' });
    s = pass(s, 0);
    s = pass(s, 1);
    const r = settle(s, 1);
    expect(r.winner).toBeNull();
    expect(r.pay).toEqual([0, 0]);
    expect(r.gain).toBe(0);
  });

  it('本局未结束就结算 → 抛错', () => {
    expect(() => settle(deal(['S5 H9', 'S6 H8']), 1)).toThrow(/未结束/);
  });
});
