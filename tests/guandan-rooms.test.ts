import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore
import { RoomRegistry } from '../server/guandan-rooms.mjs';

function fakeClient() { const sent: any[] = []; return { sent, send: (m: any) => sent.push(m) }; }
const last = (c: any) => c.sent[c.sent.length - 1];
const tokenOf = (c: any) => [...c.sent].reverse().find((m: any) => m.t === 'seat-token')?.token; // 本座会话令牌(最近一次)

describe('RoomRegistry — 昵称', () => {
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123'); });

  it('hello 登记昵称 → hello-ok', () => {
    const a = fakeClient();
    reg.handle(a, { t: 'hello', nick: '甲' });
    expect(last(a)).toEqual({ t: 'hello-ok' });
  });

  it('重名（不区分大小写/空格）→ nick-taken', () => {
    const a = fakeClient(); const b = fakeClient();
    reg.handle(a, { t: 'hello', nick: '甲' });
    reg.handle(b, { t: 'hello', nick: ' 甲 ' });
    expect(last(b)).toEqual({ t: 'nick-taken' });
  });

  it('空昵称 → nick-taken', () => {
    const a = fakeClient();
    reg.handle(a, { t: 'hello', nick: '   ' });
    expect(last(a)).toEqual({ t: 'nick-taken' });
  });

  it('leave 后昵称释放，可被再用', () => {
    const a = fakeClient(); const b = fakeClient();
    reg.handle(a, { t: 'hello', nick: '甲' });
    reg.leave(a);
    reg.handle(b, { t: 'hello', nick: '甲' });
    expect(last(b)).toEqual({ t: 'hello-ok' });
  });
});

describe('RoomRegistry — 建房 + 挑座', () => {
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123'); });
  const hello = (c: any, nick: string) => reg.handle(c, { t: 'hello', nick });
  const roomMsg = (c: any) => [...c.sent].reverse().find((m: any) => m.t === 'room');

  it('create → created + room(房主落座 0，其余空)', () => {
    const a = fakeClient(); hello(a, '甲');
    reg.handle(a, { t: 'create' });
    expect(a.sent).toContainEqual({ t: 'created', code: 'ABC123', isPrivate: false });
    const r = roomMsg(a);
    expect(r.status).toBe('waiting');
    expect(r.you).toBe(0);
    expect(r.seats[0]).toMatchObject({ nick: '甲', online: true, ai: false });
    expect(r.seats[1]).toBeNull();
  });

  it('join + take-seat：乙坐座位 2，双方都收到更新的 room', () => {
    const a = fakeClient(); const b = fakeClient(); hello(a, '甲'); hello(b, '乙');
    reg.handle(a, { t: 'create' });
    reg.handle(b, { t: 'join', code: 'ABC123' });
    reg.handle(b, { t: 'take-seat', seat: 2 });
    expect(roomMsg(b).you).toBe(2);
    expect(roomMsg(a).seats[2]).toMatchObject({ nick: '乙', online: true });
  });

  it('坐已占座位 → error，原座位不变', () => {
    const a = fakeClient(); const b = fakeClient(); hello(a, '甲'); hello(b, '乙');
    reg.handle(a, { t: 'create' });            // 甲在 0
    reg.handle(b, { t: 'join', code: 'ABC123' });
    reg.handle(b, { t: 'take-seat', seat: 0 }); // 抢甲的座
    expect(last(b).t).toBe('error');
  });

  it('换座：甲从 0 换到 1，座位 0 释放', () => {
    const a = fakeClient(); hello(a, '甲');
    reg.handle(a, { t: 'create' });
    reg.handle(a, { t: 'take-seat', seat: 1 });
    const r = roomMsg(a);
    expect(r.you).toBe(1);
    expect(r.seats[0]).toBeNull();
    expect(r.seats[1]).toMatchObject({ nick: '甲' });
  });

  it('take-seat 非整数座位号(1.5) → error，不产生幽灵座、房主仍在座 0', () => {
    const a = fakeClient(); hello(a, '甲');
    reg.handle(a, { t: 'create' });                 // 甲(房主)坐 0
    reg.handle(a, { t: 'take-seat', seat: 1.5 });
    expect(last(a).t).toBe('error');
    const room = reg.roomSnapshot('ABC123');
    expect(room.seats.filter(Boolean).length).toBe(1);          // 无幽灵座
    expect(room.seats[0]).toMatchObject({ nick: '甲', connected: true }); // 甲没被清出
    expect(reg.seatOf(a)).toEqual({ code: 'ABC123', seat: 0 });
  });
});

describe('RoomRegistry — 房主开打', () => {
  // 假 driver：start() 返回一条广播；made 收着造出来的每个 driver，供断言「真的建了/真的 start 了」
  let made: any[];
  const fakeDriver = (room: any) => {
    const d = { room, started: false,
      start() { this.started = true; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }]; } };
    made.push(d); return d;
  };
  let reg: any;
  beforeEach(() => { made = []; reg = new RoomRegistry(() => 'ABC123', fakeDriver); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });

  function fourSeated() {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => hello(c, '玩家' + i));
    reg.handle(cs[0], { t: 'create' });                         // 0
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    return cs;
  }

  it('不满 4 人 start → 开打成功，空座补 AI（≥1 人即可开）', () => {
    const cs = [fakeClient(), fakeClient()]; cs.forEach((c, i) => hello(c, 'p' + i));
    reg.handle(cs[0], { t: 'create' });
    reg.handle(cs[1], { t: 'join', code: 'ABC123' }); reg.handle(cs[1], { t: 'take-seat', seat: 1 });
    reg.handle(cs[0], { t: 'start' });
    expect(cs[0]!.sent.some((m: any) => m.t === 'error')).toBe(false);
    expect(cs[0]!.sent).toContainEqual({ t: 'started' });
    const room = reg.roomSnapshot('ABC123');
    expect(room.status).toBe('playing');
    expect(room.seats[2]).toMatchObject({ ai: true, connected: false });  // 座 2 补 AI（无真连接）
    expect(room.seats[3]).toMatchObject({ ai: true, connected: false });  // 座 3 补 AI
    expect(room.seats[0]).toMatchObject({ ai: false, connected: true });  // 座 0 真人
  });

  it('1 人(房主)即可 start → 其余 3 座补 AI（单机 = 联机 1 人 + 3 AI）', () => {
    const c = fakeClient(); hello(c, '阿东');
    reg.handle(c, { t: 'create' });
    reg.handle(c, { t: 'start' });
    expect(c.sent.some((m: any) => m.t === 'error')).toBe(false);
    expect(c.sent).toContainEqual({ t: 'started' });
    const room = reg.roomSnapshot('ABC123');
    expect(room.status).toBe('playing');
    expect(room.seats.filter((s: any) => s && s.ai).length).toBe(3);
    expect(room.seats.filter((s: any) => s && !s.ai).length).toBe(1);
  });

  it('空座补的 AI 真的会出牌——不是只把座位标成 ai 就算数', () => {
    // 原来这里只断言 seats[2].ai === true。那只证明标了个记号：
    // 若开打时把「补 AI」和「告诉 driver 这些座是 AI」的次序写反，首攻恰好是 AI 座就会整局卡死，
    // 而那条断言照样绿。所以要断言**真的有非人类座位出了牌**。
    vi.useFakeTimers();
    const steps: number[] = [];
    const aiDriver = () => ({
      phase: 'playing', ply: 0, state: { turn: 1 },   // 首攻就是空座（座 1 之后全是 AI）
      start() { return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 1 } }]; },
      setAI() { return []; },
      stepAI() {
        steps.push(this.state.turn);
        this.ply++; this.state = { turn: (this.state.turn + 1) % 4 };
        return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: this.state.turn } }];
      },
    });
    const r: any = new RoomRegistry(() => 'ABC123', aiDriver);
    const c = fakeClient();
    r.handle(c, { t: 'hello', nick: '独' });
    r.handle(c, { t: 'create' });
    r.handle(c, { t: 'start' });                        // 1 真人 + 3 AI

    expect(r.roomSnapshot('ABC123').seats[1]).toMatchObject({ ai: true, connected: false });
    expect(steps).toHaveLength(0);                      // AI 带思考延迟，还没落子
    vi.advanceTimersByTime(2600);                       // 思考时长上限 1200+1300
    expect(steps.length).toBeGreaterThan(0);            // 空座 AI 真的出了牌
    expect(steps[0]).toBe(1);                           // 出牌的正是那个补位空座
    vi.useRealTimers();
  });

  // 原有一条「无人落座 start → error」的测试已删除。
  // 它测的是一个**从任何公开入口都到不了**的防御分支：房主建房必坐 0，非房主离座只清自己那一格，
  // 房主一走整个房就被删掉——四座全空且房还在的状态构造不出来。原测试只能靠
  // `reg.rooms.get(...).seats[0] = null` 直接改内部结构来摆样子。
  // 抽公共房间层时那个入口必然消失，这条测试会跟着重写，而重写后跑绿证明不了任何事。
  // 留一个只能靠捅内部才成立的测试，等于给零回归基线掺水，所以删掉并在此说明。

  it('非房主 start → error', () => {
    const cs = fourSeated();
    reg.handle(cs[2], { t: 'start' });
    expect(last(cs[2]).t).toBe('error');
  });

  it('房主 4 人满 start → playing，建 driver，广播 started + driver 初态', () => {
    const cs = fourSeated();
    reg.handle(cs[0], { t: 'start' });
    expect(cs[0]!.sent).toContainEqual({ t: 'started' });
    expect(cs[3]!.sent).toContainEqual({ t: 'state', phase: 'playing', turn: 0 });
    const room = reg.roomSnapshot('ABC123');
    expect(room.status).toBe('playing');
    expect(room.hasDriver).toBe(true);
    expect(made).toHaveLength(1);
    expect(made[0].started).toBe(true);
  });
});

describe('RoomRegistry — 随机匹配', () => {
  let codes: string[]; let reg: any;
  const fakeDriver = (room: any) => ({ start: () => [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }] });
  beforeEach(() => { codes = ['M00001']; reg = new RoomRegistry(() => codes.shift() || 'X' + Math.random(), fakeDriver); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });

  it('凑够 4 人自动开局：四人各落一座、收 started', () => {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => { hello(c, 'q' + i); reg.handle(c, { t: 'match' }); });
    cs.forEach(c => expect(c.sent).toContainEqual({ t: 'started' }));
    const room = reg.roomSnapshot('M00001');
    expect(room.status).toBe('playing');
    expect(room.seats.map((s: any) => s.nick).sort()).toEqual(['q0', 'q1', 'q2', 'q3']);
  });

  it('不足 4 人时只入池不开局', () => {
    const cs = [fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => { hello(c, 'q' + i); reg.handle(c, { t: 'match' }); });
    cs.forEach(c => expect(c.sent).not.toContainEqual({ t: 'started' }));
    expect(reg.matchQueueSize()).toBe(3);
    expect(reg.roomSnapshot('M00001')).toBeNull();   // 一间房都还没开
  });
});

describe('RoomRegistry — 大厅 + 观战', () => {
  const fakeDriver = (room: any) => ({ start: () => [], spectatorSync: () => [{ to: 'all', msg: { t: 'state', phase: 'playing' } }] });
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123', fakeDriver); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });
  function playingRoom() {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => hello(c, 'p' + i));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' });
    return cs;
  }

  it('lobby 订阅 → 收公开房列表', () => {
    playingRoom();
    const v = fakeClient(); reg.handle(v, { t: 'lobby' });
    const lob = [...v.sent].reverse().find((m: any) => m.t === 'lobby');
    expect(lob.rooms.find((r: any) => r.code === 'ABC123')).toBeTruthy();
  });

  it('spectate playing 房 → spectating + 进观众集', () => {
    playingRoom();
    const v = fakeClient(); hello(v, '观'); reg.handle(v, { t: 'spectate', code: 'ABC123' });
    expect([...v.sent].reverse().find((m: any) => m.t === 'spectating')).toBeTruthy();
    expect(reg.roomSnapshot('ABC123').spectators).toBe(1);
    expect(reg.seatOf(v)).toEqual({ code: 'ABC123', seat: 'spectator' });
  });

  it('观战者发 play → 被忽略（不进 driver）', () => {
    playingRoom();
    const v = fakeClient(); hello(v, '观'); reg.handle(v, { t: 'spectate', code: 'ABC123' });
    const before = v.sent.length;
    reg.handle(v, { t: 'play', cardIds: [1, 2] });
    expect(v.sent.length).toBe(before); // 无响应
  });
});

describe('RoomRegistry — 掉线', () => {
  const drv = (room: any) => ({ start: () => [], setAI: (seat: number, on: boolean) => [{ to: 'all', msg: { t: 'state', aiSeat: seat, ai: on } }] });
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123', drv); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });
  function playing() {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => hello(c, 'p' + i));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' });
    return cs;
  }

  it('waiting 房房主离开 → 删房', () => {
    const a = fakeClient(); hello(a, '甲'); reg.handle(a, { t: 'create' });
    reg.leave(a);
    expect(reg.hasRoom('ABC123')).toBe(false);
  });

  it('playing 中一人掉线 → 座位 offline+ai，其余收 peer-offline，房保留', () => {
    const cs = playing();
    reg.leave(cs[2]);
    const room = reg.roomSnapshot('ABC123');
    expect(room).toBeTruthy();
    expect(room.seats[2]).toMatchObject({ online: false, ai: true, nick: 'p2', connected: false }); // 保留昵称作凭据
    expect(cs[0]!.sent).toContainEqual({ t: 'peer-offline', seat: 2 });
  });

  it('playing 中 4 真人全掉线 → 删房', () => {
    const cs = playing();
    cs.forEach(c => reg.leave(c));
    expect(reg.hasRoom('ABC123')).toBe(false);
  });
});

describe('RoomRegistry — 重连', () => {
  const drv = (room: any) => ({ start: () => [], setAI: () => [], syncSeat: (seat: number) => [{ to: 'seat', seat, msg: { t: 'state', resync: seat } }] });
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123', drv); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });
  function playing() {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => hello(c, 'p' + i));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' });
    return cs;
  }

  it('掉线后 rejoin(带会话令牌) → 收回座位、收 rejoined + 重发态、其余收 peer-back', () => {
    const cs = playing();
    const token = tokenOf(cs[2]);
    reg.leave(cs[2]);
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', token, nick: 'p2' });
    expect(re.sent).toContainEqual({ t: 'rejoined', seat: 2 });
    expect(re.sent).toContainEqual({ t: 'state', resync: 2 });
    expect(reg.roomSnapshot('ABC123').seats[2])
      .toMatchObject({ online: true, ai: false, nick: 'p2', connected: true });
    expect(reg.seatOf(re)).toEqual({ code: 'ABC123', seat: 2 });
    expect(cs[0]!.sent).toContainEqual({ t: 'peer-back', seat: 2 });
  });

  it('座位未掉线时 rejoin(哪怕带正确令牌) → error', () => {
    const cs = playing();
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', token: tokenOf(cs[2]), nick: 'p2' }); // p2 仍在线
    expect(last(re).t).toBe('error');
  });

  it('会话令牌错误/缺失 → error（防拿房号+昵称冒名劫持座位与手牌）', () => {
    const cs = playing();
    reg.leave(cs[2]);                                                          // p2 掉线、座位空出
    const attacker = fakeClient();
    reg.handle(attacker, { t: 'rejoin', code: 'ABC123', token: 'wrong', nick: 'p2' }); // 知昵称但令牌错
    expect(last(attacker).t).toBe('error');
    reg.handle(attacker, { t: 'rejoin', code: 'ABC123', nick: 'p2' });                  // 完全无令牌
    expect(last(attacker).t).toBe('error');
    expect(attacker.sent.some((m: any) => m.t === 'hand')).toBe(false);                 // 绝不给攻击者下发手牌
    reg.handle(cs[2], { t: 'rejoin', code: 'ABC123', token: tokenOf(cs[2]), nick: 'p2' }); // 真主凭令牌可回
    expect(cs[2]!.sent).toContainEqual({ t: 'rejoined', seat: 2 });
  });
});

describe('RoomRegistry — play/pass 转 driver', () => {
  function fakeDriverWithPlay() {
    return {
      started: false,
      playCalled: null as any,
      passCalled: null as any,
      start() { this.started = true; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }]; },
      handlePlay(seat: number, cardIds: number[]) { this.playCalled = { seat, cardIds }; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 1 } }]; },
      handlePass(seat: number) { this.passCalled = seat; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 1 } }]; },
    };
  }

  let reg: any;
  let cs: any[];
  let drv: any;
  beforeEach(() => {
    drv = fakeDriverWithPlay();
    reg = new RoomRegistry(() => 'ABC123', () => drv);
    cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => reg.handle(c, { t: 'hello', nick: 'p' + i }));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) {
      reg.handle(cs[i], { t: 'join', code: 'ABC123' });
      reg.handle(cs[i], { t: 'take-seat', seat: i });
    }
    reg.handle(cs[0], { t: 'start' });
  });

  it('play 消息转 driver.handlePlay，outbound 广播给所有玩家', () => {
    reg.handle(cs[0], { t: 'play', cardIds: [42, 43] });
    expect(drv.playCalled).toEqual({ seat: 0, cardIds: [42, 43] });
    // all 4 clients receive the state broadcast from handlePlay
    cs.forEach(c => {
      expect(c.sent).toContainEqual({ t: 'state', phase: 'playing', turn: 1 });
    });
  });

  it('pass 消息转 driver.handlePass，outbound 广播给所有玩家', () => {
    reg.handle(cs[1], { t: 'pass' });
    expect(drv.passCalled).toBe(1);
    cs.forEach(c => {
      expect(c.sent).toContainEqual({ t: 'state', phase: 'playing', turn: 1 });
    });
  });

  it('观战者发 play → 忽略，driver 不被调用', () => {
    const v = fakeClient();
    reg.handle(v, { t: 'hello', nick: '观众' });
    reg.handle(v, { t: 'spectate', code: 'ABC123' });
    const before = JSON.stringify(drv.playCalled);
    reg.handle(v, { t: 'play', cardIds: [1] });
    expect(JSON.stringify(drv.playCalled)).toBe(before);
  });
});

describe('RoomRegistry — 单局结算停留(dealResultLinger)', () => {
  afterEach(() => { vi.useRealTimers(); });
  // 假 driver：出一手牌就返回「本局结算」的公开态，于是续局逻辑可以从公开入口（play）驱动，
  // 不必去调 reg._dispatch —— 那是内部方法，抽公共层时会改名，测试跟着改就失去零回归的意义。
  function mkDriver() {
    return {
      match: { over: false }, online: [true, true, true, true], started: false, nextDealCalls: 0,
      start() { this.started = true; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }]; },
      handlePlay() { return [{ to: 'all', msg: { t: 'state', phase: 'dealResult', result: { lastHand: [] } } }]; },
      nextDeal() { this.nextDealCalls++; return [{ to: 'all', msg: { t: 'state', phase: 'tribute', tribute: { exchanges: [], resist: false, doubleDown: false, pending: [] } } }]; },
    };
  }
  function playingRoom(lingerMs: number) {
    const drv = mkDriver();
    const reg: any = new RoomRegistry(() => 'ABC123', () => drv, 0, 0, 0, 2, lingerMs);
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => reg.handle(c, { t: 'hello', nick: 'p' + i }));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' });
    /** 从公开入口打出一手牌 → driver 返回 dealResult → 触发续局逻辑 */
    const finishDeal = () => reg.handle(cs[0], { t: 'play', cardIds: [] });
    return { reg, drv, cs, finishDeal };
  }

  it('dealResult 后停留 lingerMs 再续局（不立即 nextDeal，避免一闪而过看不清末游牌）', () => {
    vi.useFakeTimers();
    const { drv, finishDeal } = playingRoom(4500);
    finishDeal();
    expect(drv.nextDealCalls).toBe(0);        // 刚结算：未续局
    vi.advanceTimersByTime(4400);
    expect(drv.nextDealCalls).toBe(0);        // 未到点：仍停留
    vi.advanceTimersByTime(200);
    expect(drv.nextDealCalls).toBe(1);        // 过 4.5s → 续局
  });

  it('lingerMs=0 → 下一 tick 即续局（测试默认，保持快）', () => {
    vi.useFakeTimers();
    const { drv, finishDeal } = playingRoom(0);
    finishDeal();
    vi.advanceTimersByTime(0);
    expect(drv.nextDealCalls).toBe(1);
  });

  it('续局后玩家真的收到了新一局的公开态（不是只把 nextDeal 调了一次就算数）', () => {
    vi.useFakeTimers();
    const { cs, finishDeal } = playingRoom(0);
    finishDeal();
    vi.advanceTimersByTime(0);
    for (const c of cs) {
      expect(c.sent.some((m: any) => m.t === 'state' && m.phase === 'tribute')).toBe(true);
    }
  });
});

describe('RoomRegistry — 再来一盘(restart)', () => {
  let made: any[]; let reg: any;
  const makeDrv = (_room: any) => {
    const id = made.length;
    const d = {
      id, match: { over: false }, online: [true, true, true, true], started: false,
      start() { this.started = true; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0, drv: id } }]; },
      setAI(seat: number, on: boolean) { this.online[seat] = !on; return [{ to: 'all', msg: { t: 'state', setAI: seat } }]; },
    };
    made.push(d); return d;
  };
  beforeEach(() => { made = []; reg = new RoomRegistry(() => 'ABC123', makeDrv); });
  const hello = (c: any, n: string) => reg.handle(c, { t: 'hello', nick: n });
  function playing() {
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => hello(c, 'p' + i));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' });   // made=[drv0]
    return cs;
  }

  it('matchOver 后房主 restart → 新建 driver(留座)、AI 座同步 online=false、重发新局态', () => {
    const cs = playing();
    made[0].match.over = true;                              // 整盘结束
    reg.leave(cs[2]);                                       // 座 2 掉线 → 转 AI（公开路径，不去改内部字段）
    expect(reg.roomSnapshot('ABC123').seats[2]).toMatchObject({ ai: true, online: false });
    reg.handle(cs[0], { t: 'restart' });
    expect(made.length).toBe(2);                            // 新建 drv1
    const nd = made[1];
    expect(nd.started).toBe(true);                          // 新 driver start()
    expect(nd.online[2]).toBe(false);                       // setAI 把 AI 座同步为 offline
    expect(nd.online[0]).toBe(true);                        // 真人座不变
    expect(cs[0]!.sent).toContainEqual({ t: 'state', phase: 'playing', turn: 0, drv: 1 }); // 房主收到新局态
  });

  it('非房主 restart → error', () => {
    const cs = playing();
    made[0].match.over = true;
    reg.handle(cs[2], { t: 'restart' });
    expect(last(cs[2]).t).toBe('error');
    expect(made.length).toBe(1);                            // 未新建
  });

  it('本盘未结束(match.over=false) restart → error，不新建 driver', () => {
    const cs = playing();
    reg.handle(cs[0], { t: 'restart' });
    expect(last(cs[0]).t).toBe('error');
    expect(made.length).toBe(1);
  });

  it('房主断线重连后 restart 仍有效（房主标识随重连座转移，不永久失效）', () => {
    const cs = playing();
    const token = tokenOf(cs[0]);
    reg.leave(cs[0]);                                  // 房主(座0)断线
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', token, nick: 'p0' }); // 房主用新连接重连座0
    expect(re.sent).toContainEqual({ t: 'rejoined', seat: 0 });
    made[0].match.over = true;                         // 整盘结束
    reg.handle(re, { t: 'restart' });                  // 新连接发再来一盘
    expect(made.length).toBe(2);                       // 成功新建 driver(修前 room.host 仍指旧连接→error 不新建)
    expect(re.sent.some((m: any) => m.t === 'state' && m.drv === 1)).toBe(true); // 新局态真的发到了他手上
  });
});

describe('RoomRegistry — 回合超时 + 观战不刷计时', () => {
  // 带回合态的假 driver：phase/state.turn/ply/forceAutoPlay 齐全，供 _armTurnTimeout 判定。
  function timedDriver() {
    return {
      phase: 'playing', ply: 0, state: { turn: 0 }, autoCalls: 0,
      start() { return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }]; },
      spectatorSync() { return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: this.state.turn } }]; },
      syncSeat(seat: number) { return [{ to: 'seat', seat, msg: { t: 'state', phase: 'playing', turn: this.state.turn } }]; },
      setAI() { return []; },
      handlePlay(seat: number) { this.ply++; this.state = { turn: (seat + 1) % 4 }; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: this.state.turn } }]; },
      forceAutoPlay() { this.autoCalls++; this.ply++; this.state = { turn: (this.state.turn + 1) % 4 }; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: this.state.turn } }]; },
    };
  }
  let reg: any; let drv: any; let cs: any[];
  beforeEach(() => {
    vi.useFakeTimers();
    drv = timedDriver();
    reg = new RoomRegistry(() => 'ABC123', () => drv, 0, 5000); // turnTimeoutMs=5000
    cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => reg.handle(c, { t: 'hello', nick: 'p' + i }));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' }); // t=0 起，给座 0 armed 5000ms
  });
  afterEach(() => { vi.useRealTimers(); });
  const lastState = (c: any) => [...c.sent].reverse().find((m: any) => m.t === 'state');

  it('观战中途进入不重置真人回合计时：到点照常托管，不被推后', () => {
    vi.advanceTimersByTime(2000);                 // t=2000
    const v = fakeClient(); reg.handle(v, { t: 'hello', nick: '观' });
    reg.handle(v, { t: 'spectate', code: 'ABC123' }); // 观众进场 → 不应重置座 0 的计时
    vi.advanceTimersByTime(2500);                 // t=4500，原计时 t=5000 未到
    expect(drv.autoCalls).toBe(0);
    vi.advanceTimersByTime(1000);                 // t=5500，原计时 t=5000 应已触发
    expect(drv.autoCalls).toBe(1);                // 准点托管，没被观众进场推后
  });

  it('观战者收到的 state 带真实剩余 turnRemainMs（非各自从满倒计）', () => {
    vi.advanceTimersByTime(2000);                 // 座 0 计时已走 2000ms
    const v = fakeClient(); reg.handle(v, { t: 'hello', nick: '观' });
    reg.handle(v, { t: 'spectate', code: 'ABC123' });
    expect(lastState(v).turnRemainMs).toBe(3000); // 5000 - 2000，看到真实剩余
  });

  it('真人出牌（回合真变）才重置计时', () => {
    vi.advanceTimersByTime(2000);
    reg.handle(cs[0], { t: 'play', cardIds: [1] }); // 座 0 出牌 → turn=1、ply+1 → 给座 1 重置 5000
    expect(lastState(cs[1]).turnRemainMs).toBe(5000); // 新回合满计时
  });

  it('非对局阶段的公开态不带 turnRemainMs（负向：别把倒计时盖到结算/进贡弹层上）', () => {
    // 只有 phase==='playing' 的 state 才该被注入剩余毫秒。原先只有正向断言，
    // 一旦注入条件写宽，结算态也会挂上一个莫名其妙的倒计时，而没有测试拦得住。
    vi.advanceTimersByTime(2000);
    drv.handlePlay = () => [{ to: 'all', msg: { t: 'state', phase: 'dealResult', result: {} } }];
    reg.handle(cs[0], { t: 'play', cardIds: [1] });
    const st = lastState(cs[1]);
    expect(st.phase).toBe('dealResult');
    expect(st.turnRemainMs).toBeUndefined();
  });
});

describe('RoomRegistry — 掉线宽限接管', () => {
  function graceDriver() {
    return {
      phase: 'playing', ply: 0, state: { turn: 0 },
      online: [true, true, true, true], autoCalls: [] as number[], setAICalls: [] as any[],
      start() { return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }]; },
      setAI(seat: number, on: boolean) { this.online[seat] = !on; this.setAICalls.push({ seat, on }); return [{ to: 'all', msg: { t: 'state', setAI: seat, on } }]; },
      forceAutoPlay() { this.autoCalls.push(this.state.turn); this.ply++; this.state = { turn: (this.state.turn + 1) % 4 }; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: this.state.turn } }]; },
      handlePlay(seat: number) { this.ply++; this.state = { turn: (seat + 1) % 4 }; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: this.state.turn } }]; },
      syncSeat(seat: number) { return [{ to: 'seat', seat, msg: { t: 'state', phase: 'playing', turn: this.state.turn } }]; },
    };
  }
  let reg: any; let drv: any; let cs: any[];
  const GRACE = 10000, TURN = 20000;
  beforeEach(() => {
    vi.useFakeTimers();
    drv = graceDriver();
    reg = new RoomRegistry(() => 'ABC123', () => drv, 0, TURN, GRACE, 2); // turn 20s, grace 10s, 连续2手转AI
    cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => reg.handle(c, { t: 'hello', nick: 'p' + i }));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' }); // T 起，座0 arm 20s
  });
  afterEach(() => { vi.useRealTimers(); });
  const room = () => reg.roomSnapshot('ABC123');
  /**
   * 把回合推到座 t：从公开入口让座 (t-1) 出一手牌。
   * 假 driver 的 handlePlay(seat) 会把 turn 置为 seat+1 并推进 ply，于是回合计时按新座位重置。
   * 原来这里直接调 reg._dispatch 灌一条 state —— 那是内部方法，抽公共层时会改名。
   */
  const turnTo = (t: number) => reg.handle(cs[(t + 3) % 4], { t: 'play', cardIds: [] });

  it('掉线 → 进宽限，不立刻全速AI（座位 disconnected、未 setAI）', () => {
    reg.leave(cs[1]); // 座1掉线（非当前回合）
    expect(room().seats[1]).toMatchObject({ online: false, disconnected: true, ai: false });
    expect(drv.setAICalls.find((c: any) => c.seat === 1 && c.on === true)).toBeUndefined(); // 没立刻全速AI
    expect(drv.online[1]).toBe(true); // driver 仍当它在（不全速代打）
  });

  it('掉线宽限座轮到 → 等宽限(10s)才代打一手，连续2手没回来才转全速AI', () => {
    reg.leave(cs[1]);
    turnTo(1);                                   // 轮到座1（宽限）→ arm 10s
    vi.advanceTimersByTime(9999); expect(drv.autoCalls).not.toContain(1); // 没到点不代打
    vi.advanceTimersByTime(1);                   // 10s 到点 → 代打第1手
    expect(drv.autoCalls).toContain(1);
    // 「被代打了几手」是内部记账，不断言它；断言它带来的可观察后果：才 1 手，还没转全速 AI
    expect(room().seats[1]).toMatchObject({ disconnected: true, ai: false });
    expect(drv.setAICalls.find((c: any) => c.seat === 1 && c.on === true)).toBeUndefined();

    turnTo(1);                                   // 再轮到座1 → arm 10s
    vi.advanceTimersByTime(10000);               // 第2手到点 → 转全速AI
    expect(drv.setAICalls.find((c: any) => c.seat === 1 && c.on === true)).toBeTruthy();
    expect(room().seats[1]).toMatchObject({ ai: true, disconnected: false });
    expect(drv.online[1]).toBe(false);
  });

  it('宽限/已接管中重连 → 收回座位、变回人打', () => {
    const token = tokenOf(cs[1]);
    reg.leave(cs[1]);
    turnTo(1); vi.advanceTimersByTime(10000);    // 已被代打 1 手
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', token, nick: 'p1' });
    expect(re.sent).toContainEqual({ t: 'rejoined', seat: 1 });
    expect(room().seats[1]).toMatchObject({ online: true, disconnected: false, ai: false, connected: true });
  });

  it('重连把宽限额度也还回来：再掉线仍要连续 2 手没回来才转全速AI', () => {
    // 「计数清零」原本是断言 graceMisses===0 —— 那是内部记账。
    // 它真正的意思是「宽限额度重新给满」，这才是可观察的：回来又走，还得再挨 2 手。
    const token = tokenOf(cs[1]);
    reg.leave(cs[1]);
    turnTo(1); vi.advanceTimersByTime(10000);    // 第 1 手被代打
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', token, nick: 'p1' });

    reg.leave(re);                                // 又掉线
    turnTo(1); vi.advanceTimersByTime(10000);    // 重连后的第 1 手
    expect(room().seats[1]).toMatchObject({ disconnected: true, ai: false }); // 若额度没归零，这里已经转 AI 了
    turnTo(1); vi.advanceTimersByTime(10000);    // 重连后的第 2 手
    expect(room().seats[1]).toMatchObject({ ai: true, disconnected: false });
  });

  it('断线正当回合：截止压到 min(剩余,宽限)，断线不续命', () => {
    vi.advanceTimersByTime(15000); // 座0 已走15s（在线20s，剩5s）
    reg.leave(cs[0]);              // 座0掉线，正是当前回合 → 压到 min(剩5s, 宽限10s)=5s（不续命成10s）
    vi.advanceTimersByTime(4999); expect(drv.autoCalls).not.toContain(0); // 剩~5s，没到点
    vi.advanceTimersByTime(1);    // 再5s 到点（不是10s）
    expect(drv.autoCalls).toContain(0);
  });

  it('刚轮到就断线：截止压到宽限(10s)上限', () => {
    vi.advanceTimersByTime(2000);  // 座0 才走2s（剩18s）
    reg.leave(cs[0]);              // 掉线 → min(剩18s, 宽限10s)=10s
    vi.advanceTimersByTime(9999); expect(drv.autoCalls).not.toContain(0);
    vi.advanceTimersByTime(1);     // 10s 到点（封顶，不等满18s）
    expect(drv.autoCalls).toContain(0);
  });
});

describe('还贡超时：仅"不止 1 真人"时启用（单机不催）', () => {
  // 原来这里手搓一个假 room 对象、直接调 reg._armTributeTimeout、再断言 room._tributeTimer 存不存在。
  // 那是三重内部依赖（内部方法 + 内部字段 + 内部数据结构），抽公共层时一个都留不下。
  // 改成从公开入口把房间真开起来，用「到点之后有没有替人还贡」这个可观察行为来断言。
  afterEach(() => { vi.useRealTimers(); });

  function mkDriver() {
    return {
      autoReturnCalls: 0,
      start() { return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }]; },
      setAI() { return []; },
      handlePlay() { return [{ to: 'all', msg: { t: 'need-tribute', options: [] } }]; },
      forceAutoReturn() { this.autoReturnCalls++; return []; },
    };
  }

  /** 开一间 `humans` 个真人的房，其余空座由服务端补 AI，然后走到「等还贡」这一步 */
  function roomWithHumans(humans: number) {
    vi.useFakeTimers();
    const drv = mkDriver();
    const reg: any = new RoomRegistry(() => 'ABC123', () => drv, 30000);
    const cs = Array.from({ length: humans }, () => fakeClient());
    cs.forEach((c, i) => reg.handle(c, { t: 'hello', nick: 'p' + i }));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < humans; i++) {
      reg.handle(cs[i], { t: 'join', code: 'ABC123' });
      reg.handle(cs[i], { t: 'take-seat', seat: i });
    }
    reg.handle(cs[0], { t: 'start' });                 // 空座补 AI
    reg.handle(cs[0], { t: 'play', cardIds: [] });     // driver 抛出 need-tribute → 该不该起超时就看这一步
    return { reg, drv };
  }

  it('1 真人 + 3 AI（单机）→ 不催：到点也不替他还贡，可以慢慢选', () => {
    const { drv } = roomWithHumans(1);
    vi.advanceTimersByTime(60000);
    expect(drv.autoReturnCalls).toBe(0);
  });

  it('2 真人 + 2 AI → 到点自动替他还贡（防一人发呆卡住别人）', () => {
    const { drv } = roomWithHumans(2);
    vi.advanceTimersByTime(29999);
    expect(drv.autoReturnCalls).toBe(0);   // 没到点不催
    vi.advanceTimersByTime(1);
    expect(drv.autoReturnCalls).toBe(1);   // 30s 到点
  });
});
