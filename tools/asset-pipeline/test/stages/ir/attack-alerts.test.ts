import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emptySoundBank, SOUND_BANKS_FILE, type SoundBank, type TribeType } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ATTACK_ALERTS_FILE, addAttackAlerts } from '../../../src/stages/ir/attack-alerts.js';
import { convertSoundTree } from '../../../src/stages/sounds/index.js';
import { type GameOutTemp, makeGameOutTemp } from '../../support/game-tree.js';

const VIKING = 1;
const SARACEN = 4;
const EGYPT = 7;
const WOLVES = 20;
const TRIBES: readonly TribeType[] = [
  { typeId: VIKING, id: 'viking', atomicBindings: [], jobEnables: [], jobRequirements: [] },
  { typeId: SARACEN, id: 'saracen', atomicBindings: [], jobEnables: [], jobRequirements: [] },
  { typeId: EGYPT, id: 'egypt', atomicBindings: [], jobEnables: [], jobRequirements: [] },
  { typeId: WOLVES, id: 'wolves', atomicBindings: [], jobEnables: [], jobRequirements: [] },
];
const ANIMALS = [{ tribeType: WOLVES }];
const BANK_GROUP = 'Magic Horn';
const VOLUME = 90;

function bank(): SoundBank {
  return { ...emptySoundBank(), staticGroups: [{ name: BANK_GROUP, sfx: [] }] };
}

function alerts(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    groups: [
      { name: 'Attack Alert Viking Settlement', volume: VOLUME, files: ['viking/a.wav', 'viking/b.wav'] },
      { name: 'Attack Alert Viking Field', volume: VOLUME, files: ['viking/a.wav'] },
      { name: 'Attack Alert Saracen Settlement', volume: VOLUME, files: ['saracen/a.wav'] },
      { name: 'Attack Alert Saracen Field', volume: VOLUME, files: ['saracen/a.wav'] },
    ],
    tribes: [
      { tribe: 'viking', base: 'Attack Alert Viking Settlement', units: 'Attack Alert Viking Field' },
      { tribe: 'egypt', base: 'Attack Alert Saracen Settlement', units: 'Attack Alert Saracen Field' },
    ],
    ...overrides,
  };
}

describe('attack alert pools', () => {
  let temp: GameOutTemp;

  beforeEach(async () => {
    temp = await makeGameOutTemp('attack-alerts');
    for (const [i, rel] of ['viking/a.wav', 'viking/b.wav', 'saracen/a.wav'].entries()) {
      await temp.write(`attack-alerts/${rel}`, Uint8Array.of(i + 1));
    }
  });

  afterEach(() => temp.cleanup());

  async function packWith(doc: unknown): Promise<SoundBank> {
    await temp.write(ATTACK_ALERTS_FILE, new TextEncoder().encode(JSON.stringify(doc)));
    return addAttackAlerts({ data: temp.game }, bank(), TRIBES, ANIMALS);
  }

  it('appends the groups to the bank and binds both fronts of each tribe', async () => {
    const sounds = await packWith(alerts());
    expect(sounds.staticGroups.map((group) => group.name)).toEqual([
      BANK_GROUP,
      'Attack Alert Viking Settlement',
      'Attack Alert Viking Field',
      'Attack Alert Saracen Settlement',
      'Attack Alert Saracen Field',
    ]);
    expect(sounds.staticGroups[1]).toEqual({
      name: 'Attack Alert Viking Settlement',
      sfx: [
        { file: 'attack-alerts/viking/a.wav', params: [VOLUME] },
        { file: 'attack-alerts/viking/b.wav', params: [VOLUME] },
      ],
    });
    expect(sounds.attackAlerts).toEqual([
      { tribe: VIKING, front: 'base', group: 'Attack Alert Viking Settlement' },
      { tribe: VIKING, front: 'units', group: 'Attack Alert Viking Field' },
      { tribe: EGYPT, front: 'base', group: 'Attack Alert Saracen Settlement' },
      { tribe: EGYPT, front: 'units', group: 'Attack Alert Saracen Field' },
    ]);
  });

  it('encodes the takes into the sound banks under the path the groups name', async () => {
    const report = await convertSoundTree({ data: temp.game }, temp.out, new Set(), async (wav) => wav);
    expect(report.clips).toBe(3);
    const index = JSON.parse(await readFile(join(temp.out, 'sounds', SOUND_BANKS_FILE), 'utf8'));
    expect(Object.keys(index.clips).sort()).toEqual([
      'attack-alerts/saracen/a.wav',
      'attack-alerts/viking/a.wav',
      'attack-alerts/viking/b.wav',
    ]);
    expect([...(await readFile(join(temp.out, 'sounds/attack-alerts/viking/b.flac')))]).toEqual([2]);
  });

  it('leaves the bank alone and the lane empty when the pack has no attack alerts', async () => {
    const empty = await makeGameOutTemp('attack-alerts-absent');
    try {
      expect(await addAttackAlerts({ data: empty.game }, bank(), TRIBES, ANIMALS)).toEqual(bank());
    } finally {
      await empty.cleanup();
    }
  });

  const [settlement, field, saracenSettlement, saracenField] = alerts().groups as Record<string, unknown>[];
  const vikingRow = {
    tribe: 'viking',
    base: 'Attack Alert Viking Settlement',
    units: 'Attack Alert Viking Field',
  };
  it.each([
    [{ version: 2 }, /expected 1\s+→ at version/],
    [{ extra: true }, /Unrecognized key: "extra"/],
    [{ groups: [settlement, settlement] }, /group "Attack Alert Viking Settlement" is listed twice/],
    [{ groups: [{ ...settlement, name: BANK_GROUP }] }, /group "Magic Horn" clashes with a sound bank group/],
    [
      { groups: [{ ...settlement, name: 'magic horn' }] },
      /group "magic horn" clashes with a sound bank group/,
    ],
    [
      { groups: [settlement, { ...settlement, name: 'attack alert viking settlement' }] },
      /group "attack alert viking settlement" is listed twice/,
    ],
    [{ groups: [{ ...settlement, files: ['viking/A.wav'] }] }, /must be a lower-case \.wav path/],
    [{ groups: [{ ...settlement, files: ['viking/a.ogg'] }] }, /must be a lower-case \.wav path/],
    [
      { groups: [{ ...settlement, files: ['viking/c.wav'] }] },
      /"viking\/c.wav" is not under attack-alerts\//,
    ],
    [{ groups: [{ ...settlement, files: [] }] }, /too small.*\s+→ at groups\[0\]\.files/i],
    [{ groups: [{ ...settlement, volume: 101 }] }, /<=100\s+→ at groups\[0\]\.volume/],
    [{ tribes: [{ ...vikingRow, tribe: 'teuton' }] }, /unknown settler tribe "teuton"/],
    [{ tribes: [{ ...vikingRow, tribe: 'wolves' }] }, /unknown settler tribe "wolves"/],
    [{ tribes: [vikingRow, vikingRow] }, /tribe "viking" is listed twice/],
    [{ tribes: [{ tribe: 'viking', base: 'Attack Alert Viking Settlement' }] }, /→ at tribes\[0\]\.units/],
    [{ tribes: [{ ...vikingRow, units: 'Attack Alert Absent' }] }, /tribes\[0\]\.units names unknown group/],
  ])('rejects an invalid manifest: %#', async (overrides, error) => {
    const groups = [settlement, field, saracenSettlement, saracenField];
    await expect(packWith(alerts({ groups, ...overrides }))).rejects.toThrow(error);
  });
});
