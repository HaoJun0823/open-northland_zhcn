import {
  BOB_ATLASES_PATH,
  BobAtlasSet,
  bobAtlasManifest,
  type ServedBobAtlas,
  servedBobAtlas,
} from '@open-northland/data';
import type { AtlasManifest } from '@open-northland/render';
import { diag } from '../diag/log.js';
import { fetchJsonOrNull } from './net.js';

let atlasSet: Promise<BobAtlasSet | null> | null = null;

/**
 * Every stem's atlas manifest (`bobs/atlases.json`), fetched once per page. `null` when it is absent or
 * does not match this build; an absent one is fetched again by the next caller.
 */
export function loadBobAtlasSet(): Promise<BobAtlasSet | null> {
  atlasSet ??= fetchJsonOrNull<unknown>(`/${BOB_ATLASES_PATH}`).then((raw) => {
    if (raw === null) {
      atlasSet = null;
      return null;
    }
    const parsed = BobAtlasSet.safeParse(raw);
    if (parsed.success) return parsed.data;
    diag.warn('content', `/${BOB_ATLASES_PATH} does not match this build; run the pipeline again`);
    return null;
  });
  return atlasSet;
}

/** A stem's sheet and frame geometry, or `null` when the stem or the document is not served. */
export async function loadServedBobAtlas(stem: string): Promise<ServedBobAtlas | null> {
  const set = await loadBobAtlasSet();
  return (set === null ? undefined : servedBobAtlas(set, stem)) ?? null;
}

/** A stem's manifest with its frames decoded, or `null` when the stem or the document is not served. */
export async function loadAtlasManifest(stem: string): Promise<AtlasManifest | null> {
  const set = await loadBobAtlasSet();
  return (set === null ? undefined : bobAtlasManifest(set, stem)) ?? null;
}
