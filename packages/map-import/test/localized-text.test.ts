import { describe, expect, it } from 'vitest';
import { resolveMapBriefing } from '../src/briefing.js';
import { loadMapStringTables } from '../src/meta.js';
import { testFolder } from './support/folder.js';

// Authored display text, written as source bytes rather than UTF-8. German 0x9C is œ in CP1252 but ś
// in CP1250, and Russian 0xA8 is Ё only in CP1251.
const TEXTS = [
  { lang: 'ger', bytes: 'Gr\xf6\xdfe \x9c', text: 'Größe œ' },
  { lang: 'rus', bytes: '\xa8\xe6', text: 'Ёж' },
] as const;

describe('localized map text', () => {
  it.each(TEXTS)('decodes $lang map tables and briefing includes', async ({ lang, bytes: raw, text }) => {
    const dir = testFolder();
    dir.write(`text/${lang}/strings.ini`, `[text]\nstringn 1 "${raw}"`);
    expect(loadMapStringTables(dir.folder)[lang]?.[1]).toBe(text);

    dir.write(`text/${lang}/briefings/briefings.txt`, `[blockstart:${raw}]\n${raw}\n[blockend:${raw}]`);
    dir.write(`text/${lang}/briefings/0500.hlt`, `<include:$local$\\briefings.txt,${raw},1>\n${raw}`);
    const resolved = await resolveMapBriefing(dir.folder, [500]);
    expect(resolved?.briefing.texts[lang]?.['500']).toEqual([
      { kind: 'text', style: 'body', text: `${text}\n${text}` },
    ]);
  });
});
