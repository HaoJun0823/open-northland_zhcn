import { cellAnchorNode, components, type Entity, type Simulation } from '@open-northland/sim';
import { ANIMAL_TRIBE_HARES, ANIMAL_TRIBE_SHEEP } from '../../catalog/animal-tribes.js';
import { grassTerrain } from '../../catalog/buildings.js';
import { HUNTER_GENERAL_XP_TRACK } from '../../catalog/hunting.js';
import { JOB_HUNTER } from '../../catalog/jobs.js';
import { buildSandboxAnimals } from '../../game/sandbox/content/catalog/animals.js';
import { spawnSandboxSettler } from '../../game/sandbox/index.js';
import { createSceneSim } from '../runtime.js';
import type { SceneDefinition } from '../types.js';

const MAP_W = 26;
const MAP_H = 20;
const RUN_TICKS = 2800;

/** Spaced so each hunter auto-plants its own flag and both herds sit in both grounds. */
const HUNTER_CELLS = [
  { x: 8, y: 8 },
  { x: 8, y: 6 },
];
/** Both herds sit in the auto-planted ground, which at `HUNTER_WORK_FLAG_RADIUS` covers this whole map. */
const HARE_HERD_CELL = { x: 12, y: 8 };
const SHEEP_HERD_CELL = { x: 8, y: 12 };

const HARE = buildSandboxAnimals().find((a) => a.tribeType === ANIMAL_TRIBE_HARES);
/** A cadaver's plucks alternate between its two stages, leather first, so meat is every second one. */
const CADAVER_STAGES = 2;
/** Herd size times the meat in one hare's cadaver, read off the catalog so the check's floor cannot drift
 *  from what the scene spawns. */
const HARE_MEAT_TOTAL =
  (HARE?.maximumGroupSize ?? 0) * Math.floor((HARE?.maximumCadaverSize ?? 0) / CADAVER_STAGES);

const { Settler, SettlerProgress, Stockpile, WorkFlag } = components;

function build(sim: Simulation): void {
  for (const at of HUNTER_CELLS) spawnSandboxSettler(sim, JOB_HUNTER, at.x, at.y);
  for (const herd of [
    { tribe: ANIMAL_TRIBE_HARES, cell: HARE_HERD_CELL },
    { tribe: ANIMAL_TRIBE_SHEEP, cell: SHEEP_HERD_CELL },
  ]) {
    const node = cellAnchorNode(herd.cell.x, herd.cell.y);
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: herd.tribe, x: node.hx, y: node.hy });
  }
}

function membersOf(sim: Simulation, tribe: number): Entity[] {
  const members: Entity[] = [];
  for (const e of sim.world.query(Settler)) {
    if (sim.world.get(e, Settler).tribe === tribe) members.push(e);
  }
  return members;
}

function hunters(sim: Simulation): Entity[] {
  return [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === JOB_HUNTER);
}

/** The ticks on which the last hare and the first sheep fell, re-simulating the scene; `null` when none
 *  fell. Hunters are the scene's only killers. */
function deathOrder(): { lastHare: number | null; firstSheep: number | null } {
  const sim = createSceneSim(huntingScene);
  let lastHare: number | null = null;
  let firstSheep: number | null = null;
  let hares = new Set<Entity>();
  let sheep = new Set<Entity>();
  for (let tick = 0; tick < RUN_TICKS; tick++) {
    sim.step();
    const haresNow = new Set(membersOf(sim, ANIMAL_TRIBE_HARES));
    const sheepNow = new Set(membersOf(sim, ANIMAL_TRIBE_SHEEP));
    if ([...hares].some((e) => !haresNow.has(e))) lastHare = tick;
    if (firstSheep === null && [...sheep].some((e) => !sheepNow.has(e))) firstSheep = tick;
    hares = haresNow;
    sheep = sheepNow;
  }
  return { lastHare, firstSheep };
}

/** Hunting is this scene's only goods source, so summing every stockpile reads the flag yards. */
function bankedMeat(sim: Simulation): number {
  const meatType = sim.content.goods.find((g) => g.id === 'meat')?.typeId;
  if (meatType === undefined) return 0;
  let total = 0;
  for (const e of sim.world.query(Stockpile)) {
    total += sim.world.get(e, Stockpile).amounts.get(meatType) ?? 0;
  }
  return total;
}

export const huntingScene: SceneDefinition = {
  id: 'hunting',
  seed: 43,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // The 25-tick draw, the ~40% fresh hit rate, the herd scattering off every hit, a pluck per cadaver
  // unit, and the one-kill-at-a-time carry stretch the bag past the kill time; the run ends before the
  // hunters, out of hares, bring down the sheep herd.
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'both hunters are flag-bound (spawn auto-planted their work flags)',
      predicate: (sim) => {
        const crew = hunters(sim);
        return crew.length === HUNTER_CELLS.length && crew.every((e) => sim.world.has(e, WorkFlag));
      },
    },
    {
      label: 'every hare was hunted down (the weakest game is picked first)',
      predicate: (sim) => membersOf(sim, ANIMAL_TRIBE_HARES).length === 0,
    },
    {
      label: 'no sheep fell before the last hare (the weaker hares are picked first)',
      predicate: () => {
        const { lastHare, firstSheep } = deathOrder();
        return lastHare !== null && (firstSheep === null || firstSheep > lastHare);
      },
    },
    {
      label: "the hares' meat was carried home to the flag yard",
      predicate: (sim) => bankedMeat(sim) >= HARE_MEAT_TOTAL,
    },
    {
      label: 'harvesting the carcasses trained hunter_general (summed - the bag splits across the crew)',
      predicate: (sim) => {
        const xp = hunters(sim).reduce(
          (sum, e) =>
            sum + (sim.world.get(e, SettlerProgress).experience.get(HUNTER_GENERAL_XP_TRACK.typeId) ?? 0),
          0,
        );
        return xp >= HARE_MEAT_TOTAL * HUNTER_GENERAL_XP_TRACK.experienceFactor;
      },
    },
    {
      label: 'both hunters shared the work - neither was wedged off the bag by its colleague',
      predicate: (sim) =>
        hunters(sim).every(
          (e) => (sim.world.get(e, SettlerProgress).experience.get(HUNTER_GENERAL_XP_TRACK.typeId) ?? 0) > 0,
        ),
    },
  ],
};
