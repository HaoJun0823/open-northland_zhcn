import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MapScript, mapLobbySlots } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { loadLobbyCompatibility } from '../../src/content/lobby-identity.js';
import { authoredVacantMode, vacantOffers } from '../../src/entries/main-menu/lobby/roster-state.js';
import { mapSession } from '../../src/game/session-url.js';
import { contentDir, hasRealIr } from './helpers.js';

describe.runIf(hasRealIr())('lobby identity over generated content', () => {
  it.each([
    ['polski_mlyn_1_1', 3],
    ['starozytny_trakt', 4],
  ] as const)('honors AI-only playeroption over the human roster default in %s', (mapId, player) => {
    const script = MapScript.parse(
      JSON.parse(readFileSync(join(contentDir(), 'maps', `${mapId}.script.json`), 'utf8')),
    );
    const roster = mapLobbySlots(script);
    const reserved = roster.find((slot) => slot.player === player);
    if (reserved === undefined) throw new Error('missing reserved slot');
    expect(reserved).toMatchObject({ type: 'human', claimable: false });
    expect(vacantOffers(reserved)).toEqual(['map-ai']);
    const session = mapSession(
      new URLSearchParams(`map=${mapId}&player=${player}&computer=${player}`),
      roster,
    );
    expect(session.localSeat).toBe('observer');
    expect(session.seats.find((seat) => seat.player === player)?.mode).toBe('map-ai');
  });

  it.each(['magiczny_las', 'smocza_kraina'])('reserves map AI for authored locked seats in %s', (mapId) => {
    const script = MapScript.parse(
      JSON.parse(readFileSync(join(contentDir(), 'maps', `${mapId}.script.json`), 'utf8')),
    );
    const visible = mapLobbySlots(script).filter((slot) => !slot.hidden);
    const open = visible.filter((slot) => slot.claimable);
    const reserved = visible.filter((slot) => !slot.claimable);
    expect(open.map((slot) => slot.player)).toEqual(
      mapId === 'magiczny_las' ? [0, 1, 2, 3, 4, 5] : [0, 1, 2],
    );
    expect(reserved.map((slot) => slot.player)).toEqual(mapId === 'magiczny_las' ? [] : [3, 4, 5]);
    for (const slot of open) {
      expect(vacantOffers(slot)).toEqual(['computer', 'idle', 'absent']);
      expect(authoredVacantMode(slot)).toBe('idle');
    }
    for (const slot of reserved) {
      expect(vacantOffers(slot)).toEqual(['map-ai']);
      expect(authoredVacantMode(slot)).toBe('map-ai');
    }
  });

  it('fingerprints both the owned IR and decoded map without exposing installation paths', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const path = String(input);
      try {
        const bytes = readFileSync(join(contentDir(), path));
        return new Response(bytes, { status: 200 });
      } catch {
        return new Response('', { status: 404 });
      }
    };
    const a = await loadLobbyCompatibility('magiczny_las', fetchImpl, 'test-build');
    const b = await loadLobbyCompatibility('magiczny_las', fetchImpl, 'test-build');
    expect(a).toEqual(b);
    expect(a.content).toMatch(/^[a-f0-9]{64}$/);
    expect(a.map).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(a)).not.toContain(contentDir());
  });
});
