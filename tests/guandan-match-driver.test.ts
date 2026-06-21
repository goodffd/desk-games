import { describe, it, expect } from 'vitest';
import { MatchDriver } from '../server/guandan-match-driver';

// 不洗牌：固定顺序发牌，便于断言（shuffle 返回 0..n-1 原序）
const noShuffle = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('MatchDriver — 发牌 + 下发', () => {
  it('start：广播 1 条公开态 + 给 4 座各私发自己的 hand(27张)', () => {
    const d = new MatchDriver({ shuffle: noShuffle });
    const out = d.start();
    const states = out.filter(o => o.to === 'all' && o.msg.t === 'state');
    const hands = out.filter(o => o.to === 'seat' && o.msg.t === 'hand');
    expect(states).toHaveLength(1);
    expect(states[0]!.msg.phase).toBe('playing');
    expect(hands).toHaveLength(4);
    for (let s = 0; s < 4; s++) {
      const h = hands.find(o => o.seat === s)!;
      expect(h.msg.cards).toHaveLength(27);
    }
  });

  it('公开态不含任何手牌字段', () => {
    const d = new MatchDriver({ shuffle: noShuffle });
    const st = d.start().find(o => o.msg.t === 'state')!.msg;
    expect(JSON.stringify(st)).not.toContain('"hands"');
    expect(st.seats.every((x: any) => x.count === 27 && x.lastPlay === null)).toBe(true);
  });
});

describe('MatchDriver — 出牌/不要', () => {
  function freshDeal() { const d = new MatchDriver({ shuffle: noShuffle }); d.start(); return d; }
  const handOf = (d: any, seat: number) => d.state.hands[seat];

  it('非回合出牌 → error，不推进', () => {
    const d = freshDeal(); // 首攻=座位0
    const out = d.handlePlay(1, [handOf(d, 1)[0].id]);
    expect(out.find((o: any) => o.msg.t === 'error')).toBeTruthy();
    expect(d.state.turn).toBe(0);
  });

  it('座位0 合法领出单张 → 推进到下一家 + 公开态含其 lastPlay + 手牌-1', () => {
    const d = freshDeal();
    const card = handOf(d, 0)[0];
    const out = d.handlePlay(0, [card.id]);
    const st = out.find((o: any) => o.to === 'all' && o.msg.t === 'state')!.msg;
    expect(st.seats[0].lastPlay).toEqual({ cards: [card] });
    expect(st.seats[0].count).toBe(26);
    expect(d.state.turn).toBe(1);
    // 出牌后只给出牌者补发新手牌
    const myHand = out.find((o: any) => o.to === 'seat' && o.seat === 0 && o.msg.t === 'hand');
    expect(myHand!.msg.cards).toHaveLength(26);
  });

  it('非法组合（乱凑两张）→ error', () => {
    const d = freshDeal();
    const h = handOf(d, 0);
    // 取两张不同点的牌强凑（非对子）——isLegalPlay 应拒
    const a = h[0]; const b = h.find((c: any) => c.kind === 'normal' && c.rank !== (a.kind === 'normal' ? a.rank : -1));
    const out = d.handlePlay(0, [a.id, b.id]);
    expect(out.find((o: any) => o.msg.t === 'error')).toBeTruthy();
  });
});

describe('MatchDriver — 重连/观战补发', () => {
  it('syncSeat：给该座补发 公开态(seat 定向) + 自己手牌', () => {
    const d = new MatchDriver({ shuffle: noShuffle }); d.start();
    const out = d.syncSeat(2);
    expect(out.find((o: any) => o.to === 'seat' && o.seat === 2 && o.msg.t === 'state')).toBeTruthy();
    const h = out.find((o: any) => o.to === 'seat' && o.seat === 2 && o.msg.t === 'hand');
    expect(h!.msg.cards).toHaveLength(27);
  });
  it('spectatorSync：只补公开态，无 hand', () => {
    const d = new MatchDriver({ shuffle: noShuffle }); d.start();
    const out = d.spectatorSync({} as any);
    expect(out.some((o: any) => o.msg.t === 'hand')).toBe(false);
    expect(out.some((o: any) => o.msg.t === 'state')).toBe(true);
  });
});
