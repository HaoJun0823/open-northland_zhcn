import { cellAnchorNode, components, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SPEAR_WOODEN, JOB_SOLDIER_SWORD, JOB_SOLDIER_UNARMED } from '../catalog/jobs.js';
import { BYZANTINE, BYZANTINE_SPEAR_VARIANTS } from '../catalog/unit-variants.js';
import { spawnSettlerAtNode } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const ENDURANCE = 1_000_000;
const SUBJECTS = [
  { tribe: 1, jobType: JOB_SOLDIER_UNARMED },
  { tribe: 6, jobType: JOB_SOLDIER_UNARMED },
  { tribe: 5, jobType: JOB_SOLDIER_UNARMED },
  { tribe: BYZANTINE, jobType: JOB_SOLDIER_SPEAR_WOODEN },
];

function build(sim: Simulation): void {
  for (const [column, subject] of SUBJECTS.entries()) {
    const node = cellAnchorNode(4 + column * 5, 9);
    const target = systems.createSettler(
      sim.world,
      sim.content,
      sim.rng,
      { ...subject, owner: 2, x: node.hx + 1, y: node.hy },
      sim.names,
    );
    if (target === null) throw new Error('Missing creature blood subject');
    // The fallback catalog has generic human HP; exercise the same dragon pool in both entries.
    const variant = BYZANTINE_SPEAR_VARIANTS.find(
      (rule) => rule.form === 'native' && rule.jobType === subject.jobType,
    );
    if (subject.tribe === BYZANTINE && variant?.hitpoints !== undefined)
      sim.world.mut(target, components.Health).max = variant.hitpoints;
    const attacker = spawnSettlerAtNode(sim, JOB_SOLDIER_SWORD, node, 0);
    for (const entity of [attacker, target]) {
      // Keep the comparison running without inflating the HP reference used by visible wounds.
      sim.world.mut(entity, components.Health).hitpoints = ENDURANCE;
      sim.world.mut(entity, components.Stance).mode = systems.MILITARY_MODE.IGNORE;
    }
    components.setMissionBehaviour(sim.world, target, components.MISSION_BEHAVIOUR.PASSIVE, true);
    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target });
  }
}

export const creatureBloodScene: SceneDefinition = {
  id: 'creature-blood',
  seed: 84,
  terrain: grassTerrain(25, 19),
  graphicTribes: [1, 6, 5, 3],
  initialZoom: 1.25,
  build,
  runTicks: 240,
  checks: [
    {
      label: 'all four subjects take wounds while keeping their maximum health',
      predicate: (sim) => {
        const subjects = [...sim.world.query(components.Settler, components.Owner, components.Health)].filter(
          (e) => sim.world.get(e, components.Owner).player === 2,
        );
        return (
          subjects.length === 4 &&
          subjects.every((e) => {
            const hp = sim.world.get(e, components.Health);
            const identity = sim.world.get(e, components.Settler);
            return (
              hp.hitpoints > 0 &&
              hp.hitpoints < ENDURANCE &&
              (identity.tribe !== BYZANTINE || (identity.humanForm !== true && hp.max === 20000))
            );
          })
        );
      },
    },
  ],
};
