import {
  cellAnchorNode,
  components,
  type Entity,
  type Simulation,
  setupCommand,
  systems,
} from '@open-northland/sim';
import { ANIMAL_TRIBE_CATTLE } from '../../catalog/animal-tribes.js';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_BUILDER, JOB_COLLECTOR, JOB_SCOUT } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import {
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_WAREHOUSE_00,
  buildingDef,
  placeBuiltSandboxBuilding,
  placeSandboxSite,
  spawnAnimalHerdDirect,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import { holdsSometimeDuring } from '../runtime.js';
import type { SceneDefinition } from '../types.js';

/**
 * An enemy scout in two villages. A red scout walks through the blue settlement past its builders, who keep
 * building, then on into a village the computer runs, which has no soldier. There two villagers take up the
 * bow as hunters and shoot at him; once he is down or gone, they go back to their work.
 */

const MAP_W = 60;
const MAP_H = 22;
/** The computer's seat: a third one, at war with the scout's and at peace with the viewer's. */
const COMPUTER_PLAYER = 2;

const WAREHOUSE = { x: 10, y: 17 } as const;
const SITE = { x: 15, y: 9 } as const;
const BUILDERS: readonly (readonly [number, number])[] = [
  [12, 12],
  [13, 12],
  [12, 13],
  [13, 13],
];
/** Spare goods past the farm's bill, so the crew never waits on a delivery. */
const BILL_MULTIPLE = 4;

const HEADQUARTERS = { x: 47, y: 6 } as const;
/** Enough villagers that the seat may arm two of them: one in four at most. */
const VILLAGERS: readonly (readonly [number, number])[] = [
  [42, 12],
  [44, 13],
  [46, 12],
  [48, 13],
  [43, 15],
  [45, 16],
  [47, 15],
  [49, 16],
];
const CATTLE_AT = { x: 52, y: 16 } as const;
const CATTLE = 2;

const SCOUT_FROM = { x: 2, y: 12 } as const;
/** Past the blue site, out of the settlement on the east side. */
const SCOUT_PAST_BLUE = { x: 28, y: 12 } as const;
/** In the computer's village, among its people. */
const SCOUT_IN_VILLAGE = { x: 40, y: 12 } as const;
const ORDER_TICK = 1;
const SCRIPTED_SEQUENCE = Number.MAX_SAFE_INTEGER;
/** The walk in, the hunters' shots, and long enough after for them to go back to work. */
const RUN_TICKS = 1500;

const { AttackOrder, Building, Fleeing, Health, Militia, Owner, Projectile, Settler, UnderConstruction } =
  components;

function build(sim: Simulation): void {
  // The viewer's settlement: a farm site and its crew, the goods beside them.
  const bill = buildingDef(sim, BUILDING_FARM)?.construction ?? [];
  const depot = cellAnchorNode(WAREHOUSE.x, WAREHOUSE.y);
  sim.enqueueSetup({
    kind: 'placeBuilding',
    buildingType: BUILDING_WAREHOUSE_00,
    x: depot.hx,
    y: depot.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
    force: true,
    initialGoods: bill.map((line) => ({ good: line.goodType, amount: line.amount * BILL_MULTIPLE })),
  });
  placeSandboxSite(sim, BUILDING_FARM, SITE.x, SITE.y);
  for (const [x, y] of BUILDERS) spawnSettlerDirect(sim, JOB_BUILDER, x, y, HUMAN_PLAYER);

  // The computer's village: its headquarters, villagers and cattle, and no soldier.
  placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HEADQUARTERS.x, HEADQUARTERS.y, COMPUTER_PLAYER);
  for (const [x, y] of VILLAGERS) spawnSettlerDirect(sim, JOB_COLLECTOR, x, y, COMPUTER_PLAYER);
  spawnAnimalHerdDirect(sim, ANIMAL_TRIBE_CATTLE, CATTLE_AT.x, CATTLE_AT.y, {
    count: CATTLE,
    owner: COMPUTER_PLAYER,
  });
  for (const [from, to] of [
    [HUMAN_PLAYER, COMPUTER_PLAYER],
    [COMPUTER_PLAYER, HUMAN_PLAYER],
  ] as const) {
    sim.enqueueSetup({ kind: 'setDiplomacy', from, to, state: 'friend' });
  }
  // Only the military module: a full computer seat would spend the scene staffing its town instead.
  sim.enqueueSetup({
    kind: 'setAiControl',
    player: COMPUTER_PLAYER,
    enabled: true,
    mapAiEnabled: false,
    modules: {
      collectResources: false,
      guideBuild: false,
      homeExpansion: false,
      houseBuild: false,
      houseUpgrade: false,
      military: true,
      roadBuild: false,
    },
  });

  const scout = spawnSettlerDirect(sim, JOB_SCOUT, SCOUT_FROM.x, SCOUT_FROM.y, ENEMY_PLAYER);
  const pastBlue = cellAnchorNode(SCOUT_PAST_BLUE.x, SCOUT_PAST_BLUE.y);
  const inVillage = cellAnchorNode(SCOUT_IN_VILLAGE.x, SCOUT_IN_VILLAGE.y);
  const walk = [
    { kind: 'moveUnit', entity: scout, x: pastBlue.hx, y: pastBlue.hy },
    { kind: 'moveUnit', entity: scout, x: inVillage.hx, y: inVillage.hy, queued: true },
  ] as const;
  // One tick apart, so the queued order lands behind the one before it.
  walk.forEach((command, i) => {
    sim.enqueueAt(setupCommand(command), ORDER_TICK + i, SCRIPTED_SEQUENCE);
  });
}

function scoutOf(sim: Simulation): Entity | undefined {
  return sim.world
    .canonicalQuery(Settler, Owner)
    .find(
      (e) =>
        sim.world.get(e, Owner).player === ENEMY_PLAYER && sim.world.get(e, Settler).jobType === JOB_SCOUT,
    );
}

/** The computer's people with an attack order on the scout. */
function onTheScout(sim: Simulation): Entity[] {
  const scout = scoutOf(sim);
  if (scout === undefined) return [];
  return [...sim.world.query(AttackOrder, Owner)].filter(
    (e) =>
      sim.world.get(e, Owner).player === COMPUTER_PLAYER && sim.world.get(e, AttackOrder).target === scout,
  );
}

/** The computer's villagers armed against the scout. */
function chasers(sim: Simulation): Entity[] {
  return [...sim.world.query(Militia, Owner)].filter(
    (e) => sim.world.get(e, Owner).player === COMPUTER_PLAYER,
  );
}

function blueFled(sim: Simulation): boolean {
  for (const e of sim.world.query(Fleeing, Owner)) {
    if (sim.world.get(e, Owner).player === HUMAN_PLAYER) return true;
  }
  return false;
}

function blueWentAtHim(sim: Simulation): boolean {
  const scout = scoutOf(sim);
  if (scout === undefined) return false;
  for (const e of sim.world.query(AttackOrder, Owner)) {
    if (sim.world.get(e, Owner).player === HUMAN_PLAYER && sim.world.get(e, AttackOrder).target === scout)
      return true;
  }
  return false;
}

function siteRose(sim: Simulation): boolean {
  for (const e of sim.world.query(Building, UnderConstruction)) {
    if (sim.world.get(e, Building).buildingType === BUILDING_FARM)
      return sim.world.get(e, Building).built > 0;
  }
  return true; // finished
}

/** Whether an arrow of an armed villager is in flight at the scout. */
function shotAtHim(sim: Simulation): boolean {
  const scout = scoutOf(sim);
  if (scout === undefined) return false;
  for (const shot of sim.world.query(Projectile)) {
    const { source, target } = sim.world.get(shot, Projectile);
    if (target === scout && sim.world.has(source, Militia)) return true;
  }
  return false;
}

/** The computer's people: its herd carries a Settler too, with no trade. */
function villagersOf(sim: Simulation): Entity[] {
  return sim.world
    .canonicalQuery(Settler, Owner)
    .filter(
      (e) => sim.world.get(e, Owner).player === COMPUTER_PLAYER && sim.world.get(e, Settler).jobType !== null,
    );
}

/** Whether the scout is down or out of the village with nobody on him. */
function scoutDealtWith(sim: Simulation): boolean {
  const scout = scoutOf(sim);
  return scout === undefined || sim.world.get(scout, Health).hitpoints <= 0 || onTheScout(sim).length === 0;
}

export const scoutVillageScene: SceneDefinition = {
  id: 'scout-village',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.7,
  checks: [
    {
      label: 'no blue settler ran from the scout or went at him',
      predicate: () =>
        !holdsSometimeDuring(scoutVillageScene, RUN_TICKS, (sim) => blueFled(sim) || blueWentAtHim(sim)),
    },
    {
      label: 'the builders kept building as he passed',
      predicate: siteRose,
    },
    {
      label: 'the computer armed two villagers as hunters against him',
      predicate: () =>
        holdsSometimeDuring(
          scoutVillageScene,
          RUN_TICKS,
          (sim) => chasers(sim).length === systems.SCOUT_CHASERS_PER_SCOUT,
        ),
    },
    {
      label: 'never more than two',
      predicate: () =>
        !holdsSometimeDuring(
          scoutVillageScene,
          RUN_TICKS,
          (sim) => chasers(sim).length > systems.SCOUT_CHASERS_PER_SCOUT,
        ),
    },
    {
      label: 'the hunters shot at him',
      predicate: () => holdsSometimeDuring(scoutVillageScene, RUN_TICKS, shotAtHim),
    },
    {
      label: 'he took their arrows',
      predicate: (sim) => {
        const scout = scoutOf(sim);
        if (scout === undefined) return true;
        const health = sim.world.get(scout, Health);
        return health.hitpoints < health.max;
      },
    },
    {
      label: 'once he was dealt with, the hunters went back to their work',
      predicate: (sim) =>
        scoutDealtWith(sim) &&
        chasers(sim).length === 0 &&
        villagersOf(sim).every((e) => sim.world.get(e, Settler).jobType === JOB_COLLECTOR),
    },
  ],
};
