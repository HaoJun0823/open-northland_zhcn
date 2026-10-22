import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { UI_CUE_FILES } from '@open-northland/audio';
import {
  SOUND_BANKS_FILE,
  SOUND_QUALITIES,
  SoundBanksDocument,
  soundBankPath,
  soundClipPath,
} from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { contentDir, hasRealIr, loadContentUnderTest } from './helpers.js';

/** The subtree the `/sounds/` route serves; the IR's `file` values are relative to it. */
const SOUNDS_DIR = 'sounds';

function readBanks(): SoundBanksDocument {
  return SoundBanksDocument.parse(
    JSON.parse(readFileSync(resolve(contentDir(), SOUNDS_DIR, SOUND_BANKS_FILE), 'utf8')),
  );
}

/** The clips of `files` some quality cannot serve: a missing own file, or a span its bank lacks. */
function unservable(files: Iterable<string>): string[] {
  const banks = readBanks();
  const served = (file: string): boolean =>
    SOUND_QUALITIES.every((quality) => {
      const entry = banks.clips[file];
      const bank =
        entry === undefined
          ? undefined
          : resolve(contentDir(), SOUNDS_DIR, soundBankPath(entry.bank, quality));
      const span = entry?.spans[quality];
      return (
        existsSync(resolve(contentDir(), SOUNDS_DIR, soundClipPath(file, banks.extensions[quality]))) &&
        bank !== undefined &&
        span !== undefined &&
        existsSync(bank) &&
        span.offset + span.length <= statSync(bank).size
      );
    });
  return [...files].filter((file) => !served(file));
}

/**
 * Every clip the decoded sound bank names is a file and a bank span the same run wrote, in every
 * quality, so a sound the game asks for is never a 404. Skips without generated content (see
 * `helpers.ts`).
 */
describe.runIf(hasRealIr())('decoded sound bank', () => {
  it('names only clips the run encoded into the served sounds tree', async () => {
    const { real } = await loadContentUnderTest();
    const groups = [...real.sounds.staticGroups, ...real.sounds.ambient, ...real.sounds.jingles];
    const files = new Set(groups.flatMap((group) => group.sfx.map((sfx) => sfx.file)));
    expect(files.size).toBeGreaterThan(0);
    expect(unservable(files)).toEqual([]);
  });

  it('carries the clips the engine hardwires outside the bank: the clicks, the chat ring, the briefing and the quake', () => {
    expect(unservable(Object.values(UI_CUE_FILES))).toEqual([]);
  });

  it('names creature voices and weapon impacts the bank resolves', async () => {
    const { real } = await loadContentUnderTest();
    const groups = new Set(real.sounds.staticGroups.map((g) => g.name.toLowerCase()));
    const ids = new Set(real.sounds.staticGroups.map((g) => g.logicSoundType));
    expect(real.sounds.humanVoices.length).toBeGreaterThan(0);
    expect(real.sounds.animalCalls.length).toBeGreaterThan(0);
    const voiceGroups = real.sounds.humanVoices.flatMap((v) => [
      ...(v.scream === undefined ? [] : [v.scream]),
      ...(v.generic === undefined ? [] : [v.generic]),
      ...v.respondOk,
      ...v.respondNo,
    ]);
    const calls = real.sounds.animalCalls.map((c) => c.group);
    expect([...voiceGroups, ...calls].filter((name) => !groups.has(name.toLowerCase()))).toEqual([]);
    const weaponIds = real.weapons.flatMap((w) => [
      ...Object.values(w.hitSounds),
      ...Object.values(w.missSounds),
    ]);
    expect(weaponIds.length).toBeGreaterThan(0);
    expect(weaponIds.filter((id) => !ids.has(id))).toEqual([]);
  });
});
