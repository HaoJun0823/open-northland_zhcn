import { defineConfig } from 'vitest/config';

/** Browser checks of the served app; `npm run test:e2e --workspace @open-northland/app` runs them. */
const TEST_TIMEOUT_MS = 120_000;

export default defineConfig({
  test: { include: ['test-e2e/**/*.test.ts'], testTimeout: TEST_TIMEOUT_MS, hookTimeout: TEST_TIMEOUT_MS },
});
