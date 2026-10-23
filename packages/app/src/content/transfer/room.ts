import type { MapProvenance } from '@open-northland/data';
import type { ClientMessage, RoomView, ServerMessage } from '@open-northland/net-protocol';
import { diag } from '../../diag/log.js';
import { installAnnouncedCatalogMap } from '../map-source/install.js';
import { findMapSource, mapFetch } from '../map-source/sources.js';
import { MAPS_INDEX_URL, parseMapsIndex } from '../maps-index.js';
import { type ContentFetch, contentFetch } from '../url.js';
import { loadPersistedMap, persistedMapOrigin, persistVerifiedMap } from './cache.js';
import {
  type DeliverableMapOrigin,
  decodeMapTransfer,
  encodeMapTransfer,
  isDeliverableMapOrigin,
  mapDeliveryAllowed,
} from './codec.js';
import {
  loadVerifiedMapDocuments,
  readVerifiedMapDocuments,
  type VerifiedMapDocuments,
} from './documents.js';

type Upload = Omit<Extract<ClientMessage, { kind: 'blob' }>, 'kind'>;

/** What the player sees while a received map is verified. The verify blocks the page, so `show`
 *  resolves only once the notice has painted. */
export interface MapVerifyNotice {
  show(): Promise<void>;
  hide(): void;
}
/** Origins whose map the creator deposits on the relay: the ones only a player's copy can provide. */
const DEPOSITED_ORIGINS = ['user', 'mod'] as const satisfies readonly DeliverableMapOrigin[];
function isDepositedOrigin(kind: unknown): kind is (typeof DEPOSITED_ORIGINS)[number] {
  return DEPOSITED_ORIGINS.some((origin) => origin === kind);
}
const SILENT_VERIFY_NOTICE: MapVerifyNotice = { show: async () => undefined, hide: () => undefined };

export interface RoomMapTransferOptions {
  readonly client: { readonly nick: string; sendBlob(upload: Upload): void; requestMap(): void };
  readonly onVerified: (documents: VerifiedMapDocuments | null) => void;
  readonly onError: (error: Error) => void;
  readonly fetchImpl?: ContentFetch;
  readonly cacheRead?: typeof loadPersistedMap;
  readonly cacheWrite?: typeof persistVerifiedMap;
  /** Where a map's files load from: an installed catalogue map's store, else the given transport. */
  readonly mapFetch?: typeof mapFetch;
  readonly findSource?: typeof findMapSource;
  /** Fetches the room's announced catalogue map from the catalogue server. */
  readonly catalogInstall?: typeof installAnnouncedCatalogMap;
  readonly verifyNotice?: MapVerifyNotice;
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
  /** Whether this load's documents went to the relay as the room's deposit. */
  let deposited = false;
  /** Whether the room's map is in the page's own maps index. */
  let shipped = false;
  let disposed = false;
  const pending = new Set<string>();
  const fetchImpl = options.fetchImpl ?? contentFetch;
  const verifyNotice = options.verifyNotice ?? SILENT_VERIFY_NOTICE;
  /** Verifies under way; the notice stays up until the last one returns. */
  let verifying = 0;
  async function beginVerify(): Promise<void> {
    verifying++;
    await verifyNotice.show();
  }
  function endVerify(): void {
    if (verifying > 0 && --verifying === 0) verifyNotice.hide();
  }
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
    upload(documents, deliveryOrigin, nick);
  }
  /** Encodes the documents once per load and sends them to `nick` while they are still the room's. */
  function upload(encoded: VerifiedMapDocuments, deliveryOrigin: DeliverableMapOrigin, nick: string) {
    encodedMap ??= encodeMapTransfer(encoded, { kind: deliveryOrigin });
    const active = generation;
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
  /** The creator leaves the relay a copy of a player's own map, addressed to itself, so a member who
   *  returns to the started game without it can still get it. Every page serves the shipped maps and
   *  the catalogue server a catalogue map, so neither is deposited. */
  function deposit() {
    if (
      deposited ||
      shipped ||
      room?.state !== 'lobby' ||
      room.creator !== options.client.nick ||
      documents === null ||
      documents.fingerprint !== expectedFingerprint() ||
      (locallyListed && !mapDeliveryAllowed(origin))
    )
      return;
    const deliveryOrigin = origin?.kind ?? persistedMapOrigin(documents);
    if (!isDepositedOrigin(deliveryOrigin) || deliveryOrigin !== room.settings.mapOrigin) return;
    deposited = true;
    upload(documents, deliveryOrigin, options.client.nick);
  }
  function flushPending() {
    if (documents === null || documents.fingerprint !== expectedFingerprint()) return;
    deposit();
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
    deposited = false;
    shipped = false;
    const mapId = room?.settings.world.kind === 'map' ? room.settings.world.mapId : null;
    if (mapId === null) return;
    loading = true;
    const transport: ContentFetch = (input, init) => fetchImpl(input, { ...init, signal });
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
      shipped = locallyListed;
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
        let downloaded = false;
        const beforeVerify = async (): Promise<void> => {
          if (downloaded) return;
          downloaded = true;
          await beginVerify();
        };
        try {
          resolved = await (options.catalogInstall ?? installAnnouncedCatalogMap)(announced, {
            ...(abort === undefined ? {} : { signal: abort.signal }),
            beforeVerify,
          });
        } catch (error) {
          // The relay delivery below stays the fallback when the catalogue server cannot help.
          diag.warn('content', 'catalogue server could not deliver the room map', { error: String(error) });
        } finally {
          if (downloaded) endVerify();
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
        const mapId = room.settings.world.mapId;
        void (async () => {
          await beginVerify();
          try {
            return await decodeMapTransfer(message.bytes, {
              mapId,
              fingerprint,
              provenance: { kind: allowedOrigin },
            });
          } finally {
            endVerify();
          }
        })()
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
