// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { mountTable, type TableState, type TableApi } from '../../src/games/gandengyan/ui/table';

/**
 * owner 公网真机反馈：倒计时只有自己有、其他人没有、还不读秒不动画。修法（仿掼蛋 view.ts）：
 * 倒计时放在「当前回合座」（含 AI，服务端无 timer 用本地 20s 兜底），客户端每 250ms 读秒，
 * 闹钟图标摇摆动画、≤5s 转红。这里锁：哪座显示、秒数被 paintClock 填上、AI 座也有、中央无旧闹钟。
 */
const tables: Array<ReturnType<typeof mountTable>> = [];
afterEach(() => { while (tables.length) tables.pop()!.cleanup(); });   // 清读秒 interval，别泄漏到下条

function mount(mySeat: number): { root: HTMLElement; table: ReturnType<typeof mountTable> } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const api: TableApi = { mySeat, names: ['甲', '乙', '丙'], onPlay() {}, onPass() {}, onRestart() {}, onLeave() {} };
  const table = mountTable(root, api);
  tables.push(table);
  return { root, table };
}
function playing(turn: number, turnRemainMs: number | undefined): TableState {
  return {
    phase: 'playing', turn, deckCount: 20, current: null, turnRemainMs,
    seats: [
      { seat: 0, count: 5, online: true, ai: false },
      { seat: 1, count: 5, online: true, ai: false },
      { seat: 2, count: 5, online: false, ai: true },
    ],
  };
}
const clocks = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll('.gy__board .gy__seat-clock'));
const secOf = (root: HTMLElement): string => root.querySelector('.gy__board .gy__seat-clock .gy__seat-clock-sec')?.textContent ?? '';

describe('座位读秒小闹钟', () => {
  it('轮到别的真人：读秒长在他那一座（且只有那一座），秒数被填成服务端剩余', () => {
    const { root, table } = mount(0);
    table.render(playing(1, 18000), []);            // 轮到座 1（乙）
    const cs = clocks(root);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.closest('.gy__seat')!.classList.contains('gy__seat--turn')).toBe(true);
    expect(secOf(root)).toBe('18s');                // paintClock 用服务端 18000ms 播种
    expect(cs[0]!.querySelector('.gy__seat-clock-icon')).toBeTruthy();   // 有摇摆的闹钟图标
  });

  it('轮到自己：读秒在自己座位', () => {
    const { root, table } = mount(0);
    table.render(playing(0, 20000), []);
    expect(clocks(root)).toHaveLength(1);
    expect(secOf(root)).toBe('20s');
  });

  it('AI 回合（无服务端 timer）：AI 座也有读秒，本地 20s 兜底', () => {
    const { root, table } = mount(0);
    table.render(playing(2, undefined), []);        // 轮到 AI 座 2，turnRemainMs 缺省
    const cs = clocks(root);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.closest('.gy__seat')!.classList.contains('gy__seat--turn')).toBe(true);
    expect(secOf(root)).toBe('20s');                // 本地兜底
  });

  it('中央不再有旧的 .gy__clock', () => {
    const { root, table } = mount(0);
    table.render(playing(0, 20000), []);
    expect(root.querySelector('.gy__clock')).toBeNull();
  });
});
