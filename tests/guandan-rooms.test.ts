import { describe, it, expect, beforeEach } from 'vitest';
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

  it('不满 4 人 start → error', () => {
    const cs = [fakeClient(), fakeClient()]; cs.forEach((c, i) => hello(c, 'p' + i));
    reg.handle(cs[0], { t: 'create' });
    reg.handle(cs[1], { t: 'join', code: 'ABC123' }); reg.handle(cs[1], { t: 'take-seat', seat: 1 });
    reg.handle(cs[0], { t: 'start' });
    expect(last(cs[0]).t).toBe('error');
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
