/**
 * OnlineSession 单测（Plan 3 Task 3）：mock WebSocket + mock storage，验连接/发包/分发/重连/昵称。
 */
import { describe, it, expect } from 'vitest';
import { OnlineSession, type WebSocketLike, type StorageLike, type OnlineSessionOpts } from '../src/games/guandan/online/session';
import { c2s } from '../src/games/guandan/online/protocol';

class MockWS implements WebSocketLike {
  static instances: MockWS[] = [];
  url: string;
  sent: string[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  constructor(url: string) { this.url = url; MockWS.instances.push(this); }
  send(s: string): void { this.sent.push(s); }
  close(): void { this.onclose?.(); }
  // 测试触发器
  _open(): void { this.onopen?.(); }
  _recv(obj: unknown): void { this.onmessage?.({ data: JSON.stringify(obj) }); }
}

function memStorage(): StorageLike {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

function makeSession(extra: Partial<OnlineSessionOpts> = {}) {
  MockWS.instances = [];
  const local = memStorage(); const session = memStorage();
  const s = new OnlineSession('ws://x/ws-guandan', {
    WebSocketCtor: MockWS,
    local, session,
    schedule: (fn) => { fn(); return 0; }, // 即时重连
    ...extra,
  });
  return { s, local, session };
}
const lastWS = () => MockWS.instances[MockWS.instances.length - 1]!;
const sentMsgs = (ws: MockWS) => ws.sent.map((x) => JSON.parse(x));

describe('OnlineSession', () => {
  it('connect 后 send → mock WS 收到 JSON', () => {
    const { s } = makeSession();
    s.connect();
    s.send(c2s.hello('阿东'));
    expect(sentMsgs(lastWS())).toContainEqual({ t: 'hello', nick: '阿东' });
  });

  it('收到 hello-ok → on(hello-ok) 回调一次', () => {
    const { s } = makeSession();
    let n = 0;
    s.on('hello-ok', () => { n++; });
    s.connect(); lastWS()._open();
    lastWS()._recv({ t: 'hello-ok' });
    expect(n).toBe(1);
  });

  it('收到 state → on(state) 拿到该对象', () => {
    const { s } = makeSession();
    let got: any = null;
    s.on('state', (m) => { got = m; });
    s.connect(); lastWS()._open();
    lastWS()._recv({ t: 'state', phase: 'playing', turn: 2 });
    expect(got).toMatchObject({ t: 'state', phase: 'playing', turn: 2 });
  });

  it('onOpen 在连接打开时触发', () => {
    const { s } = makeSession();
    let opened = 0;
    s.onOpen(() => { opened++; });
    s.connect(); lastWS()._open();
    expect(opened).toBe(1);
  });

  it('断线 + 有房况 → 自动重连并 rejoin（用凭据里的本座昵称）', () => {
    const { s } = makeSession();
    s.setNick('别的名');                       // 共享 gd_nick 被别的标签覆盖
    s.saveRoom('ABC123', 2, '阿东');           // 凭据里是本座真实昵称
    s.connect(); lastWS()._open();
    const before = MockWS.instances.length;
    lastWS().close();                         // 断线 → 即时 schedule → 重连 connect()
    expect(MockWS.instances.length).toBe(before + 1); // 新建了一条连接
    lastWS()._open();                         // 重连 open → 自动发 rejoin（用凭据 nick，不用 gd_nick）
    expect(sentMsgs(lastWS())).toContainEqual({ t: 'rejoin', code: 'ABC123', nick: '阿东' });
  });

  it('断线但无房况 → 不重连', () => {
    const { s } = makeSession();
    s.connect(); lastWS()._open();
    const before = MockWS.instances.length;
    lastWS().close();
    expect(MockWS.instances.length).toBe(before); // 未重连
  });

  it('昵称持久化到 localStorage，跨 session 读回', () => {
    const local = memStorage();
    const s1 = new OnlineSession('ws://x', { WebSocketCtor: MockWS, local, session: memStorage() });
    s1.setNick('阿东');
    const s2 = new OnlineSession('ws://x', { WebSocketCtor: MockWS, local, session: memStorage() });
    expect(s2.nick).toBe('阿东');
  });

  it('手机杀后台：session 没了，从 localStorage 兜底捞回座位（仍能 rejoin）', () => {
    const local = memStorage();
    const s1 = new OnlineSession('ws://x', { WebSocketCtor: MockWS, local, session: memStorage() });
    s1.saveRoom('ABC123', 2, '阿东');
    // 新标签页/重开：session 是新的(空)，local 共享 → savedRoom 走 local 兜底
    const s2 = new OnlineSession('ws://x', { WebSocketCtor: MockWS, local, session: memStorage() });
    expect(s2.savedRoom()).toEqual({ code: 'ABC123', seat: 2, nick: '阿东' });
  });

  it('一台电脑多标签：各 session 独立，各守各座不互相覆盖（共享 local）', () => {
    const local = memStorage(); // 浏览器级共享
    const tabA = new OnlineSession('ws://x', { WebSocketCtor: MockWS, local, session: memStorage() });
    const tabB = new OnlineSession('ws://x', { WebSocketCtor: MockWS, local, session: memStorage() });
    tabA.saveRoom('ROOM01', 0, '甲');
    tabB.saveRoom('ROOM01', 3, '丁'); // 共享 local 被丁覆盖，但各自 session 守住自己的座
    expect(tabA.savedRoom()).toEqual({ code: 'ROOM01', seat: 0, nick: '甲' }); // 甲仍是座0
    expect(tabB.savedRoom()).toEqual({ code: 'ROOM01', seat: 3, nick: '丁' }); // 丁仍是座3
  });

  it('savedRoom/saveRoom/clearRoom 往返', () => {
    const { s } = makeSession();
    expect(s.savedRoom()).toBeNull();
    s.saveRoom('XYZ789', 1, '阿东');
    expect(s.savedRoom()).toEqual({ code: 'XYZ789', seat: 1, nick: '阿东' });
    s.clearRoom();
    expect(s.savedRoom()).toBeNull();
  });

  it('dispose 后收消息不再分发', () => {
    const { s } = makeSession();
    let n = 0;
    s.on('state', () => { n++; });
    s.connect(); lastWS()._open();
    const ws = lastWS();
    s.dispose();
    ws._recv({ t: 'state' });    // dispose 已清 listeners
    expect(n).toBe(0);
  });
});
