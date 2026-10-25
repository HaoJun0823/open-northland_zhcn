import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGraphicsKnobs, parseWindowSpec } from '../../bench/browser/frames-plan.mjs';

test('a window spec names cameras with a speed each', () => {
  assert.equal(parseWindowSpec(undefined), undefined);
  assert.deepEqual(parseWindowSpec('dense:3,wide:0'), [
    { cameraName: 'dense', speed: 3 },
    { cameraName: 'wide', speed: 0 },
  ]);
  assert.throws(() => parseWindowSpec('nope:3'), /camera:speed/);
  assert.throws(() => parseWindowSpec('dense:1.5'), /camera:speed/);
});

test('the graphics knobs default to xBR at render scale 1 and switch the filter off on request', () => {
  assert.deepEqual(parseGraphicsKnobs({}), {
    filter: 'xbr',
    renderScale: 1,
    settings: { enhancedSampling: true, pixelArtScaler: 'xbr', renderScale: 1 },
  });
  const off = parseGraphicsKnobs({ ON_BENCH_BROWSER_FILTER: 'off', ON_BENCH_BROWSER_RENDER_SCALE: '0.5' });
  assert.deepEqual(off.settings, { enhancedSampling: false, renderScale: 0.5 });
  assert.throws(() => parseGraphicsKnobs({ ON_BENCH_BROWSER_FILTER: 'bilinear' }), /FILTER/);
  assert.throws(() => parseGraphicsKnobs({ ON_BENCH_BROWSER_RENDER_SCALE: '3' }), /RENDER_SCALE/);
});
