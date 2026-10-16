import type { MapAiSeat } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { exportSaveGame, parseSaveGame, restoreSimulation, Simulation } from '../../src/index.js';
import type { MissionScript } from '../../src/systems/missions/index.js';
import { testContent } from '../fixtures/content.js';

const missions: MissionScript = {
  missions: [
    {
      active: true,
      visible: false,
      successfullIf: 0,
      goals: [{ opcode: 'TimeGone', seconds: 1 }],
      results: [{ opcode: 'PlayCutscene', cutscene: 500, replay: true }],
    },
  ],
};
const mapAiScript: readonly MapAiSeat[] = [
  {
    player: 2,
    allDisabled: false,
    computerDisabled: true,
    disabledComputerModules: [],
    conditions: [{ kind: 'onTime', slot: 0, ticks: 12 }],
    tasks: [
      {
        kind: 'changeDiplomacy',
        priority: 5,
        condition: 0,
        player: 3,
        state: 3,
      },
    ],
  },
];

function saved(sim: Simulation) {
  return parseSaveGame(JSON.parse(JSON.stringify(exportSaveGame(sim))));
}

describe('save program identity', () => {
  it('rejects changed mission arguments with the same number of records', () => {
    const sim = new Simulation({ seed: 7, content: testContent(), missions });
    sim.enqueueSetup({ kind: 'setMissionsEnabled', enabled: true });
    sim.run(1);
    const save = saved(sim);
    for (const changed of [
      {
        ...missions,
        missions: missions.missions.map((m) => ({
          ...m,
          goals: [{ opcode: 'TimeGone' as const, seconds: 2 }],
        })),
      },
      {
        ...missions,
        missions: missions.missions.map((m) => ({
          ...m,
          results: [{ opcode: 'PlayCutscene' as const, cutscene: 501, replay: true }],
        })),
      },
    ]) {
      expect(() => restoreSimulation(save, { content: sim.content, missions: changed })).toThrow(
        /missionScriptFingerprint/,
      );
    }
    // Identical definitions with independently constructed objects and different key insertion order.
    const clone: MissionScript = {
      missions: missions.missions.map((m) => ({
        results: m.results.map((r) => ({ ...r })),
        goals: m.goals.map((g) => ({ ...g })),
        successfullIf: m.successfullIf,
        visible: m.visible,
        active: m.active,
      })),
    };
    const restored = restoreSimulation(save, {
      content: sim.content,
      missions: clone,
    });
    sim.run(180);
    restored.run(180);
    expect(sim.missionBriefingHistory()).toEqual([500]);
    expect(restored.missionBriefingHistory()).toEqual([500]);
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('rejects same-shaped map AI condition and task changes before its first turn', () => {
    const sim = new Simulation({
      seed: 7,
      content: testContent(),
      mapAiScript,
    });
    const save = saved(sim);
    const row = mapAiScript[0];
    if (row === undefined) throw new Error('missing fixture row');
    for (const changed of [
      [
        {
          ...row,
          conditions: [{ kind: 'onTime' as const, slot: 0, ticks: 24 }],
        },
      ],
      [
        {
          ...row,
          tasks: [
            {
              kind: 'changeDiplomacy' as const,
              priority: 5,
              condition: 0,
              player: 3,
              state: 2,
            },
          ],
        },
      ],
    ]) {
      expect(() => restoreSimulation(save, { content: sim.content, mapAiScript: changed })).toThrow(
        /mapAiScriptFingerprint/,
      );
    }
    const restored = restoreSimulation(save, {
      content: sim.content,
      mapAiScript: JSON.parse(JSON.stringify(mapAiScript)),
    });
    expect(restored.hashState()).toBe(sim.hashState());
  });

  it('requires exact program presence even before any program state initializes', () => {
    const content = testContent();
    const bare = saved(new Simulation({ seed: 7, content }));
    const missionSave = saved(new Simulation({ seed: 7, content, missions }));
    const aiSave = saved(new Simulation({ seed: 7, content, mapAiScript }));
    expect(() => restoreSimulation(missionSave, { content })).toThrow(/missionScriptFingerprint/);
    expect(() => restoreSimulation(aiSave, { content })).toThrow(/mapAiScriptFingerprint/);
    expect(() => restoreSimulation(bare, { content, missions: { missions: [] } })).toThrow(
      /missionScriptFingerprint/,
    );
    expect(() => restoreSimulation(bare, { content, mapAiScript: [] })).toThrow(/mapAiScriptFingerprint/);
  });
});
