import { describe, it, expect } from 'vitest';
import type { Card, Rank, Seat } from '../src/games/guandan/engine/types';
import {
  startMatch,
  dealLevel,
  settleDeal,
  planTribute,
  returnableCards,
  autoReturn,
  applyTribute,
  passALockedEarly,
  fullRanking,
  teamOf,
  partnerOf,
  type MatchState,
} from '../src/games/guandan/engine/match';

// --- card helpers (explicit unique ids) ---
type Suit = 'S' | 'H' | 'D' | 'C';
let _id = 0;
const n = (suit: Suit, rank: Rank): Card => ({ kind: 'normal', suit, rank, id: _id++ });
const J = (big: boolean): Card => ({ kind: 'joker', big, id: _id++ });

const mkMatch = (p: Partial<MatchState> = {}): MatchState => ({
  levels: [2, 2], trumpTeam: 0, dealNo: 1, stuckA: [0, 0], over: false, winner: null, ...p,
});

describe('teamOf / partnerOf', () => {
  it('队=座位%2，搭子=对面', () => {
    expect([0, 1, 2, 3].map(s => teamOf(s as Seat))).toEqual([0, 1, 0, 1]);
    expect([0, 1, 2, 3].map(s => partnerOf(s as Seat))).toEqual([2, 3, 0, 1]);
  });
});

describe('startMatch / dealLevel', () => {
  it('开局两队打2、首局级牌=2', () => {
    const m = startMatch();
    expect(m.levels).toEqual([2, 2]);
    expect(m.over).toBe(false);
    expect(dealLevel(m)).toBe(2);
  });
});

describe('settleDeal — 升级数（沿用名次表）', () => {
  it('对家二游(双下)→升3', () => {
    // finished 头→末 = [0,2,1,3]：头游0(队0)、搭子2 是二游 → gain 3
    const r = settleDeal(mkMatch(), [0, 2, 1, 3]);
    expect(r.gain).toBe(3);
    expect(r.winTeam).toBe(0);
    expect(r.match.levels).toEqual([5, 2]);
  });
  it('对家三游→升2', () => {
    const r = settleDeal(mkMatch(), [0, 1, 2, 3]); // 头0、搭子2 是三游
    expect(r.gain).toBe(2);
    expect(r.match.levels).toEqual([4, 2]);
  });
  it('对家末游→升1', () => {
    const r = settleDeal(mkMatch(), [0, 1, 3, 2]); // 头0、搭子2 是末游
    expect(r.gain).toBe(1);
    expect(r.match.levels).toEqual([3, 2]);
  });
  it('赢家队成为下局庄家(打赢家队的级 Q1)', () => {
    const r = settleDeal(mkMatch(), [1, 3, 0, 2]); // 头1(队1)、搭子3 二游 → 队1 升3
    expect(r.winTeam).toBe(1);
    expect(r.match.trumpTeam).toBe(1);
    expect(r.match.levels).toEqual([2, 5]);
    expect(dealLevel(r.match)).toBe(5);
  });
  it('升级封顶A，不越过A', () => {
    const r = settleDeal(mkMatch({ levels: [13, 2] }), [0, 2, 1, 3]); // K(13)+3 → 封顶 A(14)
    expect(r.match.levels[0]).toBe(14);
    expect(r.match.over).toBe(false); // 到A不算赢，须另开局打过
  });
});

describe('settleDeal — 打A过A（Q2 严格 / Q2b 降回2）', () => {
  it('打A局头游+对家非末游(gain≥2)→过A收盘', () => {
    const r = settleDeal(mkMatch({ levels: [14, 2] }), [0, 2, 1, 3]); // 队0打A、二游gain3
    expect(r.passedA).toBe(true);
    expect(r.match.over).toBe(true);
    expect(r.match.winner).toBe(0);
  });
  it('打A局头游+对家末游(gain=1)→卡A、不过', () => {
    const r = settleDeal(mkMatch({ levels: [14, 2] }), [0, 1, 3, 2]); // gain1
    expect(r.stuck).toBe(true);
    expect(r.passedA).toBe(false);
    expect(r.match.over).toBe(false);
    expect(r.match.levels[0]).toBe(14); // 仍打A
    expect(r.match.stuckA[0]).toBe(1);
  });
  it('连续卡A 3次 → 降回2', () => {
    let m = mkMatch({ levels: [14, 2] });
    let r = settleDeal(m, [0, 1, 3, 2]); // 卡A 1
    r = settleDeal({ ...r.match, trumpTeam: 0 }, [0, 1, 3, 2]); // 卡A 2
    expect(r.match.stuckA[0]).toBe(2);
    r = settleDeal({ ...r.match, trumpTeam: 0 }, [0, 1, 3, 2]); // 卡A 3 → 降回2
    expect(r.demoted).toBe(true);
    expect(r.match.levels[0]).toBe(2);
    expect(r.match.stuckA[0]).toBe(0);
    expect(r.match.over).toBe(false);
  });
});

describe('planTribute — 进贡/还贡/抗贡 + 首攻', () => {
  // 占位手牌：仅末游/三游手牌的牌点与大王影响判定
  const blank = (): Card[] => [n('S', 3), n('D', 4)];

  it('非双下：末游→头游单贡，进除逢人配外最大牌，末游首攻(Q6)', () => {
    const hands: Card[][] = [blank(), blank(), blank(), [n('H', 2) /*逢人配 rv15*/, n('S', 13) /*K*/, n('C', 5)]];
    const plan = planTribute([0, 1, 2, 3], hands, 2); // 头0(队0)/二游1(队1) → 非双下
    expect(plan.doubleDown).toBe(false);
    expect(plan.resist).toBe(false);
    expect(plan.exchanges).toHaveLength(1);
    expect(plan.exchanges[0]!.giver).toBe(3);
    expect(plan.exchanges[0]!.receiver).toBe(0);
    expect(plan.exchanges[0]!.tribute.id).toBe(hands[3]![1]!.id); // K，不是逢人配 H2
    expect(plan.firstLeader).toBe(3);
  });

  it('双下双贡：头游拿点数较大的进贡牌、二游拿较小的（与谁出无关，owner ruling）', () => {
    // finished=[0,2,1,3]：头0/二游2(双下)；三游=座位1 持 K(13)、末游=座位3 持 5。
    // K 较大 → 头游0 收 K(来自三游1)、二游2 收 5(来自末游3)；若按旧的固定映射(末游→头游)就会反。
    const hands: Card[][] = [blank(), [n('S', 13)], blank(), [n('S', 5)]];
    const plan = planTribute([0, 2, 1, 3], hands, 2);
    expect(plan.doubleDown).toBe(true);
    expect(plan.exchanges).toHaveLength(2);
    const toHead = plan.exchanges.find(e => e.receiver === 0)!;
    const toSecond = plan.exchanges.find(e => e.receiver === 2)!;
    expect([toHead.giver, toHead.tribute.id]).toEqual([1, hands[1]![0]!.id]);    // 头游收三游的 K
    expect([toSecond.giver, toSecond.tribute.id]).toEqual([3, hands[3]![0]!.id]); // 二游收末游的 5
    expect(plan.firstLeader).toBe(3);
  });

  it('双下双贡：两张进贡牌点数相等 → 确定性 末游→头游、三游→二游', () => {
    const hands: Card[][] = [blank(), [n('S', 14)], blank(), [n('D', 14)]]; // 三游1、末游3 各持一张 A(14)
    const plan = planTribute([0, 2, 1, 3], hands, 2);
    expect(plan.doubleDown).toBe(true);
    expect(plan.exchanges.map(e => [e.giver, e.receiver])).toEqual([[3, 0], [1, 2]]);
    expect(plan.firstLeader).toBe(3);
  });

  it('抗贡(单贡)：末游持双大王 → 免进，头游首攻', () => {
    const hands: Card[][] = [blank(), blank(), blank(), [J(true), J(true), n('S', 3)]];
    const plan = planTribute([0, 1, 2, 3], hands, 2);
    expect(plan.resist).toBe(true);
    expect(plan.exchanges).toHaveLength(0);
    expect(plan.firstLeader).toBe(0);
  });

  it('抗贡(双贡)：三游+末游合计双大王 → 免进', () => {
    // finished=[0,2,1,3]：头0/二2(双下)、三游=座位1、末游=座位3 → 看 hands[1]+hands[3]
    const hands: Card[][] = [blank(), [J(true), n('S', 3)] /*三游1个大王*/, blank(), [J(true), n('S', 4)] /*末游1个*/];
    const plan = planTribute([0, 2, 1, 3], hands, 2);
    expect(plan.resist).toBe(true);
  });

  it('双贡里三游、末游各只1大王但不同队不合计——非双下时只看末游一人', () => {
    const hands: Card[][] = [blank(), [J(true)], [J(true)], [J(true), n('S', 3)]]; // 末游3 仅1大王
    const plan = planTribute([0, 1, 2, 3], hands, 2); // 非双下，只看末游一人 → 不抗贡
    expect(plan.resist).toBe(false);
  });
});

describe('returnableCards / autoReturn — 还贡 ≤10 (Q4)', () => {
  it('只挑 rankValue≤10 的牌，AI 还最小', () => {
    const hand = [n('S', 3), n('S', 11) /*J rv11*/, n('H', 2) /*逢人配 rv15*/, n('D', 10), n('C', 14) /*A*/];
    const ret = returnableCards(hand, 2).map(c => c.id);
    expect(ret).toEqual([hand[0]!.id, hand[3]!.id]); // 仅 S3、D10（J/逢人配/A 都>10）
    expect(autoReturn(hand, 2).id).toBe(hand[0]!.id); // 最小 = S3
  });
});

describe('applyTribute — 牌在两家间交换，张数守恒', () => {
  it('单贡：进贡牌移到收贡方、还贡牌移回，各家张数不变', () => {
    const hands: Card[][] = [
      [n('S', 3), n('S', 4), n('S', 5)],   // 头游0(收贡)
      [n('D', 6)], [n('D', 7)],
      [J(true), n('C', 8), n('C', 9)],     // 末游3(进贡)
    ];
    const plan = planTribute([0, 1, 2, 3], hands, 2);
    expect(plan.exchanges[0]!.tribute.kind).toBe('joker'); // 进大王
    const ret = autoReturn(hands[0]!, 2);                  // 收贡方还最小 S3
    const before = hands.flat().length;
    const out = applyTribute(hands, plan, [ret]);
    expect(out.flat().length).toBe(before);               // 总张数守恒
    expect(out[0]!.length).toBe(3);                        // 收贡方仍3张
    expect(out[3]!.length).toBe(3);                        // 进贡方仍3张
    expect(out[0]!.some(c => c.kind === 'joker')).toBe(true);          // 收到大王
    expect(out[0]!.some(c => c.id === ret.id)).toBe(false);            // 还出的牌已离手
    expect(out[3]!.some(c => c.id === plan.exchanges[0]!.tribute.id)).toBe(false); // 进出的大王已离手
    expect(out[3]!.some(c => c.id === ret.id)).toBe(true);             // 进贡方收到还贡
    // 全局 id 不重不漏
    const ids = out.flat().map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('抗贡：手牌原样不变', () => {
    const hands: Card[][] = [[n('S', 3)], [n('D', 4)], [n('D', 5)], [J(true), J(true)]];
    const plan = planTribute([0, 1, 2, 3], hands, 2);
    const out = applyTribute(hands, plan, []);
    expect(out.flat().map(c => c.id)).toEqual(hands.flat().map(c => c.id));
  });
});

describe('passALockedEarly / fullRanking — 打A双下提前收盘', () => {
  it('打A方双下(头游+二游同队) → 锁定过A(true)', () => {
    // 队0(座0&2)在 A；finished 前两名 0,2 同队 → 过A 已必成
    expect(passALockedEarly(mkMatch({ levels: [14, 2] }), [0, 2])).toBe(true);
    expect(passALockedEarly(mkMatch({ levels: [2, 14], trumpTeam: 1 }), [1, 3])).toBe(true);
  });
  it('打A方头游但二游是对手(非双下) → 不锁定(false)，需继续打', () => {
    expect(passALockedEarly(mkMatch({ levels: [14, 2] }), [0, 1])).toBe(false);
  });
  it('双下但该队未到A → 不提前收盘(false)', () => {
    expect(passALockedEarly(mkMatch({ levels: [13, 2] }), [0, 2])).toBe(false);
  });
  it('不足2人 → false', () => {
    expect(passALockedEarly(mkMatch({ levels: [14, 2] }), [0])).toBe(false);
  });
  it('fullRanking 补全仍在场座位到末尾（顺序不影响双下 gain）', () => {
    expect(fullRanking([0, 2])).toEqual([0, 2, 1, 3]);
    expect(fullRanking([1, 3, 0, 2])).toEqual([1, 3, 0, 2]);
  });
  it('提前收盘名次交给 settleDeal → 双下过A(gain=3, over)', () => {
    const settle = settleDeal(mkMatch({ levels: [14, 2] }), fullRanking([0, 2]));
    expect(settle.gain).toBe(3);
    expect(settle.passedA).toBe(true);
    expect(settle.match.over).toBe(true);
    expect(settle.match.winner).toBe(0);
  });
});
