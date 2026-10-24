import { hasHumanForm } from '@open-northland/data';
import { cellAnchorNode, components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SPEAR_WOODEN } from '../../catalog/jobs.js';
import { BYZANTINE } from '../../catalog/unit-variants.js';
import type { SceneDefinition } from '../types.js';

const HUMAN_SEAT = 0;
const MACHINE_SEAT = 1;

/** Three columns of Byzantine spears: a trained one, the map's man on a machine seat, and the map's gift
 *  to the human player. Wood stands above iron in each column; only wood has a second form. */
const COLUMNS = [
  { owner: HUMAN_SEAT, humanForm: true },
  { owner: MACHINE_SEAT, humanForm: false },
  { owner: HUMAN_SEAT, humanForm: false },
] as const;

function build(sim: Simulation): void {
  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_SEAT, to: MACHINE_SEAT, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: MACHINE_SEAT, to: HUMAN_SEAT, state: 'friend' });
  sim.enqueueSetup({ kind: 'setAiControl', player: MACHINE_SEAT, enabled: true, mapAiEnabled: false });
  for (const [column, { owner, humanForm }] of COLUMNS.entries()) {
    for (const [row, jobType] of [JOB_SOLDIER_SPEAR_WOODEN, JOB_SOLDIER_SPEAR].entries()) {
      const node = cellAnchorNode(4 + column * 5, 5 + row * 5);
      sim.enqueueSetup({
        kind: 'spawnSettler',
        tribe: BYZANTINE,
        jobType,
        owner,
        x: node.hx,
        y: node.hy,
        ...(humanForm && jobType === JOB_SOLDIER_SPEAR_WOODEN ? { humanForm: true } : {}),
      });
    }
  }
}

export const byzantineSpearsScene: SceneDefinition = {
  id: 'byzantine-spears',
  seed: 37,
  terrain: grassTerrain(19, 16),
  graphicTribes: [1, BYZANTINE],
  initialZoom: 1.5,
  runTicks: 60,
  build,
  checks: [
    {
      label: "only the trained wooden spear is in the human form; the map's placement and gift are dragons",
      predicate: (sim) => {
        const units = [...sim.world.query(components.Settler, components.Owner, components.Health)];
        if (units.length !== COLUMNS.length * 2) return false;
        // The fallback catalog declares one form, so there every man is a 5000 HP spearman.
        const twoForms = hasHumanForm(sim.content, BYZANTINE, JOB_SOLDIER_SPEAR_WOODEN);
        let humanForms = 0;
        for (const e of units) {
          const settler = sim.world.get(e, components.Settler);
          const wooden = settler.jobType === JOB_SOLDIER_SPEAR_WOODEN;
          const dragon = twoForms && wooden && settler.humanForm !== true;
          if (settler.humanForm === true) humanForms++;
          if (sim.world.get(e, components.Health).max !== (dragon ? 20000 : 5000)) return false;
        }
        return humanForms === (twoForms ? 1 : 0);
      },
    },
  ],
};
