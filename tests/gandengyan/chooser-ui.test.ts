// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mountTable, type TableState, type TableApi } from '../../src/games/gandengyan/ui/table';
import type { Card, WildAssign } from '../../src/games/gandengyan/engine/types';
import { identify } from '../../src/games/gandengyan/engine/combos';
import { n, jokerBig, jokerSmall } from './mk';

/**
 * #15 AC#4：歧义选择器的**真机交互**——审计已证 engine 语义与 UI 触发 CORRECT，这里锁死
 * 浏览器侧那条 enumerateIdentities → renderChooser → commit → onPlay(ids, assign) 的链路，
 * 之前完全没测（冒烟从不主动打歧义组合）。用 jsdom 挂真 table.ts、模拟点牌/出牌/选牌，
 * 断言：真歧义才弹、无歧义零打扰、发出去的包带的是**玩家选的那一项**的指派。
 */

function setup(): { root: HTMLElement; table: ReturnType<typeof mountTable>; plays: { ids: number[]; assign: WildAssign[] }[] } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const plays: { ids: number[]; assign: WildAssign[] }[] = [];
  const api: TableApi = {
    mySeat: 0,
    names: ['我'],
    onPlay: (ids, assign) => plays.push({ ids, assign }),
    onPass: () => {}, onRestart: () => {}, onLeave: () => {},
  };
  return { root, table: mountTable(root, api), plays };
}

function playingState(hand: Card[], current: TableState['current']): TableState {
  return {
    phase: 'playing', turn: 0, deckCount: 10, current,
    seats: [{ seat: 0, count: hand.length, online: true, ai: false }],
  };
}
/** 把一手牌 identify 成桌面当前牌（由别家 by=1 出）。 */
function tableCombo(cs: Card[]): NonNullable<TableState['current']> {
  const c = identify(cs)!;
  return { type: c.type, length: c.length, key: c.key, cards: c.cards, assign: [], by: 1 };
}

const $ = (root: HTMLElement, sel: string): HTMLElement | null => root.querySelector(sel);
const $$ = (root: HTMLElement, sel: string): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
const clickCard = (root: HTMLElement, id: number): void => { $(root, `.gy__hand .dgc-card[data-card-id="${id}"]`)!.click(); };
const clickBtn = (root: HTMLElement, text: string): void => { $$(root, 'button').find((b) => b.textContent === text)!.click(); };
const chips = (root: HTMLElement): HTMLElement[] => $$(root, '.gy__chooser .gy__chip');
const chipByName = (root: HTMLElement, name: string): HTMLElement =>
  chips(root).find((c) => $(c, '.gy__chip-name')?.textContent === name)!;

describe('#15 歧义选择器真机交互', () => {
  it('AC2/4 无歧义零打扰：王+♠5 当对5，选牌→出牌直接发，不弹选择器', () => {
    const jb = jokerBig(), s5 = n('S', 5);
    const { root, table, plays } = setup();
    table.render(playingState([jb, s5], null), [jb, s5]);   // 领出
    clickCard(root, jb.id); clickCard(root, s5.id);
    clickBtn(root, '出牌');
    expect(chips(root), '无歧义却弹了选择器').toHaveLength(0);
    expect(plays).toHaveLength(1);
    // 王被指成 5 组成对子，assign 带上
    expect(plays[0]!.assign).toEqual([{ jokerId: jb.id, rank: 5 }]);
    expect(new Set(plays[0]!.ids)).toEqual(new Set([jb.id, s5.id]));
  });

  it('AC1 领出真歧义才弹：王+♠5+♥6 → 弹两解(456/567)，选谁发谁的指派', () => {
    const jb = jokerBig(), s5 = n('S', 5), h6 = n('H', 6);
    const { root, table, plays } = setup();
    table.render(playingState([jb, s5, h6], null), [jb, s5, h6]);
    clickCard(root, jb.id); clickCard(root, s5.id); clickCard(root, h6.id);
    clickBtn(root, '出牌');
    expect(chips(root).length, '领出双解没弹二选一').toBe(2);
    // 两解都是顺子；王要么补成 4（456）要么补成 7（567）——点第一个，发的就是它那份指派
    chips(root)[0]!.click();
    expect(plays).toHaveLength(1);
    expect(plays[0]!.assign).toHaveLength(1);
    expect([4, 7]).toContain(plays[0]!.assign[0]!.rank);
    expect(plays[0]!.assign[0]!.jokerId).toBe(jb.id);
  });

  it('AC1 选不同项发不同指派：456 与 567 两个选项发出的王指派不同', () => {
    const ranksPicked: number[] = [];
    for (const idx of [0, 1]) {
      const jb = jokerBig(), s5 = n('S', 5), h6 = n('H', 6);
      const { root, table, plays } = setup();
      table.render(playingState([jb, s5, h6], null), [jb, s5, h6]);
      clickCard(root, jb.id); clickCard(root, s5.id); clickCard(root, h6.id);
      clickBtn(root, '出牌');
      chips(root)[idx]!.click();
      ranksPicked.push(plays[0]!.assign[0]!.rank);
    }
    expect(ranksPicked[0]).not.toBe(ranksPicked[1]);   // 选项确实互不相同、所见即所发
    expect(new Set(ranksPicked)).toEqual(new Set([4, 7]));
  });

  it('★ AC5 跟牌也弹：双王压一对7 → 王炸/一对8 二选一，选一对8发王指8', () => {
    const jb = jokerBig(), js = jokerSmall();
    const { root, table, plays } = setup();
    table.render(playingState([jb, js], tableCombo([n('S', 7), n('H', 7)])), [jb, js]);
    clickCard(root, jb.id); clickCard(root, js.id);
    clickBtn(root, '出牌');
    expect(chips(root).length, '跟牌双解没弹（王炸 vs 一对8）').toBe(2);
    chipByName(root, '对子').click();                  // 选「当一对8出」
    expect(plays).toHaveLength(1);
    // 两张王都指成 8（指派顺序不做假设）
    expect(plays[0]!.assign).toHaveLength(2);
    expect(plays[0]!.assign.every((a) => a.rank === 8)).toBe(true);
    expect(new Set(plays[0]!.assign.map((a) => a.jokerId))).toEqual(new Set([jb.id, js.id]));
  });

  it('★ AC5 选王炸则不带指派（王炸没有点数可言）', () => {
    const jb = jokerBig(), js = jokerSmall();
    const { root, table, plays } = setup();
    table.render(playingState([jb, js], tableCombo([n('S', 7), n('H', 7)])), [jb, js]);
    clickCard(root, jb.id); clickCard(root, js.id);
    clickBtn(root, '出牌');
    chipByName(root, '王炸').click();
    expect(plays).toHaveLength(1);
    expect(plays[0]!.assign).toEqual([]);            // 王炸不指派
    expect(new Set(plays[0]!.ids)).toEqual(new Set([jb.id, js.id]));
  });
});
