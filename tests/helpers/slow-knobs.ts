/**
 * 慢轨的局数旋钮。
 *
 * 默认值就是**提交基线**——慢轨全绿是按这个规模说的。环境变量只为本地快速冒烟
 * （「这条测试还跑得通吗」），调小之后统计类门槛（胜率、平均升级）在那个样本量下
 * 不具代表性，不能拿来当提交或发版依据，所以调小时会打一行醒目的警告。
 *
 * 现有旋钮：
 * - `FUZZ_GAMES`    单局模糊测试的局数（默认 1000）
 * - `FUZZ_MATCHES`  整盘模糊测试的盘数（默认 50）
 * - `BENCH_GAMES`   AI 对打基准的局数（默认 500，两个基准文件共用）
 */
export function slowCount(envName: string, fallback: number): number {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const raw = env?.[envName];
  if (raw === undefined || raw.trim() === '') return fallback;

  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${envName}=${raw} 不是正整数；慢轨局数旋钮只接受 ≥1 的整数`);
  }
  if (n < fallback) {
    // eslint-disable-next-line no-console
    console.warn(
      `⚠ ${envName}=${n}（基线 ${fallback}）——本地冒烟档。` +
      `此规模下统计类门槛不具代表性，绿灯不等于通过，不可作为提交/发版依据。`,
    );
  }
  return n;
}
