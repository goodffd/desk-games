import { describe, it, expect } from 'vitest';
import { identify, beats } from '../../src/games/gandengyan/engine/combos';
import { cards } from './mk';

function id(spec: string) {
  const combo = identify(cards(spec));
  if (!combo) throw new Error(`本该认得出牌型：${spec}`);
  return combo;
}

describe('炸弹的识别', () => {
  it('3 张同点是炸', () => {
    expect(id('S5 H5 D5')).toMatchObject({ type: 'bomb', length: 3 });
  });

  it('4 张同点是炸', () => {
    expect(id('S5 H5 D5 C5')).toMatchObject({ type: 'bomb', length: 4 });
  });

  it('同一个炸最多 4 张：5 张同点不成牌型', () => {
    // 一副牌里同点只有 4 张，物理上凑不出 5 张；但 #7 的王能当替身，
    // 必须现在就把上限钉死，别让「张数越多越大」自然延伸出 5 张、6 张炸。
    expect(identify(cards('S5 H5 D5 C5 S5'))).toBeNull();
    expect(identify(cards('S5 H5 D5 C5 S5 H5'))).toBeNull();
  });

  it('2 也能成炸', () => {
    expect(id('S2 H2 D2')).toMatchObject({ type: 'bomb', length: 3 });
  });

  it('王炸 = 大王 + 小王', () => {
    expect(id('jB jS')).toMatchObject({ type: 'jokerBomb', length: 2 });
    expect(id('jS jB')).toMatchObject({ type: 'jokerBomb', length: 2 });
  });

  it('单张王仍然出不去（百搭是 #7）', () => {
    expect(identify(cards('jB'))).toBeNull();
    expect(identify(cards('jS'))).toBeNull();
  });

  it('王跟普通牌混在一起本期仍不成牌型（百搭是 #7）', () => {
    expect(identify(cards('jB S5 H5'))).toBeNull();
    expect(identify(cards('jB S5'))).toBeNull();
  });
});

describe('炸弹全序：3 张炸 < 4 张炸 < 王炸', () => {
  const b3 = () => id('S5 H5 D5');
  const b3big = () => id('S9 H9 D9');
  const b4 = () => id('S4 H4 D4 C4');
  const jb = () => id('jB jS');

  it('相邻档位逐档双向：能压 / 反向压不住', () => {
    expect(beats(b3(), b4())).toBe(true);
    expect(beats(b4(), b3())).toBe(false);
    expect(beats(b4(), jb())).toBe(true);
    expect(beats(jb(), b4())).toBe(false);
    expect(beats(b3(), jb())).toBe(true);
    expect(beats(jb(), b3())).toBe(false);
  });

  it('张数优先于点数：4 张的 4 压得住 3 张的 9', () => {
    expect(beats(b3big(), b4())).toBe(true);
    expect(beats(b4(), b3big())).toBe(false);
  });

  it('同张数比点数，且「大就行」不受大一约束', () => {
    expect(beats(b3(), b3big())).toBe(true);       // 555 → 999，隔了四级照压
    expect(beats(b3(), id('S6 H6 D6'))).toBe(true); // 大一级当然也行
    expect(beats(b3big(), b3())).toBe(false);       // 小的压不住大的
    expect(beats(b3(), id('C5 S5 H5'))).toBe(false); // 同点压不住
  });

  it('炸弹里 2 也按点数排在 A 之上', () => {
    expect(beats(id('SA HA DA'), id('S2 H2 D2'))).toBe(true);
    expect(beats(id('S2 H2 D2'), id('SA HA DA'))).toBe(false);
  });

  it('王炸压一切，且压不住它', () => {
    for (const spec of ['S3', 'S3 H3', 'S3 H4 D5', 'S3 H3 D4 C4', 'S2', 'S2 H2', 'S5 H5 D5', 'S5 H5 D5 C5']) {
      expect(beats(id(spec), jb())).toBe(true);
      expect(beats(jb(), id(spec))).toBe(false);
    }
  });
});

describe('逃生口一：炸弹压任意非炸牌型', () => {
  it('炸弹压得住单张 / 对子 / 顺子 / 连对', () => {
    const bomb = id('S5 H5 D5');
    for (const spec of ['S3', 'SA', 'S2', 'S3 H3', 'SA HA', 'S2 H2', 'S3 H4 D5', 'SQ HK DA', 'S3 H3 D4 C4']) {
      expect(beats(id(spec), bomb)).toBe(true);
    }
  });

  it('普通牌型压不住炸弹', () => {
    const bomb = id('S5 H5 D5');
    for (const spec of ['S6', 'S2', 'S2 H2', 'S6 H6', 'S6 H7 D8']) {
      expect(beats(bomb, id(spec))).toBe(false);
    }
  });

  it('炸弹不受大一约束——它根本不走那条链', () => {
    expect(beats(id('S3'), id('SK HK DK'))).toBe(true);
  });
});

describe('逃生口二：单张 2 压任意单张', () => {
  it('不论差几级都压得住', () => {
    for (const spec of ['S3', 'S7', 'SJ', 'SA']) {
      expect(beats(id(spec), id('H2'))).toBe(true);
    }
  });

  it('2 压不住 2', () => {
    expect(beats(id('S2'), id('H2'))).toBe(false);
  });

  it('这条特权只给单张：2 压不住对子，也压不了顺子', () => {
    expect(beats(id('S3 H3'), id('H2'))).toBe(false);
    expect(beats(id('S3 H4 D5'), id('H2'))).toBe(false);
  });
});

describe('逃生口三：对 2 压任意对子', () => {
  it('不论差几级都压得住', () => {
    for (const spec of ['S3 H3', 'S7 H7', 'SA HA']) {
      expect(beats(id(spec), id('D2 C2'))).toBe(true);
    }
  });

  it('对 2 压不住对 2', () => {
    expect(beats(id('S2 H2'), id('D2 C2'))).toBe(false);
  });

  it('这条特权只给对子：对 2 压不住单张，也压不了连对', () => {
    expect(beats(id('SA'), id('D2 C2'))).toBe(false);
    expect(beats(id('S3 H3 D4 C4'), id('D2 C2'))).toBe(false);
  });
});

describe('2 的三条特权互相独立', () => {
  it('① 压单张', () => {
    expect(beats(id('SA'), id('H2'))).toBe(true);
  });

  it('② 压对子', () => {
    expect(beats(id('SA HA'), id('D2 C2'))).toBe(true);
  });

  it('③ 不入顺子与连对——特权归特权，顺子里没它的位置', () => {
    expect(identify(cards('S2 H3 D4'))).toBeNull();
    expect(identify(cards('SK HA D2'))).toBeNull();
    expect(identify(cards('SA HA S2 H2'))).toBeNull();
  });

  it('前两条不互相渗透：单张的特权管不到对子那边', () => {
    // 一张 2 不能拿去压对子（连牌型都不同），一对 2 也不能拆开压单张
    expect(beats(id('S3 H3'), id('H2'))).toBe(false);
    expect(beats(id('S3'), id('D2 C2'))).toBe(false);
  });
});
