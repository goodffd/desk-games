// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mountTable, type TableState, type TableApi } from '../../src/games/gandengyan/ui/table';

/**
 * owner 公网真机反馈：等别的选手出牌时，他座位旁没有倒计时小闹钟（原来只在轮到自己时飘在中央）。
 * 修法=倒计时挪到「轮到那一座」的座位框。这条锁住：只有当前回合座、且真人回合(turnRemainMs 非空，
 * AI 回合无 20s 计时故为空)才显示；非当前座、AI 回合都不显示。
 */
function mount(mySeat: number): { root: HTMLElement; table: ReturnType<typeof mountTable> } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const api: TableApi = { mySeat, names: ['甲', '乙', '丙'], onPlay() {}, onPass() {}, onRestart() {}, onLeave() {} };
  return { root, table: mountTable(root, api) };
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

describe('#后续 座位倒计时小闹钟', () => {
  it('轮到别的真人：倒计时长在他那一座，且只有那一座', () => {
    const { root, table } = mount(0);
    table.render(playing(1, 18000), []);            // 轮到座 1（乙），我是座 0
    const cs = clocks(root);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.textContent).toContain('18s');
    // 那个带闹钟的座位正是当前回合座（gy__seat--turn）
    expect(cs[0]!.closest('.gy__seat')!.classList.contains('gy__seat--turn')).toBe(true);
  });

  it('轮到自己：倒计时在自己座位', () => {
    const { root, table } = mount(0);
    table.render(playing(0, 20000), []);
    const cs = clocks(root);
    expect(cs).toHaveLength(1);
    expect(cs[0]!.textContent).toContain('20s');
  });

  it('AI 回合（turnRemainMs 缺省）：任何座都不显示倒计时', () => {
    const { root, table } = mount(0);
    table.render(playing(2, undefined), []);        // 轮到 AI 座 2，无 20s 计时
    expect(clocks(root)).toHaveLength(0);
  });

  it('中央不再有旧的 .gy__clock', () => {
    const { root, table } = mount(0);
    table.render(playing(0, 20000), []);
    expect(root.querySelector('.gy__clock')).toBeNull();
  });
});
