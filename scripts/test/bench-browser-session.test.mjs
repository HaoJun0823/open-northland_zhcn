import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraAt, checkpointSession, MAX_LOAD_PER_CPU, overloaded } from '../bench-browser-session.mjs';

function save(session = {}) {
  return {
    header: {
      mapId: 'krwawa_rzeka',
      tick: 50002,
      seed: 7,
      session: { machineSeats: [1, 2], stateHash: 'abc', ...session },
    },
  };
}

test('a checkpoint replays as an observer session over its computer seats', () => {
  const { header, stateHash, params } = checkpointSession(save({ tribes: '1:2', needs: false }));
  assert.equal(header.tick, 50002);
  assert.equal(stateHash, 'abc');
  assert.equal(params.get('map'), 'krwawa_rzeka');
  assert.equal(params.get('player'), 'observer');
  assert.equal(params.get('computer'), '1,2');
  assert.equal(params.get('seed'), '7');
  assert.equal(params.get('tribes'), '1:2');
  assert.equal(params.get('needs'), 'off');
  assert.equal(params.get('progression'), null);
});

test('a checkpoint without seats or a state hash is refused', () => {
  assert.throws(() => checkpointSession(save({ stateHash: undefined })), /bench:map checkpoint/);
  assert.throws(() => checkpointSession(save({ machineSeats: [16] })), /bench:map checkpoint/);
  assert.throws(() => checkpointSession({}), /bench:map checkpoint/);
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
