import { describe, expect, it } from 'vitest';
import {
  AiOrder,
  addCurrentAtomic,
  addPerson,
  CurrentAtomic,
  DeferredOrder,
  MoveGoal,
  OrderQueue,
  Owner,
  PlayerOrder,
  Position,
  Stance,
  seatPassenger,
} from '../../src/components/index.js';
import { aiCommand, type CommandEnvelope, playerCommand } from '../../src/core/commands/index.js';
import { fx, Simulation } from '../../src/index.js';
import { commandSystem } from '../../src/systems/command/index.js';
import { setAiControl } from '../../src/systems/orders/ai.js';
import { sendUnit } from '../../src/systems/orders/movement.js';
import { deferredOrderSystem } from '../../src/systems/orders/pending.js';
import { orderQueueSystem } from '../../src/systems/orders/queue.js';
import { MILITARY_MODE } from '../../src/systems/readviews/stances.js';
import { boardRider, createVehicle } from '../../src/systems/vehicles/index.js';
import { testContent } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassCellMap } from '../fixtures/terrain.js';
import { armedContent } from './computer-player/support.js';

const PLAYER = 1;
const SOURCE = { player: PLAYER, source: 'military' } as const;
function fixture(jobType = 1, content = testContent()) {
  const sim = new Simulation({ seed: 1, content, map: grassCellMap(24, 8) });
  const entity = sim.world.create();
  sim.world.add(entity, Position, { x: fx.fromInt(2), y: fx.fromInt(2) });
  addPerson(sim.world, entity, {
    tribe: 1,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    piety: fx.fromInt(0),
  });
  sim.world.add(entity, Owner, { player: PLAYER });
  const ctx = ctxOf(sim);
  setAiControl(sim.world, ctx, { kind: 'setAiControl', player: PLAYER, enabled: true });
  const move = { kind: 'moveUnit', entity, x: 20, y: 4 } as const;
  const apply = (envelope: CommandEnvelope) => {
    sim.commands.enqueue(envelope);
    commandSystem(sim.world, ctx);
  };
  const disable = () =>
    setAiControl(sim.world, ctx, {
      kind: 'setAiControl',
      player: PLAYER,
      enabled: true,
      modules: { military: false },
    });
  return { sim, entity, ctx, move, apply, disable };
}

describe('accepted AI order ownership', () => {
  it('retains the old owner after a refused attack instead of labelling an unapplied order', () => {
    const { sim, entity, move, apply, disable } = fixture();
    apply(aiCommand(PLAYER, move, 'military'));
    apply(playerCommand(PLAYER, { kind: 'attackUnit', entity, target: sim.world.create() }));
    expect(sim.world.get(entity, AiOrder)).toEqual(SOURCE);
    disable();
    expect(sim.world.has(entity, PlayerOrder)).toBe(false);
  });

  it('clears ownership for a successful human group movement', () => {
    const { sim, entity, move, apply, disable } = fixture();
    apply(aiCommand(PLAYER, move, 'military'));
    apply(playerCommand(PLAYER, { kind: 'moveUnitGroup', members: [{ entity, x: 16, y: 4 }] }));
    expect(sim.world.has(entity, AiOrder)).toBe(false);
    disable();
    expect(sim.world.has(entity, PlayerOrder)).toBe(true);
  });

  it('keeps current movement owned while a human queues its next leg', () => {
    const { sim, entity, ctx, move, apply, disable } = fixture();
    apply(aiCommand(PLAYER, move, 'military'));
    apply(playerCommand(PLAYER, { ...move, x: 16, queued: true }));
    expect(sim.world.get(entity, AiOrder)).toEqual(SOURCE);
    disable();
    orderQueueSystem(sim.world, ctx);
    expect(sim.world.has(entity, PlayerOrder)).toBe(true);
    expect(sim.world.has(entity, AiOrder)).toBe(false);
    expect(sim.world.has(entity, OrderQueue)).toBe(false);
  });

  it('preserves a queued AI leg and refuses it if the controller loses permission', () => {
    const { sim, entity, ctx, move, apply, disable } = fixture();
    apply(playerCommand(PLAYER, move));
    apply(aiCommand(PLAYER, { ...move, x: 16, queued: true }, 'military'));
    expect(sim.world.get(entity, OrderQueue).orders[0]).toMatchObject({ aiOrder: SOURCE });
    disable();
    expect(sim.world.has(entity, PlayerOrder)).toBe(true);
    expect(sim.world.has(entity, OrderQueue)).toBe(false);
    setAiControl(sim.world, ctx, { kind: 'setAiControl', player: PLAYER, enabled: true });
    sim.world.remove(entity, PlayerOrder);
    orderQueueSystem(sim.world, ctx);
    expect(sim.world.has(entity, PlayerOrder)).toBe(false);
    expect(sim.world.has(entity, AiOrder)).toBe(false);
  });

  it('preserves the owner of movement parked behind an atomic', () => {
    const { sim, entity, ctx, move, apply, disable } = fixture();
    addCurrentAtomic(sim.world, entity, {
      atomicId: 10,
      duration: 5,
      effect: { kind: 'idle' },
      targetEntity: null,
      targetTile: null,
    });
    apply(aiCommand(PLAYER, move, 'military'));
    expect(sim.world.has(entity, DeferredOrder)).toBe(true);
    sim.world.remove(entity, CurrentAtomic);
    deferredOrderSystem(sim.world, ctx);
    expect(sim.world.get(entity, AiOrder)).toEqual(SOURCE);
    disable();
    expect(sim.world.has(entity, PlayerOrder)).toBe(false);
  });

  it('a direct mission movement replaces autonomous movement without inheriting its ownership', () => {
    const { sim, entity, ctx, move, apply, disable } = fixture();
    apply(aiCommand(PLAYER, move, 'military'));
    expect(sendUnit(sim.world, ctx, entity, 16, 4)).toBe(true);
    expect(sim.world.has(entity, AiOrder)).toBe(false);
    disable();
    expect(sim.world.has(entity, PlayerOrder)).toBe(true);
  });

  it('tracks the vehicle actually ordered through its commander, then releases it on human movement', () => {
    const { sim, entity, ctx, move, apply } = fixture(31);
    const vehicle = createVehicle(sim.world, ctx, { vehicleType: 5, tribe: 1, x: 8, y: 4, owner: PLAYER });
    if (vehicle === null || !seatPassenger(sim.world, vehicle, entity))
      throw new Error('missing vehicle crew');
    boardRider(sim.world, entity, vehicle);
    apply(aiCommand(PLAYER, move, 'military'));
    expect(sim.world.get(vehicle, AiOrder)).toEqual(SOURCE);
    expect(sim.world.has(entity, AiOrder)).toBe(false);
    apply(playerCommand(PLAYER, { kind: 'moveVehicleGroup', members: [{ entity: vehicle, x: 24, y: 4 }] }));
    expect(sim.world.has(vehicle, AiOrder)).toBe(false);
  });

  it('does not resume a cancelled offensive destination as a return to its old anchor', () => {
    const { sim, entity, move, apply, disable } = fixture(32, armedContent());
    sim.world.add(entity, Stance, { mode: MILITARY_MODE.ATTACK, anchorCell: null });
    apply(aiCommand(PLAYER, { ...move, kind: 'attackMoveUnit', x: 44 }, 'military'));
    const destination = sim.world.get(entity, Stance).anchorCell;
    expect(destination).not.toBeNull();
    disable();
    expect(sim.world.get(entity, Stance).anchorCell).not.toBe(destination);
    for (let tick = 0; tick < 8; tick++) sim.step();
    expect(sim.world.tryGet(entity, MoveGoal)?.cell).not.toBe(destination);
    expect(sim.world.has(entity, PlayerOrder)).toBe(false);
  });

  it('does not cancel a transferred unit when its former controller is disabled', () => {
    const { sim, entity, move, apply, disable } = fixture();
    apply(aiCommand(PLAYER, move, 'military'));
    sim.world.mut(entity, Owner).player = 2;
    disable();
    expect(sim.world.has(entity, AiOrder)).toBe(false);
    expect(sim.world.has(entity, PlayerOrder)).toBe(true);
  });
});
