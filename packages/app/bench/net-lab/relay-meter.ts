/**
 * The relay as the lab watches it: every message it sends and receives, counted per client and per
 * kind at the relay's own end of the link, and the clock tick of the newest frame it emitted.
 */
import type { GovernedClock, ServerMessage } from '@open-northland/net-protocol';
import { type ClientHandle, type Connection, Relay, type RelayOptions } from '@open-northland/net-server';

export interface DirectionBytes {
  bytes: number;
  messages: number;
  readonly byKind: Record<string, number>;
}

export interface ClientTraffic {
  /** What the relay received from the client: what it sent and the link delivered. */
  readonly up: DirectionBytes;
  /** What the relay sent the client, before the link delays or drops it. */
  readonly down: DirectionBytes;
}

export interface GovernorChange {
  readonly relayTick: number;
  readonly governed: GovernedClock | null;
}

function direction(): DirectionBytes {
  return { bytes: 0, messages: 0, byKind: {} };
}

function count(into: DirectionBytes, kind: string, bytes: number): void {
  into.bytes += bytes;
  into.messages++;
  into.byKind[kind] = (into.byKind[kind] ?? 0) + bytes;
}

export class MeteredRelay extends Relay {
  /** Traffic per client label, across every link that client had. */
  readonly traffic = new Map<string, ClientTraffic>();
  /** Bytes of every frame sent to any member. */
  readonly frameBytes: number[] = [];
  readonly blobs = { count: 0, bytes: 0, byType: {} as Record<string, number> };
  readonly governor: GovernorChange[] = [];
  private newestFrameTick = 0;
  private readonly labels = new Map<ClientHandle, string>();
  private linking: string | null = null;

  constructor(options: RelayOptions) {
    super(options);
  }

  /** The tick of the newest frame the relay emitted: its clock as the clients are fed it. */
  get clockTick(): number {
    return this.newestFrameTick;
  }

  /** Run `connect`, which a link opens, with its connection counted under `label`. */
  linkAs<T>(label: string, connect: () => T): T {
    this.linking = label;
    try {
      return connect();
    } finally {
      this.linking = null;
    }
  }

  override connect(connection: Connection): ClientHandle {
    const label = this.linking ?? 'unlabelled';
    const traffic = this.trafficOf(label);
    const handle = super.connect({
      send: (message: ServerMessage) => {
        const bytes = Buffer.byteLength(JSON.stringify(message));
        count(traffic.down, message.kind, bytes);
        this.observe(message, bytes);
        connection.send(message);
      },
      close: (reason) => connection.close(reason),
    });
    this.labels.set(handle, label);
    return handle;
  }

  override receive(client: ClientHandle, raw: unknown, bytes?: number): void {
    const label = this.labels.get(client);
    if (label !== undefined && bytes !== undefined) {
      const kind = typeof raw === 'object' && raw !== null && 'kind' in raw ? String(raw.kind) : 'unknown';
      count(this.trafficOf(label).up, kind, bytes);
    }
    super.receive(client, raw, bytes);
  }

  private trafficOf(label: string): ClientTraffic {
    let traffic = this.traffic.get(label);
    if (traffic === undefined) {
      traffic = { up: direction(), down: direction() };
      this.traffic.set(label, traffic);
    }
    return traffic;
  }

  private observe(message: ServerMessage, bytes: number): void {
    switch (message.kind) {
      case 'frame':
        this.frameBytes.push(bytes);
        this.newestFrameTick = Math.max(this.newestFrameTick, message.tick);
        return;
      case 'blob':
        this.blobs.count++;
        this.blobs.bytes += bytes;
        this.blobs.byType[message.type] = (this.blobs.byType[message.type] ?? 0) + bytes;
        return;
      case 'clock': {
        // One broadcast reaches every member; a change is recorded once.
        const last = this.governor.at(-1)?.governed ?? null;
        if (JSON.stringify(last) !== JSON.stringify(message.governed)) {
          this.governor.push({ relayTick: this.newestFrameTick, governed: message.governed });
        }
        return;
      }
      default:
        return;
    }
  }
}
