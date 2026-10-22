import type { ServerMessage, WaitReason } from '@open-northland/net-protocol';

/** How long a member is waited for before a vote to kick it may open. */
export const KICK_COUNTDOWN_MS = 60_000;
/** Waited milliseconds a member is forgiven for each millisecond the room does not wait for it. A
 *  member waited for more than `1 / 11` of the time (`WAIT_FORGIVENESS / (1 + WAIT_FORGIVENESS)`)
 *  comes nearer a vote with every wait, however short its waits are. */
export const WAIT_FORGIVENESS = 0.1;

export interface Waited {
  readonly token: string;
  readonly nick: string;
  readonly reason: WaitReason;
}

/** The waited time a member owes, as of `at`. It stops growing at `KICK_COUNTDOWN_MS`, so a long
 *  absence is forgiven as fast as one that just reached the vote. */
interface Account {
  owedMs: number;
  at: number;
  waited: boolean;
}

/**
 * Who the room holds its clock for, and one countdown per waited member to when a vote to kick it may
 * open. A countdown runs while its member is waited for and winds back at `WAIT_FORGIVENESS` while it
 * is not, so a member that keeps answering just long enough to end each wait still reaches a vote.
 */
export class Waiting {
  /** The waited set as the clients were last told it. */
  private announced: readonly Waited[] = [];
  /** The countdowns restarted since the clients were last told: the next update tells them again. */
  private restarted = false;
  private readonly accounts = new Map<string, Account>();
  private readonly voteAnnounced = new Set<string>();

  get active(): boolean {
    for (const account of this.accounts.values()) if (account.waited) return true;
    return false;
  }

  message(now: number): Extract<ServerMessage, { kind: 'waiting' }> {
    return {
      kind: 'waiting',
      for: this.announced.map(({ token, nick, reason }) => ({
        nick,
        reason,
        voteAfterMs: this.voteAfterMs(token, now),
      })),
    };
  }

  isWaitedFor(token: string): boolean {
    return this.accounts.get(token)?.waited ?? false;
  }

  /** The member is waited for, or still owes some of the time it was. */
  owes(token: string): boolean {
    return this.accounts.has(token);
  }

  voteOpen(token: string, now: number): boolean {
    return this.voteAfterMs(token, now) === 0;
  }

  /** Whole milliseconds, since the wire carries a count and the clock may hand out fractions. */
  voteAfterMs(token: string, now: number): number {
    const account = this.accounts.get(token);
    const owed = account === undefined ? 0 : owedAt(account, now);
    return Math.max(0, Math.ceil(KICK_COUNTDOWN_MS - owed));
  }

  /** Replace the waited set; true when what clients were told has changed. */
  update(waited: readonly Waited[], now: number): boolean {
    const before = this.announced;
    this.announced = waited;
    const tokens = new Set(waited.map((entry) => entry.token));
    for (const [token, account] of this.accounts) {
      account.owedMs = owedAt(account, now);
      account.at = now;
      account.waited = tokens.has(token);
      if (account.waited) continue;
      this.voteAnnounced.delete(token);
      if (account.owedMs === 0) this.accounts.delete(token);
    }
    let opened = false;
    for (const token of tokens) {
      if (!this.accounts.has(token)) this.accounts.set(token, { owedMs: 0, at: now, waited: true });
      if (this.voteOpen(token, now) && !this.voteAnnounced.has(token)) {
        this.voteAnnounced.add(token);
        opened = true;
      }
    }
    const restarted = this.restarted;
    this.restarted = false;
    return opened || restarted || !sameWait(before, waited);
  }

  /** The clock starts: the load every member was waited through before it counts against nobody.
   *  The next update tells the clients the waited set and its countdowns afresh. */
  restart(now: number): void {
    for (const account of this.accounts.values()) {
      account.owedMs = 0;
      account.at = now;
    }
    this.voteAnnounced.clear();
    this.restarted = true;
  }

  /** A departed token keeps no countdown. */
  forget(token: string): void {
    this.accounts.delete(token);
    this.voteAnnounced.delete(token);
  }
}

function owedAt(account: Account, now: number): number {
  const elapsed = now - account.at;
  return account.waited
    ? Math.min(KICK_COUNTDOWN_MS, account.owedMs + elapsed)
    : Math.max(0, account.owedMs - elapsed * WAIT_FORGIVENESS);
}

function sameWait(a: readonly Waited[], b: readonly Waited[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((entry, i) => entry.token === b[i]?.token && entry.reason === b[i]?.reason);
}
