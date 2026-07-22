import { describe, it, expect } from 'vitest';
import { identify, beats, comboIdentity, enumerateIdentities } from '../../src/games/gandengyan/engine/combos';
import type { Card, Combo } from '../../src/games/gandengyan/engine/types';
import { cards } from './mk';

/**
 * 专门证伪 ADR-0002 与 SPEC 里那句断言：
 *
 *   「歧义只可能发生在领出——跟牌时大一法则已把关键点数钉死，牌型标识唯一。」
 *
 * 这条断言撑着整个界面设计：只在领出时弹二选一，跟牌时零打扰。
 * 它一旦不成立，协议与交互都要返工，所以必须在写 UI 之前先撞一次。
 *
 * 判据：给定桌面牌 C 与一组要打出去的牌 S，把 S 的**所有合法解释**里
 * 能压住 C 的那些挑出来。如果剩下不止一种牌型标识，跟牌时就有歧义。
 */
function followIdentities(current: Combo, cs: readonly Card[]): string[] {
  const ids = enumerateIdentities(cs)
    .filter((p) => beats(current, p.combo))
    .map((p) => comboIdentity(p.combo));
  return [...new Set(ids)].sort();
}

describe('跟牌时指派是否唯一（ADR-0002 的核心假设）', () => {
  it('无王时确实唯一——大一法则把点数钉死了', () => {
    const current = identify(cards('S4 H5 D6'))!;   // 顺子 456
    expect(followIdentities(current, cards('S5 H6 D7'))).toEqual(['run|3|7']);
  });

  it('单张王 + 普通牌，多数情况下也唯一', () => {
    const current = identify(cards('S4 H5 D6'))!;
    expect(followIdentities(current, cards('jB S5 H6'))).toEqual(['run|3|7']);
  });

  it('★ 双王：既能当王炸，又能当大一级的对子——两种解释都合法', () => {
    const current = identify(cards('S7 H7'))!;      // 桌面是一对 7
    const ids = followIdentities(current, cards('jB jS'));
    expect(ids).toContain('jokerBomb|2|0');         // 当王炸出，压一切
    expect(ids).toContain('pair|2|8');              // 当一对 8 出，走大一
    expect(ids.length).toBeGreaterThan(1);
  });

  it('★ 两张王 + 一张普通牌：既能当炸弹，又能当大一级的顺子', () => {
    const current = identify(cards('S3 H4 D5'))!;   // 桌面是顺子 345
    const ids = followIdentities(current, cards('jB jS S5'));
    expect(ids).toContain('bomb|3|5');              // 当 3 张 5 的炸弹出
    expect(ids).toContain('run|3|6');               // 当顺子 456 出
    expect(ids.length).toBeGreaterThan(1);
  });

  it('★ 单张王 + 一对：既能当 3 张炸，又能当大一级的对子', () => {
    const current = identify(cards('S7 H7'))!;
    const ids = followIdentities(current, cards('jB S8 H8'));
    expect(ids).toContain('bomb|3|8');
    // 「王+8+8」当对子出不了（3 张牌），所以这一组只有炸弹一种解释
    expect(ids).toEqual(['bomb|3|8']);
  });

  it('★★ 结论：跟牌时的牌型标识不唯一 —— ADR-0002 的这半条假设不成立', () => {
    // 根因不是大一法则失灵，而是**炸弹与 2 的特权本来就绕开大一链条**：
    // 同一组含王的牌，既可以解释成「大一级的普通牌型」，也可以解释成「炸弹」，
    // 两者都压得住桌面。哪个更好取决于对手手牌，跟领出时一样没有支配解。
    const counterExamples: { current: string; play: string }[] = [
      { current: 'S7 H7', play: 'jB jS' },
      { current: 'S3 H4 D5', play: 'jB jS S5' },
      { current: 'S9', play: 'jB jS' },
    ];
    const ambiguous = counterExamples.filter(
      ({ current, play }) => followIdentities(identify(cards(current))!, cards(play)).length > 1,
    );
    expect(ambiguous.length).toBeGreaterThan(0);
  });
});
