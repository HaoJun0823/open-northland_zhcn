// @vitest-environment jsdom
import type { DrawItem, EntityBounds, WorldRenderer } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { afterEach, describe, expect, it } from 'vitest';
import type { HoverCard } from '../src/hud/dom/hover-card.js';
import type { BuildingHoverModel, HoverCardModel, SettlerHoverModel } from '../src/hud/hover-card/model.js';
import { createWorldHover, type WorldHover } from '../src/view/world-hover.js';

const HOUSE = 1;
const FIGHTER = 2;
/** One rendered frame at 60 fps. */
const FRAME_MS = 16;
/** Longer than the card's rest. */
const PAST_REST_MS = 400;

const HOUSE_BOX: EntityBounds = { minX: -40, minY: -100, maxX: 40, maxY: 0 };
/** The fighter's swing reaches over the house's middle on every other frame. */
const SWING_BOX: EntityBounds = { minX: -10, minY: -60, maxX: 10, maxY: -20 };
const AT_REST: EntityBounds = { minX: 60, minY: -60, maxX: 80, maxY: -20 };

function card(): HoverCard & { readonly title: () => string | null } {
  let shown: HoverCardModel | null = null;
  return {
    show: (_x, _y, model) => {
      shown = model;
    },
    hide: () => {
      shown = null;
    },
    showing: () => shown,
    dispose: () => {},
    title: () => shown?.title ?? null,
  };
}

function snapshot(tick: number): WorldSnapshot {
  return {
    tick,
    events: [],
    entities: [{ id: FIGHTER, components: { Settler: { jobType: 0 }, Person: {} } }],
  };
}

describe('world hover rest', () => {
  let hover: WorldHover | null = null;
  afterEach(() => hover?.destroy());

  function setup(pointer: { clientX: number; clientY: number }) {
    let swinging = false;
    const items: DrawItem[] = [
      { kind: 'building', ref: HOUSE, x: 0, y: 0, depth: 0 } as DrawItem,
      { kind: 'settler', ref: FIGHTER, x: 70, y: 0, depth: 1 } as DrawItem,
    ];
    const renderer = {
      drawnItems: () => items,
      entityBounds: (ref: number) => (ref === HOUSE ? HOUSE_BOX : swinging ? SWING_BOX : AT_REST),
    } as unknown as WorldRenderer;
    const shown = card();
    hover = createWorldHover({
      renderer,
      camera: () => ({ offsetX: 0, offsetY: 0, scale: 1 }),
      clientToScreen: (x, y) => ({ x, y }),
      goodLabel: () => undefined,
      chestLabel: () => '',
      chestOrderLine: () => null,
      card: shown,
      buildingModel: (_s, id) => ({ kind: 'building', title: `house ${id}` }) as BuildingHoverModel,
      settlerModel: (_s, id) => ({ kind: 'settler', title: `fighter ${id}` }) as SettlerHoverModel,
      vehicleModel: () => null,
      palisadeModel: () => null,
      modelVersion: () => 0,
      pixelHitOf: undefined,
      pointer: () => pointer,
      suppressed: () => false,
    });
    let tick = 0;
    /** `alternate`: the swing reaches over the house on every other frame; `held`: on every frame. */
    const run = (ms: number, swing: 'alternate' | 'held' = 'alternate'): void => {
      const start = tick * FRAME_MS;
      while (tick * FRAME_MS - start < ms) {
        swinging = swing === 'held' || tick % 2 === 1;
        hover?.update(snapshot(tick), tick * FRAME_MS);
        tick += 1;
      }
    };
    return { shown, run };
  }

  it('keeps the card on a house while a fighter swings across the resting pointer', () => {
    const { shown, run } = setup({ clientX: 0, clientY: -40 });
    run(PAST_REST_MS);
    expect(shown.title()).toBe(`house ${HOUSE}`);
  });

  it('picks the frontmost target again only once the pointer moves', () => {
    const pointer = { clientX: 0, clientY: -40 };
    const { shown, run } = setup(pointer);
    run(PAST_REST_MS);
    run(PAST_REST_MS, 'held');
    expect(shown.title()).toBe(`house ${HOUSE}`);

    // Onto the fighter, drawn in front of the house.
    pointer.clientX = 5;
    pointer.clientY = -30;
    run(PAST_REST_MS, 'held');
    expect(shown.title()).toBe(`fighter ${FIGHTER}`);
  });
});
