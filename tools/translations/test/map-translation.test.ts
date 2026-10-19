import { MapOverlay, OVERLAY_VERSION } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { MapSourceText } from '../src/import/map-source-text.js';
import { germanRoundTrip, translateMap } from '../src/import/map-translation.js';
import { readLocalizationMap, SIMPLIFIED_COLUMN, TRADITIONAL_COLUMN } from '../src/import/map-xml.js';

/** A localization XML authored for this test, in the shape the localization repository writes. */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<localization version="1.3" map_id="probe_map" export_map_id="probe_map" map_md5="0123456789ABCDEF0123456789abcdef" IsC2M="false" deprecated="false">
  <languages>
    <language code="CHN" alias="l10" encoding="GB2312" fix_1251="true" base="false" />
    <language code="ger" alias="ger" encoding="windows-1252" fix_1251="false" base="false" />
    <language code="l11" alias="l11" encoding="utf-8" fix_1251="false" base="false" />
  </languages>
  <strings>
    <string id="0">
      <text lang="CHN">@找到水井！</text>
      <text lang="ger">@FINDE DEN BRUNNEN!</text>
      <text lang="l11">@找到水井！</text>
    </string>
    <string id="1">
      <text lang="CHN">木桶 %d/5 &amp; 更多</text>
      <text lang="ger">Fässer %d/5 &amp; mehr</text>
      <text lang="l11" />
    </string>
    <string id="7">
      <text lang="CHN">多余的</text>
      <text lang="ger">Überzählig</text>
      <text lang="l11">多餘的</text>
    </string>
  </strings>
  <briefings>
    <block id="intro">
      <lang code="CHN">
        <text>


井边的村子
        </text>
        <usericon>2,9</usericon>
        <text>
　今天下雨。  

        </text>
      </lang>
      <lang code="ger">
        <text>
DAS DORF AM BRUNNEN

</text>
        <usericon>2,1</usericon>
        <text>

Heute regnet es.
</text>
      </lang>
      <lang code="l11">
        <text />
        <usericon>2,1</usericon>
        <text />
      </lang>
    </block>
  </briefings>
</localization>
`;

const BASIS: MapSourceText = {
  strings: { '0': '@FINDE DEN BRUNNEN!', '1': 'Fässer %d/5 & mehr', '2': 'Nur bei uns' },
  briefings: { intro: 'DAS DORF AM BRUNNEN\n\n<usericon:2,1>\n\nHeute regnet es.' },
};

describe('readLocalizationMap', () => {
  it('reads the map identity, every string column and the block nodes', () => {
    const map = readLocalizationMap(XML);
    expect(map.mapMd5).toBe('0123456789abcdef0123456789abcdef');
    expect(map.deprecated).toBe(false);
    expect(map.strings.get('1')?.get('ger')).toBe('Fässer %d/5 & mehr');
    expect(map.strings.get('1')?.get(TRADITIONAL_COLUMN)).toBe('');
    expect(map.briefings.get('intro')?.get('ger')).toEqual([
      { kind: 'text', text: '\nDAS DORF AM BRUNNEN\n\n' },
      { kind: 'tag', name: 'usericon', args: '2,1' },
      { kind: 'text', text: '\n\nHeute regnet es.\n' },
    ]);
  });

  it('refuses markup outside the plain dialect', () => {
    expect(() => readLocalizationMap('<localization><!-- note --></localization>')).toThrow(
      /unsupported markup/,
    );
    expect(() => readLocalizationMap('<localization><strings></localization>')).toThrow(/closes <strings>/);
  });
});

describe('translateMap', () => {
  it('keeps goal prefixes and placeholders, skips empty and unknown entries, and frames blocks like ours', () => {
    const translation = translateMap(readLocalizationMap(XML), SIMPLIFIED_COLUMN, BASIS);
    expect(translation.strings).toEqual({ '0': '@找到水井！', '1': '木桶 %d/5 & 更多' });
    // Run edges come from the German column, tag arguments from our German block; the ideographic
    // space that indents the second run is text and stays.
    expect(translation.briefings).toEqual({ intro: '井边的村子\n\n<usericon:2,1>\n\n　今天下雨。' });
    expect(translation.unknown).toEqual(['string 7']);
    expect(translation.retagged).toEqual(['block intro']);
    expect(translation.markupMismatches).toEqual([]);
    const overlay = MapOverlay.parse({
      version: OVERLAY_VERSION,
      map: 'probe_map',
      basis: { lang: 'ger', digest: '0'.repeat(64) },
      strings: translation.strings,
      briefings: translation.briefings,
    });
    expect(overlay.strings['1']).toBe('木桶 %d/5 & 更多');
  });

  it('leaves out a block whose text runs are all empty', () => {
    const translation = translateMap(readLocalizationMap(XML), TRADITIONAL_COLUMN, BASIS);
    expect(translation.strings).toEqual({ '0': '@找到水井！' });
    expect(translation.briefings).toEqual({});
  });

  it('leaves out a translated string whose goal prefix or placeholders differ from ours', () => {
    const basis: MapSourceText = { ...BASIS, strings: { ...BASIS.strings, '0': 'FINDE DEN BRUNNEN!' } };
    const translation = translateMap(readLocalizationMap(XML), SIMPLIFIED_COLUMN, basis);
    expect(translation.markupMismatches).toEqual(['string 0']);
    expect(translation.strings['0']).toBeUndefined();
  });
});

describe('germanRoundTrip', () => {
  it('compares the German column with our text, exactly and after normalising whitespace', () => {
    const roundTrip = germanRoundTrip(readLocalizationMap(XML), BASIS);
    expect(roundTrip.strings).toEqual({ total: 3, equal: 2, mismatches: ['7'], untranslated: ['2'] });
    expect(roundTrip.blocks).toEqual({ total: 1, exact: 1, normalized: 1, mismatches: [] });
  });
});
