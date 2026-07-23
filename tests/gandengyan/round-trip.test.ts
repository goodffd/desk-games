// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { GandengyanDriver } from '../../server/gandengyan-match-driver';
import { mountTable, type TableState, type TableApi } from '../../src/games/gandengyan/ui/table';
import type { Card } from '../../src/games/gandengyan/engine/types';
import { seededShuffle } from '../helpers/rng';

/**
 * #17 AC1 round-trip 契约：把服务端**真公开态产物** driver.publicState() 原样喂给客户端牌桌
 * table.render，断言渲染出来。此前 driver 测试与 UI 测试各拿手写对象自说自话，两边字段一
 * 旦对不上（少个 seats[].disconnected、current 结构变了…）谁都发现不了——这条把缝焊死。
 */
function api(mySeat: number | 'spectator'): TableApi {
  return { mySeat, names: ['甲', '乙', '丙', '丁', '戊'], onPlay() {}, onPass() {}, onRestart() {}, onLeave() {} };
}
function mount(mySeat: number | 'spectator'): { root: HTMLElement; table: ReturnType<typeof mountTable> } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return { root, table: mountTable(root, api(mySeat)) };
}

describe('#17 AC1 round-trip 契约', () => {
  it('对局中：driver.publicState() 原样喂 table.render 不崩、三座与桌面牌都渲染出来', () => {
    const d = new GandengyanDriver({ shuffle: seededShuffle(7), seatCount: 3, dealer: 0 });
    for (let i = 0; i < 6 && d.phase === 'playing'; i++) d.forceAutoPlay();   // 走几手，桌面有当前牌
    const state = d.publicState() as unknown as TableState;
    const hand = d.state.hands[0] as Card[];

    const { root, table } = mount(0);
    expect(() => table.render(state, hand)).not.toThrow();
    expect(root.querySelector('.gy__board'), '牌桌没渲染').toBeTruthy();
    expect(root.querySelectorAll('.gy__board .gy__seat').length, '三座没都渲染').toBe(3);
    if (state.current) expect(root.querySelector('.gy__cur'), '有桌面牌却没渲染').toBeTruthy();
  });

  it('掉线态：markDisconnected 后的真公开态喂进去，掉线座显示「掉线」', () => {
    const d = new GandengyanDriver({ shuffle: seededShuffle(5), seatCount: 3, dealer: 0 });
    d.forceAutoPlay();
    d.markDisconnected(1, true);
    const state = d.publicState() as unknown as TableState;
    // 座 1 掉线：names 给它一个昵称（真人有昵称），公开态 disconnected=true
    const table2 = api(0); table2.names = ['甲', '阿乙', '丙'];
    const root = document.createElement('div'); document.body.appendChild(root);
    mountTable(root, table2).render(state, d.state.hands[0] as Card[]);
    const tags = Array.from(root.querySelectorAll('.gy__board .gy__seat-tag')).map((e) => e.textContent);
    expect(tags.join(''), '掉线真人没显示「掉线」').toContain('掉线');
  });

  it('结算态：真 result 公开态喂 table.render，结算表逐项展开渲染出来', () => {
    const d = new GandengyanDriver({ shuffle: seededShuffle(3), seatCount: 2, dealer: 0 });
    let guard = 0;
    while (d.phase === 'playing' && guard++ < 500) d.forceAutoPlay();
    expect(d.phase).toBe('dealResult');
    const state = d.publicState() as unknown as TableState;

    const { root, table } = mount(0);
    expect(() => table.render(state, [])).not.toThrow();
    expect(root.querySelector('.gy__result'), '结算弹层没渲染').toBeTruthy();
    expect(root.querySelector('.gy__result-sum')?.textContent, '真明细没驱动出结算表').toContain('各输家赔付之和');
  });
});
