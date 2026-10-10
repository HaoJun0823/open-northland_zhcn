import type { RoomView } from '@open-northland/net-protocol';
import { diag } from '../../diag/log.js';
import { installAnnouncedCatalogMap } from '../map-source/install.js';
import { mapFetch } from '../map-source/sources.js';
import { loadMapList } from '../maps-index.js';
import { loadPersistedMap } from './cache.js';
import { mapDeliveryAllowed } from './codec.js';
import { loadVerifiedMapDocuments, type VerifiedMapDocuments } from './documents.js';

async function localMapDocuments(mapId: string): Promise<VerifiedMapDocuments | null> {
  return loadVerifiedMapDocuments(mapId, await mapFetch(mapId));
}

export async function loadRoomMapDocuments(
  room: RoomView,
  services: {
    readonly local?: (mapId: string) => Promise<VerifiedMapDocuments | null>;
    readonly cached?: typeof loadPersistedMap;
    readonly list?: typeof loadMapList;
    readonly catalog?: typeof installAnnouncedCatalogMap;
  } = {},
): Promise<VerifiedMapDocuments | null> {
  if (room.settings.world.kind !== 'map') return null;
  const mapId = room.settings.world.mapId;
  const fingerprint = room.members.find((member) => member.nick === room.creator)?.compatibility?.map;
  const local = await (services.local ?? localMapDocuments)(mapId);
  if (local !== null) {
    if (fingerprint != null && local.fingerprint !== fingerprint)
      throw new Error('Local map differs from the session');
    return local;
  }
  const origin = room.settings.mapOrigin;
  if (fingerprint == null || origin === undefined) return null;
  const listed = await (services.list ?? loadMapList)();
  if (
    listed.some(
      (entry) => entry.id.toLowerCase() === mapId.toLowerCase() && !mapDeliveryAllowed(entry.provenance),
    )
  )
    return null;
  const cached =
    (await (services.cached ?? loadPersistedMap)(mapId, { fingerprint, origin }))?.handle ?? null;
  const announced = room.settings.catalogMap;
  if (cached !== null || announced === undefined || announced.fingerprint !== fingerprint) return cached;
  try {
    return await (services.catalog ?? installAnnouncedCatalogMap)(announced);
  } catch (error) {
    diag.warn('content', 'catalogue server could not deliver the room map', { error: String(error) });
    return null;
  }
}
