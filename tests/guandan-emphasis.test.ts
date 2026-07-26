import { describe, it, expect } from 'vitest';
import { emphasis, type EmphasisInput } from '../src/games/guandan/ui/view';

/** 默认「牌局进行中、不是我的回合、我的出牌区压住手牌」，各条按需覆写。 */
const at = (o: Partial<EmphasisInput> = {}): EmphasisInput =>
  ({ live: true, myTurn: false, coversHand: true, ...o });

describe('emphasis — 手牌 / 我的出牌区按回合整段一实一淡', () => {
  it('不是我的回合 → 手牌淡，我出的牌浮在上面、实体', () => {
    expect(emphasis(at())).toEqual({ handDim: true, myPlayDim: false, myPlayOnTop: true });
  });

  it('轮到我 → 手牌回实体，出牌区沉下去淡掉', () => {
    expect(emphasis(at({ myTurn: true }))).toEqual({ handDim: false, myPlayDim: true, myPlayOnTop: false });
  });

  it('「不是我的回合」这段不看谁最新出牌——别家接手不改变任何一项', () => {
    // 绑最新出牌者的话，这段只活到下家动手（真机 1.7s，还含 .25s 淡入）→ 肉眼看不见。
    // 整段只认 myTurn，别家出多少手都不影响，状态才看得住。
    const 我刚出完 = emphasis(at());
    const 别家接手 = emphasis(at());
    const 又一家接手 = emphasis(at());
    expect(别家接手).toEqual(我刚出完);
    expect(又一家接手).toEqual(我刚出完);
  });
});

describe('emphasis — 不该淡的时候一律不淡', () => {
  it('出牌区不压手牌（本副我还没出过牌 / 桌面宽屏不相交）→ 不淡手牌，别白洗一层', () => {
    expect(emphasis(at({ coversHand: false })).handDim).toBe(false);
  });

  it('轮到我时不看压不压——手牌一律实体', () => {
    expect(emphasis(at({ myTurn: true, coversHand: true })).handDim).toBe(false);
    expect(emphasis(at({ myTurn: true, coversHand: false })).handDim).toBe(false);
  });

  it('牌局没进行（未开打 / 本副已结束）→ 手牌和出牌区都保持实体，我的牌也不浮', () => {
    expect(emphasis(at({ live: false }))).toEqual({ handDim: false, myPlayDim: false, myPlayOnTop: false });
    expect(emphasis(at({ live: false, myTurn: true }))).toEqual({ handDim: false, myPlayDim: false, myPlayOnTop: false });
  });
});
