import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@was/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    passWithNoTests: true,
  },
});
