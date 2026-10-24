import { afterEach, describe, expect, it, vi } from 'vitest';
import { libraryHead } from '../../ownership/test/support/memory-reader.js';
import { fileListReader } from '../src/entries/main-menu/original-game/browser-folder-reader.js';
import {
  type OriginalGameRecord,
  originalGameGate,
  readerCheck,
} from '../src/entries/main-menu/original-game/gate.js';
import {
  originalGameCheckEnabled,
  originalGameCheckOwed,
  originalGameRedirect,
} from '../src/view/original-game-check.js';
import { fakeShell } from './support/original-game-shell.js';

function pickedFile(relativePath: string, bytes: Uint8Array): File {
  const file = new File([new Uint8Array(bytes)], relativePath.split('/').at(-1) ?? relativePath);
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
}

const NOT_A_GAME = readerCheck(fileListReader([pickedFile('Photos/beach.jpg', new Uint8Array(8))]), 'Photos');
const AN_INSTALL = readerCheck(
  fileListReader([pickedFile('Cultures/DataX/Libs/data0001.lib', libraryHead())]),
  'Cultures',
);

describe('originalGameGate', () => {
  it('reports an unrecognized pick, then records the pass of a recognized one', async () => {
    let stored: OriginalGameRecord = {
      originalGameVerified: false,
      originalGameLabel: null,
      originalGameFolder: null,
    };
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
    // The synthetic library's size is in no release table, so the pass carries only the folder's name.
    expect(stored).toEqual({
      originalGameVerified: true,
      originalGameLabel: null,
      originalGameFolder: 'Cultures',
    });
  });
});

const OWED = async (): Promise<boolean> => true;

describe('originalGameRedirect', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends an unverified visitor of a game link to the menu, keeping language and sound', async () => {
    const params = new URLSearchParams('map=magiczny_las&player=0&lang=eng&sound=off');
    expect(await originalGameRedirect('map', params, OWED)).toBe('?lang=eng&sound=off');
    const forced = new URLSearchParams('map=magiczny_las&originalGameCheck');
    expect(await originalGameRedirect('map', forced, OWED)).toBe('?originalGameCheck=');
    expect(await originalGameRedirect('relay', new URLSearchParams('relay=ws://x'), OWED)).toBe('?');
  });

  it('leaves verified visitors and tooling entries alone', async () => {
    const params = new URLSearchParams('map=magiczny_las');
    expect(await originalGameRedirect('map', params, async () => false)).toBeNull();
    for (const route of ['scene', 'shot', 'anim', 'icons', 'sounds', 'menu'] as const) {
      expect(await originalGameRedirect(route, params, OWED)).toBeNull();
    }
  });

  it('owes the check only to a browser-served page without the flag', async () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } });
    expect(await originalGameCheckOwed({ originalGameVerified: false }, true, null)).toBe(true);
    expect(await originalGameCheckOwed({ originalGameVerified: true }, true, null)).toBe(false);
    expect(await originalGameCheckOwed({ originalGameVerified: false }, false, null)).toBe(false);
    vi.stubGlobal('window', { location: { protocol: 'app:' } });
    expect(await originalGameCheckOwed({ originalGameVerified: false }, true, null)).toBe(false);
  });

  it('asks the desktop shell, whose record outranks the stored flag', async () => {
    const owed = (required: boolean, verified: boolean) =>
      originalGameCheckOwed({ originalGameVerified: true }, false, fakeShell({ required, verified }));
    expect(await owed(true, false)).toBe(true);
    expect(await owed(true, true)).toBe(false);
    expect(await owed(false, false)).toBe(false);
  });

  it('checks every production page, and a dev page only when the URL asks for it', () => {
    expect(originalGameCheckEnabled('?lang=pl', true)).toBe(true);
    expect(originalGameCheckEnabled('?lang=pl', false)).toBe(false);
    expect(originalGameCheckEnabled('?lang=pl&originalGameCheck', false)).toBe(true);
  });
});
