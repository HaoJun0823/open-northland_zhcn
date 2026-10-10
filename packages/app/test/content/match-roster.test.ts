import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MapScript, mapLobbySlots } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { neverDiesSeats } from '../../src/game/match-participants.js';
import { mapSession } from '../../src/game/session-url.js';
import { sessionWorldOptions } from '../../src/game/session-world.js';
import { type AuthoredJoinRows, mapScriptWorld } from '../../src/game/world/index.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

function corpusScripts(): { id: string; script: MapScript }[] {
  const dir = resolve(contentDir(), 'maps');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.script.json'))
    .map((name) => ({
      id: name.slice(0, -'.script.json'.length),
      script: MapScript.parse(JSON.parse(readFileSync(resolve(dir, name), 'utf8'))),
    }))
    .filter(({ script }) => script.players.length > 0);
}

describe.runIf(hasRealIr())('match roster over the decoded corpus', () => {
  it('declares every in-use seat but the never-dying ones on every map with a roster', () => {
    const ir = rawIrUnderTest() as AuthoredJoinRows;
    const mismatched = corpusScripts().flatMap(({ id, script }) => {
      const session = mapSession(new URLSearchParams(`map=${id}&seed=1`), mapLobbySlots(script));
      const declared = sessionWorldOptions(session, script, mapScriptWorld(script, ir)).matchParticipants;
      const exempt = neverDiesSeats(script);
      const inUse = script.players.map((slot) => slot.player).filter((seat) => !exempt.includes(seat));
      return declared.join() === inUse.sort((a, b) => a - b).join() ? [] : [`${id}: ${declared} vs ${inUse}`];
    });
    expect(mismatched).toEqual([]);
  });
});
