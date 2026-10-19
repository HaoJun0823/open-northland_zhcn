import { parseBriefingBlocks } from '@open-northland/formats/hypertext';
import { describe, expect, it } from 'vitest';
import {
  type BriefingNode,
  briefingBody,
  normalizeWhitespace,
  tagGaps,
  takeRunEdges,
} from '../src/import/map-xml.js';

/** A block file authored for this test: blank lines and tags between paragraphs, framing whitespace. */
const BLOCK_FILE = [
  '[blockstart:start]\t',
  '<font:$local$\\fonts\\headline.fnt>',
  'DER BRUNNEN',
  '<font:$local$\\fonts\\body.fnt>',
  '',
  '<picture:$local$\\graphics\\well.pcx>',
  'Ein Satz.  ',
  '',
  'Zweiter Absatz.',
  '[blockend:start]',
  '',
  '[blockstart:icons]',
  'Ein Bild:',
  '<usericon:2,1><usericon:2,2>',
  'Ende.',
  '[blockend:icons]',
].join('\r\n');

/** Splits a block's raw content the way the localization repository stores it in its XML: text runs
 *  and tags, whitespace-only runs dropped. */
function storedNodes(content: string): BriefingNode[] {
  const nodes: BriefingNode[] = [];
  const parts = content.replace(/\r\n/g, '\n').split(/<(\w+):([^>]+)>/);
  for (let i = 0; i < parts.length; i += 3) {
    const text = parts[i] ?? '';
    if (text.trim() !== '') nodes.push({ kind: 'text', text });
    const name = parts[i + 1];
    const args = parts[i + 2];
    if (name !== undefined && args !== undefined) nodes.push({ kind: 'tag', name, args });
  }
  return nodes;
}

function rawContent(file: string, label: string): string {
  const start = `[blockstart:${label}]`;
  const from = file.indexOf(start) + start.length;
  return file.slice(from, file.indexOf(`[blockend:${label}]`, from));
}

describe('briefingBody', () => {
  it('rebuilds each block exactly when the source lends its tag gaps', () => {
    const blocks = parseBriefingBlocks(BLOCK_FILE);
    for (const label of ['start', 'icons']) {
      const source = blocks.get(label) ?? '';
      expect(briefingBody(storedNodes(rawContent(BLOCK_FILE, label)), tagGaps(source))).toBe(source);
    }
  });

  it('separates adjacent tags by a line end without gaps, equal once whitespace is normalised', () => {
    const source = parseBriefingBlocks(BLOCK_FILE).get('start') ?? '';
    const body = briefingBody(storedNodes(rawContent(BLOCK_FILE, 'start')));
    expect(body).toBe(
      '<font:$local$\\fonts\\headline.fnt>\nDER BRUNNEN\n<font:$local$\\fonts\\body.fnt>\n<picture:$local$\\graphics\\well.pcx>\nEin Satz.  \n\nZweiter Absatz.',
    );
    expect(normalizeWhitespace(body)).toBe(normalizeWhitespace(source));
  });

  it('ignores gaps that do not pair up with the adjacent tags', () => {
    const nodes: BriefingNode[] = [
      { kind: 'tag', name: 'font', args: 'a' },
      { kind: 'tag', name: 'font', args: 'b' },
    ];
    expect(briefingBody(nodes, ['\n\n', '\n'])).toBe('<font:a>\n<font:b>');
    expect(briefingBody(nodes, ['\n\n'])).toBe('<font:a>\n\n<font:b>');
  });

  it('ends the body at an end-tag line the stored run swallowed', () => {
    const nodes: BriefingNode[] = [{ kind: 'text', text: '\nLetzte Zeile.\n[blockend: 08]\n\n\n' }];
    expect(briefingBody(nodes)).toBe('Letzte Zeile.');
  });
});

describe('takeRunEdges', () => {
  const german: BriefingNode[] = [
    { kind: 'text', text: ' \nKOPF\n\n' },
    { kind: 'tag', name: 'usericon', args: '2,1' },
    { kind: 'text', text: '\nRumpf\n' },
  ];

  it('frames each translated run like the German run at its place and drops line-end spaces', () => {
    const padded: BriefingNode[] = [
      { kind: 'text', text: '\n\n\n头\n        ' },
      { kind: 'tag', name: 'usericon', args: '2,9' },
      { kind: 'text', text: '\n身  \n        \n尾\n\n        ' },
    ];
    expect(takeRunEdges(padded, german)).toEqual([
      { kind: 'text', text: ' \n头\n\n' },
      { kind: 'tag', name: 'usericon', args: '2,9' },
      { kind: 'text', text: '\n身\n\n尾\n' },
    ]);
  });

  it('refuses columns of another shape', () => {
    expect(takeRunEdges([{ kind: 'text', text: '头' }], german)).toBeUndefined();
    expect(
      takeRunEdges(
        [
          { kind: 'text', text: '头' },
          { kind: 'tag', name: 'picture', args: 'a.pcx' },
          { kind: 'text', text: '身' },
        ],
        german,
      ),
    ).toBeUndefined();
  });
});
