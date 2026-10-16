import type { ContentSet } from '@open-northland/data';
import type { World } from '../ecs/world.js';

// The content a world's content-keyed component payloads resolve against, so a reader holding only the
// world can turn a key into its data. An immutable input bound once, not world state.

const contentByWorld = new WeakMap<World, ContentSet>();

/** Bind `world` to `content`. A world binds once: a second, different content would re-key its payloads. */
export function bindWorldContent(world: World, content: ContentSet): void {
  const bound = contentByWorld.get(world);
  if (bound === undefined) contentByWorld.set(world, content);
  else if (bound !== content) throw new Error('world is already bound to a different content set');
}

export function worldContent(world: World): ContentSet {
  const content = contentByWorld.get(world);
  if (content === undefined) throw new Error('world is bound to no content: build it through a Simulation');
  return content;
}
