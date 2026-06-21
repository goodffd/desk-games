/**
 * OnlineDriver 单测（Plan 3 Task 4+5）：mock io 喂服务端消息，验 egocentric 旋转映射、
 * snapshot 拼装、phase、报牌、结算、动作发包、进贡还贡、dispose。
 */
import { describe, it, expect } from 'vitest';
import type { Card, Seat, Rank } from '../src/games/guandan/engine/types';
import { comboSpeech } from '../src/games/guandan/ui/render';
import type { SeatPublic, PublicState, C2SMessage, S2CType } from '../src/games/guandan/online/protocol';
import type { DealOutcome, TributePrompt } from '../src/games/guandan/driver/types';
import { OnlineDriver } from '../src/games/guandan/driver/online-driver';

function mockIO() {
  const handlers = new Map<string, ((m: unknown) => void)[]>();
  const sent: C2SMessage[] = [];
  return {
    on(t: S2CType, cb: (m: unknown) => void): void { const a = handlers.get(t) ?? []; a.push(cb); handlers.set(t, a); },
    send(m: C2SMessage): void { sent.push(m); },
    emit(t: string, m: unknown): void { (handlers.get(t) ?? []).forEach((cb) => cb(m)); },
    sent,
  };
}

const card = (id: number, rank = 5): Card => ({ kind: 'normal', suit: 'S', rank: rank as Rank, id });
const single = (id: number, key: number, by: Seat) => ({ type: 'single', cards: [card(id, key)], length: 1, key, power: 0, by });
function seat(s: Seat, count: number, o: Partial<SeatPublic> = {}): SeatPublic {
  return { seat: s, count, lastPlay: null, finishRank: null, online: true, ai: false, ...o };
}
function mkState(o: Partial<PublicState> = {}): PublicState {
  return {
    t: 'state', phase: 'playing', turn: 0, current: null, lastActor: null,
    seats: [seat(0, 27), seat(1, 27), seat(2, 27), seat(3, 27)],
    level: 2, levels: [2, 2], trumpTeam: 0, dealNo: 1, ...o,
  };
}

describe('OnlineDriver — egocentric 旋转 + 映射', () => {
  it('mySeat=2：server turn=2 → view turn=0；started/phase', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 2);
    io.emit('state', mkState({ turn: 2 }));
    expect(d.snapshot().state.turn).toBe(0);
    expect(d.snapshot().started).toBe(true);
    expect(d.snapshot().phase).toBe('playing');
  });

  it('我的手牌真发、别家占位、张数按旋转座对应', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 2);
    io.emit('hand', { cards: [card(1), card(2), card(3), card(4), card(5)] });
    io.emit('state', mkState({ seats: [seat(0, 20), seat(1, 21), seat(2, 5), seat(3, 22)] }));
    const snap = d.snapshot();
    expect(snap.state.hands[0]!.length).toBe(5);                       // 我(view0=server2)真手牌
    expect(snap.state.hands[0]!.every((c) => c.id > 0)).toBe(true);
    expect(snap.state.hands[1]!.length).toBe(22);                      // view1=server3 count22
    expect(snap.state.hands[1]!.every((c) => c.id < 0)).toBe(true);    // 占位
    expect(snap.state.hands[2]!.length).toBe(20);                      // view2=server0
    expect(snap.state.hands[3]!.length).toBe(21);                      // view3=server1
  });

  it('current.by / lastActor 旋转', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 2);
    io.emit('state', mkState({ current: single(9, 9, 3) as PublicState['current'], lastActor: 3 }));
    expect(d.snapshot().state.current!.by).toBe(1); // v(3) base2 = 1
    expect(d.snapshot().lastActor).toBe(1);
  });

  it('队伍维度重映射（奇 mySeat）：levels/trumpTeam/winner', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 1);
    io.emit('state', mkState({ levels: [5, 8], trumpTeam: 0 }));
    expect(d.snapshot().match.levels).toEqual([8, 5]); // 我方(view team0)=server team1=8
    expect(d.snapshot().match.trumpTeam).toBe(1);      // 0^1
  });

  it('finished 由 finishRank 重建并旋转', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 0);
    io.emit('state', mkState({
      seats: [seat(0, 0, { finishRank: 2 }), seat(1, 0, { finishRank: 1 }), seat(2, 5, { finishRank: null }), seat(3, 0, { finishRank: 3 })],
    }));
    expect(d.snapshot().state.finished).toEqual([1, 0, 3]); // rank1=seat1, rank2=seat0, rank3=seat3（base0 不旋转）
  });

  it('每个 state 触发 onChange', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 0);
    let n = 0; d.onChange(() => { n++; });
    io.emit('state', mkState());
    io.emit('state', mkState());
    expect(n).toBe(2);
  });
});

describe('OnlineDriver — 报牌 / 结算', () => {
  it('出牌→comboSpeech、不要→「不要」', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 0);
    const speaks: string[] = []; d.onSpeak((t) => speaks.push(t));
    const cur = single(7, 7, 1);
    io.emit('state', mkState({ current: cur as PublicState['current'], lastActor: 1 }));
    expect(speaks[0]).toBe(comboSpeech({ type: 'single', cards: [card(7, 7)], length: 1, key: 7, power: 0 }, 2));
    // seat2 不要（current 仍是那手单张）
    io.emit('state', mkState({
      current: cur as PublicState['current'], lastActor: 2,
      seats: [seat(0, 27), seat(1, 27), seat(2, 27, { lastPlay: 'pass' }), seat(3, 27)],
    }));
    expect(speaks).toContain('不要');
  });

  it('dealResult → onResult{settle,leftover}，winTeam 旋转、leftover=lastHand', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 2);
    io.emit('hand', { cards: [card(1)] });
    let outcome: DealOutcome | null = null;
    d.onResult((o) => { outcome = o; });
    io.emit('state', mkState({
      phase: 'dealResult',
      result: { ranking: [1, 3, 0, 2], gain: 2, passedA: false, stuck: false, demoted: false, lastHand: [card(50), card(51)] },
    }));
    expect(outcome).not.toBeNull();
    expect(outcome!.leftover.map((c) => c.id)).toEqual([50, 51]);
    expect(outcome!.settle.winTeam).toBe(1); // teamOf(ranking[0]=1)=1, base2 偶→1^0=1
    expect(outcome!.settle.gain).toBe(2);
    expect(d.snapshot().phase).toBe('dealResult');
  });
});

describe('OnlineDriver — 动作发包', () => {
  it('autoAdvance=true；start/timeoutSeat/nextDealOrResult 不发包', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 0);
    expect(d.autoAdvance).toBe(true);
    io.emit('state', mkState());
    const before = io.sent.length;
    d.start(); d.timeoutSeat(0); d.nextDealOrResult();
    expect(io.sent.length).toBe(before);
  });

  it('我回合 play/pass → 发包；非我回合/领出不能不要 → false 不发', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 1);
    io.emit('hand', { cards: [card(10), card(11)] });
    io.emit('state', mkState({ turn: 1 })); // v(1) base1 = 0 → 我的回合
    expect(d.snapshot().state.turn).toBe(0);
    expect(d.play([card(10), card(11)])).toBe(true);
    expect(io.sent).toContainEqual({ t: 'play', cardIds: [10, 11] });

    io.emit('state', mkState({ turn: 1, current: single(9, 9, 2) as PublicState['current'] }));
    expect(d.pass()).toBe(true);
    expect(io.sent).toContainEqual({ t: 'pass' });

    io.emit('state', mkState({ turn: 1, current: null }));
    expect(d.pass()).toBe(false); // 领出不能不要

    io.emit('state', mkState({ turn: 2 })); // v(2) base1 = 1 ≠ 0 → 非我回合
    expect(d.play([card(10)])).toBe(false);
  });

  it('观战者从不出牌/不要', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 'spectator');
    io.emit('state', mkState({ turn: 0, current: single(9, 9, 1) as PublicState['current'] }));
    expect(d.play([card(1)])).toBe(false);
    expect(d.pass()).toBe(false);
  });

  it('freshMatch → 发 restart', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 0);
    d.freshMatch();
    expect(io.sent).toContainEqual({ t: 'restart' });
  });
});

describe('OnlineDriver — 进贡还贡', () => {
  it('我收贡：等 need-tribute 再 fire onTribute；resolve(id)→tribute-return', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 0);
    let prompt: TributePrompt | null = null;
    d.onTribute((p) => { prompt = p; });
    const tribute: NonNullable<PublicState['tribute']> = { exchanges: [{ giver: 2, receiver: 0, tribute: card(99) }], resist: false, doubleDown: false, pending: [0] };
    io.emit('state', mkState({ phase: 'tribute', tribute, levels: [3, 3], trumpTeam: 0 }));
    expect(prompt).toBeNull(); // 收贡方：state 先到、need-tribute 未到 → 暂不弹
    io.emit('need-tribute', { options: [card(3), card(4)] });
    expect(prompt).not.toBeNull();
    expect(prompt!.myReturnOptions!.map((c) => c.id)).toEqual([3, 4]);
    expect(prompt!.exchanges[0]!.receiver).toBe(0);
    prompt!.resolve(3);
    expect(io.sent).toContainEqual({ t: 'tribute-return', cardId: 3 });
  });

  it('我非收贡：立即 fire onTribute(myReturnOptions=null)；resolve(null) 不发包', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 1); // base1，server 收贡座=0 ≠ 我(1)
    let prompt: TributePrompt | null = null;
    d.onTribute((p) => { prompt = p; });
    const tribute: NonNullable<PublicState['tribute']> = { exchanges: [{ giver: 2, receiver: 0, tribute: card(99) }], resist: false, doubleDown: false, pending: [0] };
    io.emit('state', mkState({ phase: 'tribute', tribute }));
    expect(prompt).not.toBeNull();
    expect(prompt!.myReturnOptions).toBeNull();
    prompt!.resolve(null);
    expect(io.sent.filter((m) => m.t === 'tribute-return').length).toBe(0);
  });
});

describe('OnlineDriver — dispose', () => {
  it('dispose 后不再 fire 事件', () => {
    const io = mockIO();
    const d = new OnlineDriver(io, 0);
    let n = 0; d.onChange(() => { n++; });
    d.dispose();
    io.emit('state', mkState());
    expect(n).toBe(0);
  });
});
