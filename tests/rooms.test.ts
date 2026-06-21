import { describe, it, expect, beforeEach } from 'vitest';
import { RoomRegistry } from '../server/rooms.mjs';

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
