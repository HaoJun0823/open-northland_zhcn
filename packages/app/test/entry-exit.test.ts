import { describe, expect, it } from 'vitest';
import { createEntryExit } from '../src/view/runtime/entry-exit.js';

const MENU = '?lang=pl';
const REPLAY = '?map=river&lang=pl';

describe('createEntryExit', () => {
  it('swaps to the entry inside the document, so fullscreen survives the exit', async () => {
    const trace: string[] = [];
    const leave = createEntryExit({
      teardown: () => trace.push('teardown'),
      swap: async (search, teardown) => {
        trace.push(`swap ${search}`);
        teardown();
      },
      navigate: (search) => trace.push(`navigate ${search}`),
    });

    leave(MENU);
    await Promise.resolve();

    expect(trace).toEqual([`swap ${MENU}`, 'teardown']);
  });

  it('starts one handover however many exit paths fire', () => {
    const swaps: string[] = [];
    const leave = createEntryExit({
      teardown: () => undefined,
      swap: (search) => {
        swaps.push(search);
        return new Promise(() => undefined);
      },
      navigate: () => undefined,
    });

    leave(REPLAY);
    leave(MENU);

    expect(swaps).toEqual([REPLAY]);
  });

  it('still reaches the entry by navigating when the handover fails', async () => {
    const navigations: string[] = [];
    const leave = createEntryExit({
      teardown: () => undefined,
      swap: () => Promise.reject(new Error('menu module failed to load')),
      navigate: (search) => navigations.push(search),
    });

    leave(MENU);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(navigations).toEqual([MENU]);
  });
});
