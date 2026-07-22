import { defineConfig } from 'vite';

/**
 * 慢轨配置：只跑 `*.slow.test.ts`（模糊测试 + AI 对打基准）。
 *
 * 为什么单独一个配置文件而不是给 `vitest run` 传参：基础配置 vite.config.ts 把
 * `*.slow.test.ts` 排除掉了，而 exclude 优先于文件名过滤 —— 想跑慢轨就必须换一套
 * include/exclude，这是最少魔法的写法。
 *
 * 局数旋钮见 tests/helpers/slow-knobs.ts：本地冒烟可以调小，但调小后统计类门槛不作数。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.slow.test.ts'],
    exclude: ['**/.claude/**', '**/node_modules/**', '**/dist/**'],
  },
});
