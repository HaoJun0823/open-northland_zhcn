/** One `"key" "value"` or `"key" { ... }` pair of Steam's KeyValues text (`.vdf`, `.acf`). */
export interface VdfNode {
  readonly key: string;
  readonly value: string | readonly VdfNode[];
}

type Token = { readonly kind: 'string'; readonly text: string } | { readonly kind: 'open' | 'close' };

const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', '\\': '\\', '"': '"' };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at] ?? '';
    if (/\s/.test(char)) {
      at += 1;
    } else if (text.startsWith('//', at)) {
      const end = text.indexOf('\n', at);
      at = end === -1 ? text.length : end;
    } else if (char === '{' || char === '}') {
      tokens.push({ kind: char === '{' ? 'open' : 'close' });
      at += 1;
    } else if (char === '"') {
      let value = '';
      at += 1;
      while (at < text.length && text[at] !== '"') {
        const next = text[at + 1];
        if (text[at] === '\\' && next !== undefined && ESCAPES[next] !== undefined) {
          value += ESCAPES[next];
          at += 2;
        } else {
          value += text[at];
          at += 1;
        }
      }
      tokens.push({ kind: 'string', text: value });
      at += 1;
    } else {
      // Unquoted tokens and conditionals like `[$WIN32]` run to the next blank or brace.
      const match = /^[^\s{}"]+/.exec(text.slice(at));
      const word = match?.[0] ?? char;
      if (!word.startsWith('[')) tokens.push({ kind: 'string', text: word });
      at += word.length;
    }
  }
  return tokens;
}

/** Tolerant: a truncated or unbalanced file yields the pairs read before the damage. */
export function parseVdf(text: string): readonly VdfNode[] {
  const tokens = tokenize(text);
  let at = 0;
  function block(): VdfNode[] {
    const nodes: VdfNode[] = [];
    while (at < tokens.length) {
      const token = tokens[at];
      if (token === undefined || token.kind === 'close') {
        at += 1;
        return nodes;
      }
      at += 1;
      if (token.kind !== 'string') continue;
      const value = tokens[at];
      if (value === undefined) return nodes;
      at += 1;
      if (value.kind === 'string') nodes.push({ key: token.text, value: value.text });
      else if (value.kind === 'open') nodes.push({ key: token.text, value: block() });
      else return nodes;
    }
    return nodes;
  }
  return block();
}

function sameKey(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The children of the first block named `key` at this level; keys match in any case, as Steam's do. */
export function vdfBlock(nodes: readonly VdfNode[], key: string): readonly VdfNode[] | undefined {
  for (const node of nodes) {
    if (sameKey(node.key, key) && typeof node.value !== 'string') return node.value;
  }
  return undefined;
}

export function vdfString(nodes: readonly VdfNode[], key: string): string | undefined {
  for (const node of nodes) {
    if (sameKey(node.key, key) && typeof node.value === 'string') return node.value;
  }
  return undefined;
}

/** Every string value named `key`, at any depth. */
export function vdfStringsDeep(nodes: readonly VdfNode[], key: string): string[] {
  const found: string[] = [];
  for (const node of nodes) {
    if (typeof node.value === 'string') {
      if (sameKey(node.key, key)) found.push(node.value);
    } else {
      found.push(...vdfStringsDeep(node.value, key));
    }
  }
  return found;
}
