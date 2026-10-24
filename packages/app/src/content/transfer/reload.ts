import type { RoomView } from '@open-northland/net-protocol';
import { diag } from '../../diag/log.js';
import { loadMapList } from '../map/maps-index.js';
import { installAnnouncedCatalogMap } from '../map-source/install.js';
import { mapFetch } from '../map-source/sources.js';
import { loadPersistedMap, persistVerifiedMap } from './cache.js';
import { decodeMapTransfer, mapDeliveryAllowed } from './codec.js';
import { loadVerifiedMapDocuments, type VerifiedMapDocuments } from './documents.js';

async function localMapDocuments(mapId: string): Promise<VerifiedMapDocuments | null> {
  return loadVerifiedMapDocuments(mapId, await mapFetch(mapId));
}

/** The room's map from this browser, the catalogue server, or last the relay: `delivered` asks the
 *  relay for its copy and resolves with the `map` blob's text, which is verified and kept as the lobby
 *  keeps a delivered map. */
export async function loadRoomMapDocuments(
  room: RoomView,
  services: {
    readonly local?: (mapId: string) => Promise<VerifiedMapDocuments | null>;
    readonly cached?: typeof loadPersistedMap;
    readonly list?: typeof loadMapList;
    readonly catalog?: typeof installAnnouncedCatalogMap;
    readonly delivered?: () => Promise<string>;
    readonly persist?: typeof persistVerifiedMap;
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
  if (cached !== null) return cached;
  const announced = room.settings.catalogMap;
  if (announced !== undefined && announced.fingerprint === fingerprint) {
    try {
      const installed = await (services.catalog ?? installAnnouncedCatalogMap)(announced);
      if (installed !== null) return installed;
    } catch (error) {
      diag.warn('content', 'catalogue server could not deliver the room map', { error: String(error) });
    }
  }
  if (services.delivered === undefined) return null;
  const bytes = await services.delivered();
  const handle = await decodeMapTransfer(bytes, { mapId, fingerprint, provenance: { kind: origin } });
  await (services.persist ?? persistVerifiedMap)(handle, origin, bytes);
  return handle;
}
