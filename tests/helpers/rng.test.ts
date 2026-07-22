import { describe, it, expect } from 'vitest';
import { makeLCG, seededShuffle, seededShuffleStream } from './rng';

/**
 * 黄金值回归锁。
 *
 * 这些数字是在「抽公共模块」之前，从当时的 tests/fuzz.test.ts（现 fuzz.slow.test.ts）里那份实现逐字照抄跑出来的
 * （见 issue #3）。它们的作用不是描述算法，而是**钉死 seed 语义**：
 * 同一个种子在改造前后必须洗出同一副牌，否则掼蛋既有的所有 fuzz 复现记录全部作废。
 *
 * 改动 rng.ts 让这里变红时，先想清楚是不是真要作废全部历史种子，而不是顺手更新期望值。
 *
 * **两处例外，seed 语义是被刻意改掉的**（issue #3 已记录影响范围）：
 * - `tests/ai.test.ts` 原本用 Mulberry32，迁过来后同一 seed 发到的牌不同。它只用随机局面做
 *   合法性与统计倾向断言，不依赖任何具体牌面；迁移后全部断言仍绿。
 * - `tests/guandan-match-driver.test.ts` 原本用 glibc 式 LCG、种子写死 12345，迁过来后牌面不同。
 *   它用 `seededShuffleStream` 保住「连发多局各不相同」这条性质，具体牌面不作要求。
 * 两处的历史 seed 均无对外复现记录（错误消息里不带 seed），作废无影响。
 */

/**
 * 顺序敏感的校验和，用来在断言里代替「贴出 108 个数字」。
 * 位置参与哈希，所以元素集合相同、顺序不同会得到不同结果 —— 这正是洗牌回归要抓的东西。
 * 只有本文件用得上，故留在这里而不是塞进共享模块。
 */
function orderedChecksum(values: readonly number[]): number {
  let h = 2166136261;
  for (let i = 0; i < values.length; i++) {
    h = Math.imul(h ^ (values[i]! + i * 2654435761), 16777619) >>> 0;
  }
  return h;
}
describe('makeLCG — 种子随机数生成器', () => {
  it('LCG 前 5 个输出与改造前逐位相同', () => {
    const take5 = (seed: number): number[] => {
      const next = makeLCG(seed);
      return [next(), next(), next(), next(), next()];
    };
    expect(take5(0)).toEqual([1013904223, 1196435762, 3519870697, 2868466484, 1649599747]);
    expect(take5(1)).toEqual([1015568748, 1586005467, 2165703038, 3027450565, 217083232]);
    expect(take5(42)).toEqual([1083814273, 378494188, 2479403867, 955863294, 1613448261]);
  });

  it('输出落在 32 位无符号范围内', () => {
    const next = makeLCG(12345);
    for (let i = 0; i < 200; i++) {
      const v = next();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('同种子两个独立生成器产出同一条序列', () => {
    const a = makeLCG(7);
    const b = makeLCG(7);
    for (let i = 0; i < 50; i++) expect(a()).toBe(b());
  });
});

describe('seededShuffle — 确定性洗牌', () => {
  // 覆盖 0（种子为 0 是边界：state 从 0 起步）、小数、以及 fuzz 里真实用过的 0xdead=57005
  const SEEDS = [0, 1, 7, 42, 1337, 12345, 57005];

  it('n=8 的完整排列与改造前逐位相同', () => {
    const golden: Record<number, number[]> = {
      0: [2, 5, 0, 3, 6, 1, 4, 7],
      1: [5, 3, 1, 6, 0, 2, 7, 4],
      7: [5, 3, 0, 7, 1, 6, 4, 2],
      42: [0, 6, 3, 7, 4, 5, 2, 1],
      1337: [5, 2, 6, 0, 1, 7, 3, 4],
      12345: [1, 6, 3, 0, 5, 2, 7, 4],
      57005: [1, 3, 6, 5, 4, 7, 2, 0],
    };
    for (const s of SEEDS) expect(seededShuffle(s)(8)).toEqual(golden[s]);
  });

  it('n=108（双副牌）的排列与改造前相同', () => {
    const golden: Record<number, { head: number[]; ck: number }> = {
      0: { head: [22, 64, 30, 54, 20, 1, 8, 39], ck: 997805689 },
      1: { head: [13, 88, 50, 14, 61, 43, 72, 28], ck: 2678881329 },
      7: { head: [64, 52, 12, 97, 78, 66, 85, 11], ck: 1880015097 },
      42: { head: [60, 30, 103, 11, 32, 54, 72, 86], ck: 2567568429 },
      1337: { head: [6, 53, 78, 47, 96, 25, 104, 75], ck: 2715922713 },
      12345: { head: [90, 80, 56, 74, 1, 27, 10, 87], ck: 1098877653 },
      57005: { head: [86, 11, 3, 70, 49, 79, 9, 38], ck: 2872741925 },
    };
    for (const s of SEEDS) {
      const perm = seededShuffle(s)(108);
      expect(perm.slice(0, 8)).toEqual(golden[s]!.head);
      expect(orderedChecksum(perm)).toBe(golden[s]!.ck);
    }
  });

  it('n=54（单副牌）的排列与改造前相同', () => {
    const golden: Record<number, { head: number[]; ck: number }> = {
      0: { head: [4, 2, 38, 40, 28, 32, 18, 16], ck: 860230423 },
      1: { head: [20, 11, 50, 33, 4, 7, 17, 9], ck: 461044343 },
      7: { head: [2, 14, 19, 26, 49, 7, 25, 18], ck: 1947092439 },
      42: { head: [0, 6, 26, 22, 13, 30, 2, 20], ck: 4189078411 },
      1337: { head: [16, 43, 6, 9, 13, 7, 29, 22], ck: 2353369139 },
      12345: { head: [41, 11, 47, 36, 33, 37, 17, 45], ck: 1522243355 },
      57005: { head: [8, 5, 46, 34, 25, 28, 1, 13], ck: 2483496935 },
    };
    for (const s of SEEDS) {
      const perm = seededShuffle(s)(54);
      expect(perm.slice(0, 8)).toEqual(golden[s]!.head);
      expect(orderedChecksum(perm)).toBe(golden[s]!.ck);
    }
  });

  it('产出的是 [0..n-1] 的排列：不重不漏', () => {
    for (const s of SEEDS) {
      for (const n of [1, 2, 5, 54, 108]) {
        const perm = seededShuffle(s)(n);
        expect(perm).toHaveLength(n);
        expect([...perm].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      }
    }
  });

  it('同一个洗牌函数被反复调用时每次都重置状态，结果恒定', () => {
    // 这是本模块刻意选定的语义：seed 唯一决定排列，与调用次数无关。
    // 迁移前 played-log.test.ts 那份实现把 LCG 状态建在外层，第二次调用会往下走，
    // 与其余四处不一致（单次调用时两者等价，所以历史输出不受影响）。统一取「每次重置」。
    const shuffle = seededShuffle(1337);
    const first = shuffle(108);
    expect(shuffle(108)).toEqual(first);
    expect(shuffle(108)).toEqual(first);
  });

  it('不同种子给出不同排列', () => {
    const seen = new Set(SEEDS.map((s) => seededShuffle(s)(108).join(',')));
    expect(seen.size).toBe(SEEDS.length);
  });

  it('n=0 返回空数组，n=1 返回 [0]', () => {
    expect(seededShuffle(42)(0)).toEqual([]);
    expect(seededShuffle(42)(1)).toEqual([0]);
  });
});

describe('seededShuffleStream — 状态跨调用推进的洗牌', () => {
  it('连续调用给出各不相同的排列', () => {
    const stream = seededShuffleStream(12345);
    const deals = [stream(108), stream(108), stream(108), stream(108)];
    expect(new Set(deals.map((d) => d.join(','))).size).toBe(4);
  });

  it('第一次调用与 seededShuffle 同种子的结果相同', () => {
    expect(seededShuffleStream(12345)(108)).toEqual(seededShuffle(12345)(108));
  });

  it('从第二次调用起与 seededShuffle 分道扬镳', () => {
    const stream = seededShuffleStream(12345);
    const fixed = seededShuffle(12345);
    stream(108);
    fixed(108);
    expect(stream(108)).not.toEqual(fixed(108));
  });

  it('同种子的两条流产出同一串排列（整串可复现）', () => {
    const a = seededShuffleStream(7);
    const b = seededShuffleStream(7);
    for (let i = 0; i < 5; i++) expect(a(54)).toEqual(b(54));
  });

  it('每次产出仍是 [0..n-1] 的排列', () => {
    const stream = seededShuffleStream(42);
    for (let i = 0; i < 5; i++) {
      const perm = stream(54);
      expect([...perm].sort((x, y) => x - y)).toEqual(Array.from({ length: 54 }, (_, k) => k));
    }
  });
});

describe('orderedChecksum — 顺序敏感校验和', () => {
  it('对顺序敏感：换位即变', () => {
    expect(orderedChecksum([1, 2, 3])).not.toBe(orderedChecksum([3, 2, 1]));
  });

  it('同一序列恒定', () => {
    expect(orderedChecksum([5, 0, 9, 2])).toBe(orderedChecksum([5, 0, 9, 2]));
  });
});
