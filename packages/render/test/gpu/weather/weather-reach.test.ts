import { FOG_STATE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TILE_HALF_H, TILE_HALF_W } from '../../../src/data/projection/index.js';
import { WeatherReach } from '../../../src/gpu/weather/weather-reach.js';
import { WorldFog } from '../../../src/gpu/world-renderer/world-fog.js';
import { fogViewOf, snapshotOf } from '../../support/fixtures.js';

const VIEWPORT = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
const WORLD = snapshotOf([]);

describe('WeatherReach', () => {
  it('follows the fog wash band and asks for a rebind only when its texture changes', () => {
    const fog = new WorldFog();
    const reach = new WeatherReach();
    reach.watchFog(fog.washMask);
    fog.update(WORLD, VIEWPORT);
    expect(reach.update()).toBe(false);
    expect(reach.uniforms.uniforms.uReachFogBand[2]).toBe(0);

    fog.setView(fogViewOf(new Map([['0,0', FOG_STATE.VISIBLE]]), 1));
    fog.update(WORLD, VIEWPORT);
    const mask = fog.washMask;
    expect(mask.source).not.toBeNull();
    // The viewport starts left of and above the map, so the band starts at cell (0, 0).
    expect([mask.originX, mask.originY]).toEqual([-TILE_HALF_W, -TILE_HALF_H / 2]);
    expect(reach.update()).toBe(true);
    expect(reach.fogSource).toBe(mask.source);
    const u = reach.uniforms.uniforms;
    expect([...u.uReachFogBand]).toEqual([mask.originX, mask.originY, mask.bandW, mask.bandH]);
    expect([...u.uReachFogTexel]).toEqual([1 / mask.texW, 1 / mask.texH].map(Math.fround));
    expect(reach.update()).toBe(false);

    fog.setView(null);
    fog.update(WORLD, VIEWPORT);
    expect(reach.update()).toBe(true);
    expect(u.uReachFogBand[2]).toBe(0);
  });
});
