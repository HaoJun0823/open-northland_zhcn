import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CifLine } from '@open-northland/formats/cif';

/** The named fixes to single mod files, one JSON file each; this package's AGENTS.md sets the rules. */
export const CORRECTIONS_DIR = fileURLToPath(new URL('../corrections/', import.meta.url));

/**
 * One whole line of the file replaced by the `to` lines, none deleting it; with `every`, each line
 * spelled like `from`. With `section`, only lines inside the `[...]` block holding the one line spelled
 * `section` count, for a line that repeats verbatim across records. `line` (1-based) names the one
 * line instead, which must read `from`; the pinned hash keeps the number stable.
 */
interface LineEdit {
  readonly from: string;
  /** The replacement lines as file bytes, one latin1 code unit per byte. */
  readonly to: readonly string[];
  readonly every: boolean;
  readonly section?: string;
  readonly line?: number;
}

/** A fix to the mod file `file`, applied only while its bytes still hash to `sha256`. */
export interface SourceCorrection {
  /** The correction's file name without `.json`. */
  readonly id: string;
  readonly reason: string;
  /** Mod-root-relative and `/`-separated, matched case-insensitively like every mod path. */
  readonly file: string;
  readonly sha256: string;
  /** Decoded CIF property lines; absent means the existing plaintext byte edits. */
  readonly format?: 'cif';
  /** The code page `from` lines are read and `to` lines written in; without one both are printable ASCII. */
  readonly encoding?: string;
  readonly lines: readonly LineEdit[];
}

/** One pipeline run's corrections, and which of them its reads applied. */
export interface SourceCorrections {
  readonly list: readonly SourceCorrection[];
  /** The bytes at `path`, with the correction naming that mod file applied. `file` names a source
   *  outside the data root by its map tree path instead, as a campaign map's files are. */
  read(path: string, file?: string): Promise<Uint8Array>;
  /** Correct decoded properties against the original bytes, before any map readers consume them. */
  correctCifLines(file: string, bytes: Uint8Array, lines: readonly CifLine[]): readonly CifLine[];
  /** Every correction the reads so far did not apply, and why; a run that read only part of the data
   *  filters it to the files it read. */
  unapplied(): readonly UnappliedCorrection[];
  /** Throws naming every correction the run did not apply, and why. */
  assertApplied(): void;
}

export interface UnappliedCorrection {
  readonly id: string;
  readonly file: string;
  readonly why: string;
}

const CORRECTION_KEYS = ['reason', 'file', 'sha256', 'format', 'encoding', 'lines'] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Script lines are printable ASCII, which the latin1 round trip keeps byte for byte. */
const SCRIPT_LINE = /^[\x20-\x7e]*$/;
/** A `from` line read through an encoding: anything but a line break. */
const DECODED_LINE = /^[^\r\n]*$/;

/**
 * Loads every `<id>.json` under `dir` against the mod at `dataRoot`. A missing directory holds no
 * corrections; a malformed file, or two corrections naming one mod file, throws.
 */
export async function loadSourceCorrections(dir: string, dataRoot: string): Promise<SourceCorrections> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  } catch {
    names = [];
  }
  const list: SourceCorrection[] = [];
  for (const name of names) {
    const id = basename(name, '.json');
    list.push(parseCorrection(id, JSON.parse(await readFile(join(dir, name), 'utf8'))));
  }
  const byFile = new Map<string, SourceCorrection>();
  for (const correction of list) {
    const key = correction.file.toLowerCase();
    const twin = byFile.get(key);
    if (twin !== undefined) {
      throw new Error(`corrections ${twin.id} and ${correction.id} both name ${correction.file}; merge them`);
    }
    byFile.set(key, correction);
  }

  const applied = new Set<string>();
  const failures = new Map<string, string>();
  const unapplied = (): UnappliedCorrection[] =>
    list
      .filter((correction) => !applied.has(correction.id))
      .map((correction) => ({
        id: correction.id,
        file: correction.file,
        why:
          failures.get(correction.id) ??
          'never read: the mod lacks the file, or its stage reads it without readSourceFile',
      }));
  return {
    list,
    unapplied,
    async read(path, file = relative(dataRoot, path).split(sep).join('/')) {
      const bytes = await readFile(path);
      const correction = byFile.get(file.toLowerCase());
      if (correction === undefined) return bytes;
      // A CIF read alone has applied nothing: its decoded properties are corrected by the map reader.
      if (correction.format === 'cif') return bytes;
      const corrected = applyCorrection(correction, bytes);
      if (typeof corrected === 'string') {
        failures.set(correction.id, corrected);
        return bytes;
      }
      applied.add(correction.id);
      return corrected;
    },
    correctCifLines(file, bytes, lines) {
      const correction = byFile.get(file.toLowerCase());
      if (correction?.format !== 'cif') return lines;
      const fail = (why: string): never => {
        applied.delete(correction.id);
        failures.set(correction.id, why);
        throw new Error(`correction ${correction.id} (${correction.file}): ${why}`);
      };
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== correction.sha256) fail(`the file changed (sha256 ${actual}); revisit the correction`);
      const edits = new Map<number, LineEdit>();
      for (const edit of correction.lines) {
        const index = (edit.line ?? 0) - 1;
        const source = lines[index];
        if (source?.level !== 2 || source.text !== edit.from)
          fail(`decoded line ${edit.line} is not the property "${edit.from}"`);
        if (edits.has(index)) fail(`two edits replace decoded line ${edit.line}`);
        edits.set(index, edit);
      }
      const corrected = lines.flatMap((line, index) => {
        const edit = edits.get(index);
        return edit === undefined ? [{ ...line }] : edit.to.map((text) => ({ level: 2, text }));
      });
      applied.add(correction.id);
      return corrected;
    },
    assertApplied() {
      const problems = unapplied().map(({ id, file, why }) => `${id} (${file}): ${why}`);
      if (problems.length > 0) {
        throw new Error(
          `corrections not applied; update or delete them in ${dir}:\n  ${problems.join('\n  ')}`,
        );
      }
    },
  };
}

/** The corrected bytes, or why the correction no longer fits the file. */
function applyCorrection(correction: SourceCorrection, bytes: Uint8Array): Uint8Array | string {
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== correction.sha256) {
    return `the file changed (sha256 ${actual}); check whether the mod now fixes it`;
  }
  // latin1 maps each byte to one code unit, so every untouched line keeps its exact bytes.
  const lines = Buffer.from(bytes).toString('latin1').split('\n');
  const edits = new Map<number, LineEdit>();
  const decoder = correction.encoding === undefined ? undefined : new TextDecoder(correction.encoding);
  const text = lines.map((line) => {
    const bare = line.replace(/\r$/, '');
    return decoder === undefined ? bare : decoder.decode(Buffer.from(bare, 'latin1'));
  });
  for (const edit of correction.lines) {
    if (edit.line !== undefined) {
      const index = edit.line - 1;
      if (text[index] !== edit.from) return `line ${edit.line} does not read "${edit.from}"`;
      if (edits.has(index)) return `two edits replace the line "${edit.from}"`;
      edits.set(index, edit);
      continue;
    }
    const range =
      edit.section === undefined ? { start: 0, end: text.length } : sectionAround(text, edit.section);
    if (typeof range === 'string') return range;
    const at: number[] = [];
    for (let i = range.start; i < range.end; i++) if (text[i] === edit.from) at.push(i);
    if (at.length === 0 || (at.length > 1 && !edit.every)) {
      const scope = edit.section === undefined ? '' : ` in the section of "${edit.section}"`;
      return `"${edit.from}" matches ${at.length} lines${scope} instead of one`;
    }
    for (const index of at) {
      if (edits.has(index)) return `two edits replace the line "${edit.from}"`;
      edits.set(index, edit);
    }
  }
  const corrected = lines.flatMap((line, index) => {
    const edit = edits.get(index);
    if (edit === undefined) return [line];
    const eol = line.endsWith('\r') ? '\r' : '';
    return edit.to.map((replacement) => `${replacement}${eol}`);
  });
  return Buffer.from(corrected.join('\n'), 'latin1');
}

/** The line range of the `[...]` block holding the one line spelled `anchor`, or why there is none. */
function sectionAround(text: readonly string[], anchor: string): { start: number; end: number } | string {
  const at = text.flatMap((line, i) => (line === anchor ? [i] : []));
  const [index] = at;
  if (index === undefined || at.length > 1)
    return `section "${anchor}" matches ${at.length} lines instead of one`;
  const isHeader = (line: string | undefined): boolean => line?.trimStart().startsWith('[') === true;
  let start = index;
  while (start > 0 && !isHeader(text[start])) start--;
  let end = index + 1;
  while (end < text.length && !isHeader(text[end])) end++;
  return { start, end };
}

function parseCorrection(id: string, raw: unknown): SourceCorrection {
  const fail = (why: string): never => {
    throw new Error(`correction ${id}: ${why}`);
  };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('not a JSON object');
  const record = raw as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((key) => !(CORRECTION_KEYS as readonly string[]).includes(key));
  if (unknownKey !== undefined) fail(`unknown key "${unknownKey}"`);
  const { reason, file, sha256, format, encoding, lines } = record;
  if (typeof reason !== 'string' || reason.trim() === '') return fail('reason must say why the fix exists');
  if (typeof file !== 'string' || file === '') return fail('file must name a mod file');
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) {
    return fail('sha256 must be the lower-case hex digest of the shipped file');
  }
  if (format !== undefined && format !== 'cif') return fail('"format" is "cif" or absent');
  if (format === 'cif' && encoding !== undefined)
    return fail('CIF property edits are ASCII, without "encoding"');
  if (encoding !== undefined && (typeof encoding !== 'string' || !keepsAsciiBytes(encoding))) {
    return fail('"encoding" is a TextDecoder label that reads ASCII bytes as ASCII, or absent');
  }
  if (!Array.isArray(lines) || lines.length === 0) return fail('lines must list at least one edit');
  const isLine = (value: unknown): value is string => typeof value === 'string' && SCRIPT_LINE.test(value);
  const isText = (value: unknown): value is string =>
    encoding === undefined ? isLine(value) : typeof value === 'string' && DECODED_LINE.test(value);
  const write = encoding === undefined ? (text: string) => text : codePageWriter(encoding);
  const edits = lines.map((edit: unknown): LineEdit => {
    if (typeof edit !== 'object' || edit === null) return fail('each line edit is an object');
    const { from, to, every, section, line } = edit as Record<string, unknown>;
    const target = isText(to) ? [to] : Array.isArray(to) && to.every(isText) ? to : undefined;
    if (!isText(from) || target === undefined) {
      return fail(
        'each line edit has a "from" line and a "to" line or list of lines, printable ASCII without "encoding"',
      );
    }
    const bytes: string[] = [];
    for (const text of target) {
      const written = write(text);
      if (written === undefined) return fail(`"${text}" has a character ${encoding} cannot write`);
      bytes.push(written);
    }
    if (every !== undefined && every !== true) return fail('"every" is true or absent');
    if (
      section !== undefined &&
      (typeof section !== 'string' || !SCRIPT_LINE.test(section) || section === '')
    ) {
      return fail('"section" is a printable-ASCII line or absent');
    }
    const lineNumber = typeof line === 'number' && Number.isInteger(line) && line >= 1 ? line : undefined;
    if (line !== undefined && (lineNumber === undefined || every !== undefined || section !== undefined)) {
      return fail('"line" is a 1-based line number, without "every" or "section"');
    }
    if (format === 'cif' && lineNumber === undefined) return fail('CIF edits require an explicit "line"');
    return {
      from,
      to: bytes,
      every: every === true,
      ...(section === undefined ? {} : { section }),
      ...(lineNumber === undefined ? {} : { line: lineNumber }),
    };
  });
  return {
    id,
    reason,
    file,
    sha256,
    ...(format === undefined ? {} : { format }),
    ...(encoding === undefined ? {} : { encoding }),
    lines: edits,
  };
}

/**
 * `text` as file bytes in the code page `label` (one latin1 code unit per byte), or undefined for a
 * character it has no byte for. UTF-8 is written as such; any other label is read as a single-byte page.
 */
function codePageWriter(label: string): (text: string) => string | undefined {
  const decoder = new TextDecoder(label);
  if (decoder.encoding === 'utf-8') return (text) => Buffer.from(text, 'utf8').toString('latin1');
  const byteOf = new Map<string, number>();
  for (let byte = 0; byte <= 0xff; byte++) {
    const char = decoder.decode(Uint8Array.of(byte));
    if (char.length === 1 && char !== '\ufffd' && !byteOf.has(char)) byteOf.set(char, byte);
  }
  return (text) => {
    let bytes = '';
    for (const char of text) {
      const byte = byteOf.get(char);
      if (byte === undefined) return undefined;
      bytes += String.fromCharCode(byte);
    }
    return bytes;
  };
}

/** Lines split at byte 0x0A and ASCII `to` lines written as single bytes need an ASCII-compatible code page. */
function keepsAsciiBytes(label: string): boolean {
  const ascii = Uint8Array.from({ length: 0x80 }, (_, byte) => byte);
  try {
    return new TextDecoder(label).decode(ascii) === String.fromCharCode(...ascii);
  } catch {
    return false;
  }
}
