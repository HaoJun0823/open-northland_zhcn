import { createHash } from 'node:crypto';
import type { RoomSettings } from '@open-northland/net-protocol';
import { type BlobMessage, type BlobUpload, blobMessage, relayBlob } from './blob-relay.js';
import type { CachedSnapshot } from './catch-up.js';
import { broadcast, type Deliver, type Member, type Refusal } from './member.js';

/** One member's map or initial-save request is answered at most this often, bounding a small
 *  request's large response. */
const REQUEST_COOLDOWN_MS = 2000;

/** The map text the creator last delivered or deposited, kept for the room's life so the relay can
 *  serve it again. Every request is answered with the one message object, which the host encodes once. */
interface KeptMap {
  readonly message: BlobMessage;
  readonly uploader: Member;
  /** The map fingerprint the creator's compatibility report named when it sent the text. */
  readonly fingerprint: string | null;
}

export class LobbyTransfers {
  private snapshot: CachedSnapshot | null = null;
  private kept: KeptMap | null = null;
  private started = false;
  private readonly mapRequests = new WeakMap<Member, number>();
  private readonly saveRequests = new WeakMap<Member, number>();

  constructor(
    private readonly settings: () => RoomSettings,
    private readonly members: ReadonlyMap<string, Member>,
    private readonly creator: () => Member | null,
    private readonly deliver: Deliver,
  ) {}

  get initialSave(): CachedSnapshot | null {
    return this.snapshot;
  }

  /** The room's snapshot retention takes the initial save over; the kept map stays the room's map. */
  start(): void {
    this.snapshot = null;
    this.started = true;
  }

  readyRefusal(): Refusal {
    return this.settings().initialSave !== undefined && this.snapshot === null
      ? { code: 'initialSaveMissing' }
      : null;
  }

  upload(member: Member, upload: BlobUpload): Refusal {
    if (upload.type !== 'map' && upload.type !== 'initialSave') return { code: 'gameNotStarted' };
    if (member !== this.creator()) return { code: 'creatorOnly' };
    if (upload.type === 'map') {
      if (this.settings().mapOrigin === undefined) return { code: 'mapDeliveryOff' };
      if (upload.tick !== null) return { code: 'mapUploadHasTick' };
      const message = blobMessage(member, upload);
      // A map the creator addresses to itself is a deposit: kept for later requests, sent to nobody.
      const refusal =
        upload.to === member.nick
          ? null
          : relayBlob(this.members.values(), this.deliver, member, upload.to, message);
      if (refusal === null) {
        this.kept = {
          message,
          uploader: member,
          fingerprint: member.compatibility?.map ?? null,
        };
      }
      return refusal;
    }
    const identity = this.settings().initialSave;
    if (identity === undefined) return { code: 'notFromSave' };
    if (upload.to !== null) return { code: 'initialSaveForEveryone' };
    if (upload.tick !== identity.tick) return { code: 'initialSaveTickMismatch' };
    if (createHash('sha256').update(upload.bytes).digest('hex') !== identity.fingerprint) {
      return { code: 'initialSaveFingerprintMismatch' };
    }
    this.snapshot = { tick: identity.tick, from: member.nick, bytes: upload.bytes };
    broadcast(this.members.values(), this.deliver, {
      kind: 'blob',
      type: 'initialSave',
      from: member.nick,
      tick: identity.tick,
      bytes: upload.bytes,
    });
    return null;
  }

  requestInitialSave(member: Member, now: number): Refusal {
    if (this.settings().initialSave === undefined) return { code: 'notFromSave' };
    const snapshot = this.snapshot;
    if (snapshot === null) return this.readyRefusal();
    if (this.tooSoon(this.saveRequests, member, now)) return { code: 'retryTooSoon' };
    this.deliver(member, {
      kind: 'blob',
      type: 'initialSave',
      from: snapshot.from,
      tick: snapshot.tick,
      bytes: snapshot.bytes,
    });
    return null;
  }

  private tooSoon(requests: WeakMap<Member, number>, member: Member, now: number): boolean {
    const last = requests.get(member);
    if (last !== undefined && now - last < REQUEST_COOLDOWN_MS) return true;
    requests.set(member, now);
    return false;
  }

  /** Served from the kept text when the relay holds it; in the lobby, asked of the creator otherwise. */
  requestMap(member: Member, now: number): Refusal {
    if (this.settings().mapOrigin === undefined) return { code: 'mapDeliveryOff' };
    const kept = this.keptMap();
    const creator = this.creator();
    if (kept === null) {
      if (this.started) return { code: 'mapNotKept' };
      if (creator === null || !creator.connected) return { code: 'mapProviderAway' };
      if (creator === member) return { code: 'creatorHasMap' };
    }
    if (this.tooSoon(this.mapRequests, member, now)) return { code: 'retryTooSoon' };
    if (kept !== null) {
      this.deliver(member, kept.message);
    } else if (creator !== null) {
      this.deliver(creator, { kind: 'mapRequest', from: member.nick });
    }
    return null;
  }

  /** The room's world is fixed, but in the lobby its creator may change or report another copy of the
   *  map; the text counts only while it is the creator's current one. */
  private keptMap(): KeptMap | null {
    const kept = this.kept;
    if (kept === null || this.started) return kept;
    const creator = this.creator();
    return kept.uploader === creator && kept.fingerprint === (creator.compatibility?.map ?? null)
      ? kept
      : null;
  }
}
