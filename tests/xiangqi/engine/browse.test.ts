import { describe, it, expect } from 'vitest';
import { BrowseSession } from '../../../src/games/xiangqi/engine/browse';
import { OPENINGS } from '../../../src/games/xiangqi/engine/openings';
import { initialBoard } from '../../../src/games/xiangqi/engine/board';

const zhongpao = OPENINGS.find((o) => o.id === 'zhongpao-pingfengma')!;

describe('BrowseSession', () => {
  it('新会话停在初始局面、可进不可退', () => {
    const s = new BrowseSession(zhongpao);
    expect(s.position().board).toEqual(initialBoard());
    expect(s.position().turn).toBe('red');
    expect(s.canPrev()).toBe(false);
    expect(s.canNext()).toBe(true);
    expect(s.moves()).toEqual([]);
  });

  it('next 推进谱着、prev 回退', () => {
    const s = new BrowseSession(zhongpao);
    s.next(); // 炮二平五
    expect(s.moves()).toEqual(['炮二平五']);
    expect(s.position().turn).toBe('black');
    expect(s.canPrev()).toBe(true);
    s.prev();
    expect(s.moves()).toEqual([]);
    expect(s.position().turn).toBe('red');
  });

  it('分支节点 frontier 给多变着，next(idx) 选变着', () => {
    const s = new BrowseSession(zhongpao);
    s.next(); s.next(); s.next(); // 炮二平五 马8进7 马二进三 → frontier 有 2 变着
    expect(s.frontier().length).toBe(2);
    s.next(1); // 选第二变着 卒3进1
    expect(s.moves()[3]).toBe('卒3进1');
  });
});
