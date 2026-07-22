import { describe, it, expect } from 'vitest';
import { GandengyanDriver } from '../server/gandengyan-match-driver';
// @ts-ignore
import { RoomRegistry } from '../server/gandengyan-rooms.mjs';
import { seededShuffle } from './helpers/rng';
import type { Card } from '../src/games/gandengyan/engine/types';

/**
 * 干瞪眼服务端运行器的 wire 接缝测试：**只断言客户端收到了什么**。
 *
 * 牌型规则本身在引擎那 200 条里已经罩死了，这里不重测；这里管的是
 * 「谁能看到什么、谁能做什么」——手牌不外泄、牌堆不外泄、桌面牌的指派要带上、
 * 非法出牌不能污染状态、客户端可控的指派字段挡不挡得住乱来。
 */

function fakeClient() { const sent: any[] = []; return { sent, send: (m: any) => sent.push(m) }; }
const lastOf = (c: any, t: string) => [...c.sent].reverse().find((m: any) => m.t === t);
const allOf = (c: any, t: string) => c.sent.filter((m: any) => m.t === t);

/** 开一局：seatCount 个真人全落座、房主开打，返回 { reg, cs, drv } */
function playing(seatCount: number, seed = 1) {
  let drv: any = null;
  const reg: any = new RoomRegistry(
    () => 'ABC123',
    (room: any) => {
      drv = new GandengyanDriver({ shuffle: seededShuffle(seed), seatCount: room.seatCount, dealer: 0 });
      return drv;
    },
  );
  const cs = Array.from({ length: seatCount }, () => fakeClient());
  cs.forEach((c, i) => reg.handle(c, { t: 'hello', nick: 'p' + i }));
  reg.handle(cs[0], { t: 'create', seats: seatCount });
  for (let i = 1; i < seatCount; i++) {
    reg.handle(cs[i], { t: 'join', code: 'ABC123' });
    reg.handle(cs[i], { t: 'take-seat', seat: i });
  }
  reg.handle(cs[0], { t: 'start' });
  return { reg, cs, drv: () => drv };
}

describe('开局与私发', () => {
  it('2~5 人局都能开起来，各家收到自己的手牌，庄 6 张其余 5 张', () => {
    for (const n of [2, 3, 4, 5]) {
      const { cs } = playing(n);
      for (let i = 0; i < n; i++) {
        const hand = lastOf(cs[i], 'hand');
        expect(hand, `${n} 人局座 ${i} 没收到手牌`).toBeTruthy();
        expect(hand.cards).toHaveLength(i === 0 ? 6 : 5);
      }
    }
  });

  it('**手牌只到本人**：出站流里每一条 hand 都只发给它自己的座位', () => {
    const { cs } = playing(4);
    // 每个客户端收到的 hand 消息，其牌必须全在自己手上——拿别人的手牌一张都不行
    const mine = cs.map((c) => new Set(lastOf(c, 'hand').cards.map((x: Card) => x.id)));
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        if (i === j) continue;
        for (const id of mine[i]!) expect(mine[j]!.has(id), `座 ${j} 的手牌里混进了座 ${i} 的牌`).toBe(false);
      }
      expect(allOf(cs[i], 'hand')).toHaveLength(1);   // 只收到自己那一条
    }
  });

  it('**牌堆内容绝不进公开态**：只报还剩几张', () => {
    const { cs } = playing(5);
    const st = lastOf(cs[1], 'state');
    expect(JSON.stringify(st)).not.toContain('"deck"');
    expect(st.deckCount).toBe(54 - (6 + 5 * 4));
    // 公开态里也不该出现别人的手牌
    expect(JSON.stringify(st)).not.toContain('"hands"');
  });

  it('公开态只报各家剩几张，不报是哪些牌', () => {
    const { cs } = playing(3);
    const st = lastOf(cs[0], 'state');
    expect(st.seats.map((s: any) => s.count)).toEqual([6, 5, 5]);
    for (const s of st.seats) expect(s.cards).toBeUndefined();
  });
});

describe('出牌与桌面牌的指派', () => {
  /** 让当前轮到的座位出掉手里第一张普通牌（领出任意单张都合法） */
  function leadFirstNormal(reg: any, cs: any[], drv: any) {
    const seat = drv().state.turn;
    const card = drv().state.hands[seat].find((c: Card) => c.kind === 'normal');
    reg.handle(cs[seat], { t: 'play', cardIds: [card.id] });
    return { seat, card };
  }

  it('合法领出 → 全员收到新公开态，出牌者手牌少一张', () => {
    const { reg, cs, drv } = playing(3);
    const before = drv().state.hands[0].length;
    const { seat } = leadFirstNormal(reg, cs, drv);
    for (const c of cs) expect(lastOf(c, 'state').current).toBeTruthy();
    expect(lastOf(cs[seat], 'hand').cards).toHaveLength(before - 1);
    expect(lastOf(cs[0], 'state').turn).toBe(1);
  });

  it('**桌面当前牌带着指派**：重连的人才知道那张王算几点', () => {
    const drv = new GandengyanDriver({ shuffle: seededShuffle(1), seatCount: 2, dealer: 0 });
    // 直接摆一个「王 + 5」当对 5 的局面，验公开态把指派带出去
    const joker: Card = { kind: 'joker', big: true, id: 900 };
    const five: Card = { kind: 'normal', suit: 'S', rank: 5, id: 901 };
    drv.state = { ...drv.state, hands: [[joker, five], drv.state.hands[1]!], turn: 0, current: null } as any;
    drv.handlePlay(0, [900, 901], [{ jokerId: 900, rank: 5 }]);
    const cur: any = drv.publicState()['current'];
    expect(cur.type).toBe('pair');
    expect(cur.key).toBe(5);
    expect(cur.assign).toEqual([{ jokerId: 900, rank: 5 }]);
  });

  it('非法出牌 → 报错，且轮转与手牌一个字节不动', () => {
    const { reg, cs, drv } = playing(3);
    leadFirstNormal(reg, cs, drv);                       // 座 0 领出一张单牌
    const turnBefore = drv().state.turn;
    const handsBefore = drv().state.hands.map((h: Card[]) => h.map((c) => c.id).join(','));
    const plyBefore = drv().ply;

    // 座 1 拿两张凑不成牌型的牌硬出
    const h1 = drv().state.hands[1].filter((c: Card) => c.kind === 'normal');
    reg.handle(cs[1], { t: 'play', cardIds: [h1[0].id, h1[1].id] });

    expect(lastOf(cs[1], 'error')).toBeTruthy();
    expect(drv().state.turn).toBe(turnBefore);
    expect(drv().state.hands.map((h: Card[]) => h.map((c) => c.id).join(','))).toEqual(handsBefore);
    expect(drv().ply).toBe(plyBefore);
  });

  it('不是自己的回合 → 报错，不动状态', () => {
    const { reg, cs, drv } = playing(3);
    const card = drv().state.hands[2].find((c: Card) => c.kind === 'normal');
    reg.handle(cs[2], { t: 'play', cardIds: [card.id] });
    expect(lastOf(cs[2], 'error').msg).toMatch(/还没轮到你/);
    expect(drv().ply).toBe(0);
  });

  it('观众发出牌 → 直接被房间层挡掉，运行器完全不知情', () => {
    const { reg, cs, drv } = playing(3);
    const v = fakeClient();
    reg.handle(v, { t: 'hello', nick: '观' });
    reg.handle(v, { t: 'spectate', code: 'ABC123' });
    const plyBefore = drv().ply;
    reg.handle(v, { t: 'play', cardIds: [1] });
    expect(drv().ply).toBe(plyBefore);
    expect(lastOf(v, 'error')).toBeFalsy();
  });
});

describe('恶意指派：客户端可控输入，掼蛋没有的一整个攻击面', () => {
  /** 造一个「座 0 手里有一张王 + 一张 5」的确定局面 */
  function withJoker() {
    const drv = new GandengyanDriver({ shuffle: seededShuffle(1), seatCount: 2, dealer: 0 });
    const joker: Card = { kind: 'joker', big: true, id: 900 };
    const five: Card = { kind: 'normal', suit: 'S', rank: 5, id: 901 };
    const otherJoker: Card = { kind: 'joker', big: false, id: 902 };
    drv.state = { ...drv.state, hands: [[joker, five], [otherJoker, ...drv.state.hands[1]!]], turn: 0, current: null } as any;
    return drv;
  }
  const rejected = (out: any[]) => out.length === 1 && out[0].msg.t === 'error';

  it.each([
    ['指派条数比王多', [900, 901], [{ jokerId: 900, rank: 5 }, { jokerId: 900, rank: 6 }]],
    ['同一张王指派两次', [900, 901], [{ jokerId: 900, rank: 5 }, { jokerId: 900, rank: 5 }]],
    ['一张王也不指派', [900, 901], []],
    ['指到别人手里的王', [900, 901], [{ jokerId: 902, rank: 5 }]],
    ['指到不存在的牌', [900, 901], [{ jokerId: 12345, rank: 5 }]],
    ['指到一张普通牌', [900, 901], [{ jokerId: 901, rank: 5 }]],
    ['点数是 2（王不能替 2）', [900, 901], [{ jokerId: 900, rank: 2 }]],
    ['点数越界（15）', [900, 901], [{ jokerId: 900, rank: 15 }]],
    ['点数越界（0）', [900, 901], [{ jokerId: 900, rank: 0 }]],
    ['点数不是整数', [900, 901], [{ jokerId: 900, rank: 5.5 }]],
  ])('%s → 拒绝', (_label, ids, assign) => {
    const drv = withJoker();
    const out = drv.handlePlay(0, ids as number[], assign as any);
    expect(rejected(out), JSON.stringify(out)).toBe(true);
    expect(drv.ply).toBe(0);                       // 状态没被推进
    expect(drv.state.hands[0]).toHaveLength(2);    // 手牌没少
  });

  it.each([
    ['指派不是数组', 'nonsense'],
    ['指派里混了 null', [null]],
    ['指派里混了数字', [42]],
    ['jokerId 不是数字', [{ jokerId: 'x', rank: 5 }]],
    ['rank 不是数字', [{ jokerId: 900, rank: 'A' }]],
  ])('%s → 拒绝，且不抛异常', (_label, assign) => {
    const drv = withJoker();
    let out: any;
    expect(() => { out = drv.handlePlay(0, [900, 901], assign as any); }).not.toThrow();
    expect(rejected(out)).toBe(true);
    expect(drv.ply).toBe(0);
  });

  it('拿别人手里的牌出 → 拒绝', () => {
    const drv = withJoker();
    const out = drv.handlePlay(0, [902], []);      // 902 在座 1 手里
    expect(rejected(out)).toBe(true);
  });

  it('同一张牌报两次 → 拒绝', () => {
    const drv = withJoker();
    const out = drv.handlePlay(0, [901, 901], []);
    expect(rejected(out)).toBe(true);
  });

  it('cardIds 不是数组 → 拒绝，不抛异常', () => {
    const drv = withJoker();
    let out: any;
    expect(() => { out = drv.handlePlay(0, 'oops' as any, []); }).not.toThrow();
    expect(rejected(out)).toBe(true);
  });

  it('正常的指派照旧放行（防止上面那一串把好人也挡了）', () => {
    const drv = withJoker();
    const out = drv.handlePlay(0, [900, 901], [{ jokerId: 900, rank: 5 }]);
    expect(out.some((o: any) => o.msg.t === 'state')).toBe(true);
    expect(drv.ply).toBe(1);
  });
});

describe('wire 层打完一整局', () => {
  it.each([2, 3, 4, 5])('%i 人局：一路托管打到局终，公开态进结算且带得分', (n) => {
    const { cs, drv } = playing(n, 7);
    let guard = 0;
    while (drv().phase === 'playing' && guard++ < 500) drv().forceAutoPlay();

    expect(drv().phase, '没在步数上界内打完').toBe('dealResult');
    const st: any = drv().publicState();
    expect(st.result).toBeTruthy();
    expect(st.result.pay).toHaveLength(n);
    expect(st.result.gain).toBe(st.result.pay.reduce((a: number, b: number) => a + b, 0));
    expect(JSON.stringify(st)).not.toContain('"deck"');   // 到最后一刻也没泄牌堆

    // 手牌隔离的**全局不变量**：干瞪眼没有进贡，牌从不在手之间流动，
    // 所以每张牌整局只属于一个座位 ⇒ 任意两个客户端见过的手牌 id 集合必须不相交。
    // 出牌会让牌离开手牌、摸牌会让新牌进来，但这条性质全程成立。
    const seen = cs.map((c) => {
      const ids = new Set<number>();
      for (const h of allOf(c, 'hand')) for (const card of h.cards) ids.add(card.id);
      return ids;
    });
    for (let i = 0; i < n; i++) {
      expect(seen[i]!.size, `座 ${i} 一条手牌都没收到`).toBeGreaterThan(0);
      for (let j = i + 1; j < n; j++) {
        const leaked = [...seen[i]!].filter((id) => seen[j]!.has(id));
        expect(leaked, `座 ${i} 与座 ${j} 见过同一张牌 ${leaked.join(',')}`).toEqual([]);
      }
    }
  });

  it('打完之后房主可以再来一局（干瞪眼不自动续局，停在结算等人点）', () => {
    const { reg, cs, drv } = playing(2, 3);
    const first = drv();
    let guard = 0;
    while (first.phase === 'playing' && guard++ < 500) first.forceAutoPlay();
    expect(first.phase).toBe('dealResult');

    reg.handle(cs[0], { t: 'restart' });
    expect(drv()).not.toBe(first);              // 换了一个新的对局
    expect(drv().phase).toBe('playing');
    expect(lastOf(cs[1], 'hand').cards.length).toBeGreaterThan(0);
  });

  it('本局没打完就 restart → 被挡下', () => {
    const { reg, cs, drv } = playing(2, 3);
    const before = drv();
    reg.handle(cs[0], { t: 'restart' });
    expect(lastOf(cs[0], 'error').msg).toMatch(/本盘未结束/);
    expect(drv()).toBe(before);
  });
});
