import { vi } from 'vitest';

/**
 * The one `swapToEntry` stand-in for test files that mock `launch.js`. Files share modules, so a
 * module another file loaded first keeps that file's mock; a shared stand-in reaches either way.
 * It leaves at once, running the teardown as the next entry's load would.
 */
export const swapToEntry = vi.fn((_search: string, teardown: () => void) => {
  teardown();
  return Promise.resolve();
});
