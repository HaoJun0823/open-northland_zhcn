// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { decodeEntities, descriptionBlocks } from '../src/entries/main-menu/catalogue/description.js';

const html = (raw: string): string =>
  descriptionBlocks(raw)
    .map((block) => block.outerHTML)
    .join('');

describe('decodeEntities', () => {
  it('preserves out-of-range numeric entities without breaking the description', () => {
    const invalid = '&#1114112; &#x110000; &#999999999999999999999999999999999999999;';
    expect(decodeEntities(invalid)).toBe(invalid);
    expect(descriptionBlocks(`Opis ${invalid}`)[0]?.textContent).toBe(`Opis ${invalid}`);
  });

  it('decodes the named and numeric entities the upstream escapes', () => {
    expect(decodeEntities('&quot;Trudny wyb&oacute;r&quot; &#39;x&#39; &amp; &gt; &#92; &#x41; &nbsp;')).toBe(
      '"Trudny wyb&oacute;r" \'x\' & > \\ A \u00a0',
    );
  });

  it('decodes text the upstream escaped more than once', () => {
    expect(decodeEntities('test tak zwanej &amp;quot;Massive War&amp;quot;')).toBe('test tak zwanej "Massive War"');
    expect(decodeEntities('Emil &amp;amp;amp;amp; Mikulus, D&amp;#39;uppa')).toBe("Emil & Mikulus, D'uppa");
  });
});

describe('descriptionBlocks', () => {
  it('renders bold-only lines as headings, numbered and quoted lines as lists, and bold inline', () => {
    const raw = [
      '**Legenda**',
      '',
      '1. Zawartość pliku',
      '2. Instalacja',
      '',
      '**1. Zawartość pliku**',
      'Archiwum zawiera mapy w formacie *.DAT.',
      '&gt; multiplayer - dla trybu &quot;Wolnej gry&quot;,',
      '&gt; singleplayer - z **fabułą**.',
    ].join('\r\n');
    expect(html(raw)).toBe(
      '<h4 class="catalogue-desc__heading">Legenda</h4>' +
        '<ol class="catalogue-desc__list"><li>Zawartość pliku</li><li>Instalacja</li></ol>' +
        '<h4 class="catalogue-desc__heading">1. Zawartość pliku</h4>' +
        '<p class="catalogue-desc__paragraph">Archiwum zawiera mapy w formacie *.DAT.</p>' +
        '<ul class="catalogue-desc__list"><li>multiplayer - dla trybu "Wolnej gry",</li>' +
        '<li>singleplayer - z <strong>fabułą</strong>.</li></ul>',
    );
  });

  it('keeps single newlines as line breaks, italics inline and bare URLs as links', () => {
    const raw =
      'To jest *przerobiona* mapka "Trudny wybór 1.0"\nWersja PL i ENG.\n\nhttps://example.test/a?b=1 koniec';
    expect(html(raw)).toBe(
      '<p class="catalogue-desc__paragraph">To jest <em>przerobiona</em> mapka "Trudny wybór 1.0"<br>Wersja PL i ENG.</p>' +
        '<p class="catalogue-desc__paragraph"><a href="https://example.test/a?b=1" target="_blank" rel="noopener noreferrer">https://example.test/a?b=1</a> koniec</p>',
    );
  });

  it('never builds markup out of the text itself', () => {
    expect(html('<script>alert(1)</script> &lt;b&gt;x&lt;/b&gt;')).toBe(
      '<p class="catalogue-desc__paragraph">&lt;script&gt;alert(1)&lt;/script&gt; &lt;b&gt;x&lt;/b&gt;</p>',
    );
  });

  it('drops a first block that only repeats the entry title, ignoring case, marks and diacritics', () => {
    const raw = '**GROBOWIEC  krola**\n\nOpis mapy.';
    expect(html(raw)).toContain('Grobowiec'.toUpperCase());
    expect(descriptionBlocks(raw, 'Grobowiec Króla').map((block) => block.textContent)).toEqual([
      'Opis mapy.',
    ]);
    expect(descriptionBlocks('Grobowiec Króla 2\n\nOpis.', 'Grobowiec Króla')).toHaveLength(2);
    expect(descriptionBlocks('Opis.\n\nGrobowiec Króla', 'Grobowiec Króla')).toHaveLength(2);
  });

  it('gives nothing for blank text', () => {
    expect(descriptionBlocks(' \r\n\n ')).toEqual([]);
  });
});
