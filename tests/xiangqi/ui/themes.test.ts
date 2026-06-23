import { describe, it, expect } from 'vitest';
import { THEMES, DEFAULT_THEME_KEY, themeByKey } from '../../../src/games/xiangqi/ui/themes';

describe('themes 数据完整性', () => {
  it('恰好 4 套，key 唯一', () => {
    expect(THEMES).toHaveLength(4);
    const keys = THEMES.map((t) => t.key);
    expect(new Set(keys).size).toBe(4);
    expect(keys).toEqual(['cinnabar', 'wood', 'night', 'plain']);
  });

  it('默认主题存在且为朱砂水墨', () => {
    expect(themeByKey(DEFAULT_THEME_KEY).key).toBe('cinnabar');
  });

  it('未知 key 回退到第一套', () => {
    expect(themeByKey('nope').key).toBe('cinnabar');
  });

  it('每套字段非空、pieceStyle 合法、双方调色齐全', () => {
    for (const t of THEMES) {
      expect(t.name).toBeTruthy();
      expect(t.boardBg.length).toBeGreaterThanOrEqual(1);
      expect(t.line && t.frame && t.river && t.mark).toBeTruthy();
      expect(['ivory', 'luminous', 'solid']).toContain(t.pieceStyle);
      for (const side of [t.red, t.black]) {
        expect(side.topStops).toHaveLength(3);
        expect(side.base && side.edge && side.char && side.charUnderlay).toBeTruthy();
      }
      expect(t.accent).toMatch(/^\d+,\d+,\d+$/);
      expect(t.lastMoveRed).toMatch(/^\d+,\d+,\d+$/);
      expect(t.lastMoveBlack).toMatch(/^\d+,\d+,\d+$/);
    }
  });
});
