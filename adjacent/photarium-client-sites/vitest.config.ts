import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.mjs'],
  },
  resolve: {
    alias: {
      '@client': path.resolve(__dirname, 'src/client'),
      '@worker': path.resolve(__dirname, 'src/worker'),
    },
  },
});
