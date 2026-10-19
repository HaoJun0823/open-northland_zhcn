/**
 * A reader for the plain XML the localization repository writes: elements, attributes, character data
 * and the predefined and numeric entities. Comments, CDATA, processing instructions other than the
 * declaration, and a doctype are refused rather than guessed at.
 */

export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  /** The element's own character data, child elements' excluded. */
  readonly text: string;
}

interface OpenElement {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly children: XmlElement[];
  text: string;
}

const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g;
const HEX_RADIX = 16;
const DECIMAL_RADIX = 10;
const DECLARATION = /^\s*<\?xml[^?]*\?>/;
const MARKUP = /<(\/?)([A-Za-z_][\w.-]*)((?:\s+[A-Za-z_][\w.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE = /([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function decodeEntities(raw: string): string {
  return raw.replace(ENTITY, (whole, name: string) => {
    if (name.startsWith('#x')) return String.fromCodePoint(Number.parseInt(name.slice(2), HEX_RADIX));
    if (name.startsWith('#')) return String.fromCodePoint(Number.parseInt(name.slice(1), DECIMAL_RADIX));
    const value = PREDEFINED_ENTITIES[name];
    if (value === undefined) throw new Error(`xml: unknown entity ${whole}`);
    return value;
  });
}

function close(open: OpenElement): XmlElement {
  return { name: open.name, attributes: open.attributes, children: open.children, text: open.text };
}

/** Parses one document into its root element; line ends read as `\n`, as XML prescribes. */
export function parseXml(source: string): XmlElement {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  let at = DECLARATION.exec(text)?.[0].length ?? 0;
  const stack: OpenElement[] = [];
  let root: XmlElement | undefined;
  while (at < text.length) {
    const lt = text.indexOf('<', at);
    const data = text.slice(at, lt < 0 ? text.length : lt);
    const parent = stack.at(-1);
    if (parent !== undefined) parent.text += decodeEntities(data);
    else if (data.trim() !== '') throw new Error('xml: character data outside the root element');
    if (lt < 0) break;
    MARKUP.lastIndex = lt;
    const tag = MARKUP.exec(text);
    if (tag === null) throw new Error(`xml: unsupported markup at offset ${lt}`);
    at = MARKUP.lastIndex;
    const [, closing, name = '', attributeText = '', selfClosing] = tag;
    if (closing === '/') {
      const open = stack.pop();
      if (open?.name !== name) throw new Error(`xml: </${name}> closes <${open?.name ?? 'nothing'}>`);
      const element = close(open);
      const outer = stack.at(-1);
      if (outer === undefined) root = element;
      else outer.children.push(element);
      continue;
    }
    if (root !== undefined) throw new Error('xml: more than one root element');
    const attributes: Record<string, string> = {};
    for (const [, key = '', double, single] of attributeText.matchAll(ATTRIBUTE)) {
      attributes[key] = decodeEntities(double ?? single ?? '');
    }
    const open: OpenElement = { name, attributes, children: [], text: '' };
    if (selfClosing === '/') {
      const outer = stack.at(-1);
      if (outer === undefined) root = close(open);
      else outer.children.push(close(open));
    } else {
      stack.push(open);
    }
  }
  if (stack.length > 0) throw new Error(`xml: <${stack.at(-1)?.name}> is never closed`);
  if (root === undefined) throw new Error('xml: no root element');
  return root;
}
