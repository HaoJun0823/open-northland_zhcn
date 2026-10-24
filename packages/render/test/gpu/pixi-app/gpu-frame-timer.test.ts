import type { Application } from 'pixi.js';
import { expect, it } from 'vitest';
import { createGpuFrameTimer } from '../../../src/gpu/pixi-app/gpu-frame-timer.js';

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;
const NS_PER_MS = 1e6;

/** A context whose queries land when the test says, counting the disjoint reads. */
function fakeContext() {
  const landed = new Set<object>();
  const state = { disjoint: false, disjointReads: 0, landAll: () => {} };
  const queries: object[] = [];
  const gl = {
    QUERY_RESULT,
    QUERY_RESULT_AVAILABLE,
    getExtension: (name: string) =>
      name === 'EXT_disjoint_timer_query_webgl2' ? { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT } : null,
    createQuery: () => {
      const query = {};
      queries.push(query);
      return query;
    },
    beginQuery: () => {},
    endQuery: () => {},
    deleteQuery: () => {},
    getQueryParameter: (query: object, name: number) =>
      name === QUERY_RESULT_AVAILABLE ? landed.has(query) : 2 * NS_PER_MS,
    getParameter: (name: number) => {
      if (name !== GPU_DISJOINT_EXT) return null;
      state.disjointReads++;
      const value = state.disjoint;
      state.disjoint = false;
      return value;
    },
  };
  state.landAll = () => {
    for (const query of queries) landed.add(query);
  };
  return { app: { renderer: { gl } } as unknown as Application, state };
}

it('reads the disjoint flag only on a drain that takes a result', () => {
  const { app, state } = fakeContext();
  const timer = createGpuFrameTimer(app);
  const taken: number[] = [];
  timer?.begin();
  timer?.end();
  timer?.drain((ms) => taken.push(ms));
  expect(state.disjointReads).toBe(0);

  state.landAll();
  timer?.drain((ms) => taken.push(ms));
  expect(state.disjointReads).toBe(1);
  expect(taken).toEqual([2]);
});

it('voids every result in flight when the flag shows a disjoint event', () => {
  const { app, state } = fakeContext();
  const timer = createGpuFrameTimer(app);
  const taken: number[] = [];
  for (let frame = 0; frame < 2; frame++) {
    timer?.begin();
    timer?.end();
  }
  state.disjoint = true;
  state.landAll();
  timer?.drain((ms) => taken.push(ms));
  expect(taken).toEqual([]);

  timer?.begin();
  timer?.end();
  state.landAll();
  timer?.drain((ms) => taken.push(ms));
  expect(taken).toEqual([2]);
});
