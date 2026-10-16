import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PLAYER_COLORS } from '@open-northland/formats/player-palette';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleBmdBytes } from '../../../packages/formats/test/fixtures/bmd.js';
import { samplePcx } from '../../../packages/formats/test/fixtures/pcx.js';
import { convertPlayerPaletteAtlases } from '../src/stages/player-colors.js';
import { indexSourceAssets } from '../src/stages/source-files.js';
import { makeTempDir } from './support/game-tree.js';

const CREATURES = 'Data/engine2d/bin/palettes/creatures';
const GUIDEPOST_BMD = 'Data/engine2d/bin/bobs/ls_guidepost.bmd';

const tempCleanups: Array<() => Promise<void>> = [];

describe('convertPlayerPaletteAtlases', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempCleanups.splice(0).map((c) => c()));
  });

  it('bakes the guidepost for every player when the heart sheet is in no source layer', async () => {
    const { path, cleanup } = await makeTempDir('player-colors');
    tempCleanups.push(cleanup);
    const put = async (rel: string, bytes: Uint8Array): Promise<void> => {
      await mkdir(dirname(join(path, rel)), { recursive: true });
      await writeFile(join(path, rel), bytes);
    };
    await put(GUIDEPOST_BMD, sampleBmdBytes());
    for (const color of PLAYER_COLORS) {
      if (color.source.kind === 'pcx') await put(`${CREATURES}/${color.source.file}`, samplePcx().bytes);
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const emitted = await convertPlayerPaletteAtlases(path, await indexSourceAssets({ data: path }));

    expect(emitted).toBe(PLAYER_COLORS.length);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ls_gui_bubbles.bmd'));
  });
});
