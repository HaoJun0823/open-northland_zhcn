import { MAX_COMMANDS_PER_TICK } from '@open-northland/net-protocol';
import type { CommandEnvelope } from '@open-northland/sim';

/** Gestures held back locally; past it a new one is refused as the relay's own budget would. */
export const MAX_QUEUED_COMMANDS = MAX_COMMANDS_PER_TICK * 5;

interface QueuedCommand {
  readonly envelope: CommandEnvelope;
  readonly clickedAt: number;
}

/**
 * This seat's gestures waiting for room under the relay's per-tick budget, oldest first. Every
 * accepted gesture still pending at the relay is in flight here, so while fewer than
 * `MAX_COMMANDS_PER_TICK` are, no tick can hold more than that many of this seat's gestures and the
 * next one cannot be refused for the budget. A burst larger than the budget, such as a long wall line
 * or a dozen orders given while paused, therefore lands over successive ticks in order.
 */
export class CommandOutbox {
  private readonly queue: QueuedCommand[] = [];

  get size(): number {
    return this.queue.length;
  }

  /** False when the outbox is full and the gesture was not taken. */
  push(envelope: CommandEnvelope, clickedAt: number): boolean {
    if (this.queue.length >= MAX_QUEUED_COMMANDS) return false;
    this.queue.push({ envelope, clickedAt });
    return true;
  }

  /** Send the oldest gestures while fewer than the budget are in flight. */
  drain(inFlight: () => number, send: (envelope: CommandEnvelope, clickedAt: number) => void): void {
    while (this.queue.length > 0 && inFlight() < MAX_COMMANDS_PER_TICK) {
      const next = this.queue.shift();
      if (next === undefined) return;
      send(next.envelope, next.clickedAt);
    }
  }

  clear(): void {
    this.queue.length = 0;
  }
}
