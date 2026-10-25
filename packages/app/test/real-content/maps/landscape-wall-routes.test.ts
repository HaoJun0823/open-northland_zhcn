import { existsSync } from 'node:fs';
import { components, dynamicBlockOverlay, findPath, TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from '../helpers.js';
import { realMapPath, realMapScript, realMapWorld } from '../real-map-world.js';

const NORTHLAND = 'northland-campaign_02_02_sub';
const WONDER = 'wonder-campaign_03_02_sub';

// Real map files stay local; the regression loads the same placements and rules as the app.
describe.runIf(hasRealIr())('landscape walls and dungeon doors', () => {
  it.skipIf(!existsSync(realMapPath(WONDER)))(
    'keeps the exit sealed until the authored gate-opening result runs',
    async () => {
      const script = realMapScript(WONDER);
      if (script === null) throw new Error('expected dungeon script');
      // The script's final opening result opens all four gates and disables their closers.
      const openingMission = 21;
      const { sim, content } = await realMapWorld({
        missions: true,
        mapId: WONDER,
        machineSeats: [],
        humanSeats: [0],
        script: {
          ...script,
          missions: script.missions.map((mission, index) => ({
            ...mission,
            active: index === openingMission,
            ...(index === openingMission ? { goals: [{ key: 'goal', values: ['True'] }] } : {}),
          })),
        },
      });
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('expected terrain');
      const route = () =>
        findPath(
          terrain,
          terrain.nodeAt(21, 18),
          terrain.nodeAt(49, 16),
          dynamicBlockOverlay(sim.world, { content }, terrain),
        );
      expect(route()).toBeNull();
      sim.run(TICKS_PER_SECOND * 4);

      expect(route()).not.toBeNull();
    },
  );

  it.skipIf(!existsSync(realMapPath(NORTHLAND)))(
    'keeps Bjarni alive through the opening snakes for 90 seconds',
    async () => {
      const { sim } = await realMapWorld({
        missions: true,
        mapId: NORTHLAND,
        machineSeats: [],
        humanSeats: [0],
      });
      const heroes = [
        ...sim.world.query(
          components.MissionObjectId,
          components.Owner,
          components.Position,
          components.Settler,
        ),
      ].filter((e) => sim.world.get(e, components.Owner).player === 0);
      const hero = heroes.find((e) => sim.world.get(e, components.MissionObjectId).id === 1);
      if (hero === undefined) throw new Error('expected starting hero');
      const enemies = [...sim.world.query(components.Settler, components.Owner, components.Position)].filter(
        (e) => sim.world.get(e, components.Owner).player === 1,
      );
      expect(enemies.length).toBeGreaterThan(0);
      // The snakes share an open route with Bjarni; the opening protects his survival, not a
      // radius around his initial position. The wall and sealed-door routes are checked above.
      sim.run(90 * TICKS_PER_SECOND);
      expect(sim.world.tryGet(hero, components.Health)?.hitpoints).toBeGreaterThan(0);
    },
    60000,
  );
});
