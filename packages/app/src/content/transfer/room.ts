import type { MapProvenance } from '@open-northland/data';
import type { ClientMessage, RoomView, ServerMessage } from '@open-northland/net-protocol';
import { diag } from '../../diag/log.js';
import { installAnnouncedCatalogMap } from '../map-source/install.js';
import { findMapSource, mapFetch } from '../map-source/sources.js';
import { MAPS_INDEX_URL, parseMapsIndex } from '../maps-index.js';
import { loadPersistedMap, persistedMapOrigin, persistVerifiedMap } from './cache.js';
import { decodeMapTransfer, encodeMapTransfer, isDeliverableMapOrigin, mapDeliveryAllowed } from './codec.js';
import {
  loadVerifiedMapDocuments,
  readVerifiedMapDocuments,
  type VerifiedMapDocuments,
} from './documents.js';

type Upload = Omit<Extract<ClientMessage, { kind: 'blob' }>, 'kind'>;
export interface RoomMapTransferOptions {
  readonly client: { readonly nick: string; sendBlob(upload: Upload): void; requestMap(): void };
  readonly onVerified: (documents: VerifiedMapDocuments | null) => void;
  readonly onError: (error: Error) => void;
  readonly fetchImpl?: typeof fetch;
  readonly cacheRead?: typeof loadPersistedMap;
  readonly cacheWrite?: typeof persistVerifiedMap;
  /** Where a map's files load from: an installed catalogue map's store, else the given transport. */
  readonly mapFetch?: typeof mapFetch;
  readonly findSource?: typeof findMapSource;
  /** Fetches the room's announced catalogue map from the catalogue server. */
  readonly catalogInstall?: typeof installAnnouncedCatalogMap;
}

/** Retains one room's validated documents until handover; asynchronous loads cannot outlive that room. */
export function createRoomMapTransfer(options: RoomMapTransferOptions) {
  let room: RoomView | null = null;
  let prepared: VerifiedMapDocuments | null = null;
  let roomPrepared: VerifiedMapDocuments | null = null;
  let identity = '';
  let generation = 0;
  let abort: AbortController | undefined;
  let documents: VerifiedMapDocuments | null = null;
  let origin: MapProvenance | undefined;
  let locallyListed = false;
  let loaded = false;
  let loading = false;
  let encodedMap: Promise<string> | undefined;
  /** The generation whose delivered blob is still decoding, so a retry's second copy is ignored. */
  let decodingGeneration: number | null = null;
  let cacheFingerprint: string | null = null;
  let requested = false;
  let disposed = false;
  const pending = new Set<string>();
  const fetchImpl = options.fetchImpl ?? fetch;
  const reportError = (error: unknown) =>
    options.onError(error instanceof Error ? error : new Error(String(error)));
  function expectedFingerprint(): string | null {
    return room?.members.find((member) => member.nick === room?.creator)?.compatibility?.map ?? null;
  }
  function requestMissing() {
    if (
      !loaded ||
      documents !== null ||
      requested ||
      room?.state !== 'lobby' ||
      room.creator === options.client.nick ||
      expectedFingerprint() === null
    )
      return;
    if (
      !mapDeliveryAllowed({ kind: room.settings.mapOrigin ?? 'unknown' }) ||
      (locallyListed && !mapDeliveryAllowed(origin))
    ) {
      reportError(new Error('Missing map cannot be delivered from this origin'));
      requested = true;
      return;
    }
    requested = true;
    options.client.requestMap();
  }
  function sendTo(nick: string) {
    if (
      room?.state !== 'lobby' ||
      room.creator !== options.client.nick ||
      documents === null ||
      !room.members.some((member) => member.nick === nick && member.connected) ||
      nick === options.client.nick
    )
      return;
    const deliveryOrigin = origin?.kind ?? persistedMapOrigin(documents);
    if (
      (locallyListed && !mapDeliveryAllowed(origin)) ||
      !isDeliverableMapOrigin(deliveryOrigin) ||
      deliveryOrigin !== room.settings.mapOrigin
    ) {
      reportError(new Error('Local map origin does not permit delivery'));
      return;
    }
    if (documents.fingerprint !== expectedFingerprint()) return;
    encodedMap ??= encodeMapTransfer(documents, { kind: deliveryOrigin });
    const active = generation;
    const encoded = documents;
    encodedMap.then(
      (bytes) => {
        const current = room;
        if (
          disposed ||
          generation !== active ||
          documents !== encoded ||
          current?.state !== 'lobby' ||
          !current.members.some((member) => member.nick === nick && member.connected)
        )
          return;
        options.client.sendBlob({ type: 'map', to: nick, tick: null, bytes });
      },
      (error: unknown) => {
        if (!disposed && generation === active) reportError(error);
      },
    );
  }
  function flushPending() {
    if (documents === null || documents.fingerprint !== expectedFingerprint()) return;
    for (const nick of pending) sendTo(nick);
    pending.clear();
  }
  async function load() {
    const active = ++generation;
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    documents = null;
    encodedMap = undefined;
    origin = undefined;
    locallyListed = false;
    loaded = false;
    requested = false;
    const mapId = room?.settings.world.kind === 'map' ? room.settings.world.mapId : null;
    if (mapId === null) return;
    loading = true;
    const transport: typeof fetch = (input, init) => fetchImpl(input, { ...init, signal });
    try {
      const files = await (options.mapFetch ?? mapFetch)(mapId, transport);
      const [handle, response] = await Promise.all([
        roomPrepared?.mapId === mapId ? roomPrepared : loadVerifiedMapDocuments(mapId, files),
        transport(MAPS_INDEX_URL),
      ]);
      if (!response.ok && response.status !== 404)
        throw new Error(`Cannot read map provenance: HTTP ${response.status}`);
      const index = response.ok ? parseMapsIndex(await response.json()) : [];
      if (disposed || generation !== active) return;
      const matches = index.filter((item) => item.id.toLowerCase() === mapId.toLowerCase());
      const entry = matches.find((item) => !mapDeliveryAllowed(item.provenance)) ?? matches[0];
      origin = entry?.provenance;
      locallyListed = entry !== undefined;
      if (!locallyListed) {
        const installed = await (options.findSource ?? findMapSource)(mapId);
        if (disposed || generation !== active) return;
        if (
          installed !== null &&
          (installed?.catalog !== undefined || installed?.local !== undefined) &&
          !installed.stale
        ) {
          origin = installed.entry.provenance;
          locallyListed = true;
        }
      }
      let resolved = handle;
      const fingerprint = expectedFingerprint();
      const allowedOrigin = room?.settings.mapOrigin;
      cacheFingerprint = fingerprint;
      // The creator's own report is what everyone else compares against, so it reads the cache by
      // origin alone; a member needs the creator's fingerprint to accept a cached copy.
      const creator = room?.creator === options.client.nick;
      if (
        resolved === null &&
        (creator || fingerprint !== null) &&
        allowedOrigin !== undefined &&
        (!locallyListed || mapDeliveryAllowed(origin))
      ) {
        const cached = await (options.cacheRead ?? loadPersistedMap)(mapId, {
          ...(fingerprint === null ? {} : { fingerprint }),
          origin: allowedOrigin,
        });
        if (disposed || generation !== active) return;
        if (fingerprint !== expectedFingerprint()) {
          void load();
          return;
        }
        resolved = cached?.handle ?? null;
      }
      const announced = room?.settings.catalogMap;
      if (resolved === null && !creator && announced?.mapId === mapId) {
        try {
          resolved =
            options.catalogInstall === undefined
              ? await installAnnouncedCatalogMap(announced, { signal: abort?.signal })
              : await options.catalogInstall(announced);
        } catch (error) {
          // The relay delivery below stays the fallback when the catalogue server cannot help.
          diag.warn('content', 'catalogue server could not deliver the room map', { error: String(error) });
        }
        if (disposed || generation !== active) return;
      }
      documents = resolved;
      loaded = true;
      options.onVerified(resolved);
      requestMissing();
      flushPending();
    } catch (error) {
      if (!disposed && generation === active) {
        abort?.abort();
        reportError(error);
      }
    } finally {
      if (generation === active) loading = false;
    }
  }
  return {
    prepare(handle: VerifiedMapDocuments) {
      if (!disposed) {
        readVerifiedMapDocuments(handle);
        prepared = handle;
      }
    },
    observe(next: RoomView | null) {
      if (disposed) return;
      room = next;
      if (next === null) {
        // Leaving keeps the identity and the documents prepared for it: a reconnect re-enters the
        // same room before any compatibility report exists to look the map up by.
        pending.clear();
        generation++;
        abort?.abort();
        documents = null;
        encodedMap = undefined;
        loaded = false;
        loading = false;
        return;
      }
      const key = `${next.id}:${next.creator}:${JSON.stringify(next.settings.world)}`;
      if (key !== identity) {
        identity = key;
        roomPrepared = prepared;
        prepared = null;
        pending.clear();
        generation++;
        abort?.abort();
        documents = null;
        encodedMap = undefined;
        loaded = false;
        void load();
      } else if (!loaded && !loading) {
        void load();
      } else if (loaded && documents === null && cacheFingerprint !== expectedFingerprint()) {
        void load();
      } else {
        requestMissing();
        flushPending();
      }
    },
    observeBlob(message: ServerMessage) {
      if (disposed || room?.state !== 'lobby') return;
      try {
        if (message.kind === 'mapRequest') {
          if (
            room.creator !== options.client.nick ||
            !room.members.some((member) => member.nick === message.from && member.connected)
          )
            return;
          pending.add(message.from);
          flushPending();
          return;
        }
        if (message.kind !== 'blob' || message.type !== 'map') return;
        // A retry can leave two responses in flight; the already verified documents remain authoritative.
        if (documents !== null || decodingGeneration === generation || !loaded || !requested) return;
        if (message.from !== room.creator || message.tick !== null || room.settings.world.kind !== 'map')
          throw new Error('Unexpected map delivery');
        const fingerprint = expectedFingerprint();
        const allowedOrigin = room.settings.mapOrigin;
        if (
          fingerprint === null ||
          allowedOrigin === undefined ||
          (locallyListed && !mapDeliveryAllowed(origin))
        )
          throw new Error('Map delivery is not authorized');
        const active = generation;
        const current = () => !disposed && generation === active;
        decodingGeneration = active;
        void decodeMapTransfer(message.bytes, {
          mapId: room.settings.world.mapId,
          fingerprint,
          provenance: { kind: allowedOrigin },
        })
          .then(async (handle) => {
            if (!current() || documents !== null) return;
            documents = handle;
            await (options.cacheWrite ?? persistVerifiedMap)(handle, allowedOrigin, message.bytes);
            if (current() && documents === handle) options.onVerified(handle);
          })
          .catch((error: unknown) => {
            if (current()) reportError(error);
          })
          .finally(() => {
            if (decodingGeneration === active) decodingGeneration = null;
          });
      } catch (error) {
        reportError(error);
      }
    },
    retry() {
      if (!disposed && room !== null) void load();
    },
    verified() {
      return documents;
    },
    dispose() {
      disposed = true;
      generation++;
      abort?.abort();
      pending.clear();
      room = null;
      documents = null;
      prepared = null;
      roomPrepared = null;
      encodedMap = undefined;
    },
  };
}
