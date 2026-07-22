/**
 * AI 增强基准：改进版 choosePlay(src) vs 冻结的现版基线(baseline-ai)。
 * 目标"稳压现版"：新队头游胜率 ≥ 56%（记牌 + 双下 + 残局搜索三件事累计效果）。
 * 台架同 ai-headtohead：500 局轮换座位，忠实头游制无平局。
 */
import { describe, it, expect } from 'vitest';
import { choosePlay } from '../src/games/guandan/ai/ai';
import { baselineChoosePlay } from './helpers/baseline-ai';
import { benchmark } from './helpers/deal-sim';
import { slowCount } from './helpers/slow-knobs';

// dev 提速：BENCH_GAMES=200 npm run test:slow；默认 500 局（提交基线）
const GAMES = slowCount('BENCH_GAMES', 500);
// 记牌+双下+残局rollout+便宜抢节奏 四件套实测 ~58% 头游 / 平均升级 ~1.33。
// 门槛取稳健下界（AI 确定性、基准可复现，但保留余量当回归地板，非 flaky）：
const WIN_FLOOR = 0.55;      // 头游胜率下界（基线自打≈50%，明显更强）
const UPGRADE_FLOOR = 1.15;  // 平均升级下界（基线≈1.0；含双下的真实计分，噪声更小）

describe('增强 AI vs 现版基线', () => {
  it(`稳压现版：头游胜率 ≥ ${WIN_FLOOR * 100}% 且 平均升级 ≥ ${UPGRADE_FLOOR}（${GAMES} 局）`, () => {
    const r = benchmark(choosePlay, baselineChoosePlay, GAMES);
    // eslint-disable-next-line no-console
    console.log(
      `增强 vs 基线：头游胜率=${(r.winRate * 100).toFixed(1)}% ` +
      `双下率=${(r.doubleDownRate * 100).toFixed(1)}% ` +
      `平均升级=${r.avgUpgrade.toFixed(2)}级`,
    );
    expect(r.winRate).toBeGreaterThanOrEqual(WIN_FLOOR);
    expect(r.avgUpgrade).toBeGreaterThanOrEqual(UPGRADE_FLOOR);
  });
});
