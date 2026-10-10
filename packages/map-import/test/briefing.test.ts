import { DecodeLimitError } from '@open-northland/formats/limit';
import { encodePcx } from '@open-northland/formats/pcx';
import { describe, expect, it } from 'vitest';
import { rampPalette } from '../../formats/test/fixtures/palette.js';
import { cutsceneIdsOf, resolveMapBriefing } from '../src/briefing.js';
import { type TestFolder, testFolder } from './support/folder.js';

/**
 * The per-folder briefing resolution (`briefing.ts`): each cutscene id reads its `NNNN.hlt` page,
 * which includes its text from `briefings.txt`, per language; the pictures those pages name are
 * converted once, and a folder without briefings yields no sidecar. Fixtures are ASCII; the renderer
 * itself is pinned in the formats package's `hypertext.test.ts`.
 */

/** The page a map ships for one block: `<block:2>` and the text colour, then the block's lines. */
function hltPage(label: string): string {
  return `<block:2>\r\n<color:$local$\\palettes\\font_dark.pcx>\r\n<include:$local$\\briefings.txt,${label},1>`;
}

function writeBriefings(dir: TestFolder, lang: string, files: Record<string, string>): void {
  for (const [name, body] of Object.entries(files)) dir.write(`text/${lang}/briefings/${name}`, body);
}

describe('cutsceneIdsOf', () => {
  it('collects the PlayCutscene ids over every mission, ascending and unique', () => {
    const ids = cutsceneIdsOf({
      missions: [
        { goals: [], other: [], results: [{ key: 'result', values: ['PlayCutscene', '501', '1'] }] },
        {
          goals: [],
          other: [],
          results: [
            { key: 'result', values: ['PlayCutscene', '0', '1'] },
            { key: 'result', values: ['MissionWon', '0'] },
            { key: 'result', values: ['PlayCutscene', '501', '1'] },
            { key: 'result', values: ['PlayCutscene', 'x', '1'] },
          ],
        },
      ],
    });
    expect(ids).toEqual([0, 501]);
  });

  it('matches the verb in any case, as the sim plays it', () => {
    const ids = cutsceneIdsOf({
      missions: [
        {
          goals: [],
          other: [],
          results: [
            { key: 'result', values: ['PlayCutScene', '508', '1'] },
            { key: 'result', values: ['Playcutscene', '530', '1'] },
          ],
        },
      ],
    });
    expect(ids).toEqual([508, 530]);
  });
});

describe('resolveMapBriefing', () => {
  it('renders each id from its NNNN.hlt page, per language, and skips an id without one', async () => {
    const dir = testFolder();
    writeBriefings(dir, 'pol', {
      'briefings.txt':
        '[blockstart:500]\n<font:$local$\\fonts\\fonthead16bld.fnt>\nTYTUL\n<font:$local$\\fonts\\font12.fnt>\nTresc\n[blockend:500]\n' +
        '[blockstart:00_title]\nPROLOG\n[blockend:00_title]\n',
      '0000.hlt': '<font:$local$\\fonts\\fonthead16bld.fnt>\n<include:$local$\\briefings.txt,00_title,1>\n',
      '0500.hlt': hltPage('500'),
    });
    writeBriefings(dir, 'eng', {
      'briefings.txt': '[blockstart:500]\nTITLE\n[blockend:500]\n',
    });
    const resolved = await resolveMapBriefing(dir.folder, [0, 500, 777]);
    expect(resolved?.pictures.size).toBe(0);
    expect(resolved?.briefing).toEqual({
      texts: {
        pol: {
          '0': [{ kind: 'text', style: 'title', text: 'PROLOG' }],
          '500': [
            { kind: 'blank', lines: 1 },
            { kind: 'text', style: 'title', text: 'TYTUL', align: 'center' },
            { kind: 'blank', lines: 1 },
            { kind: 'text', style: 'body', text: 'Tresc', align: 'center' },
          ],
        },
      },
    });
  });

  it('emits each named picture once and points both languages at the same file', async () => {
    const dir = testFolder();
    const block = '[blockstart:500]\nOpis\n<picture:$local$\\graphics\\Map.pcx>\n[blockend:500]\n';
    for (const lang of ['pol', 'eng']) {
      writeBriefings(dir, lang, { 'briefings.txt': block, '0500.hlt': hltPage('500') });
      dir.write(
        `text/${lang}/briefings/Graphics/map.pcx`,
        encodePcx({ width: 3, height: 2, pixels: new Uint8Array(6).fill(4), palette: rampPalette() }),
      );
    }
    const resolved = await resolveMapBriefing(dir.folder, [500]);
    const briefing = resolved?.briefing;
    const pictures = [...(resolved?.pictures.keys() ?? [])];
    const [pol, eng] = [briefing?.texts.pol?.['500']?.[1], briefing?.texts.eng?.['500']?.[1]];
    expect(pictures).toHaveLength(1);
    expect(pol).toEqual({ kind: 'picture', file: pictures[0], width: 3, height: 2 });
    expect(eng).toEqual(pol);
  });

  it('throws the decoder limit for a picture over maxPixels instead of warning past it', async () => {
    const dir = testFolder();
    const block = '[blockstart:500]\nOpis\n<picture:$local$\\graphics\\Map.pcx>\n[blockend:500]\n';
    writeBriefings(dir, 'pol', { 'briefings.txt': block, '0500.hlt': hltPage('500') });
    const pixels = new Uint8Array(6).fill(4);
    dir.write(
      'text/pol/briefings/Graphics/map.pcx',
      encodePcx({ width: 3, height: 2, pixels, palette: rampPalette() }),
    );
    await expect(resolveMapBriefing(dir.folder, [500], pixels.length - 1)).rejects.toThrow(DecodeLimitError);
    expect((await resolveMapBriefing(dir.folder, [500], pixels.length))?.pictures.size).toBe(1);
  });

  it('yields undefined with no ids, no briefings folder, or no resolvable page', async () => {
    const dir = testFolder();
    expect(await resolveMapBriefing(dir.folder, [])).toBeUndefined();
    expect(await resolveMapBriefing(dir.folder, [500])).toBeUndefined();
    writeBriefings(dir, 'pol', { 'briefings.txt': '[blockstart:500]\nx\n[blockend:500]\n' });
    expect(await resolveMapBriefing(dir.folder, [500])).toBeUndefined();
  });
});
