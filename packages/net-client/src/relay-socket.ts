import {
  CLOSE_PROTOCOL_ERROR,
  CLOSE_REPLACED,
  CLOSE_SERVICE_RESTART,
  type ClientMessage,
  type ClosingCode,
} from '@open-northland/net-protocol';

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** An open link on which no relay message arrived for this long is quiet: the relay pings every second,
 *  and judges a client silent after this long without an answer, so the room has most likely stopped
 *  hearing this client at the same moment. The report keeps the socket open: a large message still
 *  arriving looks the same, and a route that fell away may come back under it. */
export const LINK_QUIET_MS = 4000;
/** A quiet link is replaced by a fresh socket on the same token after this long, unless the client
 *  awaits a large message: a link that dropped without a close (a router or WiFi roam) would otherwise
 *  hold the room until it is voted out, while a new socket rejoins within a second. */
export const LINK_REPLACE_MS = 2 * LINK_QUIET_MS;
/** How long a quiet link may carry an awaited large message before it is replaced. A full 32 MiB blob
 *  is about 45 MB as base64, which arrives within it at 1.2 Mbit/s; a snapshot of a few MiB at a
 *  tenth of that rate. */
export const TRANSFER_REPLACE_MS = 5 * 60_000;
const QUIET_POLL_MS = 1000;
/** A poll later than this after the previous one ran in a thread blocked meanwhile, such as by a world
 *  build: socket messages that queued then may still be waiting behind it. */
const STARVED_POLL_MS = 2 * QUIET_POLL_MS;
const FINAL_CLOSE_CODES: readonly number[] = [CLOSE_REPLACED, CLOSE_PROTOCOL_ERROR];
/** A restarted relay has forgotten every room, so reconnecting to one would only be refused. The
 *  reason tells the relay's own restart from a proxy's, after which the relay may still be there. */
const SERVER_RESTART: ClosingCode = 'serverRestart';
/** RFC 6455 normal closure, one of the codes a browser lets a page close with. The reason says why
 *  this end closed; the relay only logs it, so a client giving up on a quiet link reads apart from a
 *  page that closed or a network that dropped. */
const CLOSE_NORMAL = 1000;
type ClientCloseReason = 'closed' | 'linkQuiet';

function finalClose(event: CloseEvent): boolean {
  if (FINAL_CLOSE_CODES.includes(event.code)) return true;
  return event.code === CLOSE_SERVICE_RESTART && event.reason === SERVER_RESTART;
}

/** What a relay link reports to its owner. */
export interface RelayLinkEvents {
  /** Runs on every (re)connection; the client introduces itself again from here. */
  readonly onOpen: () => void;
  readonly onMessage: (raw: unknown) => void;
  /** Runs once the link will not reopen: closed here, replaced, refused or restarted by the relay. */
  readonly onClosed: (reason: string) => void;
  /** The link dropped and reopens in `inMs`; `quietMs` is how long no relay message had arrived. */
  readonly onRetry?: (attempt: number, inMs: number, quietMs: number) => void;
  /** The open link has carried nothing from the relay for `quietMs` ({@link LINK_QUIET_MS} or more). */
  readonly onQuiet?: (quietMs: number) => void;
  /** The relay was heard again on a link reported quiet. */
  readonly onHeard?: () => void;
  /** Whether the client awaits a large message, which a browser socket shows only once complete.
   *  Without it a quiet link cannot be told from such a message still arriving, and is kept. */
  readonly awaitsTransfer?: () => boolean;
}

/** A connection to the relay that carries client messages out and reports through `RelayLinkEvents`. */
export interface RelayLink {
  readonly connected: boolean;
  /** False when nothing is connected; the message is dropped, since the client says everything that
   *  matters again once it is back. */
  send(message: ClientMessage): boolean;
  close(): void;
}

export interface RelaySocketOptions extends RelayLinkEvents {
  readonly url: string;
  readonly createSocket?: (url: string) => WebSocket;
  /** Monotonic milliseconds; default `performance.now`. */
  readonly now?: () => number;
}

/** One relay connection that comes back on its own after a drop, with the same identity. */
export class RelaySocket implements RelayLink {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private quietPoll: ReturnType<typeof setInterval> | null = null;
  private quiet = false;
  private lastPollAt = 0;
  /** One delayed poll may allow queued socket events to run before judging the link. */
  private starvedGraceUsed = false;
  /** When the relay was last heard on the current socket, or the attempt began. */
  private heardAt: number;
  private closed = false;
  private readonly options: RelaySocketOptions;
  private readonly now: () => number;

  constructor(options: RelaySocketOptions) {
    this.options = options;
    this.now = options.now ?? ((): number => performance.now());
    this.heardAt = this.now();
    this.open();
  }

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === this.socket.OPEN;
  }

  send(message: ClientMessage): boolean {
    if (!this.connected || this.socket === null) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    this.clearDeadline();
    this.stopQuietWatch();
    const reason: ClientCloseReason = 'closed';
    this.socket?.close(CLOSE_NORMAL, reason);
    this.socket = null;
    this.options.onClosed(reason);
  }

  private open(): void {
    const socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(this.options.url);
    this.socket = socket;
    this.heardAt = this.now();
    this.watchOpening(socket);
    socket.onopen = () => {
      if (this.closed || this.socket !== socket) return;
      this.clearDeadline();
      this.attempt = 0;
      this.heardAt = this.now();
      this.watchQuiet(socket);
      this.options.onOpen();
    };
    socket.onmessage = (event) => {
      if (this.closed || this.socket !== socket) return;
      this.heard();
      if (typeof event.data !== 'string') return;
      let raw: unknown = null;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      this.options.onMessage(raw);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.clearDeadline();
      this.stopQuietWatch();
      this.socket = null;
      if (this.closed) return;
      if (finalClose(event)) {
        this.closed = true;
        this.options.onClosed(event.reason === '' ? `closed with code ${event.code}` : event.reason);
        return;
      }
      this.scheduleRetry();
    };
    // A failed attempt is followed by a close event, where the retry is scheduled.
    socket.onerror = () => undefined;
  }

  private clearDeadline(): void {
    if (this.deadline !== null) clearTimeout(this.deadline);
    this.deadline = null;
  }

  private heard(): void {
    this.heardAt = this.now();
    this.starvedGraceUsed = false;
    if (!this.quiet) return;
    this.quiet = false;
    this.options.onHeard?.();
  }

  private watchQuiet(socket: WebSocket): void {
    this.stopQuietWatch();
    this.lastPollAt = this.now();
    this.starvedGraceUsed = false;
    this.quietPoll = setInterval(() => {
      if (this.closed || this.socket !== socket) {
        this.stopQuietWatch();
        return;
      }
      const now = this.now();
      const starved = now - this.lastPollAt > STARVED_POLL_MS;
      this.lastPollAt = now;
      // Allow one delayed poll for queued messages, but repeated delays cannot hide a dead link.
      if (starved && !this.starvedGraceUsed) {
        this.heardAt = now;
        this.starvedGraceUsed = true;
      }
      const quietMs = now - this.heardAt;
      if (quietMs < LINK_QUIET_MS) return;
      if (!this.quiet) {
        this.quiet = true;
        this.options.onQuiet?.(quietMs);
      }
      const awaitsTransfer = this.options.awaitsTransfer;
      if (awaitsTransfer === undefined) return;
      if (quietMs >= (awaitsTransfer() ? TRANSFER_REPLACE_MS : LINK_REPLACE_MS))
        this.abandon(socket, 'linkQuiet');
    }, QUIET_POLL_MS);
  }

  /** A closed or dropped socket's silence is the retry's or the close's to tell. */
  private stopQuietWatch(): void {
    if (this.quietPoll !== null) clearInterval(this.quietPoll);
    this.quietPoll = null;
    this.quiet = false;
  }

  private watchOpening(socket: WebSocket): void {
    this.clearDeadline();
    this.deadline = setTimeout(() => {
      this.deadline = null;
      if (this.closed || this.socket !== socket) return;
      this.abandon(socket, null);
    }, CONNECT_TIMEOUT_MS);
  }

  /** A broken link may never finish its close handshake. Detach it before retrying so queued events
   *  cannot act on the replacement connection. An attempt that never opened has no close frame to
   *  carry a reason (null). */
  private abandon(socket: WebSocket, reason: ClientCloseReason | null): void {
    this.clearDeadline();
    this.socket = null;
    this.stopQuietWatch();
    if (reason === null) socket.close();
    else socket.close(CLOSE_NORMAL, reason);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    const inMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.attempt);
    this.attempt++;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (!this.closed) this.open();
    }, inMs);
    this.options.onRetry?.(this.attempt, inMs, this.now() - this.heardAt);
  }
}
