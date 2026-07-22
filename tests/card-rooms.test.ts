import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-ignore
import { CardRoomRegistry, NickRegistry } from '../server/card-rooms.mjs';
// @ts-ignore
import { RoomRegistry as GuandanRooms } from '../server/guandan-rooms.mjs';

/**
 * 通用牌类房间层的自有测试。
 *
 * 掼蛋那份（tests/guandan-rooms.test.ts）是**零回归基线**，抽层前后一字不改跑绿，
 * 证明「掼蛋的行为没变」。这份则证明公共层自己该有的能力：
 * 座位数参数化、各游戏各自大厅、昵称全服唯一、座位在线态真的走到了 wire 上。
 */

function fakeClient() { const sent: any[] = []; return { sent, send: (m: any) => sent.push(m) }; }
const last = (c: any) => c.sent[c.sent.length - 1];
const lastOf = (c: any, t: string) => [...c.sent].reverse().find((m: any) => m.t === t);

/**
 * 最简运行器：广播一条自带 seats 的公开态，供房间层把在线态写进去。
 * 认一种自造的对局消息 `{t:'go', seat}`，用来从**公开入口**把回合推到指定座位——
 * 测试不去碰房间层的计时器内部（那正是 #4 刚清掉的东西）。
 */
function fakeRunner(seatCount = 4) {
  const state = () => ({
    to: 'all',
    msg: { t: 'state', phase: 'playing', seats: Array.from({ length: seatCount }, (_, seat) => ({ seat })) },
  });
  const r: any = {
    started: false, turn: 0, ply: 0,
    start() { r.started = true; return [state()]; },
    // 真实的 MatchDriver 在 setAI 之后会重播公开态；替身若返回空数组，
    // 「掉线即转 AI」那条路上就没人把新在线态播出去，测出来的是替身的毛病不是实现的。
    setAI: () => [state()],
    syncSeat: () => [state()],
    spectatorSync: () => [state()],
    broadcastState: () => [state()],
    canForceAutoPlay: () => true,
    forceAutoPlay() { r.ply++; r.turn = (r.turn + 1) % seatCount; return [state()]; },
    canStepAI: () => false,
    stepAI: () => [],
    canNextDeal: () => false,
    nextDeal: () => [],
    forceAutoReturn: () => [],
    turnSeat: () => r.turn,
    progress: () => r.ply,
    isOver: () => false,
    handleGameMessage(_seat: number, msg: any) {
      if (msg.t !== 'go') return null;
      r.turn = msg.seat; r.ply++;
      return [state()];
    },
  };
  return r;
}

/** 最简适配器：座位数可调，事实原样写进消息，没有自动续局与催办 */
function fakeAdapter(minSeats: number, maxSeats: number, runner?: any) {
  return {
    minSeats, maxSeats,
    createRunner: () => runner ?? fakeRunner(),
    decorate(out: any[], { presence, turnRemainMs }: any) {
      for (const o of out) {
        const m = o?.msg;
        if (!m || m.t !== 'state') continue;
        if (turnRemainMs != null && m.phase === 'playing') m.turnRemainMs = turnRemainMs;
        if (Array.isArray(m.seats)) {
          for (const sp of m.seats) {
            const p = presence[sp.seat];
            sp.online = !!p?.online; sp.disconnected = !!p?.disconnected; sp.ai = !!p?.ai;
          }
        }
      }
      return out;
    },
    autoAdvance: () => null,
    pendingDecision: () => null,
    clearPendingOn: () => false,
  };
}

describe('公共房间层 — 座位数参数化', () => {
  const mk = (min: number, max: number) => new CardRoomRegistry({
    adapter: fakeAdapter(min, max), codeGen: () => 'ABC123',
  }) as any;

  it('建房时不指定人数 → 取上限', () => {
    const reg = mk(2, 5);
    const a = fakeClient(); reg.handle(a, { t: 'hello', nick: '甲' });
    reg.handle(a, { t: 'create' });
    expect(reg.roomSnapshot('ABC123').seatCount).toBe(5);
  });

  it.each([2, 3, 4, 5])('建房时指定 %i 人 → 就是 %i 座', (n) => {
    const reg = mk(2, 5);
    const a = fakeClient(); reg.handle(a, { t: 'hello', nick: '甲' });
    reg.handle(a, { t: 'create', seats: n });
    const snap = reg.roomSnapshot('ABC123');
    expect(snap.seatCount).toBe(n);
    expect(snap.seats).toHaveLength(n);
  });

  it('指定的人数越界 → 夹到区间内，不产生怪房', () => {
    const reg = mk(2, 5);
    const a = fakeClient(); reg.handle(a, { t: 'hello', nick: '甲' });
    reg.handle(a, { t: 'create', seats: 99 });
    expect(reg.roomSnapshot('ABC123').seatCount).toBe(5);

    const reg2 = mk(2, 5);
    const b = fakeClient(); reg2.handle(b, { t: 'hello', nick: '乙' });
    reg2.handle(b, { t: 'create', seats: 1 });
    expect(reg2.roomSnapshot('ABC123').seatCount).toBe(2);
  });

  it('座位号越界坐不进去（3 人房里没有第 4 座）', () => {
    const reg = mk(2, 5);
    const a = fakeClient(); const b = fakeClient();
    reg.handle(a, { t: 'hello', nick: '甲' }); reg.handle(b, { t: 'hello', nick: '乙' });
    reg.handle(a, { t: 'create', seats: 3 });
    reg.handle(b, { t: 'join', code: 'ABC123' });
    reg.handle(b, { t: 'take-seat', seat: 3 });
    expect(last(b).t).toBe('error');
    reg.handle(b, { t: 'take-seat', seat: 2 });
    expect(reg.seatOf(b)).toEqual({ code: 'ABC123', seat: 2 });
  });

  it('开打时空座按本房座位数补 AI（3 人房补 2 个，不是永远补到 4）', () => {
    const reg = mk(2, 5);
    const a = fakeClient(); reg.handle(a, { t: 'hello', nick: '甲' });
    reg.handle(a, { t: 'create', seats: 3 });
    reg.handle(a, { t: 'start' });
    const snap = reg.roomSnapshot('ABC123');
    expect(snap.seats.filter((s: any) => s && s.ai)).toHaveLength(2);
    expect(snap.seats.filter((s: any) => s && !s.ai)).toHaveLength(1);
  });

  it('掼蛋走的是同一层，但被适配器钉死在 4 座', () => {
    const reg: any = new GuandanRooms(() => 'ABC123', null);
    const a = fakeClient(); reg.handle(a, { t: 'hello', nick: '甲' });
    reg.handle(a, { t: 'create', seats: 2 });      // 哪怕客户端硬要 2 座
    expect(reg.roomSnapshot('ABC123').seatCount).toBe(4);
  });
});

describe('公共房间层 — 各游戏各自大厅，昵称全服唯一', () => {
  function twoGames() {
    const nicks = new NickRegistry();             // 一套占用表，两个游戏共用
    const gd: any = new CardRoomRegistry({ adapter: fakeAdapter(4, 4), codeGen: () => 'GD0001', nicks });
    const gdy: any = new CardRoomRegistry({ adapter: fakeAdapter(2, 5), codeGen: () => 'GY0001', nicks });
    return { gd, gdy };
  }

  it('昵称全服唯一：一个游戏里占了名字，另一个游戏里就占不到', () => {
    const { gd, gdy } = twoGames();
    const a = fakeClient(); const b = fakeClient();
    gd.handle(a, { t: 'hello', nick: '甲' });
    expect(last(a)).toEqual({ t: 'hello-ok' });
    gdy.handle(b, { t: 'hello', nick: ' 甲 ' });   // 换个游戏、换个大小写空格
    expect(last(b)).toEqual({ t: 'nick-taken' });
  });

  it('离开后名字全服释放', () => {
    const { gd, gdy } = twoGames();
    const a = fakeClient(); const b = fakeClient();
    gd.handle(a, { t: 'hello', nick: '甲' });
    gd.leave(a);
    gdy.handle(b, { t: 'hello', nick: '甲' });
    expect(last(b)).toEqual({ t: 'hello-ok' });
  });

  it('大厅按游戏分桶：在这个游戏的大厅里看不到那个游戏的房', () => {
    const { gd, gdy } = twoGames();
    const host = fakeClient(); gd.handle(host, { t: 'hello', nick: '房主' });
    gd.handle(host, { t: 'create' });                       // 掼蛋开了一间房

    const looker = fakeClient(); gdy.handle(looker, { t: 'hello', nick: '看客' });
    gdy.handle(looker, { t: 'lobby' });
    expect(lastOf(looker, 'lobby').rooms).toEqual([]);      // 干瞪眼大厅里空空如也

    const looker2 = fakeClient(); gd.handle(looker2, { t: 'hello', nick: '看客二' });
    gd.handle(looker2, { t: 'lobby' });
    expect(lastOf(looker2, 'lobby').rooms.map((r: any) => r.code)).toEqual(['GD0001']);
  });

  it('两个游戏的房号互不打架（各自的房间表）', () => {
    const { gd, gdy } = twoGames();
    const a = fakeClient(); const b = fakeClient();
    gd.handle(a, { t: 'hello', nick: '甲' }); gd.handle(a, { t: 'create' });
    gdy.handle(b, { t: 'hello', nick: '乙' }); gdy.handle(b, { t: 'create' });
    expect(gd.hasRoom('GD0001')).toBe(true);
    expect(gd.hasRoom('GY0001')).toBe(false);
    expect(gdy.hasRoom('GY0001')).toBe(true);
    expect(gdy.hasRoom('GD0001')).toBe(false);
  });
});

describe('座位在线态真的走到了 wire 上（掉线 → AI 接管 → 重连归位）', () => {
  // 这条链路原先三层各自绿、合起来可以坏：房间层断的是自己的私有字段，
  // 驱动层的公开态断言不查在线态，客户端测试用的是手写 fixture。
  // 于是「头像上显示掉线了 / AI 接管中」这件事全仓没有一条端到端的断言。
  afterEach(() => { vi.useRealTimers(); });

  function playing(graceMs = 0) {
    const runner = fakeRunner();
    const reg: any = new CardRoomRegistry({
      adapter: fakeAdapter(4, 4, runner), codeGen: () => 'ABC123',
      turnTimeoutMs: 20000, disconnectGraceMs: graceMs, disconnectGraceMisses: 2,
    });
    const cs = [fakeClient(), fakeClient(), fakeClient(), fakeClient()];
    cs.forEach((c, i) => reg.handle(c, { t: 'hello', nick: 'p' + i }));
    reg.handle(cs[0], { t: 'create' });
    for (let i = 1; i < 4; i++) { reg.handle(cs[i], { t: 'join', code: 'ABC123' }); reg.handle(cs[i], { t: 'take-seat', seat: i }); }
    reg.handle(cs[0], { t: 'start' });
    return { reg, cs, runner };
  }
  /** 别人（座 0）最近收到的那条公开态里，座 n 长什么样 */
  const seatOnWire = (c: any, n: number) => lastOf(c, 'state').seats.find((s: any) => s.seat === n);

  it('掉线（无宽限）→ 别人收到的公开态里该座标记为 AI 接管', () => {
    const { reg, cs } = playing(0);
    reg.leave(cs[2]);
    expect(seatOnWire(cs[0], 2)).toMatchObject({ online: false, ai: true, disconnected: false });
  });

  it('掉线（有宽限）→ 公开态里先标「掉线了」，还不是 AI', () => {
    const { reg, cs } = playing(10000);
    reg.leave(cs[2]);
    expect(seatOnWire(cs[0], 2)).toMatchObject({ online: false, disconnected: true, ai: false });
  });

  it('宽限耗尽 → 公开态改标 AI 接管', () => {
    vi.useFakeTimers();
    const { reg, cs } = playing(10000);
    reg.leave(cs[2]);
    /** 从公开入口把回合推到座 2（运行器认这条自造消息） */
    const turnToSeat2 = () => reg.handle(cs[0], { t: 'go', seat: 2 });

    turnToSeat2(); vi.advanceTimersByTime(10000);   // 第 1 手没回来
    expect(seatOnWire(cs[0], 2)).toMatchObject({ disconnected: true, ai: false });
    turnToSeat2(); vi.advanceTimersByTime(10000);   // 第 2 手没回来 → 转全速 AI
    expect(seatOnWire(cs[0], 2)).toMatchObject({ ai: true, disconnected: false });
  });

  it('重连 → 公开态归位成在线真人', () => {
    const { reg, cs } = playing(10000);
    const token = [...cs[2]!.sent].reverse().find((m: any) => m.t === 'seat-token')?.token;
    reg.leave(cs[2]);
    expect(seatOnWire(cs[0], 2)).toMatchObject({ disconnected: true });
    const re = fakeClient();
    reg.handle(re, { t: 'rejoin', code: 'ABC123', token, nick: 'p2' });
    expect(seatOnWire(cs[0], 2)).toMatchObject({ online: true, disconnected: false, ai: false });
  });

  it('观众也看得到同一份在线态', () => {
    const { reg, cs } = playing(10000);
    const v = fakeClient(); reg.handle(v, { t: 'hello', nick: '观' });
    reg.handle(v, { t: 'spectate', code: 'ABC123' });
    reg.leave(cs[2]);
    expect(seatOnWire(v, 2)).toMatchObject({ online: false, disconnected: true });
  });
});
