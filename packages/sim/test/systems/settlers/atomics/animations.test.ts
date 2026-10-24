import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  ATOMIC_EVENT_CHANNEL,
  atomicAnimationByName,
  atomicEventChannelDelta,
  isInterruptibleAtomic,
  isStrokeCountedAtomic,
} from '../../../../src/systems/index.js';
import {
  ATOMIC_EVENT_TYPE_PICKUP,
  ATOMIC_EVENT_TYPE_SPLIT_UP,
  ATOMIC_EVENT_TYPE_TRANSFORM,
  atomicDuration,
} from '../../../../src/systems/readviews/animations.js';
import { TEST_MANIFEST } from '../../../fixtures/content.js';

/**
 * The atomic-animation read views - `atomicAnimationByName` (the canonical name→record resolver the
 * `atomicDuration`/combat-cadence lookups spell out inline), `isInterruptibleAtomic`, and
 * `atomicEventChannelDelta` (the net per-channel delta over the `events` array). These are genuinely extracted (245/896 animations carry
 * `interruptible=true`, 89/896 a `startDirection`, 695/896 ≥1 `event`, and 43 of the ~2900 event lines
 * are `eventx` clustering on `*_produce_*` in the real IR), so the fixture sets non-default values on a
 * couple of entries to exercise a real read, not just the schema defaults.
 *
 * The fixture mirrors the real shape: an uninterruptible directional swing (`chop`, facing pinned), an
 * interruptible idle (no facing), a plain entry that pins neither (the schema defaults), an `eat`/`sleep`
 * carrying real-shaped channel `event`s (hunger restore on channel 2, multi-tick rest restore on channel
 * 1, plus a value-less cue event that must contribute 0), and a `produce` mixing plain `event` yields
 * with `eventx` worker-drain/bracket lines (the real `*_produce_*` two-stream shape).
 */
function animationContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' }],
    atomicAnimations: [
      // A harvest swing: must play to completion (uninterruptible) and pins a facing direction.
      { id: 'viking_chop', name: 'viking_chop', length: 3, interruptible: false, startDirection: 2 },
      // An idle: a settler may abandon it the instant a higher-priority drive fires; no pinned facing.
      { id: 'viking_idle', name: 'viking_idle', length: 100, interruptible: true },
      // A plain entry pinning neither - exercises the schema defaults (interruptible=false, no facing).
      { id: 'viking_walk', name: 'viking_walk', length: 8 },
      // An eat: one hunger-channel (2) restore, plus a value-less cue event that must sum as 0.
      {
        id: 'viking_eat',
        name: 'viking_eat',
        length: 40,
        events: [
          { at: 30, type: ATOMIC_EVENT_CHANNEL.HUNGER, value: 4000 },
          { at: 35, type: 34 }, // a cue (no value) - contributes 0, doesn't throw or skew the sum
        ],
      },
      // A sleep: multiple rest-channel (1) ticks that must sum (mirrors the real per-tick +100 stream).
      {
        id: 'viking_sleep',
        name: 'viking_sleep',
        length: 100,
        events: [
          { at: 20, type: ATOMIC_EVENT_CHANNEL.REST, value: 100 },
          { at: 40, type: ATOMIC_EVENT_CHANNEL.REST, value: 100 },
          { at: 60, type: ATOMIC_EVENT_CHANNEL.REST, value: 100 },
        ],
      },
      // A produce: the real `*_produce_*` two-stream shape - plain `event` good yields alongside
      // `eventx` lines (the worker's own need-drains while labouring + the production start/end
      // brackets). Confirms the channel-delta sum spans both streams (it sums by `type`, not by
      // `extended`).
      {
        id: 'viking_produce',
        name: 'viking_produce',
        length: 100,
        events: [
          { at: 0, type: 22, value: 0, extended: true }, // production-start bracket (eventx)
          { at: 50, type: ATOMIC_EVENT_CHANNEL.HUNGER, value: -100, extended: true }, // worker self-drain (eventx)
          { at: 95, type: ATOMIC_EVENT_CHANNEL.HUNGER, value: 50 }, // a plain `event` on the same channel
          { at: 99, type: 23, value: 0, extended: true }, // production-end bracket (eventx)
        ],
      },
    ],
  });
}

describe('atomicDuration', () => {
  const VIKING = 1;
  const CIVILIST = 6;
  const CARRIER = 24;
  const PICKUP = 22;
  const UNBOUND_ATOMIC = 99;
  function boundContent(): ContentSet {
    return parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [
        { typeId: CIVILIST, id: 'civilist' },
        { typeId: CARRIER, id: 'carrier', baseJob: CIVILIST },
      ],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' }],
      tribes: [
        {
          typeId: VIKING,
          id: 'viking',
          atomicBindings: [{ jobType: CIVILIST, atomicId: PICKUP, animation: 'viking_civilist_pickup' }],
        },
      ],
      atomicAnimations: [{ id: 'viking_civilist_pickup', name: 'viking_civilist_pickup', length: 20 }],
    });
  }

  it('plays the civilist clip length for a trade that binds none itself', () => {
    const content = boundContent();
    expect(atomicDuration(content, { tribe: VIKING, jobType: CIVILIST }, PICKUP)).toBe(20);
    expect(atomicDuration(content, { tribe: VIKING, jobType: CARRIER }, PICKUP)).toBe(20);
  });

  it('keeps the unresolved default when neither the trade nor the civilist binds the atomic', () => {
    const civilist = atomicDuration(boundContent(), { tribe: VIKING, jobType: CIVILIST }, UNBOUND_ATOMIC);
    expect(atomicDuration(boundContent(), { tribe: VIKING, jobType: CARRIER }, UNBOUND_ATOMIC)).toBe(
      civilist,
    );
    expect(civilist).toBeLessThan(20);
  });
});

describe('atomicAnimationByName', () => {
  it('resolves by exact name (the setatomic join key, not the slug id); an unknown name has no record', () => {
    const content = animationContent();
    const chop = atomicAnimationByName(content, 'viking_chop');
    expect(chop?.length).toBe(3);
    expect(chop?.name).toBe('viking_chop');
    expect(atomicAnimationByName(content, 'nonexistent_anim')).toBeUndefined();
  });
});

describe('isInterruptibleAtomic', () => {
  it('reads the flag, defaulting to false for an unflagged entry and an unknown name', () => {
    const content = animationContent();
    expect(isInterruptibleAtomic(content, 'viking_idle')).toBe(true);
    expect(isInterruptibleAtomic(content, 'viking_chop')).toBe(false);
    expect(isInterruptibleAtomic(content, 'viking_walk')).toBe(false); // schema default
    expect(isInterruptibleAtomic(content, 'nonexistent_anim')).toBe(false); // safe non-preempt default
  });
});

describe('atomicEventChannelDelta', () => {
  it('sums every event on the channel, across both the plain and the eventx stream', () => {
    const content = animationContent();
    expect(atomicEventChannelDelta(content, 'viking_eat', ATOMIC_EVENT_CHANNEL.HUNGER)).toBe(4000);
    expect(atomicEventChannelDelta(content, 'viking_sleep', ATOMIC_EVENT_CHANNEL.REST)).toBe(300); // 3 x +100
    // An eventx -100 self-drain and a plain +50 on the same channel.
    expect(atomicEventChannelDelta(content, 'viking_produce', ATOMIC_EVENT_CHANNEL.HUNGER)).toBe(-50);
  });

  it('is 0 for another channel, a value-less cue, an animation without events and an unknown name', () => {
    const content = animationContent();
    expect(atomicEventChannelDelta(content, 'viking_eat', ATOMIC_EVENT_CHANNEL.REST)).toBe(0);
    expect(atomicEventChannelDelta(content, 'viking_sleep', ATOMIC_EVENT_CHANNEL.HUNGER)).toBe(0);
    expect(atomicEventChannelDelta(content, 'viking_eat', 34)).toBe(0); // the cue carries no value
    expect(atomicEventChannelDelta(content, 'viking_walk', ATOMIC_EVENT_CHANNEL.HUNGER)).toBe(0);
    expect(atomicEventChannelDelta(content, 'nonexistent_anim', ATOMIC_EVENT_CHANNEL.HUNGER)).toBe(0);
  });
});

describe('isStrokeCountedAtomic', () => {
  const VIKING = 1;
  const COLLECTOR = 8;
  const FELL = 24;
  const MINE = 25;
  const PICK = 30;
  const BARE = 31;
  const UNBOUND = 99;
  const collector = { tribe: VIKING, jobType: COLLECTOR };
  const clipWith = (name: string, type?: number) => ({
    id: name,
    name,
    length: 30,
    events: type === undefined ? [] : [{ at: 20, type }],
  });
  function gatherContent(): ContentSet {
    return parseContentSet({
      manifest: TEST_MANIFEST,
      goods: [{ typeId: 0, id: 'none' }],
      jobs: [{ typeId: COLLECTOR, id: 'collector' }],
      buildings: [{ typeId: 1, id: 'headquarters', kind: 'storage' }],
      tribes: [
        {
          typeId: VIKING,
          id: 'viking',
          atomicBindings: [
            { jobType: COLLECTOR, atomicId: FELL, animation: 'harvest_tree' },
            { jobType: COLLECTOR, atomicId: MINE, animation: 'harvest_stone' },
            { jobType: COLLECTOR, atomicId: PICK, animation: 'harvest_mushroom' },
            { jobType: COLLECTOR, atomicId: BARE, animation: 'harvest_bare' },
          ],
        },
      ],
      atomicAnimations: [
        clipWith('harvest_tree', ATOMIC_EVENT_TYPE_TRANSFORM),
        clipWith('harvest_stone', ATOMIC_EVENT_TYPE_SPLIT_UP),
        clipWith('harvest_mushroom', ATOMIC_EVENT_TYPE_PICKUP),
        clipWith('harvest_bare'),
      ],
    });
  }

  it('counts strokes on a transform or split-up clip', () => {
    const content = gatherContent();
    expect(isStrokeCountedAtomic(content, collector, FELL)).toBe(true);
    expect(isStrokeCountedAtomic(content, collector, MINE)).toBe(true);
  });

  it('takes a unit per clip on a pickup clip, one with no work event, or an unbound atomic', () => {
    const content = gatherContent();
    expect(isStrokeCountedAtomic(content, collector, PICK)).toBe(false);
    expect(isStrokeCountedAtomic(content, collector, BARE)).toBe(false);
    expect(isStrokeCountedAtomic(content, collector, UNBOUND)).toBe(false);
  });
});
