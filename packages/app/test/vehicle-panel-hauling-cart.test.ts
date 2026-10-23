import type { Simulation, WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { settlerName } from '../src/game/character-names/index.js';
import { VEHICLE_HANDCART } from '../src/game/sandbox/index.js';
import { buildUnitPanelModel, type UnitPanelModelContext } from '../src/hud/details-panel/index.js';
import {
  type HaulingCartHold,
  type VehiclePanelModel,
  vehicleSubjectEntity,
} from '../src/hud/details-panel/model/index.js';
import { pulledByParts } from '../src/hud/dom/vehicle-panel/portrait.js';
import { formatMessage, messages } from '../src/i18n/index.js';
import { haulingCartScene, PARKED_CHECK_TICKS, SLEEP_ORDER_TICK } from '../src/scenes/hauling-cart.js';
import { createSceneSim } from '../src/scenes/index.js';
import { ctxOf } from './support/sandbox.js';

interface HaulingCartSnapshot {
  readonly vehicle?: unknown;
  readonly taken?: unknown;
  readonly parked?: unknown;
  readonly lift?: unknown;
}
interface CarryingSnapshot {
  readonly goodType: number;
  readonly amount: number;
}
interface PorterState {
  snapshot: WorldSnapshot;
  ctx: UnitPanelModelContext;
  porter: number;
  cart: number;
  held: HaulingCartSnapshot;
  carrying: CarryingSnapshot | undefined;
}

/** The scene's first porter whose cart satisfies `wanted`, from `fromTick` on; throws when none does. */
function porterWith(
  wanted: (
    held: HaulingCartSnapshot,
    carrying: CarryingSnapshot | undefined,
    cartType: number | undefined,
  ) => boolean,
  fromTick = 0,
): PorterState {
  const sim: Simulation = createSceneSim(haulingCartScene);
  sim.run(fromTick);
  for (let tick = fromTick; tick < haulingCartScene.runTicks; tick++) {
    sim.step();
    const snapshot = sim.snapshot();
    for (const e of snapshot.entities) {
      const held = e.components.HaulingCart as HaulingCartSnapshot | undefined;
      const carrying = e.components.Carrying as CarryingSnapshot | undefined;
      if (held === undefined || typeof held.vehicle !== 'number') continue;
      const cart = snapshot.entities.find((row) => row.id === held.vehicle);
      const cartType = (cart?.components.Vehicle as { vehicleType?: number } | undefined)?.vehicleType;
      if (wanted(held, carrying, cartType)) {
        return { snapshot, ctx: ctxOf(sim), porter: e.id, cart: held.vehicle, held, carrying };
      }
    }
  }
  throw new Error('no porter of the scene reached the wanted cart state');
}

/** A porter with its cart taken and more than one unit in hand, the moment the scene first shows one. */
function porterLifting(): PorterState & { carrying: CarryingSnapshot } {
  const state = porterWith((held, carrying) => held.taken === true && (carrying?.amount ?? 0) > 1);
  if (state.carrying === undefined) throw new Error('unreachable: the pick needs a load in hand');
  return { ...state, carrying: state.carrying };
}

function modelOf(snapshot: WorldSnapshot, ctx: UnitPanelModelContext, entity: number): VehiclePanelModel {
  const model = buildUnitPanelModel(snapshot, new Set([entity]), ctx);
  if (model.kind !== 'vehicle') throw new Error(`expected a vehicle model, got ${model.kind}`);
  return model;
}

function porterNamed(state: PorterState): string {
  const porterEntity = state.snapshot.entities.find((e) => e.id === state.porter);
  if (porterEntity === undefined) throw new Error('porter missing');
  return settlerName(state.ctx, porterEntity);
}

/** The porter holds the commander's seat read-only and takes no passenger slot. */
function expectPorterInCommand(model: VehiclePanelModel, porter: number, name: string): void {
  const refusal = messages().hud.vehiclePanel.refusals.hauled;
  expect(model.crew.commander).toMatchObject({ entity: porter, name, inside: true });
  expect(model.crew.commander?.job).not.toBe('');
  expect(model.crew.leave).toBe(refusal);
  expect(model.crew.assign).toBe(refusal);
  expect(model.crew.count).toBe(0);
}

describe('hauling cart vehicle panel', () => {
  it('shows a taken cart through its porter: his load in the hold, his name in the status, him in the portrait', () => {
    const state = porterLifting();
    const { snapshot, ctx, porter, cart, carrying } = state;
    const copy = messages().hud.vehiclePanel;
    const name = porterNamed(state);
    const model = modelOf(snapshot, ctx, cart);

    expect(model.hauler).toEqual({ entity: porter, name, hold: 'pulled' });
    expect(model.status.label).toBe(formatMessage(copy.status.pulledBy, { porter: name }));
    expect(model.status.tone).toBe('ok');
    expect(vehicleSubjectEntity(model)).toBe(porter);
    const row = model.hold?.rows.find((line) => line.goodType === carrying.goodType);
    expect(row).toMatchObject({
      current: carrying.amount,
      wanted: carrying.amount,
      reserved: carrying.amount,
    });
    expect(model.hold?.hauled).toBe(true);
    expect(model.hold?.cargoHand).toBe(true);
    expect(model.orders.every((order) => order.control === copy.refusals.hauled)).toBe(true);
    expect(model.crew.assign).toBe(copy.refusals.hauled);
    expectPorterInCommand(model, porter, name);
  });

  it('shows the load of a taken cart in the porter panel vehicle row too', () => {
    const { snapshot, ctx, porter, carrying } = porterLifting();
    const model = buildUnitPanelModel(snapshot, new Set([porter]), ctx);
    if (model.kind !== 'settler') throw new Error(`expected a settler model, got ${model.kind}`);
    const load = model.vehicle?.target?.load ?? '';
    expect(load).toContain(String(carrying.amount));
    expect(load).not.toContain(messages().hud.settlerPanel.vehicleEmpty);
  });

  it('shows a cart parked for a break with the load stowed in its own hold and the porter it belongs to', () => {
    // The scene sends the handcart porter to bed mid-haul; the cart then stands parked until it wakes.
    const state = porterWith(
      (held, _carrying, cartType) =>
        cartType === VEHICLE_HANDCART && held.taken === false && held.parked === true && held.lift === null,
      SLEEP_ORDER_TICK + PARKED_CHECK_TICKS,
    );
    const { snapshot, ctx, porter, cart, carrying } = state;
    const name = porterNamed(state);
    const model = modelOf(snapshot, ctx, cart);

    expect(carrying).toBeUndefined();
    expect(model.hauler).toEqual({ entity: porter, name, hold: 'parked' });
    expect(vehicleSubjectEntity(model)).toBe(cart);
    expect(model.hold?.hauled).toBe(true);
    expect(model.hold?.cargoHand).toBe(true);
    expect(model.hold?.rows.some((line) => line.current > 0)).toBe(true);
    expect(model.status.label).toBe(
      formatMessage(messages().hud.vehiclePanel.status.parkedBy, { porter: name }),
    );
    expectPorterInCommand(model, porter, name);
  });

  it('shows a cart the porter is still walking to as fetched, not parked', () => {
    const state = porterWith((held) => held.taken === false && held.parked === false);
    const model = modelOf(state.snapshot, state.ctx, state.cart);
    expect(model.hauler?.hold).toBe('fetched');
    expect(model.status.label).toBe(
      formatMessage(messages().hud.vehiclePanel.status.fetchedBy, { porter: porterNamed(state) }),
    );
  });

  it('splits the status words around the porter name the link takes', () => {
    const status = messages().hud.vehiclePanel.status;
    const words: Record<HaulingCartHold, string> = {
      pulled: status.pulledBy,
      parked: status.parkedBy,
      fetched: status.fetchedBy,
    };
    for (const hold of Object.keys(words) as HaulingCartHold[]) {
      const { before, after } = pulledByParts(hold);
      expect(`${before}Thorleik${after}`).toBe(formatMessage(words[hold], { porter: 'Thorleik' }));
    }
  });
});
