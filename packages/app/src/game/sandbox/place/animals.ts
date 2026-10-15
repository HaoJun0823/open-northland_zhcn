import { cellAnchorNode, components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { directSpawnContext } from './context.js';

const { Settler } = components;

/**
 * Spawn a herd of `tribe` around cell (x, y) directly (scene setup, pre-tick-0) and return its members
 * in ascending id, so a scene can address them. Omitted, `count` is the tribe's group size.
 */
export function spawnAnimalHerdDirect(
  sim: Simulation,
  tribe: number,
  x: number,
  y: number,
  opts: { readonly count?: number; readonly owner?: number } = {},
): Entity[] {
  const before = new Set(sim.world.query(Settler));
  const node = cellAnchorNode(x, y);
  systems.spawnAnimalHerd(sim.world, directSpawnContext(sim), {
    kind: 'spawnAnimalHerd',
    tribe,
    x: node.hx,
    y: node.hy,
    ...(opts.count !== undefined ? { count: opts.count } : {}),
    ...(opts.owner !== undefined ? { owner: opts.owner } : {}),
  });
  return [...sim.world.query(Settler)].filter((e) => !before.has(e)).sort((a, b) => a - b);
}
