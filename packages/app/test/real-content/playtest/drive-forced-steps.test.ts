import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../helpers.js';
import {
  bootMap,
  buildingsOf,
  createLog,
  fillStock,
  kill,
  nodeOf,
  personsOf,
  placeFinished,
  run,
  SECOND,
  spawn,
  teleport,
} from './drive.js';

/** The forced steps a probe reaches for, each read back from the world it changed. */

const MAP = 'tutorial_001';
const PLAYER = 0;
const CAMP = { hx: 232, hy: 128 };
/** Ulla's meadow in the script, dry land a walk away from the camp. */
const MEADOW = { hx: 239, hy: 156 };
const REAL_MAP_TIMEOUT_MS = 60_000;

describe.runIf(hasRealIr())('drive library forced steps', () => {
  it(
    'spawns, teleports, builds, stocks and kills through the admin seam',
    async () => {
      const { sim } = await bootMap(`?map=${MAP}&lang=pol`);
      const log = createLog();
      run(sim, log, 1);
      const before = personsOf(sim, PLAYER).length;

      spawn(sim, log, { player: PLAYER, jobSlug: 'soldier_sword_short', count: 3, hx: CAMP.hx, hy: CAMP.hy });
      run(sim, log, 1);
      const soldiers = personsOf(sim, PLAYER, 'soldier_sword_short');
      expect(soldiers).toHaveLength(3);
      expect(personsOf(sim, PLAYER)).toHaveLength(before + 3);

      const far = teleport(sim, log, soldiers, MEADOW.hx, MEADOW.hy);
      run(sim, log, 1);
      for (const soldier of soldiers) {
        const node = nodeOf(sim, soldier);
        expect(Math.abs(node.hx - far.hx) + Math.abs(node.hy - far.hy)).toBeLessThan(8);
      }

      // The lesson keeps the player's building menu closed, so the seat placement names the gate.
      const homes = buildingsOf(sim, PLAYER, 'home_level_00').length;
      expect(() => placeFinished(sim, log, PLAYER, 'home_level_00', CAMP.hx + 10, CAMP.hy + 10)).toThrow(
        /gate/,
      );
      const home = placeFinished(sim, log, PLAYER, 'home_level_00', CAMP.hx + 10, CAMP.hy + 10, {
        ignoreGate: true,
      });
      expect(buildingsOf(sim, PLAYER, 'home_level_00')).toHaveLength(homes + 1);
      expect(buildingsOf(sim, PLAYER, 'home_level_00')).toContain(home);

      const [farm] = buildingsOf(sim, 1, 'work_farm_00');
      if (farm === undefined) throw new Error('the lesson ships no farm');
      const stock = (): number =>
        [...sim.world.get(farm, components.Stockpile).amounts.values()].reduce(
          (sum, amount) => sum + amount,
          0,
        );
      const empty = stock();
      fillStock(sim, log, farm, 'wheat');
      run(sim, log, 1);
      expect(stock()).toBeGreaterThan(empty);

      kill(sim, log, soldiers, 'library check');
      run(sim, log, 2 * SECOND);
      expect(personsOf(sim, PLAYER, 'soldier_sword_short')).toHaveLength(0);
      expect(log.forced).toHaveLength(5);
    },
    REAL_MAP_TIMEOUT_MS,
  );
});
