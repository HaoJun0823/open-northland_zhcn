import { randomBytes } from 'node:crypto';
import {
  type ClientMessageKind,
  clientMessageKind,
  MAX_BLOB_MESSAGE_BYTES,
} from '@open-northland/net-protocol';
import type { WebSocket } from 'ws';

export const DEFAULT_MAX_CONNECTIONS = 256;
export const MESSAGES_PER_SECOND = 256;
export const MESSAGE_BURST = MESSAGES_PER_SECOND * 2;
export const BYTES_PER_SECOND = 1024 * 1024;
export const BYTE_BURST = MAX_BLOB_MESSAGE_BYTES * 2;
export const MAX_BUFFERED_BYTES = MAX_BLOB_MESSAGE_BYTES * 2;
/** A control ping follows each fragment, and its pong keeps a slow download heard before the whole
 *  message is delivered: at 16 KiB/s one arrives every two seconds, inside the relay's silence limit.
 *  The pong to the last fragment's ping says the client has read the whole message. */
export const TEXT_FRAGMENT_BYTES = 32 * 1024;
/** One ping per fragment of a full send buffer, and as many again for pings already past it in kernel
 *  buffers and on the wire, which hold far less than the buffer bound: every fragment gets its ping. */
export const MAX_OUTSTANDING_CONTROL_PINGS = Math.ceil(MAX_BUFFERED_BYTES / TEXT_FRAGMENT_BYTES) * 2;
// RFC 6455: an unmasked frame needs at most 10 header bytes; a control frame is at most 127 bytes.
const MAX_FRAME_HEADER_BYTES = 10;
const MAX_CONTROL_FRAME_BYTES = 127;

/** Deployment budgets allow snapshot bursts alongside acknowledgements at the maximum game speed. */
export class SocketBudget {
  private messages = MESSAGE_BURST;
  private bytes = BYTE_BURST;

  constructor(private updatedAt: number) {}

  take(bytes: number, now: number, messageCost: 0 | 1 = 1): boolean {
    const seconds = Math.max(0, now - this.updatedAt) / 1000;
    this.updatedAt = now;
    this.messages = Math.min(MESSAGE_BURST, this.messages + seconds * MESSAGES_PER_SECOND);
    this.bytes = Math.min(BYTE_BURST, this.bytes + seconds * BYTES_PER_SECOND);
    if (this.messages < messageCost || this.bytes < bytes) return false;
    this.messages -= messageCost;
    this.bytes -= bytes;
    return true;
  }
}

/** Server-requested pongs use bytes, but do not spend the recipient's application message budget. */
export class ControlPings {
  private readonly challenge = randomBytes(16);
  private issued = 0n;
  private acknowledged = 0n;

  request(): Buffer | null {
    if (this.issued - this.acknowledged >= BigInt(MAX_OUTSTANDING_CONTROL_PINGS)) return null;
    const payload = Buffer.alloc(this.challenge.length + 8);
    this.challenge.copy(payload);
    payload.writeBigUInt64BE(++this.issued, this.challenge.length);
    return payload;
  }

  answer(data: Buffer): boolean {
    if (
      data.length !== this.challenge.length + 8 ||
      !data.subarray(0, this.challenge.length).equals(this.challenge)
    )
      return false;
    const sequence = data.readBigUInt64BE(this.challenge.length);
    if (sequence <= this.acknowledged || sequence > this.issued) return false;
    // RFC 6455 permits a peer to answer only the newest of several pending pings.
    this.acknowledged = sequence;
    return true;
  }

  /** Every ping issued has been answered. */
  get settled(): boolean {
    return this.acknowledged === this.issued;
  }
}

export interface EncodedMessage {
  readonly data: string | Buffer;
  readonly byteLength: number;
}

/** A broadcast shares its UTF-8 backing buffer across recipients as well as its JSON encoding. */
export function encodeText(text: string): EncodedMessage {
  const byteLength = Buffer.byteLength(text);
  return { data: byteLength <= TEXT_FRAGMENT_BYTES ? text : Buffer.from(text), byteLength };
}

/** True when the message went out in fragments, each followed by a control ping. */
export function sendBounded(
  socket: Pick<WebSocket, 'readyState' | 'OPEN' | 'bufferedAmount' | 'send' | 'ping' | 'terminate'>,
  message: EncodedMessage,
  ping: () => void = () => socket.ping(),
): boolean {
  if (socket.readyState !== socket.OPEN) return false;
  const { data, byteLength } = message;
  const fragments = Math.max(1, Math.ceil(byteLength / TEXT_FRAGMENT_BYTES));
  const overhead = fragments * (MAX_FRAME_HEADER_BYTES + MAX_CONTROL_FRAME_BYTES);
  if (socket.bufferedAmount + byteLength + overhead > MAX_BUFFERED_BYTES) {
    socket.terminate();
    return false;
  }
  if (typeof data === 'string') {
    socket.send(data);
    return false;
  }
  for (let offset = 0; offset < data.length; offset += TEXT_FRAGMENT_BYTES) {
    const end = Math.min(offset + TEXT_FRAGMENT_BYTES, data.length);
    const fin = end === data.length;
    socket.send(data.subarray(offset, end), { binary: false, fin });
    ping();
  }
  return true;
}

/** Recovery requests held in reserve, and the time one of them takes to come back. */
export const RECOVERY_BURST = 4;
const RECOVERY_REFILL_MS = 2000;

/** What the host does with a message under the recovery budget: hand it over, refuse it so the player
 *  can retry, or close. A refused `loaded` would leave the room waiting for an unreported world, so
 *  that connection closes instead and its reconnect reports the world afresh. */
export type RecoveryVerdict = 'accept' | 'refuse' | 'close';

/** Tiny requests the relay answers with a snapshot, a replay, a save or a map. */
const RECOVERY_KINDS: ReadonlySet<ClientMessageKind | null> = new Set<ClientMessageKind>([
  'loaded',
  'saveOrders',
  'requestInitialSave',
  'requestMap',
]);

/** Recovery can return a full snapshot or replay for a tiny request. */
export class RecoveryBudget {
  private remaining = RECOVERY_BURST;

  constructor(private updatedAt: number) {}

  take(raw: unknown, now: number): RecoveryVerdict {
    const kind = clientMessageKind(raw);
    if (!RECOVERY_KINDS.has(kind)) return 'accept';
    this.remaining = Math.min(
      RECOVERY_BURST,
      this.remaining + Math.max(0, now - this.updatedAt) / RECOVERY_REFILL_MS,
    );
    this.updatedAt = now;
    if (this.remaining >= 1) {
      this.remaining--;
      return 'accept';
    }
    return kind === 'loaded' ? 'close' : 'refuse';
  }
}
