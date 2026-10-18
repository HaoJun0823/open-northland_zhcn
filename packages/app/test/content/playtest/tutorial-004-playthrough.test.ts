import { components, type Entity, type Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../helpers.js';
import {
  bootMap,
  buildingsOf,
  createLog,
  eventsOfKind,
  expectFired,
  goodType,
  humanOf,
  jobType,
  nodeOf,
  order,
  type PlaytestLog,
  pagesOpened,
  personsOf,
  placeSiteNear,
  problems,
  run,
  SECOND,
  saveRoundTrip,
} from './drive.js';

const MAP = 'tutorial_004';
const PLAYER = 0;
const TRIBE = 1;
const HQ = { hx: 147, hy: 122 };
/** The three collectors the opening page names, by script id: Snorri, Hedin and Orm. */
const COLLECTORS = [1, 2, 3];
/** Page 18 follows the closing page 14: both missions finish on the tailor's upgrade in one pass. */
const PAGES = [0, 1, 12, 4, 6, 5, 2, 15, 19, 16, 13, 7, 3, 17, 8, 9, 14, 18];
const TIMEOUT_MS = 900_000;

function site(sim: Simulation, log: PlaytestLog, slug: string, at: { hx: number; hy: number }): void {
  placeSiteNear(sim, log, PLAYER, TRIBE, slug, at);
}

/** Steps until the seat stands a finished building of `slug`. */
function built(sim: Simulation, log: PlaytestLog, slug: string, seconds: number): Entity {
  for (let waited = 0; waited < seconds; waited += 10) {
    const [building] = buildingsOf(sim, PLAYER, slug);
    if (building !== undefined) return building;
    run(sim, log, 10 * SECOND);
  }
  throw new Error(`${slug} not built within ${seconds}s (t=${sim.tick})`);
}

function employ(sim: Simulation, worker: Entity, building: Entity, jobSlug: string): void {
  order(sim, PLAYER, {
    kind: 'assignWorker',
    entity: worker,
    building,
    jobPriority: [jobType(sim, jobSlug)],
  });
}

function upgrade(sim: Simulation, log: PlaytestLog, slug: string): void {
  const [building] = buildingsOf(sim, PLAYER, slug);
  if (building === undefined) throw new Error(`no finished ${slug} to upgrade`);
  order(sim, PLAYER, { kind: 'upgradeBuilding', building });
  run(sim, log, 1);
}

/** The production button a briefing page names: only this good from now on. */
function makeOnly(sim: Simulation, worker: Entity, goodSlug: string): void {
  order(sim, PLAYER, { kind: 'setProductionGoods', entity: worker, goods: [goodType(sim, goodSlug)] });
}

/** Holding one good zeroes every other good of the collector's trade, so the held good is the one unlisted. */
function collectorOf(sim: Simulation, goodSlug: string): Entity {
  const good = goodType(sim, goodSlug);
  const collector = COLLECTORS.map((id) => humanOf(sim, id)).find(
    (entity) =>
      !(sim.world.tryGet(entity, components.ProductionCounters)?.counters ?? []).some(
        ([held]) => held === good,
      ),
  );
  if (collector === undefined) throw new Error(`no ${goodSlug} collector`);
  return collector;
}

/**
 * The fourth tutorial played through the drive library with no forced step: each collector and a hunter
 * take the workshop their experience opens, and every upgrade and product switch follows the page that
 * asks for it. A save round-trips mid-run. The handcart step relies on the named correction that counts
 * the cart as a vehicle, since a finished cart never enters a store.
 */
describe.runIf(hasRealIr())('tutorial_004 playthrough', () => {
  it(
    'teaches upgrades and product switches in script order and exits',
    async () => {
      const map = await bootMap(`?map=${MAP}&lang=pol`);
      let { sim } = map;
      const log = createLog();
      expectFired(sim, log, 0, 5, 'opening page');
      const clay = collectorOf(sim, 'mud');
      const stone = collectorOf(sim, 'stone');
      const wood = collectorOf(sim, 'wood');
      const [tailor, breeder] = personsOf(sim, PLAYER, 'hunter');
      if (tailor === undefined || breeder === undefined) throw new Error('the map starts with two hunters');

      expectFired(sim, log, 2, 10, 'potter page');
      site(sim, log, 'work_pottery_00', nodeOf(sim, clay));
      employ(sim, clay, built(sim, log, 'work_pottery_00', 300), 'potter');
      expectFired(sim, log, 13, 60, 'potter at work');

      expectFired(sim, log, 9, 300, 'mason page');
      site(sim, log, 'work_mason_hut_00', nodeOf(sim, stone));
      expectFired(sim, log, 5, 300, 'carpenter page');
      site(sim, log, 'work_joinery_00', { hx: HQ.hx + 8, hy: HQ.hy + 10 });
      site(sim, log, 'work_sewery_00', { hx: HQ.hx + 16, hy: HQ.hy + 4 });
      employ(sim, stone, built(sim, log, 'work_mason_hut_00', 300), 'mason');
      expectFired(sim, log, 14, 60, 'mason at work');
      employ(sim, wood, built(sim, log, 'work_joinery_00', 300), 'joiner');
      expectFired(sim, log, 15, 60, 'carpenter at work');
      employ(sim, tailor, built(sim, log, 'work_sewery_00', 300), 'sewer');
      expectFired(sim, log, 16, 60, 'tailor at work');

      sim = await saveRoundTrip(sim, log, map);

      expectFired(sim, log, 3, 600, 'tiles page');
      upgrade(sim, log, 'work_pottery_00');
      expectFired(sim, log, 19, 600, 'pottery 2');
      makeOnly(sim, clay, 'tile');
      expectFired(sim, log, 20, 600, 'tiles, cattle farm open');

      expectFired(sim, log, 10, 600, 'marble page');
      upgrade(sim, log, 'work_mason_hut_00');
      expectFired(sim, log, 17, 600, 'mason hut 2');
      makeOnly(sim, stone, 'ornament');
      expectFired(sim, log, 18, 600, 'marble');

      expectFired(sim, log, 6, 600, 'furniture page');
      upgrade(sim, log, 'work_joinery_00');
      expectFired(sim, log, 23, 600, 'joinery 2');
      makeOnly(sim, wood, 'furniture');
      expectFired(sim, log, 24, 600, 'furniture');

      site(sim, log, 'work_animal_farm', { hx: HQ.hx - 20, hy: HQ.hy - 10 });
      employ(sim, breeder, built(sim, log, 'work_animal_farm', 600), 'breeder');
      expectFired(sim, log, 21, 60, 'stock farmer at work');

      expectFired(sim, log, 4, 900, 'crockery page');
      makeOnly(sim, clay, 'crockery');
      expectFired(sim, log, 22, 600, 'crockery');

      expectFired(sim, log, 7, 900, 'handcart page');
      upgrade(sim, log, 'work_joinery_01');
      expectFired(sim, log, 26, 600, 'joinery 3');
      makeOnly(sim, wood, 'handcart');
      expectFired(sim, log, 27, 900, 'a handcart stands');

      expectFired(sim, log, 8, 900, 'ship page');
      upgrade(sim, log, 'work_joinery_02');
      expectFired(sim, log, 28, 600, 'joinery 4');
      expectFired(sim, log, 12, 900, 'leather armour page');
      upgrade(sim, log, 'work_sewery_00');
      expectFired(sim, log, 25, 600, 'tailor 2');
      expectFired(sim, log, 1, 60, 'every building raised');
      expectFired(sim, log, 29, 30, 'lesson over');

      expect(eventsOfKind(log, 'missionExit')).toHaveLength(1);
      expect(eventsOfKind(log, 'settlerLost')).toEqual([]);
      expect(pagesOpened(log)).toEqual(PAGES);
      expect(problems(log)).toEqual([]);
      expect(log.forced).toHaveLength(0);
    },
    TIMEOUT_MS,
  );
});
