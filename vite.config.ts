import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    assetsInlineLimit: 4 * 1024 * 1024, // 4MB — inline fonts/images
  },
  test: {
    exclude: ['**/.claude/**', '**/node_modules/**', '**/dist/**'],
  },
});
