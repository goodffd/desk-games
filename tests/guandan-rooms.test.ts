import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore
import { RoomRegistry } from '../server/guandan-rooms.mjs';

function fakeClient() { const sent: any[] = []; return { sent, send: (m: any) => sent.push(m) }; }
const last = (c: any) => c.sent[c.sent.length - 1];

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
    const room = reg.rooms.get('ABC123');
    expect(room.seats.filter(Boolean).length).toBe(1); // 无幽灵座
    expect(room.seats[0].client).toBe(a);              // 甲没被清出
  });
});

describe('RoomRegistry — 房主开打', () => {
  // 假 driver：记录被创建，start() 返回一条广播
  const fakeDriver = (room: any) => ({ room, started: false,
    start() { this.started = true; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }]; } });
  let reg: any;
  beforeEach(() => { reg = new RoomRegistry(() => 'ABC123', fakeDriver); });
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
    const room = reg.rooms.get('ABC123');
    expect(room.status).toBe('playing');
    expect(room.seats[2].ai).toBe(true);   // 座 2 补 AI
    expect(room.seats[3].ai).toBe(true);   // 座 3 补 AI
    expect(room.seats[0].ai).toBe(false);  // 座 0 真人
  });

  it('1 人(房主)即可 start → 其余 3 座补 AI（单机 = 联机 1 人 + 3 AI）', () => {
    const c = fakeClient(); hello(c, '阿东');
    reg.handle(c, { t: 'create' });
    reg.handle(c, { t: 'start' });
    expect(c.sent.some((m: any) => m.t === 'error')).toBe(false);
    expect(c.sent).toContainEqual({ t: 'started' });
    const room = reg.rooms.get('ABC123');
    expect(room.status).toBe('playing');
    expect(room.seats.filter((s: any) => s && s.ai).length).toBe(3);
    expect(room.seats.filter((s: any) => s && !s.ai).length).toBe(1);
  });

  it('无人落座 start → error（理论上房主必坐0，防御性）', () => {
    const c = fakeClient(); hello(c, 'x');
    reg.handle(c, { t: 'create' });
    reg.rooms.get('ABC123').seats[0] = null; // 强制清空
    reg.handle(c, { t: 'start' });
    expect(last(c).t).toBe('error');
  });

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
    const room = reg.rooms.get('ABC123');
    expect(room.status).toBe('playing');
    expect(room.driver.started).toBe(true);
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
    const room = reg.rooms.get('M00001');
    expect(room.status).toBe('playing');
    expect(room.seats.map((s: any) => s.nick).sort()).toEqual(['q0', 'q1', 'q2', 'q3']);
  });

  it('不足 4 人时只入池不开局', () => {
    const cs = [fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => { hello(c, 'q' + i); reg.handle(c, { t: 'match' }); });
    cs.forEach(c => expect(c.sent).not.toContainEqual({ t: 'started' }));
    expect(reg.queue.length).toBe(3);
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
    expect(reg.rooms.get('ABC123').spectators.has(v)).toBe(true);
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
    expect(reg.rooms.has('ABC123')).toBe(false);
  });

  it('playing 中一人掉线 → 座位 offline+ai，其余收 peer-offline，房保留', () => {
    const cs = playing();
    reg.leave(cs[2]);
    const room = reg.rooms.get('ABC123');
    expect(room).toBeTruthy();
    expect(room.seats[2]).toMatchObject({ online: false, ai: true, nick: 'p2' }); // 保留昵称作凭据
    expect(cs[0]!.sent).toContainEqual({ t: 'peer-offline', seat: 2 });
  });

  it('playing 中 4 真人全掉线 → 删房', () => {
    const cs = playing();
    cs.forEach(c => reg.leave(c));
    expect(reg.rooms.has('ABC123')).toBe(false);
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

  it('掉线后 rejoin → 收回座位、收 rejoined + 重发态、其余收 peer-back', () => {
    const cs = playing();
    reg.leave(cs[2]);
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', nick: 'p2' });
    expect(re.sent).toContainEqual({ t: 'rejoined', seat: 2 });
    expect(re.sent).toContainEqual({ t: 'state', resync: 2 });
    const room = reg.rooms.get('ABC123');
    expect(room.seats[2]).toMatchObject({ online: true, ai: false, nick: 'p2' });
    expect(cs[0]!.sent).toContainEqual({ t: 'peer-back', seat: 2 });
  });

  it('座位未掉线 / 昵称不符 → error', () => {
    playing();
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', nick: 'p2' }); // p2 仍在线
    expect(last(re).t).toBe('error');
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
  function mkDriver() {
    return {
      match: { over: false }, online: [true, true, true, true], started: false, nextDealCalls: 0,
      start() { this.started = true; return [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: 0 } }]; },
      nextDeal() { this.nextDealCalls++; return [{ to: 'all', msg: { t: 'state', phase: 'tribute', tribute: { exchanges: [], resist: false, doubleDown: false, pending: [] } } }]; },
    };
  }
  function playingRoom(lingerMs: number) {
    const drv = mkDriver();
    const reg = new RoomRegistry(() => 'ABC123', () => drv, 0, 0, 0, 2, lingerMs);
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => reg.handle(c, { t: 'hello', nick: 'p' + i }));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' });
    return { reg, drv, room: reg.rooms.get('ABC123') };
  }
  const dealResult = [{ to: 'all', msg: { t: 'state', phase: 'dealResult', result: { lastHand: [] } } }];

  it('dealResult 后停留 lingerMs 再续局（不立即 nextDeal，避免一闪而过看不清末游牌）', () => {
    vi.useFakeTimers();
    const { reg, drv, room } = playingRoom(4500);
    reg._dispatch(room, dealResult);
    expect(drv.nextDealCalls).toBe(0);        // 刚结算：未续局
    vi.advanceTimersByTime(4400);
    expect(drv.nextDealCalls).toBe(0);        // 未到点：仍停留
    vi.advanceTimersByTime(200);
    expect(drv.nextDealCalls).toBe(1);        // 过 4.5s → 续局
  });

  it('lingerMs=0 → 下一 tick 即续局（测试默认，保持快）', () => {
    vi.useFakeTimers();
    const { reg, drv, room } = playingRoom(0);
    reg._dispatch(room, dealResult);
    vi.advanceTimersByTime(0);
    expect(drv.nextDealCalls).toBe(1);
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
    const room = reg.rooms.get('ABC123');
    room.driver.match.over = true;                          // 整盘结束
    room.seats[2].ai = true; room.seats[2].online = false;  // 座 2 当 AI（掉线）
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
    reg.rooms.get('ABC123').driver.match.over = true;
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
    const room = reg.rooms.get('ABC123');
    reg.leave(cs[0]);                                  // 房主(座0)断线
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', nick: 'p0' }); // 房主用新连接重连座0
    expect(re.sent).toContainEqual({ t: 'rejoined', seat: 0 });
    room.driver.match.over = true;                     // 整盘结束
    reg.handle(re, { t: 'restart' });                  // 新连接发再来一盘
    expect(made.length).toBe(2);                       // 成功新建 driver(修前 room.host 仍指旧连接→error 不新建)
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
  const room = () => reg.rooms.get('ABC123');
  // 模拟「出了一手，现在轮到座 t」：ply 变 → _armTurnTimeout 会按 t 的座位状态重置计时
  const turnTo = (t: number) => { drv.state = { turn: t }; drv.ply++; reg._dispatch(room(), [{ to: 'all', msg: { t: 'state', phase: 'playing', turn: t } }]); };

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
    expect(room().seats[1].graceMisses).toBe(1);
    expect(room().seats[1].disconnected).toBe(true); // 才1手，还没转AI
    turnTo(1);                                   // 再轮到座1 → arm 10s
    vi.advanceTimersByTime(10000);               // 第2手到点
    expect(room().seats[1].graceMisses).toBe(2);
    expect(drv.setAICalls.find((c: any) => c.seat === 1 && c.on === true)).toBeTruthy(); // 转全速AI
    expect(room().seats[1]).toMatchObject({ ai: true, disconnected: false });
    expect(drv.online[1]).toBe(false);
  });

  it('宽限/已接管中重连 → 收回座位、计数清零、变回人打', () => {
    reg.leave(cs[1]);
    turnTo(1); vi.advanceTimersByTime(10000);    // 被代打1手，graceMisses=1
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', nick: 'p1' });
    expect(re.sent).toContainEqual({ t: 'rejoined', seat: 1 });
    expect(room().seats[1]).toMatchObject({ online: true, disconnected: false, graceMisses: 0, ai: false });
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
  const ai = () => ({ online: false, ai: true });
  const human = () => ({ online: true, ai: false });
  const needTribute = [{ msg: { t: 'need-tribute' } }] as any;
  it('1 真人 + 3 AI（单机）→ 不设还贡超时（可慢慢选）', () => {
    const reg: any = new RoomRegistry(() => 'X', null, 30000);
    const room: any = { seats: [human(), ai(), ai(), ai()], driver: { forceAutoReturn: () => [] } };
    reg._armTributeTimeout(room, needTribute);
    expect(room._tributeTimer).toBeFalsy();
  });
  it('2 真人 + 2 AI → 设还贡超时（防一人发呆卡住别人）', () => {
    const reg: any = new RoomRegistry(() => 'X', null, 30000);
    const room: any = { seats: [human(), human(), ai(), ai()], driver: { forceAutoReturn: () => [] } };
    reg._armTributeTimeout(room, needTribute);
    expect(room._tributeTimer).toBeTruthy();
    clearTimeout(room._tributeTimer);
  });
});
