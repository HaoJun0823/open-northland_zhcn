/**
 * `translations/glossary.csv` from the localization repository's `language_union.csv`: the term table
 * keeps the German, English and Polish names the Chinese ones were matched against, both Chinese
 * columns and the term's type, description and references; the other language columns are dropped.
 */

/** Our column, then the source header it comes from (`l10(...)` headers carry a note in brackets). */
const GLOSSARY_COLUMNS = [
  ['ger', 'ger'],
  ['eng', 'eng'],
  ['pol', 'pol'],
  ['chs', 'l10'],
  ['cht', 'l11'],
  ['type', 'META_TYPE'],
  ['description', 'META_DESCRIPTION'],
  ['references', 'META_REFERENCES'],
] as const;
const CHINESE_COLUMNS = ['chs', 'cht'] as const;

/** Splits RFC 4180 CSV: quoted fields may hold commas, quotes (doubled) and line ends. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^﻿/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function formatCsv(rows: readonly (readonly string[])[]): string {
  return `${rows.map((row) => row.map(csvField).join(',')).join('\n')}\n`;
}

function columnIndex(header: readonly string[], name: string): number {
  const index = header.findIndex((h) => h.trim() === name || h.trim().startsWith(`${name}(`));
  if (index < 0) throw new Error(`language_union.csv lacks a ${name} column`);
  return index;
}

/** The glossary rows, header first; a term with neither Chinese name is left out. */
export function glossaryFromLanguageUnion(csv: string): string[][] {
  const [header, ...rows] = parseCsv(csv);
  if (header === undefined) throw new Error('language_union.csv is empty');
  const indices = GLOSSARY_COLUMNS.map(([, source]) => columnIndex(header, source));
  const chinese = CHINESE_COLUMNS.map((name) => GLOSSARY_COLUMNS.findIndex(([ours]) => ours === name));
  const out: string[][] = [GLOSSARY_COLUMNS.map(([ours]) => ours)];
  for (const row of rows) {
    const picked = indices.map((index) => (row[index] ?? '').trim());
    if (chinese.every((index) => (picked[index] ?? '') === '')) continue;
    out.push(picked);
  }
  return out;
}
