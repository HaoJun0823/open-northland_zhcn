import {
  MapScript,
  mapLobbySlots,
  type TerrainMapFile,
  WERESNAKE_TRIBE,
  WEREWOLF_TRIBE,
} from '@open-northland/data';
import { applyInitialSaveSeats } from '@open-northland/lockstep';
import { components, exportSaveGame, type World } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { buildMapWorld } from '../src/entries/map/world.js';
import { buildRelayedMapWorld } from '../src/entries/map/world-inputs.js';
import { mapSession, sessionSearch } from '../src/game/session-url.js';
import { sessionWorldOptions } from '../src/game/session-world.js';
import { mapScriptWorld } from '../src/game/world/mission-script.js';

const map: TerrainMapFile = { width: 8, height: 8, typeIds: new Array<number>(64).fill(0) };

/** Whether the seat's scripted handler is on. */
function scripted(world: World, player: number): boolean {
  const carrier = components.aiPlayerEntity(world, player);
  return carrier !== null && world.get(carrier, components.AiPlayer).scripted;
}

it('seats the strategic AI as the map’s [AIData] toggles say', () => {
  const { sim } = buildMapWorld({
    seed: 3,
    map,
    ir: null,
    content: {},
    aiSeats: [1, 2, 3, 4],
    assistantSeats: [],
    fog: null,
    progression: null,
    needs: null,
    alliedVision: null,
    script: {
      ai: [
        {
          player: 2,
          disabled: false,
          strategicOff: [...components.AI_MODULE_IDS],
          conditions: [],
          tasks: [],
        },
        { player: 3, disabled: true, strategicOff: [], conditions: [], tasks: [] },
        { player: 4, disabled: false, strategicOff: ['military'], conditions: [], tasks: [] },
      ],
    },
  });
  sim.step();
  const { world } = sim;
  // No row: the full strategic player.
  expect(components.aiModuleRuns(world, 1, 'military')).toBe(true);
  // HAI_Disable: still a computer seat, running no strategic module.
  expect(components.isAiPlayer(world, 2)).toBe(true);
  expect(components.AI_MODULE_IDS.some((id) => components.aiModuleRuns(world, 2, id))).toBe(false);
  // AI_Disable: still a computer seat (the needs rules read that), running neither handler.
  expect(components.isAiPlayer(world, 3)).toBe(true);
  expect(scripted(world, 3)).toBe(false);
  expect(components.AI_MODULE_IDS.some((id) => components.aiModuleRuns(world, 3, id))).toBe(false);
  expect(scripted(world, 2)).toBe(true);
  // One module off, the rest on.
  expect(components.aiModuleRuns(world, 4, 'military')).toBe(false);
  expect(components.aiModuleRuns(world, 4, 'houseBuild')).toBe(true);
});

it('gives a monster tribe’s computer seat the scripted handler alone', () => {
  // Original behavior: a `PLAYER_TYPE_AI` seat always gets the scripted handler, and the strategic
  // one only when its tribe is neither weresnake nor werewolf, whatever `[AIData]` says.
  const { sim } = buildMapWorld({
    seed: 3,
    map,
    ir: null,
    content: {},
    aiSeats: [1, 2],
    assistantSeats: [],
    fog: null,
    progression: null,
    needs: null,
    alliedVision: null,
    playerRoster: [
      { player: 1, type: 'ai', tribeId: WERESNAKE_TRIBE, colorId: 1 },
      { player: 2, type: 'ai', tribeId: WEREWOLF_TRIBE, colorId: 2 },
    ],
    script: { ai: [{ player: 1, disabled: false, strategicOff: [], conditions: [], tasks: [] }] },
  });
  sim.step();
  const { world } = sim;
  for (const seat of [1, 2]) {
    expect(scripted(world, seat)).toBe(true);
    expect(components.AI_MODULE_IDS.some((id) => components.aiModuleRuns(world, seat, id))).toBe(false);
  }
});

it('starts the assistant grants for the seats a person or the strategic AI plays, never a scripted camp', () => {
  // A seat running no strategic module is the map's scripted camp.
  const PERSON = 0;
  const STRATEGIC = 1;
  const SCRIPTED_CAMP = 2;
  const DISABLED = 3;
  const { sim } = buildMapWorld({
    seed: 3,
    map,
    ir: null,
    content: {},
    aiSeats: [STRATEGIC, SCRIPTED_CAMP, DISABLED],
    assistantSeats: [PERSON, STRATEGIC, SCRIPTED_CAMP, DISABLED],
    fog: null,
    progression: null,
    needs: null,
    alliedVision: null,
    script: {
      ai: [
        {
          player: SCRIPTED_CAMP,
          disabled: false,
          strategicOff: [...components.AI_MODULE_IDS],
          conditions: [],
          tasks: [],
        },
        { player: DISABLED, disabled: true, strategicOff: [], conditions: [], tasks: [] },
      ],
    },
  });
  sim.step();
  const granted = new Set<number>();
  for (const e of sim.world.query(components.AssistantGrants)) {
    const { player, goods } = sim.world.get(e, components.AssistantGrants);
    if (goods.length > 0) granted.add(player);
  }
  expect([...granted].sort((a, b) => a - b)).toEqual([PERSON, STRATEGIC]);
});

it('round-trips Script, AI and Idle into distinct world control', () => {
  const script = MapScript.parse({
    players: [0, 1, 2, 3].map((player) => ({ player, type: 'ai', tribeId: 1, colorId: player })),
    multiplayer: { slotOptions: [0, 1, 2, 3].map((player) => ({ player, allowed: ['human', 'ai'] })) },
    ai: [
      { player: 0, disabled: false, strategicOff: ['military'], conditions: [], tasks: [] },
      { player: 1, disabled: true, strategicOff: [], conditions: [], tasks: [] },
      { player: 2, disabled: true, strategicOff: [], conditions: [], tasks: [] },
    ],
  });
  const roster = mapLobbySlots(script);
  const session = mapSession(new URLSearchParams('map=synthetic&player=observer&ai=1&idle=3&seed=7'), roster);
  expect(session.seats.map((seat) => seat.mode)).toEqual(['script', 'ai', 'script', 'idle']);
  expect(mapSession(sessionSearch(session, roster), roster)).toEqual(session);
  const world = mapScriptWorld(script, null);
  const { sim } = buildMapWorld({
    seed: 7,
    map,
    ir: null,
    content: {},
    playerRoster: script.players,
    script: world,
    ...sessionWorldOptions(session, script, world),
  });
  expect(components.aiModuleRuns(sim.world, 0, 'military')).toBe(false);
  expect(components.aiModuleRuns(sim.world, 0, 'houseBuild')).toBe(true);
  expect(components.AI_MODULE_IDS.every((id) => components.aiModuleRuns(sim.world, 1, id))).toBe(true);
  expect(scripted(sim.world, 1)).toBe(true);
  expect(components.AI_MODULE_IDS.some((id) => components.aiModuleRuns(sim.world, 2, id))).toBe(false);
  expect(scripted(sim.world, 2)).toBe(false);
  expect(components.isAiPlayer(sim.world, 3)).toBe(false);
});

it('applies saved-room Script and AI transitions while preserving unchanged dynamic switches', () => {
  const script = MapScript.parse({
    players: [0, 1, 2, 3].map((player) => ({
      player,
      type: 'ai',
      tribeId: 1,
      colorId: player,
    })),
    multiplayer: { slotOptions: [0, 1, 2, 3].map((player) => ({ player, allowed: ['human', 'ai'] })) },
    ai: [0, 1, 2, 3].map((player) => ({
      player,
      disabled: true,
      strategicOff: [],
      conditions: [],
      tasks: [],
    })),
  });
  const roster = mapLobbySlots(script);
  // Seat 0 becomes full AI, seat 1 becomes Script, seat 2 stays Script, seat 3 wakes from Idle.
  const previous = mapSession(new URLSearchParams('map=test&seed=3&player=observer&ai=1&idle=3'), roster);
  const boot = { map, ir: null, script, content: null, session: previous, missions: null, saveText: null };
  const original = buildRelayedMapWorld(boot, null).sim;
  original.step();
  original.enqueueSetup({ kind: 'setPlayerAi', player: 2, enabled: true });
  original.step();
  const save = exportSaveGame(original, { mapId: 'test', entry: `?${sessionSearch(previous, roster)}` });
  const next = {
    ...mapSession(new URLSearchParams('map=test&seed=3&player=observer&ai=0'), roster),
    initialSave: { tick: save.header.tick, fingerprint: 'a'.repeat(64) },
  };
  const restored = buildRelayedMapWorld({ ...boot, session: next }, save);
  applyInitialSaveSeats(restored.sim, next, restored.initialSeatSetups);
  restored.sim.step();
  expect(components.aiModuleRuns(restored.sim.world, 0, 'military')).toBe(true);
  expect(scripted(restored.sim.world, 0)).toBe(true);
  for (const player of [1, 3]) {
    expect(components.isAiPlayer(restored.sim.world, player)).toBe(true);
    expect(components.aiModuleRuns(restored.sim.world, player, 'military')).toBe(false);
    expect(scripted(restored.sim.world, player)).toBe(false);
  }
  expect(components.aiModuleRuns(restored.sim.world, 2, 'military')).toBe(true);
});
