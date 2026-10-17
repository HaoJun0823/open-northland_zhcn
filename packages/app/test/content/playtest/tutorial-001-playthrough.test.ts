import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../helpers.js';
import {
  bootMap,
  buildingsOf,
  createLog,
  eventsOfKind,
  expectFired,
  humanOf,
  jobType,
  order,
  pagesOpened,
  problems,
  run,
  SECOND,
  saveRoundTrip,
  teleportHumans,
  walkTo,
} from './drive.js';

/**
 * The first tutorial played through the drive library: every lesson step through the player's own
 * orders, one forced step where the lesson's own walk needs signposts, and a save/restore in the
 * middle. The template for a per-map playtest probe, and the regression that keeps the library honest.
 */

const MAP = 'tutorial_001';
const PLAYER = 0;
const KNUT = 1;
const ULLA = 2;
const ARRIVALS = [3, 4, 5, 6];
/** Points and ids as the script's goals name them; `npm run mission:script -- tutorial_001` lists them. */
const MARK = { hx: 228, hy: 135 };
const ULLA_SPOT = { hx: 239, hy: 156 };
const VILLAGE = { hx: 101, hy: 288 };
const FARM_ID = 1;
const MISSION = {
  knutAtMark: 2,
  home: 3,
  farmer: 4,
  ulla: 5,
  married: 6,
  guestsArrive: 9,
  guides: 10,
  village: 11,
  exit: 12,
};
const PAGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const REAL_MAP_TIMEOUT_MS = 180_000;

describe.runIf(hasRealIr())('tutorial_001 playthrough', () => {
  it(
    'teaches every lesson in script order and exits',
    async () => {
      const map = await bootMap(`?map=${MAP}&lang=pol`);
      let { sim } = map;
      const log = createLog();
      expectFired(sim, log, 1, 10, 'Knut introduced');

      const knut = humanOf(sim, KNUT);
      walkTo(sim, PLAYER, [knut], MARK.hx, MARK.hy);
      expectFired(sim, log, MISSION.knutAtMark, 60, 'Knut walked to the mark');

      const [home] = buildingsOf(sim, PLAYER, 'home_level_00');
      if (home === undefined) throw new Error('the lesson ships no home for Knut');
      order(sim, PLAYER, { kind: 'assignHouse', entity: knut, house: home });
      expectFired(sim, log, MISSION.home, 60, 'Knut housed');

      // The farm is handed over by the home lesson's result; the farmer lesson needs it owned.
      const [farm] = buildingsOf(sim, PLAYER, 'work_farm_00');
      if (farm === undefined) throw new Error(`the home lesson did not hand farm ${FARM_ID} to the player`);
      order(sim, PLAYER, {
        kind: 'assignWorker',
        entity: knut,
        building: farm,
        jobPriority: [jobType(sim, 'farmer')],
      });
      expectFired(sim, log, MISSION.farmer, 90, 'Knut farms');

      walkTo(sim, PLAYER, [knut], ULLA_SPOT.hx, ULLA_SPOT.hy);
      expectFired(sim, log, MISSION.ulla, 90, 'Ulla found');
      expect(components.ownerOf(sim.world, humanOf(sim, ULLA))).toBe(PLAYER);
      // Ulla walks to the camp first; the wedding order needs her inside Knut's signpost area.
      run(sim, log, 20 * SECOND);
      order(sim, PLAYER, { kind: 'marry', entity: knut });
      expectFired(sim, log, MISSION.married, 180, 'Knut and Ulla share a home');
      expect(eventsOfKind(log, 'marriageUnmatched')).toEqual([]);

      expectFired(sim, log, MISSION.guestsArrive, 240, 'the guests walk into the camp');
      expectFired(sim, log, MISSION.guides, 60, 'signposts explained');

      sim = await saveRoundTrip(sim, log, map);

      // Original lesson: the village lies beyond walking range and teaches signposts; the walk is forced.
      teleportHumans(sim, log, [ULLA, ...ARRIVALS], VILLAGE.hx, VILLAGE.hy);
      expectFired(sim, log, MISSION.village, 60, 'everyone in the village');
      expectFired(sim, log, MISSION.exit, 30, 'lesson over');
      run(sim, log, 2 * SECOND);

      expect(eventsOfKind(log, 'missionExit')).toHaveLength(1);
      expect(pagesOpened(log)).toEqual(PAGES);
      expect(problems(log)).toEqual([]);
      expect(log.forced).toHaveLength(1);
    },
    REAL_MAP_TIMEOUT_MS,
  );
});
