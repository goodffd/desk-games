/**
 * 测试专用的种子随机数与确定性洗牌 —— 掼蛋在用，干瞪眼的测试将接同一份（issue #3）。
 *
 * 为什么要共用：不共用的话，两个游戏之间 seed 语义不可比，跨游戏复现 bug 时的心智成本白白翻倍。
 * 抽取之前这套东西在测试里复制了 5 份（fuzz / match-fuzz / ai-headtohead / played-log / deal-sim），
 * 另有两处各写各的算法。
 *
 * 算法固定为 LCG（模 2^32、乘数 1664525、增量 1013904223）+ Fisher-Yates。
 * **这套 seed 语义已被 rng.test.ts 的黄金值锁死**：同一个种子必须永远洗出同一副牌，
 * 否则掼蛋既有的 fuzz 复现记录（错误消息里带的 seed）全部作废。改算法 = 作废全部历史种子。
 *
 * 两个变体，按「这个洗牌函数会被调用几次」来选：
 * - `seededShuffle`：每次调用都从种子重置，排列只由种子决定 —— 发一次牌的场景用它。
 * - `seededShuffleStream`：状态跨调用推进，连续调用给出不同排列 —— 一个驱动连发多局的场景用它。
 *   选错会让「连打数局」退化成「同一副牌打数遍」，而断言未必抓得住。
 *
 * 只给测试用；生产代码不要 import 测试目录（依赖方向），所以 `src/games/guandan/ai/rollout.ts`
 * 里那份同款 LCG 保持独立 —— 它同样是「要可复现」而非「要随机」，只是不能反向依赖过来。
 */

/**
 * 造一个种子线性同余生成器，返回 `next()`，每次吐出 `[0, 2^32)` 的整数。
 * 种子按 32 位无符号截断，所以负数与超界值也能安全传入。
 */
export function makeLCG(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

/**
 * 造一个洗牌函数，形状与引擎 `deal(deck, shuffle)` 要的一致：吃 `n`，吐 `[0..n-1]` 的一个排列。
 *
 * 语义：**排列只由 seed 决定，与调用次数无关**——返回的函数每次调用都从 seed 重新起步，
 * 所以同一个洗牌函数连调三次拿到的是同一个排列。
 */
export function seededShuffle(seed: number): (n: number) => number[] {
  return (n: number): number[] => {
    const next = makeLCG(seed);
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = next() % (i + 1);
      const tmp = perm[i]!;
      perm[i] = perm[j]!;
      perm[j] = tmp;
    }
    return perm;
  };
}

/**
 * 造一个**状态跨调用推进**的洗牌函数：第一次调用与 `seededShuffle(seed)` 结果相同，
 * 之后每次调用继续往下走 LCG，给出不同的排列；整条序列仍由 seed 唯一决定、可复现。
 *
 * 用在「一个驱动连着发好几局」的测试里。若那里错用了 `seededShuffle`，每局会发到同一副牌，
 * 多局覆盖静默归零而测试照绿 —— 这是本模块抽取过程中真实发生过的一次回归。
 */
export function seededShuffleStream(seed: number): (n: number) => number[] {
  const next = makeLCG(seed); // 注意：建在返回函数之外，故状态跨调用保留
  return (n: number): number[] => {
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = next() % (i + 1);
      const tmp = perm[i]!;
      perm[i] = perm[j]!;
      perm[j] = tmp;
    }
    return perm;
  };
}
