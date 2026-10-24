import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Equipment,
  EquipOrder,
  Owner,
  PathRequest,
  Position,
  Stockpile,
  setNeedsEnabled,
} from '../../../../src/components/index.js';
import { fx, nodeOfPosition, positionOfNode, Simulation } from '../../../../src/index.js';
import { dynamicBlockOverlay } from '../../../../src/systems/footprint/index.js';
import { testContent } from '../../../fixtures/content.js';
import { grassNodeMap } from '../../../fixtures/terrain.js';

const HOME = { hx: 10, hy: 10 };
const SHOES = 8;
const TOOL = 11;
const WALL = 80;

// Cover the final return point while a real equipment errand is away fetching its goods.
describe('equipment return points covered by a structure', () => {
  for (const issuer of ['assistant', 'player'] as const) {
    it.each([false, true])(
      `${issuer} completes its equipment chain with the issue point blocked=%s`,
      (blocked) => {
        const sim = new Simulation({
          seed: 1,
          content: testContent(),
          map: {
            ...grassNodeMap(64, 24),
            landscapes: {
              placements: [],
              types: [
                {
                  typeId: WALL,
                  walk: [{ dx: 0, dy: 0 }],
                  build: [],
                  groups: [],
                  wall: { maxHitpoints: 100, repairPerStrike: 1, construction: [] },
                },
              ],
            },
          },
        });
        setNeedsEnabled(sim.world, false);
        const terrain = sim.terrain;
        if (terrain === undefined) throw new Error('expected terrain');
        const home = terrain.nodeAt(HOME.hx, HOME.hy);
        const settler = sim.world.create();
        sim.world.add(settler, Position, positionOfNode(HOME.hx, HOME.hy));
        addPerson(sim.world, settler, {
          tribe: 1,
          jobType: 1,
          hunger: fx.fromInt(0),
          fatigue: fx.fromInt(0),
          piety: fx.fromInt(0),
          enjoyment: fx.fromInt(0),
        });
        sim.world.add(settler, Owner, { player: 0 });
        const pile = sim.world.create();
        sim.world.add(pile, Position, positionOfNode(40, 10));
        sim.world.add(pile, Owner, { player: 0 });
        sim.world.add(pile, Stockpile, {
          amounts: new Map([
            [SHOES, 1],
            [TOOL, 1],
          ]),
        });
        if (issuer === 'assistant')
          sim.enqueueSetup({ kind: 'setAssistantGrant', player: 0, goodType: SHOES, enabled: true });
        else {
          sim.enqueueSetup({ kind: 'equipGood', entity: settler, group: 'boots', slot: 0, goodType: SHOES });
          sim.enqueueSetup({ kind: 'equipGood', entity: settler, group: 'tool', slot: 0, goodType: TOOL });
        }
        for (let tick = 0; tick < 300; tick++) {
          sim.step();
          const p = sim.world.get(settler, Position);
          if (nodeOfPosition(p.x, p.y).hx >= 15) break;
        }
        const away = sim.world.get(settler, Position);
        expect(nodeOfPosition(away.x, away.y).hx).toBeGreaterThanOrEqual(15);
        expect(sim.world.get(settler, EquipOrder).stage).toBe('acquire');
        if (blocked) {
          sim.enqueueSetup({
            kind: 'placePalisade',
            gfxIndex: WALL,
            x: HOME.hx,
            y: HOME.hy,
            tribe: 1,
            owner: 0,
          });
          sim.step();
          expect(dynamicBlockOverlay(sim.world, { content: sim.content }, terrain).has(home)).toBe(true);
        }
        let failedReturn = false,
          lost = false;
        for (let tick = 0; tick < 1500; tick++) {
          sim.step();
          const request = sim.world.tryGet(settler, PathRequest);
          failedReturn ||= request?.goal === home && request.failed;
          lost ||= sim.events.current().some((e) => e.kind === 'settlerLost' && e.entity === settler);
        }
        expect(sim.world.get(settler, Equipment).boots?.goodType).toBe(SHOES);
        if (issuer === 'player') expect(sim.world.get(settler, Equipment).tool?.goodType).toBe(TOOL);
        expect(sim.world.has(settler, EquipOrder)).toBe(false);
        expect(failedReturn).toBe(false);
        expect(lost).toBe(false);
        const p = sim.world.get(settler, Position);
        if (blocked) expect(nodeOfPosition(p.x, p.y)).not.toEqual(HOME);
        else expect(nodeOfPosition(p.x, p.y)).toEqual(HOME);
      },
    );
  }
});
