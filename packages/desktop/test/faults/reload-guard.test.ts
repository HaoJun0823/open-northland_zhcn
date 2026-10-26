import { describe, expect, it } from 'vitest';
import { createCrashReloadGuard } from '../../src/faults/reload-guard.js';

const WINDOW_MS = 60_000;

describe('createCrashReloadGuard', () => {
  it('reloads a crashed page at once unless it crashed again within the window', () => {
    const guard = createCrashReloadGuard(WINDOW_MS);
    expect(guard.reloadWithoutAsking(0)).toBe(true);
    expect(guard.reloadWithoutAsking(WINDOW_MS - 1)).toBe(false);
    expect(guard.reloadWithoutAsking(2 * WINDOW_MS - 2)).toBe(false);
    expect(guard.reloadWithoutAsking(3 * WINDOW_MS)).toBe(true);
  });
});
