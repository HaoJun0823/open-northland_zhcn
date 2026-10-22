// @vitest-environment jsdom
import type { GameSession } from '@open-northland/lockstep';
import { describe, expect, it, vi } from 'vitest';
import { MONSTER_TRIBES } from '../../src/catalog/creatures.js';
import { verifyMapDocuments } from '../../src/content/transfer/index.js';
import type { HostedMapWorld, MapBootPlan } from '../../src/entries/map/boot.js';

const mocks = vi.hoisted(() => ({ sprites: vi.fn() }));
vi.mock('@open-northland/render', async (original) => ({
  ...(await original<typeof import('@open-northland/render')>()),
  createWindowPixiApp: async () => ({ destroy: () => undefined, renderer: {} }),
}));
vi.mock('../../src/view/boot-progress.js', () => ({
  mountBootProgress: () => ({ begin: async () => undefined, finish: async () => undefined }),
}));
vi.mock('../../src/view/settings-store.js', async (original) => ({
  ...(await original<typeof import('../../src/view/settings-store.js')>()),
  readStoredSettings: () => ({ renderScale: 1, debugToolsEnabled: true }),
}));
vi.mock('../../src/content/map-source/sources.js', async (original) => ({
  ...(await original<typeof import('../../src/content/map-source/sources.js')>()),
  mapFetch: async () => async () => new Response('', { status: 404 }),
}));
vi.mock('../../src/content/ir/load.js', () => ({ loadIr: async () => null }));
vi.mock('../../src/content/sprite-sheet/index.js', () => ({ resolveSpriteSheet: mocks.sprites }));
vi.mock('../../src/view/runtime/world-bootstrap.js', () => ({
  loadLocalizedRealContent: async () => null,
}));

import { assembleMapWorld } from '../../src/entries/map/boot.js';

const SESSION: GameSession = {
  world: { kind: 'map', mapId: 'forest' },
  seed: 1,
  seats: [{ player: 0, color: 0, mode: 'human' }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};
const verifiedMap = verifyMapDocuments('forest', { width: 1, height: 1, typeIds: [0] }, { multiplayer: {} });

/** The tribes the boot asked the sprite sheet for beside the map's own, stopping at the sprites. */
async function adminTribesRequested(multiplayer: boolean): Promise<unknown> {
  mocks.sprites.mockReset();
  mocks.sprites.mockRejectedValue(new Error('stop at the sprites'));
  const plan: MapBootPlan<HostedMapWorld> = {
    hostWorld: async () => ({}) as HostedMapWorld,
    mapId: 'forest',
    stagedSave: null,
    sessionFor: () => SESSION,
    verifiedMap,
    multiplayer,
  };
  await expect(assembleMapWorld({} as HTMLCanvasElement, new URLSearchParams(), plan)).rejects.toThrow(
    'stop at the sprites',
  );
  return mocks.sprites.mock.calls[0]?.[2];
}

describe('admin character pages at boot', () => {
  it('load for a local game with the debug tools on', async () => {
    expect(await adminTribesRequested(false)).toEqual([...MONSTER_TRIBES]);
  });
  it('stay unloaded for a relayed game, which never mounts the admin panel', async () => {
    expect(await adminTribesRequested(true)).toEqual([]);
  });
});
