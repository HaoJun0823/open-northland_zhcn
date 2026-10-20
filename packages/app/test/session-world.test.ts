import { type MapDiplomacy, MapScript } from '@open-northland/data';
import type { GameSession } from '@open-northland/lockstep';
import { components, FOG_MODE } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { buildMapWorld } from '../src/entries/map/world.js';
import { sessionWorldOptions } from '../src/game/session-world.js';
import { mapScriptWorld } from '../src/game/world/mission-script.js';

const SESSION: GameSession = {
  world: { kind: 'map', mapId: 'synthetic' },
  seed: 7,
  localSeat: 0,
  speed: 1,
  rules: { fog: FOG_MODE.CLASSIC, progression: null, needs: null, weather: null, alliedVision: true },
  seats: [
    { player: 0, mode: 'human', color: 0 },
    { player: 1, mode: 'human', color: 1 },
    { player: 2, mode: 'computer', color: 2 },
    { player: 3, mode: 'idle', color: 3 },
  ],
};

/** Players 0 and 1 allied by the map, both hostile to 2. */
const AUTHORED: readonly MapDiplomacy[] = [
  { from: 0, to: 1, state: 'friend' },
  { from: 1, to: 0, state: 'friend' },
  { from: 0, to: 2, state: 'enemy' },
];

describe('session world options', () => {
  it("carries the map's authored unit form to the world build", () => {
    expect(mapScriptWorld(MapScript.parse({ authoredForm: 'human' }), null).missions?.authoredForm).toBe(
      'human',
    );
    expect(mapScriptWorld(MapScript.parse({}), null).missions).toBeUndefined();
  });
  it('counts every roster seat the lobby left on the map, idle ones included, whatever decides', () => {
    const absent: GameSession = {
      ...SESSION,
      seats: [...SESSION.seats, { player: 4, mode: 'absent', color: 4 }],
    };
    expect(sessionWorldOptions(absent, null, {}).absentSeats).toEqual([4]);
    // Without a roster the session's played seats stand in: the humans and the AI, not the idle seat.
    expect(sessionWorldOptions(absent, null, {}).matchParticipants).toEqual([0, 1, 2]);
    const roster = [0, 1, 2, 3, 4, 5];
    const scripted = sessionWorldOptions(absent, null, { victory: 'script', participants: roster });
    expect(scripted.matchParticipants).toEqual([0, 1, 2, 3, 5]);
    const survivors = sessionWorldOptions(absent, null, {
      victory: 'goals',
      goals: [{ kind: 'lastStanding' }],
      participants: roster,
    });
    expect(survivors.matchParticipants).toEqual([0, 1, 2, 3, 5]);
  });

  it('hands the world the rules, allied vision among them', () => {
    expect(sessionWorldOptions(SESSION, null, {}).alliedVision).toBe(true);
  });

  it('joins the map allies into one fog mask under the rule', () => {
    const { sim } = buildMapWorld({
      map: { width: 2, height: 2, typeIds: [0, 0, 0, 0] },
      ir: null,
      seed: SESSION.seed,
      content: {},
      machineSeats: [],
      assistantSeats: [],
      ...SESSION.rules,
      diplomacy: AUTHORED,
    });
    sim.step();
    expect(components.diplomacyStance(sim.world, 0, 1)).toBe('friend');
    expect(sim.fog?.visionGroupOf(1)).toBe(0);
    expect(sim.fog?.visionGroupOf(2)).toBe(2);
  });
});
