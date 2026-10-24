import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraAt,
  checkpointSession,
  MAX_LOAD_PER_CPU,
  overloaded,
  parseDeviceScale,
  parseViewport,
} from '../browser/session.mjs';

const SEARCH =
  'map=krwawa_rzeka&player=overseer&tribes=1:2&difficulty=1:hard&computer=1,2&seed=7&fog=classic&needs=off';

function save(session = {}) {
  return {
    header: {
      mapId: 'krwawa_rzeka',
      tick: 50002,
      seed: 7,
      session: { search: SEARCH, stateHash: 'abc', ...session },
    },
  };
}

test('a checkpoint replays as the session its stamp names, watched by the observer', () => {
  const { header, stateHash, params } = checkpointSession(save());
  assert.equal(header.tick, 50002);
  assert.equal(stateHash, 'abc');
  for (const [key, value] of new URLSearchParams(SEARCH))
    if (key !== 'player') assert.equal(params.get(key), value);
  assert.equal(params.get('player'), 'observer');
  assert.equal(params.get('zoom'), '1');
  assert.equal(params.get('fullscreen'), 'off');
});

test('a checkpoint without a session search or state hash, or with another map, is refused', () => {
  assert.throws(() => checkpointSession(save({ stateHash: undefined })), /bench:map checkpoint/);
  assert.throws(
    () => checkpointSession(save({ search: undefined, machineSeats: [1, 2] })),
    /bench:map checkpoint/,
  );
  assert.throws(() => checkpointSession({}), /bench:map checkpoint/);
  assert.throws(
    () => checkpointSession(save({ search: SEARCH.replace('krwawa_rzeka', 'oczy_weza') })),
    /another map or seed/,
  );
});

test('a camera centres the point in the window at its scale', () => {
  assert.deepEqual(cameraAt({ x: 100, y: 50 }, 2, { width: 1000, height: 600 }), {
    scale: 2,
    offsetX: 300,
    offsetY: 200,
  });
});

test('the load gate trips above the limit and ignores an unavailable reading', () => {
  const load = (loadPerCpu, available = true) => ({ available, loadPerCpu });
  assert.equal(overloaded(load(MAX_LOAD_PER_CPU), load(1)), false);
  assert.equal(overloaded(load(1), load(MAX_LOAD_PER_CPU + 0.1)), true);
  assert.equal(overloaded(load(null, false)), false);
});

test('a bench viewport is WxH, the default window when unset', () => {
  assert.deepEqual(parseViewport(undefined), { width: 1440, height: 900 });
  assert.deepEqual(parseViewport('1920x1080'), { width: 1920, height: 1080 });
  for (const text of ['1920', '1920x', '0x900', '1920X1080', '1920x1080.5'])
    assert.throws(() => parseViewport(text), /ON_BENCH_VIEWPORT must be WxH/);
});

test('a bench device scale is a positive ratio, 1 when unset', () => {
  assert.equal(parseDeviceScale(undefined), 1);
  assert.equal(parseDeviceScale('2'), 2);
  for (const text of ['0', '-1', 'retina'])
    assert.throws(() => parseDeviceScale(text), /ON_BENCH_DEVICE_SCALE must be a positive number/);
});
