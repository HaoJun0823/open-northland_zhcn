import { components, nodeOfPosition, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import {
  PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX,
  PALISADE_WALL_GFX_INDEX,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

const WIDTH = 36;
const WALL_ROW = 22;
const GATE_X = 58;
const { AttackOrder, Health, Owner, Palisade, Position, Settler } = components;

/** The open gate is far east of the attack. The squad should breach the western wall from the south. */
function build(sim: Simulation): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('open-gate-attack needs terrain');
  for (let hx = 0; hx < WIDTH * 2; hx++) {
    if (hx !== GATE_X && Math.abs(hx - GATE_X) <= 2) continue;
    const gfx = hx === GATE_X ? PALISADE_HORIZONTAL_GATE_CLOSED_GFX_INDEX : PALISADE_WALL_GFX_INDEX;
    const type = systems.palisadeType(terrain, gfx);
    if (type === undefined) throw new Error('missing palisade type');
    const wall = systems.createPalisade(sim.world, type, {
      x: hx,
      y: WALL_ROW,
      tribe: PRIMARY_TRIBE,
      owner: ENEMY_PLAYER,
      underConstruction: false,
    });
    if (wall === null) throw new Error('missing palisade');
    if (hx === GATE_X) sim.enqueueSetup({ kind: 'setPalisadeGate', palisade: wall, open: true });
  }
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 8; column++) {
      const entity = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, 5 + column, 15 + row, HUMAN_PLAYER);
      sim.enqueueSetup({ kind: 'attackMoveUnit', entity, x: 10 + column * 2, y: 10 });
    }
  }
}

export const openGateAttackScene: SceneDefinition = {
  id: 'open-gate-attack',
  seed: 7,
  terrain: grassTerrain(WIDTH, 26),
  initialZoom: 0.4,
  build,
  runTicks: 140,
  checks: [
    {
      label: 'the distant enemy gate stays open and undamaged',
      predicate: (sim) =>
        [...sim.world.query(Palisade, Health)].some((e) => {
          const wall = sim.world.get(e, Palisade);
          const health = sim.world.get(e, Health);
          return wall.gate?.open === true && health.hitpoints === health.max;
        }),
    },
    {
      label: 'the squad attacks the wall on its approach side',
      predicate: (sim) =>
        [...sim.world.query(AttackOrder)].some((e) => {
          const target = sim.world.get(e, AttackOrder).target;
          const p = sim.world.tryGet(target, Position);
          return sim.world.has(target, Palisade) && p !== undefined && nodeOfPosition(p.x, p.y).hx < 30;
        }),
    },
    {
      label: 'no attacker detours toward the eastern gate',
      predicate: (sim) =>
        [...sim.world.query(Settler, Owner, Position)]
          .filter((e) => sim.world.get(e, Owner).player === HUMAN_PLAYER)
          .every((e) => {
            const p = sim.world.get(e, Position);
            return nodeOfPosition(p.x, p.y).hx < 35;
          }),
    },
  ],
};
