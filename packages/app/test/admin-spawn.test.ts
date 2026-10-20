import type { JobRequirement } from '@open-northland/data';
import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { WOOD_YIELD_PER_NODE } from '../src/catalog/felling.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_CHILD_FEMALE,
  JOB_CHILD_MALE,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_HERO_SABER,
  JOB_HERO_SWORD,
  JOB_HERO_UNARMED,
  JOB_HEROINE_BOW,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { MINE_LEVELS, STONE_DEPOSIT_UNITS } from '../src/catalog/mining.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import {
  GOOD_BOW_LONG,
  GOOD_BOW_SHORT,
  GOOD_SPEAR_IRON,
  GOOD_SPEAR_WOODEN,
  GOOD_STONE,
  GOOD_SWORD_LONG,
  GOOD_SWORD_SHORT,
  GOOD_WOOD,
  VEHICLE_SHIP_SMALL,
  WEAPON_FISTS,
  WEAPON_SWORD,
  WEAPON_WOODEN_SPEAR,
  weaponEquipmentFor,
} from '../src/game/sandbox/ids/index.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { resourceCommand } from '../src/game/sandbox/place/index.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';
import {
  ADMIN_DROP_AMOUNT,
  type ArmorEntry,
  CREATURE_PRESETS,
  creatureSpawnCommand,
  everyJobExperience,
  goodDropCommand,
  PERSON_PRESETS,
  type PersonPreset,
  personSpawnCommand,
  RESOURCE_ENTRIES,
  SOLDIER_WEAPONS,
  type SoldierWeapon,
  soldierSpawnCommand,
  vehicleSpawnCommand,
  weaponGoodSlug,
} from '../src/view/admin-debug/spawn-catalog.js';

/**
 * The admin/debug spawn palette's pure command mapping: a soldier carries its weapon and armor, a person
 * neither, a non-positive health is left to the sim, and a resource resolves to the right node lifecycle.
 */

describe('admin spawn command mapping', () => {
  // The running content's goods table the palette resolves weapon-good slugs against.
  const sandboxGoods = sandboxContent(grassTerrain(4, 4)).goods;
  const person = { player: 1, tribe: PRIMARY_TRIBE, hitpoints: 0, x: 2, y: 3 };
  const weapon = (jobType: number): SoldierWeapon => {
    const found = SOLDIER_WEAPONS.find((entry) => entry.jobType === jobType);
    if (found === undefined) throw new Error(`missing weapon for job ${jobType}`);
    return found;
  };
  const presetOf = (id: PersonPreset['id']): PersonPreset => {
    const found = PERSON_PRESETS.find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`missing preset ${id}`);
    return found;
  };

  it('offers a man, a woman and both children, the woman and the girl spawning female', () => {
    expect(PERSON_PRESETS.map(({ id, jobType }) => [id, jobType])).toEqual([
      ['man', JOB_CIVILIST],
      ['woman', JOB_WOMAN],
      ['boy', JOB_CHILD_MALE],
      ['girl', JOB_CHILD_FEMALE],
    ]);
    const sim = createSceneSim(sandboxScene);
    const before = new Set(sim.snapshot().entities.map((e) => e.id));
    for (const id of ['man', 'woman', 'boy', 'girl'] as const)
      sim.enqueueSetup(personSpawnCommand(presetOf(id), { ...person, player: HUMAN_PLAYER }));
    sim.step();
    const spawned = sim
      .snapshot()
      .entities.filter((e) => !before.has(e.id) && e.components.Settler !== undefined)
      .sort((a, b) => a.id - b.id);
    expect(spawned.map((e) => e.components.Female !== undefined)).toEqual([false, true, false, true]);
  });

  it('offers a soldier the seven weapons in the panel order', () => {
    expect(SOLDIER_WEAPONS.map(weaponGoodSlug)).toEqual([
      undefined,
      'sword_shord',
      'sword_long',
      'bow_short',
      'bow_long',
      'spear_wooden',
      'spear_iron',
    ]);
  });

  it('spawns each creature with its fixed tribe and form, selected owner and natural weapon', () => {
    expect(CREATURE_PRESETS.map(({ tribe, jobType }) => [tribe, jobType])).toEqual([
      [5, 31],
      [6, 31],
      [5, 16],
      [5, 18],
      [5, 32],
      [5, 33],
      [5, 35],
      [3, 32],
    ]);
    for (const preset of CREATURE_PRESETS) {
      expect(creatureSpawnCommand(preset, { player: 1, hitpoints: 0, x: 7, y: 9 })).toEqual({
        kind: 'spawnSettler',
        jobType: preset.jobType,
        tribe: preset.tribe,
        owner: 1,
        humanForm: false,
        x: 7,
        y: 9,
      });
    }
    const first = CREATURE_PRESETS[0];
    if (first === undefined) throw new Error('missing creature preset');
    expect(creatureSpawnCommand(first, { player: 2, hitpoints: 8400, x: 1, y: 2 })).toMatchObject({
      owner: 2,
      hitpoints: 8400,
    });
  });

  it('a soldier wields its weapon and wears its armor, both also in its equipment slots', () => {
    const chain: ArmorEntry = { armorClass: 3, good: 999, id: 'armor_chain' };
    const cmd = soldierSpawnCommand({
      ...person,
      hitpoints: 250,
      weapon: weapon(JOB_SOLDIER_SWORD),
      armor: chain,
      x: 7,
      y: 9,
      goods: sandboxGoods,
    });
    expect(cmd).toEqual({
      kind: 'spawnSettler',
      jobType: JOB_SOLDIER_SWORD,
      x: 7,
      y: 9,
      tribe: PRIMARY_TRIBE,
      owner: 1,
      humanForm: true,
      hitpoints: 250,
      weaponTypeId: WEAPON_SWORD,
      armorClass: 3,
      // The goods in the slots drive the drawn look and the settler panel's equipment rows.
      equipment: { weapon: { goodType: GOOD_SWORD_SHORT }, armor: { goodType: 999 } },
    });
  });

  it('a bare-handed, unarmored soldier spawns as soldier_unarmed with fists and empty slots', () => {
    const cmd = soldierSpawnCommand({
      ...person,
      weapon: weapon(JOB_SOLDIER_UNARMED),
      armor: null,
      goods: sandboxGoods,
    });
    expect(cmd).toEqual({
      kind: 'spawnSettler',
      jobType: JOB_SOLDIER_UNARMED,
      x: 2,
      y: 3,
      tribe: PRIMARY_TRIBE,
      owner: 1,
      humanForm: true,
      weaponTypeId: WEAPON_FISTS,
    });
  });

  it('a wooden spear arms the wooden spearman with its own weapon', () => {
    const cmd = soldierSpawnCommand({
      ...person,
      weapon: weapon(JOB_SOLDIER_SPEAR_WOODEN),
      armor: null,
      goods: sandboxGoods,
    });
    expect(cmd).toMatchObject({
      jobType: JOB_SOLDIER_SPEAR_WOODEN,
      weaponTypeId: WEAPON_WOODEN_SPEAR,
      equipment: { weapon: { goodType: GOOD_SPEAR_WOODEN } },
    });
  });

  it('a person carries nothing, and the seat tribe and non-positive health pass as the sim defaults', () => {
    const FRANK = 2;
    const cmd = personSpawnCommand(presetOf('man'), { ...person, tribe: FRANK });
    expect(cmd).toEqual({ kind: 'spawnSettler', jobType: JOB_CIVILIST, x: 2, y: 3, tribe: FRANK, owner: 1 });
    expect(personSpawnCommand(presetOf('man'), { ...person, experience: [[7, 50]] })).toMatchObject({
      experience: [[7, 50]],
    });
  });

  it('every job experience clears each need and training row of the content', () => {
    const content = sandboxContent(grassTerrain(4, 4));
    const [track] = content.jobExperience;
    const [tribe] = content.tribes;
    if (track === undefined || tribe === undefined) throw new Error('sandbox lacks a track or a tribe');
    const RAW_TRACK = 77;
    const rows: JobRequirement[] = [
      { requirement: 'need', target: 'job', targetId: 19, amount: 10, experienceTypes: [track.typeId] },
      { requirement: 'need', target: 'job', targetId: 20, amount: 30, experienceTypes: [track.typeId] },
      { requirement: 'train', target: 'job', targetId: 31, amount: 5, experienceTypes: [RAW_TRACK] },
    ];
    const withRows = { ...content, tribes: [{ ...tribe, jobRequirements: rows }] };
    const xp = new Map(everyJobExperience(withRows));
    for (const row of rows) {
      expect(
        systems.requirementRepeats(content.jobExperience, xp, row.experienceTypes),
      ).toBeGreaterThanOrEqual(row.amount);
    }
  });

  it('a vehicle spawns through createVehicle for the chosen seat and that seat’s tribe', () => {
    const FRANK = 2;
    const cmd = vehicleSpawnCommand(VEHICLE_SHIP_SMALL, { player: 1, tribe: FRANK, x: 7, y: 9 });
    expect(cmd).toEqual({
      kind: 'createVehicle',
      vehicleType: VEHICLE_SHIP_SMALL,
      x: 7,
      y: 9,
      tribe: FRANK,
      owner: 1,
    });
  });

  it('the palette offers every gatherable resource', () => {
    const goods = new Set(RESOURCE_ENTRIES.map((r) => r.good));
    expect(goods.has(GOOD_WOOD)).toBe(true);
    expect(goods.has(GOOD_STONE)).toBe(true);
    expect(RESOURCE_ENTRIES.length).toBeGreaterThanOrEqual(6);
  });

  it('the goods palette is the running content - every good it defines is droppable (bare-checkout sandbox)', () => {
    // The panel builds its goods list from `sim.content.goods`, so it can only offer goods the sim will
    // actually drop (a good absent from the content is a `dropGood` no-op). Assert the source it reads on a
    // bare checkout - the sandbox content - spans the whole catalog, so nothing silently drops out.
    const goods = sandboxContent(grassTerrain(4, 4)).goods;
    const ids = new Set(goods.map((g) => g.id));
    expect(ids.has('wood')).toBe(true);
    expect(ids.has('bread')).toBe(true);
    expect(ids.has('armor_plate')).toBe(true);
    expect(goods.length).toBeGreaterThanOrEqual(60);
  });

  it('a good drops as a loose ground pile via dropGood', () => {
    const cmd = goodDropCommand(GOOD_STONE, 4, 5);
    expect(cmd).toEqual({ kind: 'dropGood', good: GOOD_STONE, x: 4, y: 5, amount: ADMIN_DROP_AMOUNT });
  });

  it('a wood resource resolves to a felled tree node', () => {
    const cmd = resourceCommand(GOOD_WOOD, 4, 5);
    expect(cmd).toEqual({
      kind: 'placeResource',
      good: GOOD_WOOD,
      x: 4,
      y: 5,
      remaining: WOOD_YIELD_PER_NODE,
      harvestAtomic: expect.any(Number),
      felling: true,
    });
  });

  it('a stone resource resolves to a mined deposit node', () => {
    const cmd = resourceCommand(GOOD_STONE, 1, 1);
    expect(cmd?.kind).toBe('placeResource');
    if (cmd?.kind !== 'placeResource') throw new Error('expected placeResource');
    expect(cmd.remaining).toBe(STONE_DEPOSIT_UNITS);
    expect(cmd.deposit).toEqual({ levels: MINE_LEVELS });
    expect(cmd.felling).toBeUndefined();
  });

  it('an unknown good is not spawnable (null command)', () => {
    expect(resourceCommand(9999, 0, 0)).toBeNull();
  });
});

describe('weaponEquipmentFor - the one job→equipment-weapon map every spawn path shares', () => {
  const sandboxGoods = sandboxContent(grassTerrain(4, 4)).goods;

  it('each soldier class carries its matching weapon good (so its Broń row + drawn weapon match)', () => {
    // The seam the scene placer, the imported-map spawn AND the admin palette all derive from, so a
    // pre-placed warrior fills the same equipment weapon slot a freshly-spawned one does.
    const eq = (jobType: number) => weaponEquipmentFor(jobType, sandboxGoods);
    expect(eq(JOB_SOLDIER_SPEAR_WOODEN)).toEqual({ weapon: { goodType: GOOD_SPEAR_WOODEN } });
    expect(eq(JOB_SOLDIER_SPEAR)).toEqual({ weapon: { goodType: GOOD_SPEAR_IRON } });
    expect(eq(JOB_SOLDIER_SWORD)).toEqual({ weapon: { goodType: GOOD_SWORD_SHORT } });
    expect(eq(JOB_SOLDIER_BROADSWORD)).toEqual({ weapon: { goodType: GOOD_SWORD_LONG } });
    expect(eq(JOB_ARCHER)).toEqual({ weapon: { goodType: GOOD_BOW_SHORT } });
    expect(eq(JOB_ARCHER_LONG)).toEqual({ weapon: { goodType: GOOD_BOW_LONG } });
  });

  it('resolves the good against the running content - real goodtypes.ini ids, not the sandbox +100', () => {
    // On a decoded map the sim plays on the merged real content whose weapon goods keep the
    // goodtypes.ini ids (37–42); the slug join must land there, or the panel's Weapon row shows an
    // unknown good (the empty-socket bug this pins).
    const realGoods = [
      { typeId: 38, id: 'bow_long' },
      { typeId: 42, id: 'sword_long' },
    ];
    expect(weaponEquipmentFor(JOB_SOLDIER_BROADSWORD, realGoods)).toEqual({ weapon: { goodType: 42 } });
    expect(weaponEquipmentFor(JOB_ARCHER_LONG, realGoods)).toEqual({ weapon: { goodType: 38 } });
    // A content without the slug (a minimal fixture) spawns the soldier without an equipment weapon.
    expect(weaponEquipmentFor(JOB_SOLDIER_SWORD, realGoods)).toBeUndefined();
  });

  it('heroes carry the good matching the warrior body they borrow', () => {
    const eq = (jobType: number) => weaponEquipmentFor(jobType, sandboxGoods);
    // Heroes borrow per their baseatomics soldier class (jobtypes.ini): 44→34 (short sword), 45→35.
    expect(eq(JOB_HERO_SWORD)).toEqual({ weapon: { goodType: GOOD_SWORD_SHORT } });
    expect(eq(JOB_HERO_SABER)).toEqual({ weapon: { goodType: GOOD_SWORD_LONG } });
    expect(eq(JOB_HEROINE_BOW)).toEqual({ weapon: { goodType: GOOD_BOW_LONG } });
    expect(eq(JOB_HERO_UNARMED)).toBeUndefined();
  });

  it('the bare-handed warrior and a civilian get no equipment weapon (empty slot → their own body)', () => {
    const eq = (jobType: number) => weaponEquipmentFor(jobType, sandboxGoods);
    expect(eq(JOB_SOLDIER_UNARMED)).toBeUndefined();
    expect(eq(JOB_COLLECTOR)).toBeUndefined();
    expect(eq(JOB_CIVILIST)).toBeUndefined();
  });
});
