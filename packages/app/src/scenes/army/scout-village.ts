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
 * building, then on into a village the computer runs, which lets him walk. There he strikes a villager:
 * the struck one and a neighbour take him on with their fists. He breaks off after one of the village's
 * cows and takes it; the two chase him out of the village and let him go at its edge.
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
const VILLAGERS: readonly (readonly [number, number])[] = [
  [42, 12],
  [44, 13],
  [46, 12],
  [48, 13],
];
const CATTLE_AT = { x: 52, y: 16 } as const;
const CATTLE = 2;

const SCOUT_FROM = { x: 2, y: 12 } as const;
/** Past the blue site, out of the settlement on the east side. */
const SCOUT_PAST_BLUE = { x: 28, y: 12 } as const;
/** In the computer's village, beside the villager he strikes. */
const SCOUT_IN_VILLAGE = { x: 41, y: 12 } as const;
const ORDER_TICK = 1;
const SCRIPTED_SEQUENCE = Number.MAX_SAFE_INTEGER;
/** When the scout leaves off the villager and goes after a cow: a few blows after his first. */
const CLAIM_TICK = 720;
/** The walk, the blow, the theft and the chase to the village's edge, with margin. */
const RUN_TICKS = 1500;

const { AttackOrder, Building, Fleeing, Health, Livestock, Owner, Settler, UnderConstruction } = components;

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
  const villagers = VILLAGERS.map(([x, y]) => spawnSettlerDirect(sim, JOB_COLLECTOR, x, y, COMPUTER_PLAYER));
  const cattle = spawnAnimalHerdDirect(sim, ANIMAL_TRIBE_CATTLE, CATTLE_AT.x, CATTLE_AT.y, {
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
  const victim = villagers[0];
  const cow = cattle[0];
  if (victim === undefined || cow === undefined) throw new Error('scout-village: the village is empty');
  const pastBlue = cellAnchorNode(SCOUT_PAST_BLUE.x, SCOUT_PAST_BLUE.y);
  const inVillage = cellAnchorNode(SCOUT_IN_VILLAGE.x, SCOUT_IN_VILLAGE.y);
  const walk = [
    { kind: 'moveUnit', entity: scout, x: pastBlue.hx, y: pastBlue.hy },
    { kind: 'moveUnit', entity: scout, x: inVillage.hx, y: inVillage.hy, queued: true },
    { kind: 'attackUnit', entity: scout, target: victim, queued: true },
  ] as const;
  // One tick apart, so each queued order lands behind the one before it.
  walk.forEach((command, i) => {
    sim.enqueueAt(setupCommand(command), ORDER_TICK + i, SCRIPTED_SEQUENCE);
  });
  sim.enqueueAt(
    setupCommand({ kind: 'claimAnimal', entity: scout, animal: cow }),
    CLAIM_TICK,
    SCRIPTED_SEQUENCE,
  );
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

function unhurt(sim: Simulation, e: Entity): boolean {
  const health = sim.world.get(e, Health);
  return health.hitpoints === health.max;
}

function blueFled(sim: Simulation): boolean {
  for (const e of sim.world.query(Fleeing, Owner)) {
    if (sim.world.get(e, Owner).player === HUMAN_PLAYER) return true;
  }
  return false;
}

/** Whether the computer's people went at the scout while none of them was hurt: his blow is the only
 *  harm the scene does them. */
function answeredAWalk(sim: Simulation): boolean {
  if (onTheScout(sim).length === 0) return false;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player === COMPUTER_PLAYER && !unhurt(sim, e)) return false;
  }
  return true;
}

function siteRose(sim: Simulation): boolean {
  for (const e of sim.world.query(Building, UnderConstruction)) {
    if (sim.world.get(e, Building).buildingType === BUILDING_FARM)
      return sim.world.get(e, Building).built > 0;
  }
  return true; // finished
}

function cowTaken(sim: Simulation): boolean {
  for (const e of sim.world.query(Livestock, Owner)) {
    if (sim.world.get(e, Owner).player === ENEMY_PLAYER) return true;
  }
  return false;
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
      label: 'no blue settler ran from the scout',
      predicate: () => !holdsSometimeDuring(scoutVillageScene, RUN_TICKS, blueFled),
    },
    {
      label: 'the builders kept building as he passed',
      predicate: siteRose,
    },
    {
      label: 'the village let him walk in: nobody went at him before he struck',
      predicate: () => !holdsSometimeDuring(scoutVillageScene, RUN_TICKS, answeredAWalk),
    },
    {
      label: 'his blow sent two villagers at him',
      predicate: () =>
        holdsSometimeDuring(
          scoutVillageScene,
          RUN_TICKS,
          (sim) => onTheScout(sim).length === systems.STRIKE_BACK_PARTY,
        ),
    },
    {
      label: 'never more than two',
      predicate: () =>
        !holdsSometimeDuring(
          scoutVillageScene,
          RUN_TICKS,
          (sim) => onTheScout(sim).length > systems.STRIKE_BACK_PARTY,
        ),
    },
    {
      label: 'he got away with a cow',
      predicate: cowTaken,
    },
    {
      label: 'the villagers let him go at the edge of their village, alive',
      predicate: (sim) => {
        const scout = scoutOf(sim);
        return (
          scout !== undefined && sim.world.get(scout, Health).hitpoints > 0 && onTheScout(sim).length === 0
        );
      },
    },
  ],
};
