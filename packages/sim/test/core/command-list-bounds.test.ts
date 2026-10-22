import { describe, expect, it } from 'vitest';
import { MISC_EQUIP_SLOTS } from '../../src/components/equipment.js';
import { MAX_PLAYERS } from '../../src/components/ownership.js';
import { GOOD_TYPE_SPACE, JOB_TYPE_SPACE, TRIBE_TYPE_SPACE } from '../../src/core/commands/payload.js';
import { MAX_UNIT_ORDER_MEMBERS, parseCommandEnvelope } from '../../src/index.js';

/**
 * Every list a networked or imported payload carries has a bound of its own, so the transport's byte
 * limit is never the only thing between a crafted envelope and a long handler walk.
 */

const SEAT = 2;
const UNIT = 7;
const BUILDING = 9;

function seat(command: Record<string, unknown>): unknown {
  return parseCommandEnvelope({ v: 2, origin: 'player', player: SEAT, command });
}

function setup(command: Record<string, unknown>): unknown {
  return parseCommandEnvelope({ v: 2, origin: 'setup', command });
}

const ids = (length: number): number[] => Array.from({ length }, (_, i) => i + 1);

describe('command list bounds', () => {
  it.each([
    { kind: 'assignHouseGroup', member: (entity: number) => ({ entity }), fields: { house: BUILDING } },
    {
      kind: 'assignWorkerGroup',
      member: (entity: number) => ({ entity, jobPriority: [1] }),
      fields: { building: BUILDING },
    },
  ])('holds $kind members to the group order bound, each entity once', ({ kind, member, fields }) => {
    const members = ids(MAX_UNIT_ORDER_MEMBERS).map(member);
    expect(seat({ kind, ...fields, members })).toBeDefined();
    expect(() =>
      seat({ kind, ...fields, members: [...members, member(MAX_UNIT_ORDER_MEMBERS + 1)] }),
    ).toThrow(`at most ${MAX_UNIT_ORDER_MEMBERS} entries`);
    expect(() => seat({ kind, ...fields, members: [member(UNIT), member(UNIT)] })).toThrow(
      /\[1\]: duplicate entity/,
    );
  });

  it('holds a job priority list to the job type space, alone and per group member', () => {
    const lone = { kind: 'assignWorker', entity: UNIT, building: BUILDING };
    expect(seat({ ...lone, jobPriority: ids(JOB_TYPE_SPACE) })).toBeDefined();
    expect(() => seat({ ...lone, jobPriority: ids(JOB_TYPE_SPACE + 1) })).toThrow(
      `jobPriority: expected at most ${JOB_TYPE_SPACE} entries`,
    );
    const group = (jobPriority: number[]): Record<string, unknown> => ({
      kind: 'assignWorkerGroup',
      building: BUILDING,
      members: [{ entity: UNIT, jobPriority }],
    });
    expect(seat(group(ids(JOB_TYPE_SPACE)))).toBeDefined();
    expect(() => seat(group(ids(JOB_TYPE_SPACE + 1)))).toThrow(
      `members[0].jobPriority: expected at most ${JOB_TYPE_SPACE} entries`,
    );
  });

  it('holds production goods to the good type space', () => {
    const command = { kind: 'setProductionGoods', entity: UNIT };
    expect(seat({ ...command, goods: ids(GOOD_TYPE_SPACE) })).toBeDefined();
    expect(() => seat({ ...command, goods: ids(GOOD_TYPE_SPACE + 1) })).toThrow(
      `goods: expected at most ${GOOD_TYPE_SPACE} entries`,
    );
  });

  it('holds the trusted setup lists with a natural bound to it', () => {
    const tribes = { kind: 'setPlayerPlacementTribes', player: SEAT };
    expect(setup({ ...tribes, tribes: ids(TRIBE_TYPE_SPACE) })).toBeDefined();
    expect(() => setup({ ...tribes, tribes: ids(TRIBE_TYPE_SPACE + 1) })).toThrow(
      `tribes: expected at most ${TRIBE_TYPE_SPACE} entries`,
    );

    const seats = (length: number): number[] => Array.from({ length }, (_, i) => i % MAX_PLAYERS);
    expect(setup({ kind: 'setMatchParticipants', players: seats(MAX_PLAYERS) })).toBeDefined();
    expect(() => setup({ kind: 'setMatchParticipants', players: seats(MAX_PLAYERS + 1) })).toThrow(
      `players: expected at most ${MAX_PLAYERS} entries`,
    );

    const spawn = (misc: null[]): Record<string, unknown> => ({
      kind: 'spawnSettler',
      jobType: 1,
      x: 0,
      y: 0,
      tribe: 1,
      equipment: { misc },
    });
    expect(setup(spawn(Array.from({ length: MISC_EQUIP_SLOTS }, () => null)))).toBeDefined();
    expect(() => setup(spawn(Array.from({ length: MISC_EQUIP_SLOTS + 1 }, () => null)))).toThrow(
      `misc: expected at most ${MISC_EQUIP_SLOTS} entries`,
    );
  });
});
