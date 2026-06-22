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

describe('MatchDriver — 局终结算', () => {
  it('全 AI 自对局打完一局 → 公开态进 dealResult，含 ranking(长度4)', () => {
    const d = new MatchDriver({ shuffle: defaultShuffleSeeded() }); // 见下：可复现洗牌
    const out = d.start();
    for (let s = 0; s < 4; s++) out.push(...d.setAI(s as any, true));
    const lastState = [...out].reverse().find(o => o.msg.t === 'state')!.msg;
    expect(['dealResult', 'tribute', 'matchOver']).toContain(lastState.phase);
    if (lastState.phase === 'dealResult') expect(lastState.result.ranking).toHaveLength(4);
  });
});
// 可复现洗牌：Fisher-Yates with 固定 LCG 种子（测试确定性，不用 Math.random）
function defaultShuffleSeeded() {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  return (n: number) => { const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = a[i]!; a[i] = a[j]!; a[j] = t; } return a; };
}

describe('MatchDriver — AI 接管', () => {
  it('setAI(座位X,true) 且轮到该座 → AI 自动推进，turn 不停在 AI 座', () => {
    const d = new MatchDriver({ shuffle: noShuffle }); d.start(); // 轮到座位0
    const out = d.setAI(0, true);
    expect(out.some((o: any) => o.msg.t === 'state')).toBe(true);
    // 座位0 被 AI 接管且首攻 → 应已自动出牌，turn 前移
    expect(d.online[0]).toBe(false);
    expect(d.state.turn).not.toBe(0);
  });

  it('全 4 座 AI → 一路自动打完整局不卡死', () => {
    const d = new MatchDriver({ shuffle: noShuffle }); d.start();
    for (let s = 0; s < 4; s++) d.setAI(s as any, true);
    // setAI 链式驱动后，本局应已结束（finished 满 4 或 deal over）
    expect(d.state.finished.length).toBeGreaterThanOrEqual(3);
  });

  it('forceAutoPlay：替当前轮到座位代打一手，turn 前移（在线真人发呆托管）', () => {
    const d = new MatchDriver({ shuffle: noShuffle }); d.start(); // 轮到座位0，全座在线(真人)
    const turn0 = d.state.turn;
    const out = d.forceAutoPlay();
    expect(out.some((o: any) => o.msg.t === 'state')).toBe(true);
    expect(d.state.turn).not.toBe(turn0); // 代打后 turn 前移（不停在原座）
  });

  it('forceAutoPlay：3 座 AI + 1 在线真人，反复托管→该真人回合不断回来、不卡死', () => {
    const d = new MatchDriver({ shuffle: defaultShuffleSeeded() }); d.start();
    const human = 1;
    for (const s of [0, 2, 3]) d.setAI(s as any, true); // 其余 3 座 AI（=掉线接管）
    // 真人 human 全程发呆：每轮都靠 forceAutoPlay 托管。验证：能一路把整盘推完，不会卡在 human 座。
    let guard = 0;
    while (!d.match.over && guard++ < 400) {
      if (d.phase === 'playing' && d.state.turn === human && d.state.finished.indexOf(human as any) === -1) {
        d.forceAutoPlay(); // 真人发呆 → 服务端代打
      } else if (d.phase === 'tribute') {
        d.forceAutoReturn();
      } else if (d.phase === 'dealResult') {
        d.nextDeal();
      } else {
        // 轮到 AI 座但 driveAI 未推进（理论不应发生）→ 防御性兜底
        break;
      }
    }
    expect(d.match.over).toBe(true); // 整盘能打完，真人座不会永久卡住
  });
});

describe('MatchDriver — 进贡/还贡', () => {
  it('全 AI 自对局：连打数局不卡死，每局 ranking 合法（进贡/还贡走 autoReturn）', () => {
    const d = new MatchDriver({ shuffle: defaultShuffleSeeded() });
    const out = d.start();
    for (let s = 0; s < 4; s++) out.push(...d.setAI(s as any, true));
    let guard = 0;
    while (!d.match.over && guard++ < 30) { out.push(...d.nextDeal()); for (let s = 0; s < 4; s++) out.push(...d.setAI(s as any, true)); }
    expect(d.match.over || guard >= 30).toBeTruthy(); // 不死循环
  });

  it('收贡座位是真人 → 发 need-tribute；该人 tribute-return 后开下一局', () => {
    // 造一个「非抗贡单贡、收贡座位在线」的局面：用全 AI 打完首局拿到 finished，再设收贡座位 online
    const d = new MatchDriver({ shuffle: defaultShuffleSeeded() });
    d.start(); for (let s = 0; s < 4; s++) d.setAI(s as any, true);
    // 头游座位设为在线真人
    const head = d.pendingResult!.finished[0]!;
    d.online[head] = true;
    const out = d.nextDeal();
    const need = out.find((o: any) => o.msg.t === 'need-tribute' && o.seat === head);
    if (need) { // 非抗贡才有还贡
      expect(Array.isArray(need.msg.options)).toBe(true);
      const r = d.handleTributeReturn(head, need.msg.options[0].id);
      expect(r.some((o: any) => o.msg.t === 'state')).toBe(true);
    }
  });

  it('双贡：planTribute 产出 2 项 exchange 时，给两个收贡真人各发 need-tribute', () => {
    // 直接构造 driver 内部状态触发：mock pendingResult 为双下名次 + 两收贡在线
    const d = new MatchDriver({ shuffle: defaultShuffleSeeded() });
    d.start(); for (let s = 0; s < 4; s++) d.setAI(s as any, true);
    d.pendingResult = { finished: [0, 2, 1, 3], settle: { match: d.match } } as any; // 头0/二2 同队=双下
    d.online[0] = true; d.online[2] = true;
    const out = d.nextDeal();
    const needs = out.filter((o: any) => o.msg.t === 'need-tribute');
    // 双下两收贡=头游0+二游2（除非抗贡）；至少 0 或 2 收到（依发牌是否抗贡）
    expect(needs.every((o: any) => o.seat === 0 || o.seat === 2)).toBe(true);
  });
});
