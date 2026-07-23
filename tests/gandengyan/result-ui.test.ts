// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mountTable, type TableState, type TableApi, type SettleSeatView } from '../../src/games/gandengyan/ui/table';

/**
 * #16：结算表逐项展开的真机渲染——把「每一乘」摆开，玩家看得懂赔付怎么来的；再来一局；
 * 重开归零。用 jsdom 挂真 table.ts，喂服务端会下发的 result（含逐座明细），断言界面文案。
 */
function setup(mySeat: number | 'spectator' = 0): {
  root: HTMLElement; table: ReturnType<typeof mountTable>; restarts: number[];
} {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const restarts: number[] = [];
  const api: TableApi = {
    mySeat, names: ['阿甲', '阿乙'],
    onPlay: () => {}, onPass: () => {}, onRestart: () => restarts.push(1), onLeave: () => {},
  };
  return { root, table: mountTable(root, api), restarts };
}

function seat(seat: number, over: Partial<SettleSeatView>): SettleSeatView {
  return { seat, handCount: 0, wildCount: 0, twoCount: 0, spring: false, personalMultiplier: 1, pay: 0, ...over };
}
function dealResult(result: NonNullable<TableState['result']>): TableState {
  return {
    phase: 'dealResult', turn: 0, deckCount: 0, current: null,
    seats: [
      { seat: 0, count: 0, online: true, ai: false },
      { seat: 1, count: result.hands[1] ?? 0, online: true, ai: false },
    ],
    result,
  };
}
const $ = (root: HTMLElement, sel: string): HTMLElement | null => root.querySelector(sel);
const text = (root: HTMLElement, sel: string): string => $(root, sel)?.textContent ?? '';
const calcTexts = (root: HTMLElement): string =>
  Array.from(root.querySelectorAll('.gy__result-calc')).map((e) => e.textContent).join(' | ');

describe('#16 结算表逐项展开', () => {
  it('输家赔付逐项展开：剩牌·炸弹·各张王/2 逐一摆开 = 赔付', () => {
    const { root, table } = setup();
    // 底1 × 剩5张 × 1炸(×2) × 1王(×2) × 1个2(×2) = 40，数字自洽
    const result = {
      winner: 0, pay: [0, 40], gain: 40, stalemate: false, hands: [0, 5],
      base: 1, bombsPlayed: 1, bombMultiplier: 2,
      seats: [seat(0, {}), seat(1, { handCount: 5, wildCount: 1, twoCount: 1, personalMultiplier: 4, pay: 40 })],
    };
    table.render(dealResult(result), []);
    expect(text(root, '.gy__result-title')).toContain('赢了');
    const calc = calcTexts(root);
    expect(calc).toContain('剩 5 张');
    expect(calc).toContain('1 炸 ×2');          // 炸弹倍数（几个炸）
    expect(calc).toContain('1 张王 ×2');        // 每张王逐一摆开（不再用「个人」抽象标签）
    expect(calc).toContain('1 张2 ×2');         // 每张 2 逐一摆开
    expect(calc).not.toContain('个人');         // 「个人」这个看不懂的标签已去掉
    expect(calc).toContain('= 40');             // 乘得出赔付
  });

  it('春天命中在明细里点名', () => {
    const { root, table } = setup();
    // 剩5张 × 春天(×2) = 10
    const result = {
      winner: 0, pay: [0, 10], gain: 10, stalemate: false, hands: [0, 5],
      base: 1, bombsPlayed: 0, bombMultiplier: 1,
      seats: [seat(0, {}), seat(1, { handCount: 5, spring: true, personalMultiplier: 2, pay: 10 })],
    };
    table.render(dealResult(result), []);
    expect(calcTexts(root)).toContain('春天 ×2');
    expect(calcTexts(root)).toContain('剩 5 张 · 春天 ×2 = 10');
  });

  it('AC2：界面写明「赢家得分 = 各输家赔付之和」', () => {
    const { root, table } = setup();
    const result = {
      winner: 0, pay: [0, 40], gain: 40, stalemate: false, hands: [0, 5],
      base: 1, bombsPlayed: 0, bombMultiplier: 1,
      seats: [seat(0, {}), seat(1, { handCount: 5, personalMultiplier: 8, pay: 40 })],
    };
    table.render(dealResult(result), []);
    expect(text(root, '.gy__result-sum')).toContain('+40');
    expect(text(root, '.gy__result-sum')).toContain('各输家赔付之和');
  });

  it('AC3：结算弹层里一键再来一局，回调触发', () => {
    const { root, table, restarts } = setup();
    const result = {
      winner: 0, pay: [0, 10], gain: 10, stalemate: false, hands: [0, 5],
      base: 1, bombsPlayed: 0, bombMultiplier: 1, seats: [seat(0, {}), seat(1, { handCount: 5, personalMultiplier: 2, pay: 10 })],
    };
    table.render(dealResult(result), []);
    const again = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === '再来一局');
    expect(again, '结算弹层没有再来一局').toBeTruthy();
    again!.click();
    expect(restarts).toHaveLength(1);
  });

  it('AC4：重开新局（phase→playing）时结算弹层清掉，不跨局残留', () => {
    const { root, table } = setup();
    const result = {
      winner: 0, pay: [0, 10], gain: 10, stalemate: false, hands: [0, 5],
      base: 1, bombsPlayed: 0, bombMultiplier: 1, seats: [seat(0, {}), seat(1, { handCount: 5, personalMultiplier: 2, pay: 10 })],
    };
    table.render(dealResult(result), []);
    expect($(root, '.gy__result')).toBeTruthy();
    // 新局开打
    table.render({ phase: 'playing', turn: 0, deckCount: 30, current: null,
      seats: [{ seat: 0, count: 5, online: true, ai: false }, { seat: 1, count: 5, online: true, ai: false }] }, []);
    expect($(root, '.gy__result'), '重开后结算弹层还在').toBeNull();
  });

  it('观战者结算弹层不给再来一局', () => {
    const { root, table } = setup('spectator');
    const result = {
      winner: 0, pay: [0, 10], gain: 10, stalemate: false, hands: [0, 5],
      base: 1, bombsPlayed: 0, bombMultiplier: 1, seats: [seat(0, {}), seat(1, { handCount: 5, personalMultiplier: 2, pay: 10 })],
    };
    table.render(dealResult(result), []);
    const again = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === '再来一局');
    expect(again).toBeFalsy();
  });
});
