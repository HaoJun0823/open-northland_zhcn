import type { ShaderWarmup, WarmedProgram } from '@open-northland/render';
import { expect, it, vi } from 'vitest';
import type { DiagLog } from '../../../src/diag/log.js';
import { holdWorldAfterContextRestore } from '../../../src/view/graphics/context-restore.js';

const quietLog = { info: vi.fn(), error: vi.fn() } as unknown as DiagLog;
const turns = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function warmups() {
  const settles: ((programs: readonly WarmedProgram[]) => void)[] = [];
  const rewarm = (): ShaderWarmup => ({
    done: new Promise((resolve) => {
      settles.push(resolve);
    }),
  });
  return { settles, rewarm };
}

it('holds the world from a context restore until the warm-up has linked its programs', async () => {
  const canvas = new EventTarget();
  const { settles, rewarm } = warmups();
  const held = holdWorldAfterContextRestore(canvas, new AbortController().signal, rewarm, quietLog);
  expect(held()).toBe(false);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(held()).toBe(true);
  settles[0]?.([{ name: 'world-batch', outcome: 'pending', ms: 20_000 }]);
  await turns();
  expect(held()).toBe(false);
});

it('keeps holding for the warm-up of a later restore', async () => {
  const canvas = new EventTarget();
  const { settles, rewarm } = warmups();
  const held = holdWorldAfterContextRestore(canvas, new AbortController().signal, rewarm, quietLog);
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  settles[0]?.([]);
  await turns();
  expect(held()).toBe(true);
  settles[1]?.([]);
  await turns();
  expect(held()).toBe(false);
});

it('draws at once when the warm-up cannot start', () => {
  const canvas = new EventTarget();
  const held = holdWorldAfterContextRestore(
    canvas,
    new AbortController().signal,
    () => {
      throw new Error('createProgram failed');
    },
    quietLog,
  );
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  expect(held()).toBe(false);
});
