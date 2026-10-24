import type { SpriteSheet } from '@open-northland/render';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Transform the graph once, outside any test body: it pulls in `@open-northland/render`. Each test then
// re-imports under a fresh registry, since the pictures are kept in module state.
await import('../src/hud/dom/diplomacy-window/emblems.js');

/** The scratch canvas every picture is drawn on: it counts the pictures drawn and names each by its count. */
let drawn = 0;
class FakeImageBitmap {}

/** A slot as the panels make one: its attributes, which `showPicture` writes. */
function slot(): { image: HTMLImageElement; attributes: Map<string, string> } {
  const attributes = new Map<string, string>();
  const image = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  } as unknown as HTMLImageElement;
  return { image, attributes };
}

const FRAME = { x: 0, y: 0, width: 40, height: 30 };
const VIKING = 1;
const FRANK = 2;
const BEAR_PEOPLE = 9;
const MILL = 5;
const HEADQUARTERS = 6;

/** A sheet with a mill and a headquarters bound for every tribe, the mill drawn differently for Franks. */
function sheet(): SpriteSheet {
  return {
    bindings: {
      building: { byType: { [MILL]: 1, [HEADQUARTERS]: 2 }, byTribe: { [FRANK]: { byType: { [MILL]: 3 } } } },
    },
    kindLayers: {
      building: {
        atlas: {
          frames: new Map([
            [1, FRAME],
            [2, FRAME],
            [3, FRAME],
          ]),
        },
        source: { resource: new FakeImageBitmap() },
      },
    },
    characters: { byTribe: { [BEAR_PEOPLE]: {} } },
  } as unknown as SpriteSheet;
}

describe('still pictures', () => {
  beforeEach(() => {
    drawn = 0;
    vi.resetModules();
    vi.stubGlobal('ImageBitmap', FakeImageBitmap);
    const canvas = {
      width: 0,
      height: 0,
      toDataURL: () => `data:${drawn}`,
      getContext: () => ({
        canvas,
        drawImage: () => {
          drawn++;
        },
      }),
    };
    vi.stubGlobal('document', { createElement: () => canvas });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@open-northland/render');
    vi.doUnmock('../src/hud/figures/vehicle-fit.js');
  });

  it('draws a building once per type, tribe and size, and shows the kept picture after', async () => {
    const { createBuildingThumbs } = await import('../src/hud/dom/building-thumb.js');
    const thumbs = createBuildingThumbs(sheet(), VIKING);
    const shown = (typeId: number, box: number, tribe?: number): string | undefined => {
      const { image, attributes } = slot();
      expect(thumbs.paint(image, typeId, box, tribe)).toBe(true);
      return attributes.get('src');
    };
    const mill = shown(MILL, 72);
    expect(shown(MILL, 72)).toBe(mill);
    expect(shown(MILL, 72, VIKING)).toBe(mill);
    expect(drawn).toBe(1);
    expect(shown(MILL, 72, FRANK)).not.toBe(mill);
    expect(shown(MILL, 36)).not.toBe(mill);
    expect(shown(HEADQUARTERS, 72)).not.toBe(mill);
    expect(drawn).toBe(4);
  });

  it("draws a nation's emblem once per tribe, colour and size; a civilization's is its headquarters", async () => {
    // The emblem's figure: one layer whatever the tribe, its painter a fake below.
    vi.doMock('@open-northland/render', async (original) => ({
      ...(await original<typeof import('@open-northland/render')>()),
      resolveLayers: () => [{ scale: 1, frame: { offsetX: 0, offsetY: 0, width: 10, height: 20 } }],
    }));
    vi.doMock('../src/hud/figures/vehicle-fit.js', () => ({
      growFigureBounds: () => ({ minX: 0, maxX: 10, minY: 0, maxY: 20 }),
    }));
    const { createBuildingThumbs } = await import('../src/hud/dom/building-thumb.js');
    const { createNationEmblems } = await import('../src/hud/dom/diplomacy-window/emblems.js');
    const frames = { draw: () => drawn++ };
    const thumbs = createBuildingThumbs(sheet(), VIKING);
    const emblems = createNationEmblems(
      sheet(),
      thumbs,
      frames as unknown as import('../src/hud/figures/figure-frames.js').FigureFrames,
      HEADQUARTERS,
      (player) => player + 10,
    );
    const shown = (tribe: number, player: number, size: number): string | undefined => {
      const { image, attributes } = slot();
      expect(emblems(image, tribe, player, size)).toBe(true);
      return attributes.get('src');
    };
    const bears = shown(BEAR_PEOPLE, 3, 52);
    expect(shown(BEAR_PEOPLE, 3, 52)).toBe(bears);
    expect(drawn).toBe(1);
    expect(shown(BEAR_PEOPLE, 4, 52)).not.toBe(bears);
    expect(shown(BEAR_PEOPLE, 3, 64)).not.toBe(bears);
    expect(drawn).toBe(3);
    // A Frankish nation shows the Frankish headquarters, kept by the building thumbs.
    const franks = shown(FRANK, 3, 52);
    expect(shown(FRANK, 5, 52)).toBe(franks);
    expect(drawn).toBe(4);
  });
});
