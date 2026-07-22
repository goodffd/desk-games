import { describe, it, expect } from 'vitest';
import { identify, beats, comboIdentity, enumerateIdentities, isAmbiguous } from '../../src/games/gandengyan/engine/combos';
import type { Card, Rank, WildAssign } from '../../src/games/gandengyan/engine/types';
import { cards } from './mk';

/** 把牌串里的王按给定点数依次指派 */
function assignAll(cs: readonly Card[], ...ranks: Rank[]): WildAssign[] {
  const jokers = cs.filter((c) => c.kind === 'joker');
  if (jokers.length !== ranks.length) throw new Error('指派条数与王的张数对不上（测试写错了）');
  return jokers.map((j, i) => ({ jokerId: j.id, rank: ranks[i]! }));
}

function idOf(spec: string, ...ranks: Rank[]) {
  const cs = cards(spec);
  return identify(cs, assignAll(cs, ...ranks));
}

describe('王的百搭：显式指派，引擎只校验不推断', () => {
  it('王替一张普通牌凑对子', () => {
    expect(idOf('jB S5', 5)).toMatchObject({ type: 'pair', length: 2, key: 5 });
  });

  it('王替一张普通牌凑顺子', () => {
    expect(idOf('jB S5 H6', 4)).toMatchObject({ type: 'run', length: 3, key: 6 });
    expect(idOf('jB S5 H6', 7)).toMatchObject({ type: 'run', length: 3, key: 7 });
  });

  it('两张王一起当替身', () => {
    expect(idOf('jB jS S5', 5, 5)).toMatchObject({ type: 'bomb', length: 3, key: 5 });
    expect(idOf('jB jS S5 H6', 4, 7)).toMatchObject({ type: 'run', length: 4, key: 7 });
  });

  it('王替不出来的指派一律不认', () => {
    expect(idOf('jB S5 H6', 9)).toBeNull();   // 5,6,9 不连
    expect(idOf('jB S5 H6', 5)).toBeNull();   // 5,5,6 不成型
  });

  it('王不能替 2', () => {
    expect(idOf('jB S2', 2)).toBeNull();
    expect(idOf('jB S3 H4', 2)).toBeNull();
  });

  it('王不能单独打出——哪怕给了指派', () => {
    expect(idOf('jB', 5)).toBeNull();
    expect(idOf('jS', 14)).toBeNull();
    expect(identify(cards('jB'), [])).toBeNull();
  });

  it('指派缺项、多项、重复、指到不存在的牌，一律不认', () => {
    const cs = cards('jB S5');
    const joker = cs.find((c) => c.kind === 'joker')!;
    expect(identify(cs, [])).toBeNull();                                        // 缺指派
    expect(identify(cs, [{ jokerId: joker.id, rank: 5 }, { jokerId: joker.id, rank: 5 }])).toBeNull(); // 同一张王指派两次
    expect(identify(cs, [{ jokerId: 9999, rank: 5 }])).toBeNull();              // 指到不存在的牌
    const normal = cs.find((c) => c.kind === 'normal')!;
    expect(identify(cs, [{ jokerId: normal.id, rank: 5 }])).toBeNull();         // 指到一张普通牌
  });

  it('没有王却给了指派，也不认', () => {
    const cs = cards('S5 H5');
    expect(identify(cs, [{ jokerId: cs[0]!.id, rank: 5 }])).toBeNull();
  });

  it('指派点数越界不认', () => {
    const cs = cards('jB S5');
    const joker = cs.find((c) => c.kind === 'joker')!;
    for (const rank of [0, 1, 15, 20, -3, 2.5]) {
      expect(identify(cs, [{ jokerId: joker.id, rank: rank as Rank }])).toBeNull();
    }
  });

  it('双王不给指派就是王炸；给了指派就按指派算', () => {
    expect(identify(cards('jB jS'), [])).toMatchObject({ type: 'jokerBomb' });
    expect(idOf('jB jS', 5, 5)).toMatchObject({ type: 'pair', key: 5 });
  });
});

describe('含王的炸弹', () => {
  it('王凑出来的炸与纯炸完全平级——压不动也被压不动', () => {
    const pure = identify(cards('S5 H5 D5'))!;
    const withWild = idOf('jB S5 H5', 5)!;
    expect(comboIdentity(pure)).toBe(comboIdentity(withWild));
    expect(beats(pure, withWild)).toBe(false);   // 同点同张数，谁也压不住谁
    expect(beats(withWild, pure)).toBe(false);
  });

  it('王凑的 4 张炸压得住纯的 3 张炸', () => {
    expect(beats(identify(cards('S9 H9 D9'))!, idOf('jB S5 H5 D5', 5)!)).toBe(true);
  });

  it('同一炸仍不得超过 4 张：4 张同点 + 1 张王非法', () => {
    expect(idOf('jB S5 H5 D5 C5', 5)).toBeNull();
    expect(idOf('jB jS S5 H5 D5 C5', 5, 5)).toBeNull();
  });
});

describe('comboIdentity — 牌型标识 = 牌型 | 张数 | 关键点数，花色不进标识', () => {
  it('同标识的两手牌，来源可以完全不同', () => {
    expect(comboIdentity(identify(cards('S5 H5'))!)).toBe(comboIdentity(idOf('jB D5', 5)!));
  });

  it('牌型、张数、关键点数任一不同，标识就不同', () => {
    const a = comboIdentity(identify(cards('S3 H4 D5'))!);
    expect(a).not.toBe(comboIdentity(identify(cards('S4 H5 D6'))!));       // 关键点数不同
    expect(a).not.toBe(comboIdentity(identify(cards('S3 H4 D5 C6'))!));    // 张数不同
    expect(a).not.toBe(comboIdentity(identify(cards('S5 H5'))!));          // 牌型不同
  });
});

describe('歧义判定：只有牌型标识不同才算歧义', () => {
  it('「王+5+6」是歧义：456 与 567 两种解释', () => {
    const cs = cards('jB S5 H6');
    expect(isAmbiguous(cs)).toBe(true);
    const keys = enumerateIdentities(cs).map((p) => comboIdentity(p.combo)).sort();
    expect(keys).toEqual(['run|3|6', 'run|3|7']);
  });

  it('「王+黑桃5」当对 5 不是歧义——王指红桃 5 还是方块 5，牌型标识全同', () => {
    const cs = cards('jB S5');
    expect(isAmbiguous(cs)).toBe(false);
    expect(enumerateIdentities(cs)).toHaveLength(1);
    expect(comboIdentity(enumerateIdentities(cs)[0]!.combo)).toBe('pair|2|5');
  });

  it('无王的牌不可能有歧义', () => {
    for (const spec of ['S5', 'S5 H5', 'S3 H4 D5', 'S3 H3 D4 C4', 'S5 H5 D5']) {
      expect(isAmbiguous(cards(spec))).toBe(false);
    }
  });

  it('压根不成牌型的一把牌：没有解释，也就谈不上歧义', () => {
    const cs = cards('S5 H9');
    expect(enumerateIdentities(cs)).toHaveLength(0);
    expect(isAmbiguous(cs)).toBe(false);
  });

  it('双王是歧义：王炸 或 任意一对', () => {
    const cs = cards('jB jS');
    const ids = enumerateIdentities(cs).map((p) => comboIdentity(p.combo));
    expect(ids).toContain('jokerBomb|2|0');
    expect(ids).toContain('pair|2|5');
    expect(isAmbiguous(cs)).toBe(true);
  });

  it('枚举出的每一种解释都真的能被识别器认回来', () => {
    for (const spec of ['jB S5 H6', 'jB jS S5', 'jB S5', 'jB jS', 'jB S5 H5 D5']) {
      const cs = cards(spec);
      for (const p of enumerateIdentities(cs)) {
        const again = identify(p.cards, p.assign);
        expect(again).not.toBeNull();
        expect(comboIdentity(again!)).toBe(comboIdentity(p.combo));
      }
    }
  });

  it('枚举结果里没有重复的牌型标识', () => {
    for (const spec of ['jB jS S5 H6 D7', 'jB S3 H4 D5', 'jB jS']) {
      const ids = enumerateIdentities(cards(spec)).map((p) => comboIdentity(p.combo));
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});
