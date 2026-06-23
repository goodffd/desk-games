import { describe, it, expect } from 'vitest';
import { defaultNick } from '../../../src/games/xiangqi/ui/persist';

describe('defaultNick', () => {
  it('形如 棋友 + 3 位数字', () => {
    for (let i = 0; i < 20; i++) expect(defaultNick()).toMatch(/^棋友\d{3}$/);
  });
});
