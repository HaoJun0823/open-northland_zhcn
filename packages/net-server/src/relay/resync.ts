import type { WireFrame } from '@open-northland/net-protocol';
import {
  type CachedSnapshot,
  CatchUpStore,
  HISTORY_REFRESH_AGE_MS,
  MAX_COMMAND_HISTORY_BYTES,
} from './catch-up.js';
import { type Deliver, isSilent, isSynced, type Member, type Refusal } from './member.js';

/** Cadence of the cached snapshot's refresh from the best-connected client. */
export const SNAPSHOT_REFRESH_MS = HISTORY_REFRESH_AGE_MS;
/** A snapshot request unanswered this long is repeated, to the next eligible donor. */
export const SNAPSHOT_RETRY_MS = 10_000;

/**
 * The room's cached snapshot, the frames since it, and the members waiting to be brought back to
 * the present: an out-of-sync member waits for a fresh snapshot, a returning one takes the cache.
 */
export class Resync {
  private readonly catchUp = new CatchUpStore();
  /** The cache's author was found out of sync. A drop forgets held digests, so its cached tick may
   *  never have been judged: the bytes wait for a replacement while a member in sync can send one. */
  private snapshotInvalid = false;
  /** Connected members only: a dropped one leaves, and asks again with `loaded` on its return. */
  private readonly awaiting = new Set<Member>();
  private requestedAt: number | null = null;
  private askedDonor: string | null = null;
  private lastRefreshAt: number;
  private refreshing = false;
  private readonly triedDonors = new Set<string>();

  constructor(
    private readonly members: ReadonlyMap<string, Member>,
    private readonly deliver: Deliver,
    now: number,
  ) {
    this.lastRefreshAt = now;
  }

  get snapshot(): CachedSnapshot | null {
    return this.catchUp.snapshot;
  }

  get commandHeadroomBytes(): number {
    return Math.max(0, MAX_COMMAND_HISTORY_BYTES - this.catchUp.bytes);
  }

  record(frame: WireFrame, now: number): boolean {
    return this.catchUp.record(frame, now);
  }

  framesAfter(tick: number): readonly WireFrame[] | null {
    return this.catchUp.framesAfter(tick);
  }

  finishAt(tick: number): void {
    this.catchUp.finishAt(tick);
    this.refreshing = true;
    this.resetRequests();
  }

  /** Start the refresh cadence from the clock's start. */
  restartCadence(now: number): void {
    this.lastRefreshAt = now;
  }

  /** Queue `member` for the next snapshot a client in sync sends; one request at a time serves every
   *  member queued meanwhile, and an unanswered one is repeated on its retry cadence. */
  queue(member: Member, now: number): void {
    if (member.outOfSync !== null && this.catchUp.snapshot?.from === member.nick) this.snapshotInvalid = true;
    this.awaiting.add(member);
    this.releaseUnfitDonor(now);
    if (this.requestedAt === null || now - this.requestedAt >= SNAPSHOT_RETRY_MS) this.request(now);
  }

  /** The member no longer waits, and a donor that dropped cannot answer: the next poll asks another
   *  instead of waiting out the retry. */
  forget(member: Member): void {
    this.awaiting.delete(member);
    this.triedDonors.delete(member.token);
    if (this.askedDonor === member.token) {
      this.askedDonor = null;
      this.requestedAt = null;
    }
  }

  /** Hand `member` the snapshot, or queue it while a held-back cache can still be replaced. */
  serve(member: Member, snapshot: CachedSnapshot, now: number): void {
    // Reusing a discarded generation would make its in-flight reports and uploads current again.
    if (
      (member.outOfSync !== null && snapshot.tick <= member.world) ||
      (this.snapshotInvalid && this.anySynced())
    ) {
      this.queue(member, now);
      return;
    }
    this.deliverCache(member, snapshot);
  }

  /** Send the snapshot and every frame since; `member` stands at the snapshot's tick from here. */
  private deliverCache(member: Member, snapshot: CachedSnapshot): void {
    this.deliver(member, {
      kind: 'blob',
      type: 'snapshot',
      from: snapshot.from,
      tick: snapshot.tick,
      bytes: snapshot.bytes,
    });
    for (const frame of this.catchUp.framesAfter(snapshot.tick) ?? []) {
      this.deliver(member, { kind: 'frame', ...frame });
    }
    member.ackedTick = snapshot.tick;
    member.world = snapshot.tick;
    member.outOfSync = null;
    member.loaded = true;
    this.awaiting.delete(member);
  }

  /** Take a snapshot at `tick`; true when it is newer than the cached one. Whoever waits is served. */
  take(from: string, tick: number, bytes: string, now: number): boolean {
    const newer = this.catchUp.cache({ tick, from, bytes }, this.snapshotInvalid);
    if (newer || (this.catchUp.bytes === 0 && this.catchUp.snapshot?.tick === tick)) {
      this.lastRefreshAt = now;
      this.refreshing = false;
      this.resetRequests();
    }
    const newest = this.catchUp.snapshot;
    // Only an upload at the cached tick vouches for it; an older one leaves an invalidated cache held.
    if (newest?.tick === tick) this.snapshotInvalid = false;
    if (newest !== null) {
      for (const member of this.awaiting) this.serve(member, newest, now);
    }
    return newer;
  }

  /** Unanswered refreshes retry even when no member is currently waiting for resync. */
  advance(now: number): Refusal {
    if (this.catchUp.expired(now)) return { code: 'historyAge' };
    this.releaseUnfitDonor(now);
    const refreshDue = this.catchUp.needsRefresh(now) || now - this.lastRefreshAt >= SNAPSHOT_REFRESH_MS;
    if (refreshDue && !this.refreshing) {
      this.refreshing = true;
      this.lastRefreshAt = now;
    }
    if (
      (this.awaiting.size > 0 || this.refreshing) &&
      (this.requestedAt === null || now - this.requestedAt >= SNAPSHOT_RETRY_MS)
    )
      this.request(now);
    return null;
  }

  private request(now: number): void {
    const cached = this.catchUp.snapshot;
    if (this.snapshotInvalid && cached !== null && !this.anySynced()) {
      // Nobody can replace the invalidated cache: returning members take it, then answer for the
      // diverged ones.
      for (const member of this.awaiting) {
        if (member.outOfSync === null) this.deliverCache(member, cached);
      }
    }
    const members = [...this.members.values()];
    const hasPlayers = members.some((member) => member.seat !== null);
    const eligible = members.filter(
      (member) => canDonate(member, now) && (!hasPlayers || member.seat !== null),
    );
    if (eligible.length === 0) return;
    if (eligible.every((member) => this.triedDonors.has(member.token))) this.triedDonors.clear();
    let donor: Member | null = null;
    for (const member of eligible) {
      if (!this.triedDonors.has(member.token) && (donor === null || member.roundTripMs < donor.roundTripMs)) {
        donor = member;
      }
    }
    if (donor === null) return;
    this.requestedAt = now;
    this.askedDonor = donor.token;
    this.triedDonors.add(donor.token);
    this.deliver(donor, { kind: 'snapshotRequest' });
  }

  /** A donor that diverged or went silent after the request will not answer it: the request goes on
   *  to the next donor now instead of after the retry. */
  private releaseUnfitDonor(now: number): void {
    if (this.askedDonor === null) return;
    const donor = this.members.get(this.askedDonor);
    if (donor !== undefined && canDonate(donor, now)) return;
    this.askedDonor = null;
    this.requestedAt = null;
  }

  private anySynced(): boolean {
    for (const member of this.members.values()) if (isSynced(member)) return true;
    return false;
  }

  private resetRequests(): void {
    this.requestedAt = null;
    this.askedDonor = null;
    this.triedDonors.clear();
  }
}

/** In sync and heard: a silent member's round trip is stale, and it may not answer at all. */
function canDonate(member: Member, now: number): boolean {
  return isSynced(member) && !isSilent(member, now);
}
