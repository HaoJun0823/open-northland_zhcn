import { MAX_COMMAND_BYTES_PER_TICK, MAX_COMMANDS_PER_TICK } from '@open-northland/net-protocol';
import type { CommandEnvelope } from '@open-northland/sim';

/** Gestures held back locally; past it a new one is refused as the relay's own budget would. */
export const MAX_QUEUED_COMMANDS = MAX_COMMANDS_PER_TICK * 5;

interface QueuedCommand {
  readonly envelope: CommandEnvelope;
  readonly clickedAt: number;
  /** The envelope as JSON, as the relay charges it to the tick it lands on. */
  readonly bytes: number;
}

/** This seat's commands sent and not yet applied or refused. */
export interface InFlight {
  readonly count: number;
  readonly bytes: number;
}

/**
 * This seat's gestures waiting for room under the relay's per-tick budget, oldest first. Every
 * accepted gesture still pending at the relay is in flight here, so while the ones in flight and the
 * next one together stay within `MAX_COMMANDS_PER_TICK` and `MAX_COMMAND_BYTES_PER_TICK`, no tick can
 * hold more than that of this seat's gestures and the next one cannot be refused for the budget. A
 * burst larger than the budget, such as a long wall line, a dozen orders given while paused or a few
 * large army orders, therefore lands over successive ticks in order.
 */
export class CommandOutbox {
  private readonly queue: QueuedCommand[] = [];

  get size(): number {
    return this.queue.length;
  }

  /** False when the outbox is full and the gesture was not taken. */
  push(envelope: CommandEnvelope, clickedAt: number, bytes: number): boolean {
    if (this.queue.length >= MAX_QUEUED_COMMANDS) return false;
    this.queue.push({ envelope, clickedAt, bytes });
    return true;
  }

  /** Send the oldest gestures while the budget has room for them beside the ones in flight. */
  drain(
    inFlight: () => InFlight,
    send: (envelope: CommandEnvelope, clickedAt: number, bytes: number) => void,
  ): void {
    for (let next = this.queue[0]; next !== undefined; next = this.queue[0]) {
      const { count, bytes } = inFlight();
      if (count >= MAX_COMMANDS_PER_TICK || bytes + next.bytes > MAX_COMMAND_BYTES_PER_TICK) return;
      this.queue.shift();
      send(next.envelope, next.clickedAt, next.bytes);
    }
  }

  clear(): void {
    this.queue.length = 0;
  }
}
