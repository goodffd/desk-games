import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    assetsInlineLimit: 4 * 1024 * 1024, // 4MB — inline fonts/images
  },
  test: {
    // 快轨：日常验证跑这一档，秒级返回。
    // 慢轨（`*.slow.test.ts` = 模糊测试 + AI 对打基准）在这里排除，改由 `npm run test:slow`
    // 走 vitest.slow.config.ts 单独跑。分轨的理由见 CLAUDE.md《运行 / 验证命令》：
    // 慢轨占全量测试时间的 94%，混在一起会让日常验证慢到没人愿意在提交前跑。
    exclude: ['**/.claude/**', '**/node_modules/**', '**/dist/**', '**/*.slow.test.ts'],
  },
});
