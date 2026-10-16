import type { ContentSet } from '@open-northland/data';
import type { World } from '../ecs/world.js';

// The content a world's content-keyed component payloads resolve against, so a reader holding only the
// world can turn a key into its data. An immutable input bound once, not world state.

const contentByWorld = new WeakMap<World, ContentSet>();

/** Bind `world` to `content`; a world already bound keeps its content. */
export function bindWorldContent(world: World, content: ContentSet): void {
  if (!contentByWorld.has(world)) contentByWorld.set(world, content);
}

export function worldContent(world: World): ContentSet {
  const content = contentByWorld.get(world);
  if (content === undefined) throw new Error('world is bound to no content: build it through a Simulation');
  return content;
}
