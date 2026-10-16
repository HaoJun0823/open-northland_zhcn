import { type Entity, ONE } from '@open-northland/sim';
import { Container, Sprite, type Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectSpriteScene } from '../src/data/scene/index.js';
import type { ElevationField } from '../src/data/terrain/index.js';
import * as drawable from '../src/gpu/drawable-resource.js';
import { type PoolFrame, SpritePool } from '../src/gpu/sprite-pool/index.js';
import type { SpriteSheet } from '../src/gpu/sprite-sheet.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import type { SpriteAtlas } from '../src/index.js';
import { entity, snapshotOf } from './support/fixtures.js';
import { useHeadlessShaderContext } from './support/shader-context.js';

useHeadlessShaderContext();

const POST_GFX = 691;
const CLOSED_GATE_GFX = 697;
const OPEN_GATE_GFX = 701;
const GATE_MAX_HP = 500;
const POST_MAX_HP = 100;
const GATE_WALK = [-2, -1, 0, 1, 2].map((dx) => ({ dx, dy: 0 }));
const GATE_REF = 1 as Entity;

function gate(id: number, hitpoints: number, open = false, extra: Record<string, unknown> = {}) {
  return entity(id, id * 10, 4, {
    Palisade: {
      gfxIndex: open ? OPEN_GATE_GFX : CLOSED_GATE_GFX,
      tribe: 1,
      built: ONE,
      walk: GATE_WALK,
      gate: { open, counterpartGfxIndex: open ? CLOSED_GATE_GFX : OPEN_GATE_GFX },
    },
    Health: { hitpoints, max: GATE_MAX_HP },
    ...extra,
  });
}

function hpFracOf(entities: ReturnType<typeof gate>[], ref: number): number | undefined {
  return collectSpriteScene(snapshotOf(entities)).items.find((item) => item.ref === ref)?.hpFrac;
}

describe('gate damage input', () => {
  it('gives a hurt gate, closed or open, its remaining health fraction', () => {
    expect(hpFracOf([gate(1, 300)], 1)).toBeCloseTo(0.6);
    expect(hpFracOf([gate(1, 100, true)], 1)).toBeCloseTo(0.2);
    expect(hpFracOf([gate(1, GATE_MAX_HP)], 1)).toBeUndefined();
  });

  it('leaves wall posts on their durability ladder and gate sites unmarked', () => {
    const post = entity(2, 20, 4, {
      Palisade: { gfxIndex: POST_GFX, tribe: 1, built: ONE },
      Health: { hitpoints: 40, max: POST_MAX_HP },
    });
    const scene = collectSpriteScene(snapshotOf([post])).items.find((item) => item.ref === 2);
    expect(scene?.hpFrac).toBeUndefined();
    expect(scene?.builtPct).toBe(40);
    expect(hpFracOf([gate(3, 0, false, { UnderConstruction: {} })], 3)).toBeUndefined();
  });
});

const SIZE = 64;
const GATE_BOB = 27;
const WALL_LAYER = 'ls_wall';
const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const VIEW = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

function mockCanvas(): void {
  vi.spyOn(drawable, 'isDrawableResource').mockReturnValue(true);
  vi.spyOn(drawable, 'readable2dContext').mockImplementation(
    (width, height) =>
      ({
        canvas: { width, height },
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        putImageData: vi.fn(),
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          const data = new Uint8ClampedArray(w * h * 4);
          for (let at = 0; at < data.length; at += 4) data.set([140, 100, 60, 255], at);
          return { data };
        },
      }) as unknown as CanvasRenderingContext2D,
  );
}

function frame(hitpoints: number, tick: number): PoolFrame {
  const hurt = entity(GATE_REF, 0, 0, gate(GATE_REF, hitpoints).components);
  return {
    snapshot: snapshotOf([hurt], tick),
    tick,
    viewport: VIEW,
    camera: { offsetX: 0, offsetY: 0 },
    screenW: 800,
    screenH: 600,
    elevation: FLAT,
    alpha: 0,
    buildingDamage: true,
  };
}

/** The textures the gate draws: its ground overlays share the body frame, only the body is scarred. */
function gateTextures(layer: Container): Texture[] {
  const sprites = layer.children[0]?.children.filter((child) => child instanceof Sprite && child.visible);
  if (sprites === undefined || sprites.length === 0) throw new Error('Missing gate body');
  return sprites.map((sprite) => (sprite as Sprite).texture);
}

afterEach(() => vi.restoreAllMocks());

it('scars a hurt gate body like a building and restores it once mended', () => {
  mockCanvas();
  const source = new TextureSource({ width: SIZE, height: SIZE });
  const atlas: SpriteAtlas = {
    width: SIZE,
    height: SIZE,
    frames: new Map([
      [GATE_BOB, { x: 0, y: 0, width: SIZE, height: SIZE, offsetX: -SIZE / 2, offsetY: -SIZE }],
    ]),
  };
  const sheet: SpriteSheet = {
    source,
    atlas: { width: 0, height: 0, frames: new Map() },
    bindings: {
      building: 1,
      settler: 1,
      resource: 1,
      palisade: { byGfxIndex: { [CLOSED_GATE_GFX]: [{ layer: WALL_LAYER, bob: GATE_BOB }] }, default: 0 },
    },
    families: { [WALL_LAYER]: { source, atlas } },
  };
  const layer = new Container();
  const textures = new TextureCache();
  const pool = new SpritePool(layer, textures, sheet);
  try {
    pool.reconcile(frame(GATE_MAX_HP, 1));
    const pristine = gateTextures(layer);
    pool.reconcile(frame(GATE_MAX_HP / 5, 2));
    const scarred = gateTextures(layer);
    expect(scarred.filter((texture) => !pristine.includes(texture))).toHaveLength(1);
    pool.reconcile(frame(GATE_MAX_HP, 3));
    const mended = gateTextures(layer);
    expect(mended.length === pristine.length && mended.every((texture, i) => texture === pristine[i])).toBe(
      true,
    );
  } finally {
    pool.destroy();
    textures.clear();
    source.destroy();
    layer.destroy({ children: true });
  }
});
