import { describe, expect, it } from 'vitest';
import { CommandQueue } from '../../../src/core/command-queue.js';
import { aiCommand, type CommandEnvelope, playerCommand } from '../../../src/core/commands/envelope.js';
import type { PlayerCommand } from '../../../src/core/commands/index.js';
import type { Entity } from '../../../src/ecs/component.js';

const SEAT = 1;
const TRIBE = 2;
/** More entries than one sealed log chunk holds, so the read decodes a chunk and the open tail. */
const LOGGED = 300;

/** A field holding `undefined`, which the type forbids but a caller can still hand over at runtime. */
function roadSite(i: number, owner: number): CommandEnvelope {
  const command = { kind: 'placeRoadSite', x: i, y: -0, tribe: TRIBE, owner, force: undefined };
  return playerCommand(SEAT, command as unknown as PlayerCommand);
}

describe('command log', () => {
  it('reads back every recorded entry as the owned envelope, across a chunk boundary', () => {
    const queue = new CommandQueue();
    for (let i = 0; i < LOGGED; i++) {
      queue.enqueue(
        i % 2 === 0 ? roadSite(i, SEAT) : aiCommand(SEAT, { kind: 'explore', entity: i as Entity }),
      );
    }
    const applied = queue.drain(1);
    for (const envelope of applied) queue.record(1, envelope);
    expect(queue.log).toHaveLength(LOGGED);
    // toStrictEqual: an absent field and one holding undefined must not differ between live and log.
    expect(queue.log).toStrictEqual(
      applied.map((envelope, sequence) => ({
        ...envelope,
        command: { ...envelope.command },
        applyTick: 1,
        sequence,
      })),
    );
  });

  it('carries a payload the way JSON would, so the live command and its log agree', () => {
    const queue = new CommandQueue();
    queue.enqueue(playerCommand(SEAT, { kind: 'placeRoadSite', x: Number.NaN, y: -0, tribe: TRIBE }));
    const [applied] = queue.drain(1);
    expect(applied?.command).toEqual({ kind: 'placeRoadSite', x: null, y: 0, tribe: TRIBE, owner: SEAT });
    queue.record(1, applied as CommandEnvelope);
    expect(queue.log[0]?.command).toEqual(applied?.command);
  });
});
