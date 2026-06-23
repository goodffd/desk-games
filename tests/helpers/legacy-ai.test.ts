import { describe, it, expect } from 'vitest';
import { makeDeck, deal } from '../../src/games/guandan/engine/cards';
import { createDeal } from '../../src/games/guandan/engine/game';
import { isLegalPlay } from '../../src/games/guandan/engine/legal';
import { legacyChoosePlay } from './legacy-ai';
import type { Seat } from '../../src/games/guandan/engine/types';

describe('legacyChoosePlay 快照', () => {
  it('开局自由领牌返回合法非空出牌', () => {
    const deck = makeDeck();
    const hands = deal(deck, (n) => Array.from({ length: n }, (_, i) => i));
    const s = createDeal(hands, 0 as Seat, 2);
    const play = legacyChoosePlay(s, s.turn);
    expect(play).not.toBeNull();
    expect(isLegalPlay(play!, null, s.hands[s.turn]!, 2)).toBe(true);
  });
});
