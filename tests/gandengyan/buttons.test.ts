// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mountTable, type TableState, type TableApi } from '../../src/games/gandengyan/ui/table';
import type { Card } from '../../src/games/gandengyan/engine/types';
import { identify } from '../../src/games/gandengyan/engine/combos';
import { n, jokerBig } from './mk';

/**
 * owner：要判断我有没有牌可出，出不了的出牌按钮就灰掉（参考掼蛋）。
 * mustPass = 跟牌压不住 / 领出只剩王无合法领出 → 出牌禁用、只能不要。
 */
function setup(): { root: HTMLElement; table: ReturnType<typeof mountTable> } {
  const root = document.createElement('div'); document.body.appendChild(root);
  const api: TableApi = { mySeat: 0, names: ['我'], onPlay() {}, onPass() {}, onRestart() {}, onLeave() {} };
  return { root, table: mountTable(root, api) };
}
function state(hand: Card[], current: TableState['current']): TableState {
  return { phase: 'playing', turn: 0, deckCount: 10, current,
    seats: [{ seat: 0, count: hand.length, online: true, ai: false }] };
}
function combo(cs: Card[], by = 1): NonNullable<TableState['current']> {
  const c = identify(cs)!;
  return { type: c.type, length: c.length, key: c.key, cards: c.cards, assign: [], by };
}
const btn = (root: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text) as HTMLButtonElement;

describe('出牌 / 不要 按钮启用（mustPass）', () => {
  it('跟牌压不住（一对A，手里只有杂散单张）→ 出牌灰、不要亮', () => {
    const { root, table } = setup();
    table.render(state([n('S', 3), n('H', 4)], combo([n('S', 14), n('H', 14)])), [n('S', 3), n('H', 4)]);
    expect(btn(root, '出牌').disabled).toBe(true);
    expect(btn(root, '不要').disabled).toBe(false);
  });

  it('跟牌压得住（一对7，手里有一对8）→ 出牌亮', () => {
    const { root, table } = setup();
    const hand = [n('S', 8), n('H', 8)];
    table.render(state(hand, combo([n('S', 7), n('H', 7)])), hand);
    expect(btn(root, '出牌').disabled).toBe(false);
  });

  it('领出有合法手 → 出牌亮、不要灰（领出不能不要）', () => {
    const { root, table } = setup();
    const hand = [n('S', 3), n('H', 3)];
    table.render(state(hand, null), hand);
    expect(btn(root, '出牌').disabled).toBe(false);
    expect(btn(root, '不要').disabled).toBe(true);
  });

  it('领出只剩一张王（王不能单独打出→无合法领出）→ 出牌灰、不要亮（顺延）', () => {
    const { root, table } = setup();
    const hand = [jokerBig()];   // 双王能当王炸领出，单张王无合法领出
    table.render(state(hand, null), hand);
    expect(btn(root, '出牌').disabled).toBe(true);
    expect(btn(root, '不要').disabled).toBe(false);
  });

  it('右键出牌（参考掼蛋）：选牌后右键点牌桌 = 出牌，发出所选牌', () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const plays: number[][] = [];
    const api: TableApi = { mySeat: 0, names: ['我'], onPlay: (ids) => plays.push(ids), onPass() {}, onRestart() {}, onLeave() {} };
    const table = mountTable(root, api);
    const hand = [n('S', 3), n('H', 3)];   // 领出一对 3
    table.render(state(hand, null), hand);
    for (const c of hand) root.querySelector<HTMLElement>(`.gy__hand .dgc-card[data-card-id="${c.id}"]`)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    root.querySelector<HTMLElement>('.gy')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(plays).toHaveLength(1);
    expect(new Set(plays[0])).toEqual(new Set([hand[0]!.id, hand[1]!.id]));
  });
});
