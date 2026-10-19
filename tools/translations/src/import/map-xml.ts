import { parseXml, type XmlElement } from './xml.js';

/**
 * One `Localization/map_xml/*.xml` file of CulturesGameLocalization: a map's string table and its
 * `briefings.txt` blocks, each in every language column the file carries. The repository's tools split
 * a block body at its `<name:args>` tags into nodes: a `<text>` element per text run and an element
 * named after the tag holding its arguments, dropping a run that is only whitespace.
 */
export interface LocalizationMap {
  /** MD5 of the `map.dat` the text belongs to, lower-case hex. */
  readonly mapMd5: string;
  readonly deprecated: boolean;
  /** Text by string id, then by language column. */
  readonly strings: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Nodes by block label, then by language column. */
  readonly briefings: ReadonlyMap<string, ReadonlyMap<string, readonly BriefingNode[]>>;
}

export type BriefingNode =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'tag'; readonly name: string; readonly args: string };

/** The language columns this import reads, by the code the XML gives them. */
export const SIMPLIFIED_COLUMN = 'CHN';
export const TRADITIONAL_COLUMN = 'l11';
export const GERMAN_COLUMN = 'ger';

const TEXT_ELEMENT = 'text';

function child(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((candidate) => candidate.name === name);
}

function children(element: XmlElement | undefined, name: string): XmlElement[] {
  return element?.children.filter((candidate) => candidate.name === name) ?? [];
}

function requiredAttribute(element: XmlElement, name: string): string {
  const value = element.attributes[name];
  if (value === undefined) throw new Error(`<${element.name}> lacks ${name}`);
  return value;
}

export function readLocalizationMap(xml: string): LocalizationMap {
  const root = parseXml(xml);
  if (root.name !== 'localization') throw new Error(`root is <${root.name}>, not <localization>`);
  const strings = new Map<string, Map<string, string>>();
  for (const string of children(child(root, 'strings'), 'string')) {
    const byColumn = new Map<string, string>();
    for (const text of children(string, TEXT_ELEMENT))
      byColumn.set(requiredAttribute(text, 'lang'), text.text);
    strings.set(requiredAttribute(string, 'id'), byColumn);
  }
  const briefings = new Map<string, Map<string, BriefingNode[]>>();
  for (const block of children(child(root, 'briefings'), 'block')) {
    const byColumn = new Map<string, BriefingNode[]>();
    for (const lang of children(block, 'lang')) {
      byColumn.set(
        requiredAttribute(lang, 'code'),
        lang.children.map(
          (node): BriefingNode =>
            node.name === TEXT_ELEMENT
              ? { kind: 'text', text: node.text }
              : { kind: 'tag', name: node.name, args: node.text },
        ),
      );
    }
    briefings.set(requiredAttribute(block, 'id'), byColumn);
  }
  return {
    mapMd5: requiredAttribute(root, 'map_md5').toLowerCase(),
    deprecated: root.attributes.deprecated === 'true',
    strings,
    briefings,
  };
}

/** A `<name:args>` tag, as the localization tools split block bodies at it. */
const TAG = /<(\w+):([^>]+)>/g;
const WHITESPACE_ONLY = /^\s*$/;
/** The separator the XML lost between two tags when the source gives none: one line end. */
const DEFAULT_TAG_GAP = '\n';

/**
 * The whitespace between each pair of adjacent tags of a block body, in order: the runs the XML drops.
 * A body rebuilt from nodes borrows them from the source block, keeping its blank lines between tags.
 */
export function tagGaps(body: string): string[] {
  const gaps: string[] = [];
  let previousEnd: number | undefined;
  for (const match of body.matchAll(TAG)) {
    if (previousEnd !== undefined) {
      const between = body.slice(previousEnd, match.index);
      if (WHITESPACE_ONLY.test(between)) gaps.push(between);
    }
    previousEnd = match.index + match[0].length;
  }
  return gaps;
}

/** Line-end and indentation whitespace at the edges of a text run; an ideographic space is text. */
const RUN_LEADING = /^[ \t\r\n]*/;
const RUN_TRAILING = /[ \t\r\n]*$/;
const LINE_TRAILING_SPACE = /[ \t]+$/gm;

function sameShape(a: readonly BriefingNode[], b: readonly BriefingNode[]): boolean {
  return (
    a.length === b.length &&
    a.every((node, i) => {
      const other = b[i];
      return (
        node.kind === other?.kind &&
        (node.kind === 'text' || (other.kind === 'tag' && node.name === other.name))
      );
    })
  );
}

/**
 * `nodes` with each text run framed by the whitespace that frames the run at the same place in
 * `reference`, the German column of the same block, and without the spaces that end its lines: the
 * translated runs carry the XML writer's indentation and extra line ends, which a block included line
 * by line would show as blank lines. Undefined when the two columns differ in shape.
 */
export function takeRunEdges(
  nodes: readonly BriefingNode[],
  reference: readonly BriefingNode[],
): readonly BriefingNode[] | undefined {
  if (!sameShape(nodes, reference)) return undefined;
  return nodes.map((node, i): BriefingNode => {
    const model = reference[i];
    if (node.kind !== 'text' || model?.kind !== 'text') return node;
    const leading = RUN_LEADING.exec(model.text)?.[0] ?? '';
    const trailing = WHITESPACE_ONLY.test(model.text) ? '' : (RUN_TRAILING.exec(model.text)?.[0] ?? '');
    const core = node.text
      .replace(RUN_LEADING, '')
      .replace(RUN_TRAILING, '')
      .replace(LINE_TRAILING_SPACE, '');
    return { kind: 'text', text: `${leading}${core}${trailing}` };
  });
}

/**
 * `nodes` with each tag's arguments taken from `source`, when their tags name the same tags in the same
 * order: an overlay keeps the source's markup. Undefined when the tags do not line up; `retagged` says
 * whether any argument changed.
 */
export function adoptSourceTags(
  nodes: readonly BriefingNode[],
  source: string,
): { readonly nodes: readonly BriefingNode[]; readonly retagged: boolean } | undefined {
  const sourceTags = [...source.matchAll(TAG)].map(([, name = '', args = '']) => ({ name, args }));
  const tags = nodes.filter((node) => node.kind === 'tag');
  if (tags.length !== sourceTags.length || tags.some((tag, i) => tag.name !== sourceTags[i]?.name))
    return undefined;
  let next = 0;
  let retagged = false;
  const adopted = nodes.map((node): BriefingNode => {
    if (node.kind === 'text') return node;
    const args = sourceTags[next++]?.args ?? node.args;
    if (args !== node.args) retagged = true;
    return { ...node, args };
  });
  return { nodes: adopted, retagged };
}

function adjacentTagPairs(nodes: readonly BriefingNode[]): number {
  let pairs = 0;
  for (let i = 1; i < nodes.length; i++)
    if (nodes[i]?.kind === 'tag' && nodes[i - 1]?.kind === 'tag') pairs++;
  return pairs;
}

/** A line the original reads as the block's end; the repository's tools miss one with a space in it. */
const BLOCK_END_LINE = /^\[blockend:[^\]]+\]/m;

/**
 * A block body in `briefings.txt` syntax from its nodes: text runs as they stand, tags as
 * `<name:args>`, and between two adjacent tags the gap `gaps` lends when it has one per pair, else a
 * line end. The framing a block file adds is dropped as `parseBriefingBlocks` drops it: a blank first
 * line (the rest of the start-tag line), everything from an end-tag line on, and a blank last line (the
 * line the end tag opens).
 */
export function briefingBody(nodes: readonly BriefingNode[], gaps: readonly string[] = []): string {
  const lend = gaps.length === adjacentTagPairs(nodes);
  let gap = 0;
  let body = '';
  let previous: BriefingNode | undefined;
  for (const node of nodes) {
    if (node.kind === 'text') {
      body += node.text;
    } else {
      if (previous?.kind === 'tag') body += (lend ? gaps[gap++] : undefined) ?? DEFAULT_TAG_GAP;
      body += `<${node.name}:${node.args}>`;
    }
    previous = node;
  }
  const firstBreak = body.indexOf('\n');
  if (firstBreak >= 0 && WHITESPACE_ONLY.test(body.slice(0, firstBreak))) body = body.slice(firstBreak + 1);
  const end = BLOCK_END_LINE.exec(body);
  if (end !== null) body = body.slice(0, end.index);
  const lastBreak = body.lastIndexOf('\n');
  if (lastBreak >= 0 && WHITESPACE_ONLY.test(body.slice(lastBreak + 1))) body = body.slice(0, lastBreak);
  return body;
}

/** Whether any text run of a block carries more than whitespace. */
export function hasText(nodes: readonly BriefingNode[]): boolean {
  return nodes.some((node) => node.kind === 'text' && !WHITESPACE_ONLY.test(node.text));
}

/** Collapses whitespace runs and drops whitespace between tags, the runs the XML cannot carry. */
export function normalizeWhitespace(body: string): string {
  return body.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
}
