import type { Entity, Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../helpers.js';
import {
  bootMap,
  buildingsOf,
  buildingType,
  createLog,
  eventsOfKind,
  expectFired,
  goodType,
  jobType,
  order,
  type PlaytestLog,
  pagesOpened,
  personsOf,
  problems,
  run,
  SECOND,
  saveRoundTrip,
} from './drive.js';

const MAP = 'tutorial_003';
const PLAYER = 0;
const TRIBE = 1;
/** The headquarters; the start camp lies west of it, so sites go between the two (walk range 50). */
const HQ = { hx: 147, hy: 122 };
const PAGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const TIMEOUT_MS = 600_000;

/** Retrains and steps one tick, so the next `civilist` pick sees the change. */
function retrain(sim: Simulation, log: PlaytestLog, who: Entity, jobSlug: string, goodSlug?: string): void {
  order(sim, PLAYER, { kind: 'setJob', entity: who, jobType: jobType(sim, jobSlug) });
  if (goodSlug !== undefined)
    order(sim, PLAYER, { kind: 'setGatherGood', entity: who, goodType: goodType(sim, goodSlug) });
  run(sim, log, 1);
}

/** A construction site ordered through the seat command on the first node near `at` the seat may build on. */
function site(sim: Simulation, log: PlaytestLog, slug: string, at: { hx: number; hy: number }): void {
  const type = buildingType(sim, slug);
  const probe = sim.placementProbe(type, PLAYER, TRIBE, true);
  if (probe === null) throw new Error('no terrain');
  for (let ring = 0; ring < 60; ring += 2)
    for (let dy = -ring; dy <= ring; dy += 2)
      for (let dx = -ring; dx <= ring; dx += 2) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        if (!probe.canPlace(at.hx + dx, at.hy + dy)) continue;
        order(sim, PLAYER, {
          kind: 'placeBuilding',
          buildingType: type,
          x: at.hx + dx,
          y: at.hy + dy,
          tribe: TRIBE,
        });
        run(sim, log, 1);
        return;
      }
  throw new Error(`no site for ${slug} near ${at.hx},${at.hy}`);
}

function only(entities: readonly Entity[], what: string): Entity {
  const [first] = entities;
  if (first === undefined) throw new Error(`no ${what}`);
  return first;
}

const civilist = (sim: Simulation): Entity => only(personsOf(sim, PLAYER, 'civilist'), 'idle civilist');

/**
 * The third tutorial played through the drive library with no forced step: collectors, builders, then
 * the food chain whose mill and baker wait on the farmer's and the miller's experience. Sites go between
 * the start camp and the headquarters, inside the camp's walk range, and a save round-trips mid-run.
 */

describe.runIf(hasRealIr())('tutorial_003 playthrough', () => {
  it(
    'teaches the food chain in script order and exits',
    async () => {
      const map = await bootMap(`?map=${MAP}&lang=pol`);
      let { sim } = map;
      const log = createLog();
      expectFired(sim, log, 0, 5, 'opening page');

      retrain(sim, log, civilist(sim), 'collector', 'mud');
      expectFired(sim, log, 1, 60, 'clay collector');
      retrain(sim, log, civilist(sim), 'collector', 'wood');
      retrain(sim, log, civilist(sim), 'collector', 'stone');
      expectFired(sim, log, 2, 60, 'wood and stone collectors');
      retrain(sim, log, civilist(sim), 'builder');
      retrain(sim, log, civilist(sim), 'builder');
      expectFired(sim, log, 3, 60, 'two builders');

      site(sim, log, 'work_farm_00', { hx: HQ.hx - 14, hy: HQ.hy - 2 });
      expectFired(sim, log, 4, 600, 'builders raise the farm');
      const farm = only(buildingsOf(sim, PLAYER, 'work_farm_00'), 'farm');
      const firstFarmer = civilist(sim);
      order(sim, PLAYER, {
        kind: 'assignWorker',
        entity: firstFarmer,
        building: farm,
        jobPriority: [jobType(sim, 'farmer')],
      });
      expectFired(sim, log, 5, 120, 'needs hint');
      // Page 5 asks for homes in the meantime: the farmer's first wheat has made them buildable.
      expect(sim.unlockStatus('house', buildingType(sim, 'home_level_00'), TRIBE, PLAYER).enabled).toBe(true);
      expectFired(sim, log, 6, 900, 'farmer experience unlocks the miller');

      site(sim, log, 'work_mill_00', { hx: HQ.hx - 14, hy: HQ.hy + 12 });
      expectFired(sim, log, 7, 600, 'mill raised');

      sim = await saveRoundTrip(sim, log, map);

      const mill = only(buildingsOf(sim, PLAYER, 'work_mill_00'), 'mill');
      const secondFarmer = civilist(sim);
      order(sim, PLAYER, {
        kind: 'assignWorker',
        entity: firstFarmer,
        building: mill,
        jobPriority: [jobType(sim, 'miller')],
      });
      order(sim, PLAYER, {
        kind: 'assignWorker',
        entity: secondFarmer,
        building: farm,
        jobPriority: [jobType(sim, 'farmer')],
      });
      expectFired(sim, log, 8, 120, 'carrier hint');
      expectFired(sim, log, 9, 900, 'miller experience unlocks the baker');

      site(sim, log, 'work_well_00', { hx: HQ.hx - 4, hy: HQ.hy + 8 });
      expectFired(sim, log, 10, 600, 'well raised');
      site(sim, log, 'work_bakery_00', { hx: HQ.hx - 6, hy: HQ.hy + 16 });
      expectFired(sim, log, 11, 600, 'bakery raised');

      // Page 11: the miller becomes the baker, the farmer the new miller, a fresh hand takes the farm.
      const bakery = only(buildingsOf(sim, PLAYER, 'work_bakery_00'), 'bakery');
      const freshHand = civilist(sim);
      order(sim, PLAYER, {
        kind: 'assignWorker',
        entity: firstFarmer,
        building: bakery,
        jobPriority: [jobType(sim, 'baker')],
      });
      // A hand without farm work behind him is refused the free mill, and told why.
      order(sim, PLAYER, {
        kind: 'assignWorker',
        entity: freshHand,
        building: mill,
        jobPriority: [jobType(sim, 'miller')],
      });
      run(sim, log, 1);
      expect(eventsOfKind(log, 'workerRefused')).toEqual([
        {
          kind: 'workerRefused',
          entity: freshHand,
          building: mill,
          player: PLAYER,
          reason: 'experience',
          jobType: jobType(sim, 'miller'),
        },
      ]);
      order(sim, PLAYER, {
        kind: 'assignWorker',
        entity: secondFarmer,
        building: mill,
        jobPriority: [jobType(sim, 'miller')],
      });
      order(sim, PLAYER, {
        kind: 'assignWorker',
        entity: freshHand,
        building: farm,
        jobPriority: [jobType(sim, 'farmer')],
      });
      expectFired(sim, log, 12, 60, 'farmer, miller and baker at work');
      expectFired(sim, log, 13, 30, 'lesson over');
      run(sim, log, 2 * SECOND);

      expect(eventsOfKind(log, 'missionExit')).toHaveLength(1);
      expect(eventsOfKind(log, 'settlerLost')).toEqual([]);
      expect(pagesOpened(log)).toEqual(PAGES);
      expect(problems(log)).toEqual([]);
      expect(log.forced).toHaveLength(0);
    },
    TIMEOUT_MS,
  );
});
