import type { MapLanguageText } from '@open-northland/map-import';
import { stringMarkupDiffers } from '../markup.js';
import {
  adoptSourceTags,
  briefingBody,
  GERMAN_COLUMN,
  hasText,
  type LocalizationMap,
  normalizeWhitespace,
  tagGaps,
  takeRunEdges,
} from './map-xml.js';

/** One language column of a localization map, keyed as our basis text keys it. */
export interface MapTranslation {
  readonly strings: Record<string, string>;
  readonly briefings: Record<string, string>;
  /** Translated ids and labels our basis text lacks, left out. */
  readonly unknown: readonly string[];
  /** Entries whose goal prefix, placeholders or tag names differ from the basis text, left out. */
  readonly markupMismatches: readonly string[];
  /** Blocks whose tag arguments differed from the basis text and were taken from it. */
  readonly retagged: readonly string[];
  /** Blocks shaped unlike the XML's German column, whose text runs keep their own edge whitespace. */
  readonly unframed: readonly string[];
}

/** The basis string of an XML id; an id spelled other than its number (`07`) names none. */
function basisString(basis: MapLanguageText, id: string): string | undefined {
  const number = Number(id);
  return String(number) === id ? basis.strings[number] : undefined;
}

function isBlank(text: string | undefined): boolean {
  return text === undefined || text.trim() === '';
}

/**
 * Takes one language column of `map` for the ids and labels `basis` carries: strings verbatim, block
 * bodies rebuilt in `briefings.txt` syntax with the German column's run edges and the basis block's tag
 * arguments and tag gaps. Empty entries, and entries that would not keep the basis markup, are left
 * out, so the reader falls back to the source text for them.
 */
export function translateMap(map: LocalizationMap, column: string, basis: MapLanguageText): MapTranslation {
  const strings: Record<string, string> = {};
  const briefings: Record<string, string> = {};
  const unknown: string[] = [];
  const markupMismatches: string[] = [];
  const retagged: string[] = [];
  const unframed: string[] = [];
  for (const [id, byColumn] of map.strings) {
    const text = byColumn.get(column);
    if (text === undefined || isBlank(text)) continue;
    const source = basisString(basis, id);
    if (source === undefined) {
      unknown.push(`string ${id}`);
      continue;
    }
    if (stringMarkupDiffers(source, text)) markupMismatches.push(`string ${id}`);
    else strings[id] = text;
  }
  for (const [label, byColumn] of map.briefings) {
    const nodes = byColumn.get(column);
    if (nodes === undefined || !hasText(nodes)) continue;
    const source = basis.briefings.get(label);
    if (source === undefined) {
      unknown.push(`block ${label}`);
      continue;
    }
    const framed = takeRunEdges(nodes, byColumn.get(GERMAN_COLUMN) ?? []);
    if (framed === undefined) unframed.push(`block ${label}`);
    const adopted = adoptSourceTags(framed ?? nodes, source);
    if (adopted === undefined) {
      markupMismatches.push(`block ${label}`);
      continue;
    }
    briefings[label] = briefingBody(adopted.nodes, tagGaps(source));
    if (adopted.retagged) retagged.push(`block ${label}`);
  }
  return { strings, briefings, unknown, markupMismatches, retagged, unframed };
}

/** How the XML's German column compares with our basis text: the proof the body rebuild is sound. */
export interface GermanRoundTrip {
  readonly strings: {
    readonly total: number;
    readonly equal: number;
    /** Ids whose German differs from ours, or that we lack. */
    readonly mismatches: readonly string[];
    /** Ids our German has and the XML lacks, which keep our German in every overlay. */
    readonly untranslated: readonly string[];
  };
  readonly blocks: {
    readonly total: number;
    /** Rebuilt bodies equal to ours character for character. */
    readonly exact: number;
    /** Rebuilt bodies equal to ours once whitespace is normalised. */
    readonly normalized: number;
    /** Labels whose rebuilt body differs from ours even after normalising, or that we lack. */
    readonly mismatches: readonly string[];
  };
}

export function germanRoundTrip(map: LocalizationMap, basis: MapLanguageText): GermanRoundTrip {
  let stringTotal = 0;
  let stringEqual = 0;
  const stringMismatches: string[] = [];
  for (const [id, byColumn] of map.strings) {
    const text = byColumn.get(GERMAN_COLUMN);
    if (isBlank(text)) continue;
    stringTotal++;
    if (basisString(basis, id) === text) stringEqual++;
    else stringMismatches.push(id);
  }
  const untranslated = Object.keys(basis.strings).filter((id) => !map.strings.has(id));
  let blockTotal = 0;
  let exact = 0;
  let normalized = 0;
  const mismatches: string[] = [];
  for (const [label, byColumn] of map.briefings) {
    const nodes = byColumn.get(GERMAN_COLUMN);
    if (nodes === undefined || !hasText(nodes)) continue;
    blockTotal++;
    const source = basis.briefings.get(label);
    if (source === undefined) {
      mismatches.push(label);
      continue;
    }
    const body = briefingBody(nodes, tagGaps(source));
    if (body === source) exact++;
    if (normalizeWhitespace(body) === normalizeWhitespace(source)) normalized++;
    else mismatches.push(label);
  }
  return {
    strings: { total: stringTotal, equal: stringEqual, mismatches: stringMismatches, untranslated },
    blocks: { total: blockTotal, exact, normalized, mismatches },
  };
}
