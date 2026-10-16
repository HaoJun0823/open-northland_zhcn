import type { Command, SimEvent } from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { createPlaytest } from '../src/view/runtime/playtest.js';

function fixture(options: { debug?: string; sharedClock?: boolean; readOnly?: boolean } = {}) {
  let readOnly = options.readOnly ?? false;
  const submitted: Command[] = [];
  const saveLoad = {
    saveGame: vi.fn(async (_name: string) => ({ kind: 'failed' as const })),
    loadSave: vi.fn(async (_name: string) => ({ kind: 'rejected' as const, reason: 'missing' as const })),
  };
  const playtest = createPlaytest({
    params: new URLSearchParams({ debug: options.debug ?? 'playtest' }),
    sharedClock: options.sharedClock ?? false,
    readOnly: () => readOnly,
    tick: () => 23,
    submit: (command) => submitted.push(command),
    saveLoad,
  });
  return {
    playtest,
    submitted,
    saveLoad,
    setReadOnly: () => {
      readOnly = true;
    },
  };
}

describe('local mission playtest handle', () => {
  it('requires the explicit flag and an editable local session', () => {
    expect(fixture({ debug: 'missions' }).playtest).toBeNull();
    expect(fixture({ sharedClock: true }).playtest).toBeNull();
    expect(fixture({ readOnly: true }).playtest).toBeNull();
    const f = fixture({ debug: 'missions,playtest' });
    f.setReadOnly();
    expect(() => f.playtest?.handle.prepare({ kind: 'debugKill', target: 3 })).toThrow('editable');
    expect(() => f.playtest?.handle.checkpoint('before')).toThrow('editable');
    expect(() => f.playtest?.handle.restore('before')).toThrow('editable');
    expect(f.submitted).toEqual([]);
  });

  it('submits only validated preparation commands without claiming application', () => {
    const f = fixture();
    const command = { kind: 'debugTeleport', target: 4, x: 5, y: 6 };
    expect(f.playtest?.handle.prepare(command)).toEqual({
      status: 'submitted',
      kind: 'debugTeleport',
      tick: 23,
    });
    command.x = 100;
    expect(f.submitted).toEqual([{ kind: 'debugTeleport', target: 4, x: 5, y: 6 }]);
    for (const value of [
      { kind: 'setMissionsEnabled', enabled: false },
      { kind: 'continueMatch', player: 0 },
      { kind: 'debugKill', target: NaN },
      { kind: 'debugTeleport', target: 4, x: 1.5, y: 0 },
      { kind: 'debugSetHealth', target: 4, percent: 0 },
      { kind: 'debugSetNeeds', target: 4, hunger: 101 },
      { kind: 'debugKill', target: 4, unexpected: true },
      { kind: 'spawnSettler', jobType: 1, tribe: 1, x: 2, y: 3, missionId: 9 },
      { kind: 'spawnSettler', jobType: 1, tribe: 1, x: 2, y: 3, behaviourFlags: 1 },
    ])
      expect(() => f.playtest?.handle.prepare(value)).toThrow();
    expect(f.submitted).toHaveLength(1);
    expect(f.playtest?.handle.events().rows).toHaveLength(9);
  });

  it('accepts the complete preparation whitelist', () => {
    const f = fixture();
    for (const command of [
      { kind: 'debugKill', target: 1 },
      { kind: 'debugSetHealth', target: 1, percent: 50 },
      { kind: 'debugSetNeeds', target: 1, hunger: 0 },
      { kind: 'debugFillStockpile', target: 1 },
      { kind: 'debugCompleteConstruction', target: 1 },
      {
        kind: 'spawnSettler',
        jobType: 1,
        tribe: 1,
        x: 2,
        y: 3,
        owner: 0,
        hitpoints: 10000,
        weaponTypeId: 1,
        armorClass: 3,
        equipment: { armor: { goodType: 35 } },
        experience: [[7, 500]],
      },
    ])
      f.playtest?.handle.prepare(command);
    expect(f.submitted).toHaveLength(6);
  });

  it('captures delivered mission and refusal events in order with detached bounded reads', () => {
    const f = fixture();
    const at = { hx: 1, hy: 2 };
    const event: SimEvent = { kind: 'missionCamera', point: at };
    f.playtest?.onEvents([event, { kind: 'playerWon', player: 0 }]);
    at.hx = 7;
    const first = f.playtest?.handle.events();
    expect(first?.rows[0]).toEqual({
      cursor: 1,
      observedTick: 23,
      event: { kind: 'missionCamera', point: { hx: 1, hy: 2 } },
    });
    if (first !== undefined) Reflect.set(first.rows[0]?.event ?? {}, 'kind', 'changed');
    expect(f.playtest?.handle.events().rows[0]?.event.kind).toBe('missionCamera');
    f.playtest?.onEvents(Array.from({ length: 512 }, () => ({ kind: 'playerDefeated' as const, player: 1 })));
    const tail = f.playtest?.handle.events(1);
    expect(tail?.overflow).toBe(true);
    expect(tail?.rows).toHaveLength(512);
    expect(tail?.rows[0]?.cursor).toBe(3);
    expect(tail?.nextCursor).toBe(514);
    expect(f.playtest?.handle.events(514)).toEqual({ rows: [], nextCursor: 514, overflow: false });
    expect(() => fixture().playtest?.handle.events(514)).toThrow('this running world');
    f.playtest?.onEvents([
      { kind: 'buildingFinished', entity: 2 },
      { kind: 'vehicleMoveRefused', entity: 3, player: 0, reason: 'noPath' },
    ]);
    expect(f.playtest?.handle.events(514).rows.map((row) => row.event.kind)).toEqual(['vehicleMoveRefused']);
  });

  it('uses the existing save/load flow and preserves its failure outcomes', async () => {
    const f = fixture();
    expect(await f.playtest?.handle.checkpoint('before battle')).toEqual({ kind: 'failed' });
    expect(await f.playtest?.handle.restore('before battle')).toEqual({
      kind: 'rejected',
      reason: 'missing',
    });
    expect(f.saveLoad.saveGame).toHaveBeenCalledWith('playtest: before battle');
    expect(f.saveLoad.loadSave).toHaveBeenCalledWith('playtest: before battle');
    expect(() => f.playtest?.handle.checkpoint('')).toThrow('Checkpoint name');
  });
});
