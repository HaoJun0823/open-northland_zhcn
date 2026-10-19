import { describe, expect, it } from 'vitest';
import { WORLD_MAGNIFY_MODES } from '../src/gpu/pixel-art-registry.js';
import { worldBatchFragment } from '../src/gpu/world-batch-shader.js';

const SLOTS = 16;
const prescaled = worldBatchFragment(SLOTS, WORLD_MAGNIFY_MODES.prescaled, null);
const xbr = worldBatchFragment(SLOTS, WORLD_MAGNIFY_MODES.xbr, null);

// No GL context runs here; these pin the routing the prescaled program compiles in.
describe('world batch prescaled program', () => {
  it('magnifies a plain page through the sharp path and a paletted one through xBR', () => {
    expect(prescaled).toContain(`const float WORLD_MAGNIFY = ${WORLD_MAGNIFY_MODES.prescaled}.0;`);
    expect(prescaled).toContain(
      'bool xbr = magnified && (WORLD_MAGNIFY == MAGNIFY_XBR || (WORLD_MAGNIFY == MAGNIFY_PRESCALED && paletted));',
    );
    expect(prescaled).toContain('bool sharp = magnified && WORLD_MAGNIFY > 1.5 && !xbr;');
  });

  it('reads the twin slots and keeps a splash at its page texel scale, in that program alone', () => {
    expect(prescaled).toContain('uniform highp int uTwinSlots;');
    expect(prescaled).toContain('* texSize / pageTexelScale(), vec2(1.0));');
    expect(xbr).not.toContain('uTwinSlots');
    expect(xbr).toContain('vec2 size = max((vFrame.zw - vFrame.xy) * texSize, vec2(1.0));');
  });
});
