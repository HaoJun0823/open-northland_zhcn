import { existsSync } from 'node:fs';
import {
  components,
  dynamicBlockOverlay,
  findPath,
  hexDistanceBetween,
  type NodeId,
  nodeOfPosition,
  TICKS_PER_SECOND,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr } from './helpers.js';
import { realMapPath, realMapScript, realMapWorld } from './real-map-world.js';

const NORTHLAND = 'northland-campaign_02_02_sub';
const WONDER = 'wonder-campaign_03_02_sub';

// Real map files stay local; the regression loads the same placements and rules as the app.
describe.runIf(hasRealIr())('landscape walls and dungeon doors', () => {
  it.skipIf(!existsSync(realMapPath('straznicypolnocy_sub2')))(
    'blocks diagonal shortcuts through the ice fortifications on the Guardians map',
    async () => {
      const { sim, content } = await realMapWorld({ mapId: 'straznicypolnocy_sub2', machineSeats: [] });
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('expected terrain');
      const blocked = dynamicBlockOverlay(sim.world, { content }, terrain);
      let joints = 0;
      // The fortification occupies this rectangle; inspect its actual placed collision cells.
      for (let y = 115; y <= 218; y++)
        for (let x = 105; x <= 190; x++) {
          const start = terrain.nodeAt(x, y);
          if (blocked.has(start)) continue;
          for (const step of terrain.steps(start)) {
            const dx = terrain.xOf(step.node) - x,
              dy = terrain.yOf(step.node) - y;
            if (Math.abs(dx) !== 1 || Math.abs(dy) !== 2 || blocked.has(step.node)) continue;
            const mx = x + (dx > 0 ? y & 1 : (y & 1) - 1),
              my = y + dy / 2;
            const middle = terrain.nodeAt(mx, my);
            const flank = terrain.nodeAt(mx === x ? x + dx : x, my);
            if (!blocked.has(middle) || blocked.has(flank)) continue;
            joints++;
            expect(
              terrain.steps(start, blocked).some((s) => s.node === step.node),
              `${x},${y}`,
            ).toBe(false);
          }
        }
      expect(joints).toBeGreaterThan(100);
    },
  );

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

  it.skipIf(!existsSync(realMapPath(NORTHLAND))).each([1, 2, 3, 4, 5, 6, 7, 8])(
    'keeps snakes out of the start chamber and Bjarni alive for 90 seconds, seed %s',
    async (seed) => {
      const { sim, content } = await realMapWorld({
        missions: true,
        mapId: NORTHLAND,
        machineSeats: [],
        humanSeats: [0],
        seed,
      });
      const terrain = sim.terrain;
      if (terrain === undefined) throw new Error('expected terrain');
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
      const p = sim.world.get(hero, components.Position);
      const at = nodeOfPosition(p.x, p.y);
      const blocked = dynamicBlockOverlay(sim.world, { content }, terrain);
      const room = new Set<NodeId>([terrain.nodeAt(at.hx, at.hy)]);
      const queue = [...room];
      for (let i = 0; i < queue.length; i++) {
        const node = queue[i];
        if (node === undefined) continue;
        for (const { node: next } of terrain.steps(node, blocked)) {
          if (
            !room.has(next) &&
            hexDistanceBetween(at.hx, at.hy, terrain.xOf(next), terrain.yOf(next)) <= 8
          ) {
            room.add(next);
            queue.push(next);
          }
        }
      }
      const enemies = [...sim.world.query(components.Settler, components.Owner, components.Position)].filter(
        (e) => sim.world.get(e, components.Owner).player === 1,
      );
      expect(enemies.length).toBeGreaterThan(0);
      for (let tick = 0; tick < 90 * TICKS_PER_SECOND; tick++) {
        for (const e of enemies) {
          const p = sim.world.tryGet(e, components.Position);
          if (p === undefined) continue;
          const n = nodeOfPosition(p.x, p.y);
          expect(
            room.has(terrain.nodeAt(n.hx, n.hy)),
            `snake entered the start chamber at tick ${tick}`,
          ).toBe(false);
        }
        sim.step();
      }
      expect(sim.world.tryGet(hero, components.Health)?.hitpoints).toBeGreaterThan(0);
    },
    60000,
  );
});
