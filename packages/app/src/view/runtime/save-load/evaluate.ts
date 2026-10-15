import { parseSaveGame, SAVE_FORMAT_VERSION, SAVE_KIND, type SaveGame } from '@open-northland/sim';

import { saveDocumentOf } from './codec.js';

/** The live session identity a candidate save is checked against before the page leaves it. */
export interface LiveWorldIdentity {
  /** The entry's world token: the decoded map id, or `scene:<id>`; null for a tokenless world. */
  readonly worldToken: string | null;
  readonly mapFingerprint: string | null;
  readonly irVersion: number;
}

export type SaveRejection = 'corrupt' | 'incompatibleVersion' | 'wrongContent' | 'wrongMap';

export type EvaluatedSave =
  | { readonly ok: true; readonly save: SaveGame }
  | { readonly ok: false; readonly reason: SaveRejection };

export type EvaluatedDocument =
  | { readonly ok: true; readonly save: SaveGame }
  | { readonly ok: false; readonly reason: 'corrupt' | 'incompatibleVersion' };

/** Structure-only classification, for a load launched outside any running world (the main menu). */
export function evaluateSaveDocument(text: string): EvaluatedDocument {
  let raw: unknown;
  try {
    raw = saveDocumentOf(text);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  const header = headerOf(raw);
  if (header === null || header.kind !== SAVE_KIND) return { ok: false, reason: 'corrupt' };
  try {
    return { ok: true, save: parseSaveGame(raw) };
  } catch {
    // A real save from another format version is incompatible, not corrupt.
    const version = header.formatVersion;
    const unsupported = typeof version === 'number' && version !== SAVE_FORMAT_VERSION;
    return { ok: false, reason: unsupported ? 'incompatibleVersion' : 'corrupt' };
  }
}

/**
 * Classify a picked file against the running session, so a rejected file never navigates the page.
 * The next boot runs on the same served content, so the content version must match; a save of
 * another world launches into that world, and only one of this world must match its terrain.
 */
export function evaluateSaveFile(text: string, live: LiveWorldIdentity): EvaluatedSave {
  const evaluated = evaluateSaveDocument(text);
  if (!evaluated.ok) return evaluated;
  const save = evaluated.save;
  if (save.header.irVersion !== live.irVersion) return { ok: false, reason: 'wrongContent' };
  if (save.header.mapId === live.worldToken && save.header.mapFingerprint !== live.mapFingerprint)
    return { ok: false, reason: 'wrongMap' };
  return { ok: true, save };
}

function headerOf(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const header = (raw as Record<string, unknown>).header;
  if (typeof header !== 'object' || header === null || Array.isArray(header)) return null;
  return header as Record<string, unknown>;
}
