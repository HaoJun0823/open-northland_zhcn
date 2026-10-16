import { describe, expect, it } from 'vitest';
import { CHANGE_FEED_LIMIT } from '../../src/ecs/change-feed.js';
import { defineComponent, type Entity, World } from '../../src/ecs/world.js';

/** `World.watchChanges`: one entity log across several stores' membership and value writes. */

interface Tag {
  n: number;
}

const Watched = defineComponent<Tag>('FeedWatched', 'economy');
const Valued = defineComponent<Tag>('FeedValued', 'economy');
const Ignored = defineComponent<Tag>('FeedIgnored', 'economy');

function drained(feed: { drain(consume: (e: Entity) => void): boolean }): Entity[] | 'rebuild' {
  const out: Entity[] = [];
  return feed.drain((e) => out.push(e)) ? 'rebuild' : out;
}

describe('World change feeds', () => {
  it('logs watched membership changes and value writes across stores, in order', () => {
    const w = new World();
    const feed = w.watchChanges([Watched], [Valued]);
    const a = w.create();
    const b = w.create();
    w.add(a, Watched, { n: 1 });
    w.add(b, Valued, { n: 1 }); // membership of a values-only store is not watched
    w.add(b, Ignored, { n: 1 });
    w.mut(b, Valued).n = 2;
    w.mut(b, Valued).n = 3;
    w.destroy(a); // a pending entity is held once, at its first write
    expect(feed.pending).toBe(true);
    expect(drained(feed)).toEqual([a, b]);
    expect(feed.pending).toBe(false);
  });

  it('holds an entity again once drained, and keeps a write made while draining for the next drain', () => {
    const w = new World();
    const feed = w.watchChanges([], [Valued]);
    const a = w.create();
    const b = w.create();
    w.add(a, Valued, { n: 1 });
    w.add(b, Valued, { n: 1 });
    w.mut(a, Valued).n = 2;
    w.mut(b, Valued).n = 2;
    const rewriteA = (e: Entity): void => {
      if (e === a) w.mut(a, Valued).n = 3;
    };
    expect(feed.drain(rewriteA)).toBe(false);
    expect(drained(feed)).toEqual([a]);
    w.mut(b, Valued).n = 3;
    w.mut(a, Valued).n = 4;
    w.mut(b, Valued).n = 4;
    expect(drained(feed)).toEqual([b, a]);
  });

  it('asks its reader to rebuild after an overflow or a restored store', () => {
    const w = new World();
    const feed = w.watchChanges([Watched], []);
    const first = w.create();
    w.add(first, Watched, { n: 0 });
    for (let i = 1; i < CHANGE_FEED_LIMIT; i++) w.add(w.create(), Watched, { n: i });
    w.add(first, Watched, { n: -1 }); // a held entity never counts twice toward the limit
    expect(feed.peek(() => {})).toBe(false);
    w.add(w.create(), Watched, { n: CHANGE_FEED_LIMIT });
    expect(drained(feed)).toBe('rebuild');
    expect(drained(feed)).toEqual([]);
    w.add(first, Watched, { n: 0 }); // the overflow released every held entity
    expect(drained(feed)).toEqual([first]);

    const restored = new World();
    const restoredFeed = restored.watchChanges([Watched], []);
    restored.restoreStore(Watched, [[restored.create(), { n: 1 }]]);
    expect(drained(restoredFeed)).toBe('rebuild');
  });
});
