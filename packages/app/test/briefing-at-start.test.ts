import type { TerrainMapFile } from '@open-northland/data';
import { LockstepDriver, LoopbackTransport } from '@open-northland/lockstep';
import {
  exportSaveGame,
  type MissionScript,
  type SimEvent,
  SUCCESSFUL_IF,
  systems,
} from '@open-northland/sim';
import { expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { buildMapWorld, restoreMapWorld } from '../src/entries/map/world.js';
import { BRIEFING_PAGE, presentationScene } from '../src/scenes/presentation.js';
import { createSceneSim } from '../src/scenes/runtime.js';

/**
 * A scripted world shows its opening briefing on the script's first pass: each entry's boot hands over
 * a world whose first live tick loads the script, and the pass a period later fires the opening
 * `PlayCutscene` for the frame loop to collect. A sub-mission reaches the player as a save taken at
 * boot, and its first ticks after the restore do the same.
 */

const MAP_SIDE = 12;
const PAGE = 500;

const map: TerrainMapFile = {
  width: MAP_SIDE,
  height: MAP_SIDE,
  typeIds: new Array<number>(MAP_SIDE * MAP_SIDE).fill(0),
};
const missions: MissionScript = {
  missions: [
    {
      active: true,
      visible: true,
      successfullIf: SUCCESSFUL_IF.all,
      goals: [],
      results: [{ opcode: 'PlayCutscene', cutscene: PAGE, replay: true }],
    },
  ],
};
const options = {
  seed: 7,
  map,
  ir: {} as ContentIr,
  content: {},
  aiSeats: [],
  assistantSeats: [],
  fog: null,
  progression: null,
  needs: null,
  alliedVision: null,
  missions: null,
  script: { missions },
};
const OPENING: SimEvent = { kind: 'missionCutscene', mission: 0, page: PAGE, replay: true };

/** Live ticks from the end of boot to the script's first pass: the first one loads it. */
const FIRST_PASS = systems.MISSION_EVALUATION_TICKS;

it('fires the opening briefing on the first pass after boot, not before', () => {
  const { sim } = buildMapWorld(options);
  sim.run(FIRST_PASS - 1);
  expect(sim.missionBriefingHistory()).toEqual([]);
  sim.step();
  expect(sim.events.current()).toContainEqual(OPENING);
  expect(sim.missionBriefingPage()).toBe(PAGE);
});

it('fires it on the first pass after a save taken at boot is restored', () => {
  const { sim } = buildMapWorld(options);
  const { sim: restored } = restoreMapWorld(options, exportSaveGame(sim, { mapId: 'child' }));
  restored.run(FIRST_PASS - 1);
  expect(restored.missionBriefingHistory()).toEqual([]);
  restored.step();
  expect(restored.events.current()).toContainEqual(OPENING);
});

it('keeps the script off under ?missions=off', () => {
  const { sim } = buildMapWorld({ ...options, missions: false });
  sim.run(FIRST_PASS);
  expect(sim.events.current()).not.toContainEqual(OPENING);
  expect(sim.missionBriefingHistory()).toEqual([]);
});

it('fires a scene briefing on the first pass, after the scene entry`s boot tick', () => {
  const sim = createSceneSim(presentationScene);
  const driver = new LockstepDriver({ sim, transport: new LoopbackTransport() });
  for (let tick = 1; tick < FIRST_PASS; tick++) driver.runTick();
  expect(sim.missionBriefingHistory()).toEqual([]);
  driver.runTick();
  expect(sim.events.current()).toContainEqual({
    kind: 'missionCutscene',
    mission: 0,
    page: BRIEFING_PAGE,
    replay: true,
  });
});
