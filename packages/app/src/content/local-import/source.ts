import { MAP_FINGERPRINT } from '@open-northland/data';
import { isMapId } from '../transfer/documents.js';
import type { LocalMapInput } from './input.js';

export const LOCAL_SOURCE_VERSION = 1;

export interface LocalSourceRecord {
  readonly kind: 'local-source';
  readonly version: typeof LOCAL_SOURCE_VERSION;
  readonly entryId: string;
  readonly name: string;
  /** Hash of the retained input, including text and pictures, independent of IR_VERSION. */
  readonly fingerprint: string;
  readonly size: number;
  /** Kept across reconversion so a save still names the same map. */
  readonly maps: readonly { readonly folder: string; readonly mapId: string }[];
}

export interface RetainedLocalSource {
  readonly record: LocalSourceRecord;
  readonly input: LocalMapInput;
}

export function localSourceRecord(raw: unknown): LocalSourceRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    r.kind !== 'local-source' ||
    r.version !== LOCAL_SOURCE_VERSION ||
    typeof r.entryId !== 'string' ||
    !isMapId(r.entryId) ||
    !r.entryId.startsWith('user-') ||
    typeof r.name !== 'string' ||
    r.name === '' ||
    typeof r.fingerprint !== 'string' ||
    !MAP_FINGERPRINT.test(r.fingerprint) ||
    typeof r.size !== 'number' ||
    !Number.isSafeInteger(r.size) ||
    r.size < 0 ||
    !Array.isArray(r.maps) ||
    r.maps.length === 0
  )
    return null;
  const maps: { folder: string; mapId: string }[] = [];
  for (const rawMap of r.maps) {
    if (typeof rawMap !== 'object' || rawMap === null) return null;
    const map = rawMap as Record<string, unknown>;
    if (
      typeof map.folder !== 'string' ||
      typeof map.mapId !== 'string' ||
      !isMapId(map.mapId) ||
      !map.mapId.startsWith(`${r.entryId}-`) ||
      maps.some((item) => item.mapId === map.mapId)
    )
      return null;
    maps.push({ folder: map.folder, mapId: map.mapId });
  }
  return {
    kind: 'local-source',
    version: LOCAL_SOURCE_VERSION,
    entryId: r.entryId,
    name: r.name,
    fingerprint: r.fingerprint,
    size: r.size,
    maps,
  };
}
