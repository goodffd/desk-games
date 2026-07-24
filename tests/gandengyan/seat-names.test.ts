// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mountTable, type TableState, type TableApi } from '../../src/games/gandengyan/ui/table';

/**
 * owner 反馈：除我以外其他选手都是 AI 时，名字要能区分（不能都叫「AI」，否则看不出谁出的牌）。
 * 多个 AI 补位空座 → 按服务端座序编号「AI 1 / AI 2 …」；只有一个 AI → 就叫「AI」。
 */
function render(seats: TableState['seats'], names: (string | null)[]): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const api: TableApi = { mySeat: 0, names, onPlay() {}, onPass() {}, onRestart() {}, onLeave() {} };
  mountTable(root, api).render(
    { phase: 'playing', turn: 0, deckCount: 20, current: null, seats }, [],
  );
  return root;
}
const seatNames = (root: HTMLElement): string[] =>
  Array.from(root.querySelectorAll('.gy__board .gy__seat-name')).map((e) => e.textContent ?? '');
const ai = (seat: number): TableState['seats'][number] => ({ seat, count: 5, online: false, ai: true });
const me = (seat: number): TableState['seats'][number] => ({ seat, count: 5, online: true, ai: false });

describe('AI 座位名区分', () => {
  it('多个 AI：按座序编号 AI 1 / AI 2 / AI 3，互不相同', () => {
    const names = seatNames(render([me(0), ai(1), ai(2), ai(3)], ['封真', null, null, null]));
    expect(names).toContain('封真（你）');
    expect(names).toContain('AI 1');
    expect(names).toContain('AI 2');
    expect(names).toContain('AI 3');
    const aiNames = names.filter((n) => n.startsWith('AI'));
    expect(new Set(aiNames).size).toBe(aiNames.length);   // 全不重复
  });

  it('只有一个 AI：就叫「AI」不带编号', () => {
    const names = seatNames(render([me(0), ai(1)], ['封真', null]));
    expect(names).toContain('AI');
    expect(names.some((n) => /AI \d/.test(n))).toBe(false);
  });

  it('掉线真人有昵称不被编号成 AI（disconnected 非 ai）', () => {
    const dropped = { seat: 1, count: 5, online: true, ai: false, disconnected: true };
    const names = seatNames(render([me(0), dropped, ai(2)], ['封真', '阿乙', null]));
    expect(names).toContain('阿乙');       // 掉线真人仍显昵称
    expect(names).toContain('AI');         // 只剩一个真 AI → 不编号
  });
});
