/**
 * DealState.played 累计日志单测（AI 记牌地基）。
 * 校验：createDeal 空 → play 追加本手 → pass 不变 → 全程 |played| + Σ|hands| == 108（无凭空增减）。
 */
import { describe, it, expect } from 'vitest';
import { makeDeck, deal } from '../src/games/guandan/engine/cards';
import { createDeal, play, pass, isDealOver } from '../src/games/guandan/engine/game';
import { choosePlay } from '../src/games/guandan/ai/ai';
import type { Seat } from '../src/games/guandan/engine/types';

function seededShuffle(seed: number) {
  let st = seed >>> 0;
  const next = () => (st = (Math.imul(st, 1664525) + 1013904223) >>> 0);
  return (n: number): number[] => {
    const p = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = next() % (i + 1); [p[i], p[j]] = [p[j]!, p[i]!]; }
    return p;
  };
}

describe('DealState.played 记牌日志', () => {
  it('createDeal → played 为空', () => {
    const hands = deal(makeDeck(), seededShuffle(1));
    const s = createDeal(hands, 0, 2);
    expect(s.played ?? []).toEqual([]);
  });

  it('play 追加本手、pass 不变；played 无重复 id', () => {
    const hands = deal(makeDeck(), seededShuffle(7));
    let s = createDeal(hands, 0, 2);
    const lead = choosePlay(s, 0)!;
    s = play(s, 0, lead);
    expect(s.played!.map(c => c.id).sort()).toEqual(lead.map(c => c.id).sort());
    const beforePass = s.played!.length;
    s = pass(s, 1); // 座 1 不要（此时桌面有牌，可 pass）
    expect(s.played!.length).toBe(beforePass); // pass 不改 played
    const ids = new Set(s.played!.map(c => c.id));
    expect(ids.size).toBe(s.played!.length); // 无重复
  });

  it('整局全程守恒：|played| + Σ|hands| == 108', () => {
    const hands = deal(makeDeck(), seededShuffle(42));
    let s = createDeal(hands, (2 as Seat), 2);
    for (let step = 0; step < 4000 && !isDealOver(s); step++) {
      const seat = s.turn;
      const mv = choosePlay(s, seat);
      s = mv === null ? pass(s, seat) : play(s, seat, mv);
      const inHands = s.hands.reduce((n, h) => n + h.length, 0);
      expect((s.played?.length ?? 0) + inHands).toBe(108);
    }
    expect(isDealOver(s)).toBe(true);
    // 掼蛋规则：只剩一家时自动记末游、末游剩牌不出 → played = 108 − 末游剩牌。
    const last = s.finished[3]!;
    const leftover = s.hands[last]!.length;
    expect(s.played!.length).toBe(108 - leftover);
    // 其余三家已空
    for (const seat of s.finished.slice(0, 3)) expect(s.hands[seat]!.length).toBe(0);
  });
});
