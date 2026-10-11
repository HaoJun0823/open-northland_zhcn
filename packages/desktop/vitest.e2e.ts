import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Each file launches its own Electron shell; one at a time keeps their timings apart.
  test: { include: ['test-e2e/**/*.test.ts'], fileParallelism: false },
});
