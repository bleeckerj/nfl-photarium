import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    // The default 5s is too tight for this suite. Several tests do real work
    // per case — the MCP transport tests call `vi.resetModules()`, re-import
    // the server modules, and start an HTTP listener in every test — and the
    // full run collects ~200 files in parallel, so a test that finishes in
    // under a second in isolation can exceed 5s under contention. These
    // limits still catch a genuinely hung test, just not a merely slow one.
    testTimeout: 20000,
    hookTimeout: 20000,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
