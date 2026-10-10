import { afterEach, describe, expect, it, vi } from 'vitest';
import { libraryHead } from '../../original-check/test/memory-reader.js';
import { fileListReader } from '../src/entries/main-menu/original-game/browser-folder-reader.js';
import {
  installLabel,
  type OriginalGameRecord,
  originalGameGate,
} from '../src/entries/main-menu/original-game/gate.js';
import { originalGameCheckOwed, originalGameRedirect } from '../src/view/original-game-check.js';

function pickedFile(relativePath: string, bytes: Uint8Array): File {
  const file = new File([new Uint8Array(bytes)], relativePath.split('/').at(-1) ?? relativePath);
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

const NOT_A_GAME = fileListReader([pickedFile('Photos/beach.jpg', new Uint8Array(8))]);
const AN_INSTALL = fileListReader([pickedFile('Cultures/DataX/Libs/data0001.lib', libraryHead())]);

describe('originalGameGate', () => {
  it('reports an unrecognized pick, then records the pass of a recognized one', async () => {
    let stored: OriginalGameRecord = { originalGameVerified: false, originalGameLabel: null };
    const gate = originalGameGate(async (record) => {
      stored = { ...stored, ...record };
    });
    expect(gate.status).toBe('asking');

    expect(await gate.check(NOT_A_GAME)).toBe('notRecognized');
    expect(stored.originalGameVerified).toBe(false);

    // A cancelled pick leaves the failure line up.
    expect(await gate.check(undefined)).toBe('notRecognized');

    const checked = gate.check(AN_INSTALL);
    expect(gate.status).toBe('checking');
    expect(await checked).toBe('verified');
    // The synthetic library's size is in no release table, so the pass carries no label.
    expect(stored).toEqual({ originalGameVerified: true, originalGameLabel: null });
  });

  it('labels a known release with its title and edition', () => {
    expect(installLabel({ path: [], layout: 'library', game: 'northland', edition: 'PL' })).toBe(
      'Cultures: Northland (PL)',
    );
    expect(installLabel({ path: [], layout: 'loose', game: undefined, edition: undefined })).toBeNull();
  });
});

describe('originalGameRedirect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends an unverified visitor of a game link to the menu, keeping language and sound', () => {
    const params = new URLSearchParams('map=magiczny_las&player=0&lang=eng&sound=off');
    expect(originalGameRedirect('map', params, () => true)).toBe('?lang=eng&sound=off');
    expect(originalGameRedirect('relay', new URLSearchParams('relay=ws://x'), () => true)).toBe('?');
  });

  it('leaves verified visitors and tooling entries alone', () => {
    const params = new URLSearchParams('map=magiczny_las');
    expect(originalGameRedirect('map', params, () => false)).toBeNull();
    for (const route of ['scene', 'shot', 'anim', 'icons', 'sounds', 'menu'] as const) {
      expect(originalGameRedirect(route, params, () => true)).toBeNull();
    }
  });

  it('owes the check only to a browser-served page without the flag', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    expect(originalGameCheckOwed({ originalGameVerified: false })).toBe(true);
    expect(originalGameCheckOwed({ originalGameVerified: true })).toBe(false);
    vi.stubGlobal('window', { location: { protocol: 'app:' } });
    expect(originalGameCheckOwed({ originalGameVerified: false })).toBe(false);
  });
});
