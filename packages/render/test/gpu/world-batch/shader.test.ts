import { describe, expect, it } from 'vitest';
import { WORLD_MAGNIFY_MODES } from '../../../src/gpu/pixel-art/registry.js';
import { worldBatchFragment } from '../../../src/gpu/world-batch/shader.js';

describe('world batch sampling', () => {
  it('leaves xBR and its twelve-tap window out of the unmagnified program', () => {
    const magnifying = worldBatchFragment(16, WORLD_MAGNIFY_MODES.xbr, null, 'magnifying');
    const unmagnified = worldBatchFragment(16, WORLD_MAGNIFY_MODES.xbr, null, 'unmagnified');
    for (const wide of ['magnifyXbrCorner(n,', 'taps[XBR_TAPS]']) {
      expect(magnifying).toContain(wide);
      expect(unmagnified).not.toContain(wide);
    }
  });
});
