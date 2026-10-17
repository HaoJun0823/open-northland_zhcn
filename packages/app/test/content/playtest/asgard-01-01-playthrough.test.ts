import { components, type Entity, type HalfCellNode, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../helpers.js';
import {
  bootMap,
  buildingType,
  createLog,
  eventsOfKind,
  expectFired,
  humanOf,
  jobType,
  kill,
  nodeOf,
  note,
  order,
  type PlaytestLog,
  pagesOpened,
  personsOf,
  problems,
  run,
  SECOND,
  saveRoundTrip,
  walkTo,
  withMissionId,
} from './drive.js';

/**
 * The first Gates of Asgard stage played through: Bjarni finds the village and the druid, the druid's
 * lessons build the mead economy by the player's own orders, the mead pays for the drakkar, and the
 * drakkar carries Bjarni to the Norns. Nothing is forced; the economy takes about 45 minutes of game time.
 */

const MAP = 'asgard-campaign_01_01';
const PLAYER = 0;
/** Script human ids; `npm run mission:script -- asgard-campaign_01_01` lists them. */
const DRUID = 1;
const BJARNI = 2;
const SHIPWRIGHT = 3;
const DRAKKAR = 1;
const TRIBUTE_SLOT = 1;
/** Where the scripted child leads; walking it brings the village into view. */
const CHILD_GOAL = { hx: 176, hy: 206 };
const VILLAGE = { hx: 160, hy: 225 };
/** The strait the farewell waits for, open water short of the island, and the Norns' circle. */
const STRAIT = { hx: 183, hy: 309 };
const OFF_ISLAND = { hx: 184, hy: 500 };
const NORNS = { hx: 173, hy: 560 };
const MISSION = {
  village: 1,
  druid: 2,
  shipwright: 4,
  builderLesson: 5,
  builders: 6,
  farm: 7,
  millerQualified: 9,
  mill: 10,
  bakerQualified: 12,
  well: 13,
  bakery: 14,
  bakeryStaffed: 15,
  hive: 16,
  brewery: 17,
  brewer: 18,
  tributePaid: 19,
  nornsFound: 20,
  farewell: 21,
  iceText: 22,
  bjarniDead: 25,
  island: 29,
  exit: 31,
  meadReady: 33,
  wonText: 34,
};
const PAGES = [0, 1, 3, 4, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 33, 5, 6, 7, 31, 9];
const REAL_MAP_TIMEOUT_MS = 300_000;

/** Retrains idle civilists through the player's own setJob order. */
function retrain(sim: Simulation, log: PlaytestLog, jobSlug: string, count: number): Entity[] {
  const picked = personsOf(sim, PLAYER, 'civilist')
    .filter((entity) => !sim.world.has(entity, components.MissionObjectId))
    .slice(0, count);
  if (picked.length < count) throw new Error(`fewer than ${count} civilists to retrain`);
  for (const entity of picked) order(sim, PLAYER, { kind: 'setJob', entity, jobType: jobType(sim, jobSlug) });
  note(log, `setJob ${jobSlug} x${count} t=${sim.tick}`);
  return picked;
}

function work(sim: Simulation, entity: Entity, building: Entity, jobSlug: string): void {
  order(sim, PLAYER, { kind: 'assignWorker', entity, building, jobPriority: [jobType(sim, jobSlug)] });
}

/** Orders the worker into `building` as `jobSlug` every ten seconds until it qualifies and the job sticks. */
function workOnceQualified(
  sim: Simulation,
  log: PlaytestLog,
  entity: Entity,
  building: Entity,
  jobSlug: string,
): void {
  for (let waited = 0; waited < 3600; waited += 10) {
    work(sim, entity, building, jobSlug);
    run(sim, log, 10 * SECOND);
    if (personsOf(sim, PLAYER, jobSlug).includes(entity)) return;
  }
  throw new Error(`${entity} never qualified as ${jobSlug}`);
}

/** Orders a construction site on the first node near the village the seat's rule accepts; builders do the rest. */
function orderSite(sim: Simulation, log: PlaytestLog, buildingSlug: string): Entity {
  const type = buildingType(sim, buildingSlug);
  const tribe = sim.world.get(humanOf(sim, BJARNI), components.Settler).tribe;
  const probe = sim.placementProbe(type, PLAYER, tribe, true);
  if (probe === null) throw new Error('the world has no terrain');
  for (let ring = 0; ring < 80; ring += 2) {
    for (let dy = -ring; dy <= ring; dy += 2) {
      for (let dx = -ring; dx <= ring; dx += 2) {
        const x = VILLAGE.hx + dx;
        const y = VILLAGE.hy + dy;
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring || !probe.canPlace(x, y)) continue;
        const before = new Set(sim.world.query(components.Building));
        order(sim, PLAYER, { kind: 'placeBuilding', buildingType: type, x, y, tribe });
        run(sim, log, 1);
        const site = [...sim.world.query(components.Building)].find((entity) => !before.has(entity));
        if (site === undefined) throw new Error(`the ${buildingSlug} site at ${x},${y} was refused`);
        return site;
      }
    }
  }
  throw new Error(`no site near the village takes ${buildingSlug}`);
}

function runUntil(
  sim: Simulation,
  log: PlaytestLog,
  done: () => boolean,
  seconds: number,
  what: string,
): void {
  for (let tick = 0; tick < seconds * SECOND && !done(); tick++) run(sim, log, 1);
  if (!done()) throw new Error(`${what} not within ${seconds}s (t=${sim.tick})`);
}

/** The first walkable node of the island's own ground on the line from open water toward the circle. */
function islandShore(sim: Simulation): HalfCellNode {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('the world has no terrain');
  const island = terrain.componentOf(terrain.nodeAt(NORNS.hx, NORNS.hy));
  for (let step = 0; step <= 60; step++) {
    const hx = Math.round(OFF_ISLAND.hx + ((NORNS.hx - OFF_ISLAND.hx) * step) / 60);
    const hy = Math.round(OFF_ISLAND.hy + ((NORNS.hy - OFF_ISLAND.hy) * step) / 60);
    const node = terrain.nodeAt(hx, hy);
    if (terrain.isWalkable(node) && terrain.componentOf(node) === island) return { hx, hy };
  }
  throw new Error('no shore between open water and the circle');
}

async function villageFound(): Promise<{ map: Awaited<ReturnType<typeof bootMap>>; log: PlaytestLog }> {
  const map = await bootMap(`?map=${MAP}&lang=pol&tribe=1`);
  const log = createLog();
  walkTo(map.sim, PLAYER, [humanOf(map.sim, BJARNI)], CHILD_GOAL.hx, CHILD_GOAL.hy);
  expectFired(map.sim, log, MISSION.village, 120, 'village in view');
  return { map, log };
}

function walkNear(sim: Simulation, who: Entity, scriptId: number): void {
  const at = nodeOf(sim, humanOf(sim, scriptId));
  walkTo(sim, PLAYER, [who], at.hx, at.hy + 2);
}

describe.runIf(hasRealIr())(`${MAP} playthrough`, () => {
  it(
    "meets the druid, brews the shipwright's mead, sails to the Norns and unlocks Normandy",
    async () => {
      const { map, log } = await villageFound();
      let sim = map.sim;
      const bjarni = humanOf(sim, BJARNI);
      walkNear(sim, bjarni, DRUID);
      expectFired(sim, log, MISSION.druid, 400, 'druid met');
      walkNear(sim, bjarni, SHIPWRIGHT);
      expectFired(sim, log, MISSION.shipwright, 400, 'shipwright met');

      expectFired(sim, log, MISSION.builderLesson, 30, 'builder lesson');
      retrain(sim, log, 'builder', 2);
      expectFired(sim, log, MISSION.builders, 30, 'two builders');
      const farm = orderSite(sim, log, 'work_farm_00');
      expectFired(sim, log, MISSION.farm, 900, 'farm built');
      const [first] = retrain(sim, log, 'farmer', 1);
      if (first === undefined) throw new Error('no farmer');
      work(sim, first, farm, 'farmer');
      expectFired(sim, log, MISSION.millerQualified, 3600, 'farmer qualifies as miller');
      const mill = orderSite(sim, log, 'work_mill_00');
      expectFired(sim, log, MISSION.mill, 900, 'mill built');
      work(sim, first, mill, 'miller');
      expectFired(sim, log, MISSION.bakerQualified, 3600, 'miller qualifies as baker');
      orderSite(sim, log, 'work_well_00');
      expectFired(sim, log, MISSION.well, 900, 'well built');
      const bakery = orderSite(sim, log, 'work_bakery_00');
      expectFired(sim, log, MISSION.bakery, 900, 'bakery built');
      // The lesson's rotation: the miller bakes, a new farmer earns the mill, a third man farms.
      work(sim, first, bakery, 'baker');
      const [second] = retrain(sim, log, 'farmer', 1);
      if (second === undefined) throw new Error('no second farmer');
      work(sim, second, farm, 'farmer');
      workOnceQualified(sim, log, second, mill, 'miller');
      const [third] = retrain(sim, log, 'farmer', 1);
      if (third === undefined) throw new Error('no third farmer');
      work(sim, third, farm, 'farmer');
      expectFired(sim, log, MISSION.bakeryStaffed, 60, 'miller, baker and farmer');
      const hive = orderSite(sim, log, 'work_hive_00');
      expectFired(sim, log, MISSION.hive, 900, 'hive built');
      const brewery = orderSite(sim, log, 'work_brewery');
      expectFired(sim, log, MISSION.brewery, 900, 'brewery built');
      workOnceQualified(sim, log, first, brewery, 'brewer');
      expectFired(sim, log, MISSION.brewer, 30, 'brewer');
      const [hiveHand, breweryHand] = retrain(sim, log, 'carrier', 2);
      if (hiveHand === undefined || breweryHand === undefined) throw new Error('no carriers');
      work(sim, hiveHand, hive, 'carrier');
      work(sim, breweryHand, brewery, 'carrier');
      expectFired(sim, log, MISSION.meadReady, 3600, 'ten mead brewed');
      order(sim, PLAYER, { kind: 'payTribute', player: PLAYER, slot: TRIBUTE_SLOT });
      expectFired(sim, log, MISSION.tributePaid, 30, 'drakkar bought');

      sim = await saveRoundTrip(sim, log, map);

      const drakkar = withMissionId(sim, DRAKKAR).find((entity) => sim.world.has(entity, components.Vehicle));
      if (drakkar === undefined) throw new Error('the tribute launched no drakkar');
      order(sim, PLAYER, { kind: 'attachToVehicle', entity: bjarni, vehicle: drakkar });
      runUntil(sim, log, () => components.isAboardVehicle(sim.world, bjarni), 300, 'Bjarni aboard');
      order(sim, PLAYER, { kind: 'moveVehicle', vehicle: drakkar, x: STRAIT.hx, y: STRAIT.hy });
      expectFired(sim, log, MISSION.farewell, 600, 'familiar waters left');
      order(sim, PLAYER, { kind: 'moveVehicle', vehicle: drakkar, x: OFF_ISLAND.hx, y: OFF_ISLAND.hy });
      expectFired(sim, log, MISSION.iceText, 900, 'ice text');
      expectFired(sim, log, MISSION.island, 900, 'island in view');
      const shore = islandShore(sim);
      order(sim, PLAYER, { kind: 'dockVehicle', vehicle: drakkar, x: shore.hx, y: shore.hy });
      runUntil(sim, log, () => sim.world.get(drakkar, components.Vehicle).moored, 900, 'moored');
      order(sim, PLAYER, { kind: 'unloadPeople', vehicle: drakkar });
      runUntil(sim, log, () => !components.isAboardVehicle(sim.world, bjarni), 30, 'Bjarni ashore');
      walkTo(sim, PLAYER, [bjarni], NORNS.hx, NORNS.hy);
      expectFired(sim, log, MISSION.nornsFound, 300, 'Norns found');
      expectFired(sim, log, MISSION.wonText, 30, 'won text');
      expectFired(sim, log, MISSION.exit, 30, 'stage over');
      run(sim, log, 2 * SECOND);

      expect(eventsOfKind(log, 'playerWon')).toEqual([{ kind: 'playerWon', player: PLAYER }]);
      expect(eventsOfKind(log, 'missionCampaignUnlock')).toEqual([
        { kind: 'missionCampaignUnlock', campaignId: 1, mapId: 20 },
      ]);
      expect(eventsOfKind(log, 'missionExit')).toHaveLength(1);
      expect(pagesOpened(log)).toEqual(PAGES);
      expect(problems(log)).toEqual([]);
      expect(log.forced).toEqual([]);
    },
    REAL_MAP_TIMEOUT_MS,
  );

  it(
    'fails and exits when Bjarni dies',
    async () => {
      const { map, log } = await villageFound();
      const { sim } = map;
      kill(sim, log, [humanOf(sim, BJARNI)], 'Bjarni falls');
      expectFired(sim, log, MISSION.bjarniDead, 60, 'Bjarni dead');
      expectFired(sim, log, MISSION.exit, 30, 'stage over');
      run(sim, log, 2 * SECOND);

      expect(eventsOfKind(log, 'playerDefeated')).toEqual([{ kind: 'playerDefeated', player: PLAYER }]);
      expect(eventsOfKind(log, 'missionCampaignUnlock')).toEqual([]);
      expect(pagesOpened(log)).toEqual([0, 1, 10]);
      expect(problems(log)).toEqual([]);
      expect(log.forced).toHaveLength(1);
    },
    REAL_MAP_TIMEOUT_MS,
  );
});
