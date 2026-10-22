import type { SpriteLayer } from '@open-northland/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ stems: [] as string[] }));

vi.mock('../src/content/ir/load.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/content/ir/load.js')>()),
  loadLayer: (stem: string): Promise<SpriteLayer> => {
    loaded.stems.push(stem);
    return Promise.resolve({ label: stem } as unknown as SpriteLayer);
  },
}));

// Test files share one module registry; import the subject into one cleared of the real loader.
vi.resetModules();
const { loadBaseHumanLayers } = await import('../src/content/sprite-sheet/human-sheet.js');

const BASE_STEMS = ['cr_hum_body_00.test_human_00', 'cr_hum_head_00.test_human_00'];

beforeEach(() => {
  loaded.stems = [];
});

describe('the base human layers', () => {
  it('are not loaded for a sheet whose settlers draw as characters', async () => {
    const { body, head } = await loadBaseHumanLayers(true);

    expect(loaded.stems).toEqual([]);
    expect(body.atlas.frames.size).toBe(0);
    expect(head).toBeUndefined();
  });

  it('load the body and the head overlay for a sheet without characters', async () => {
    const { body, head } = await loadBaseHumanLayers(false);

    expect(loaded.stems.sort()).toEqual(BASE_STEMS);
    expect(body).toMatchObject({ label: BASE_STEMS[0] });
    expect(head).toMatchObject({ label: BASE_STEMS[1] });
  });
});
