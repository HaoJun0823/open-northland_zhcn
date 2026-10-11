import { node } from '../dom.js';
import { foldText } from './query.js';

function plain<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * Catalogue descriptions as the upstream stores them: HTML-escaped text with the markdown the
 * authors typed. `**bold**`, `*italic*`, numbered lines, `- ` and `> ` lines (the authors use `>`
 * as a bullet), blank lines between paragraphs, single newlines as line breaks, bare URLs.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X'))
      return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(Number(body.slice(1)));
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const ORDERED_ITEM = /^\s*\d+[.)]\s+(.*)$/;
const BULLET_ITEM = /^\s*(?:[-•]|>)\s+(.*)$/;
/** A line that is one bold run and nothing else reads as a heading. */
const HEADING_LINE = /^\s*\*\*([^*]+)\*\*\s*$/;
/** Bold, italic and URLs, in one pass so a URL's `*` or an emphasis mark inside a URL stays put. */
const INLINE = /\*\*(?!\s)([^*\n]+?)(?<!\s)\*\*|\*(?!\s)([^*\n]+?)(?<!\s)\*|https?:\/\/[^\s<>"')\]]+/g;

type Block =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly lines: readonly string[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly items: readonly string[];
    };

function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', lines: paragraph });
    if (list !== null) blocks.push({ kind: 'list', ...list });
    paragraph = [];
    list = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      continue;
    }
    const heading = HEADING_LINE.exec(line);
    if (heading !== null) {
      flush();
      blocks.push({ kind: 'heading', text: heading[1] ?? '' });
      continue;
    }
    const ordered = ORDERED_ITEM.exec(line);
    const bullet = ordered === null ? BULLET_ITEM.exec(line) : null;
    const item = ordered ?? bullet;
    if (item !== null) {
      if (paragraph.length > 0 || (list !== null && list.ordered !== (ordered !== null))) flush();
      list ??= { ordered: ordered !== null, items: [] };
      list.items.push(item[1] ?? '');
      continue;
    }
    if (list !== null) flush();
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function inline(target: HTMLElement, text: string): void {
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const [whole, bold, italic] = match;
    if (match.index > at) target.append(text.slice(at, match.index));
    if (bold !== undefined) target.append(plain('strong', bold));
    else if (italic !== undefined) target.append(plain('em', italic));
    else {
      const link = plain('a', whole);
      link.href = whole;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      target.append(link);
    }
    at = match.index + whole.length;
  }
  if (at < text.length) target.append(text.slice(at));
}

function blockElement(block: Block): HTMLElement {
  switch (block.kind) {
    case 'heading': {
      const heading = node('h4', 'catalogue-desc__heading');
      inline(heading, block.text);
      return heading;
    }
    case 'paragraph': {
      const paragraph = node('p', 'catalogue-desc__paragraph');
      block.lines.forEach((line, index) => {
        if (index > 0) paragraph.append(plain('br'));
        inline(paragraph, line.trim());
      });
      return paragraph;
    }
    case 'list': {
      const list = node(block.ordered ? 'ol' : 'ul', 'catalogue-desc__list');
      for (const text of block.items) {
        const item = plain('li');
        inline(item, text);
        list.append(item);
      }
      return list;
    }
  }
}

const folded = (text: string): string => foldText(text).replace(/\s+/g, ' ').trim();

/** The description as block elements; empty for text without a visible character. A first block
 *  that only repeats the entry's `title` is left out. */
export function descriptionBlocks(raw: string, title?: string): HTMLElement[] {
  const blocks = blocksOf(decodeEntities(raw)).map(blockElement);
  const first = blocks[0];
  if (title !== undefined && first !== undefined && folded(first.textContent ?? '') === folded(title))
    blocks.shift();
  return blocks;
}
