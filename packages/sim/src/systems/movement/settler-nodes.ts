import { Position, Settler } from '../../components/index.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import { HeldNodes, NO_NODE } from '../spatial/held-nodes.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';
import { NodeBuckets } from '../spatial/nodes.js';

/** Shared occupancy for gate retries and evictions. Only changed memberships and node crossings
 * update buckets; fractional steps within the same node leave the index alone. The bucketed nodes are
 * held in typed columns, so catching up on a backlog of moves allocates nothing. */
class SettlerNodes {
  private readonly membership: ChangeFeed;
  private readonly moves: NodeMoveFeed;
  /** Each settler's bucketed node, {@link NO_NODE} for an entity not bucketed. */
  private readonly nodes = new HeldNodes();
  readonly buckets: NodeBuckets;
  /** The drains' consumer, a field so the feeds call it directly. */
  private readonly resync = (e: Entity): void => {
    const world = this.world;
    const p = world.has(e, Settler) ? world.tryGet(e, Position) : undefined;
    let hx = NO_NODE;
    let hy = 0;
    if (p !== undefined) {
      hx = nodeHxOfPosition(p.x, p.y);
      hy = nodeHyOfPosition(p.y);
    }
    const nodes = this.nodes;
    const heldX = nodes.hx(e);
    const heldY = nodes.hy(e);
    if (heldX === hx && heldY === hy) return;
    if (heldX !== NO_NODE) this.buckets.remove(e, heldX, heldY);
    nodes.set(e, hx, hy, world.nextEntityId);
    if (hx !== NO_NODE) this.buckets.insert(e, hx, hy);
  };

  constructor(private readonly world: World) {
    this.membership = world.watchChanges([Settler, Position], []);
    this.moves = watchNodeMoves(world);
    this.buckets = new NodeBuckets(world, []);
    this.rebuild();
  }

  catchUp(): NodeBuckets {
    const membershipLost = this.membership.drain(this.resync);
    const movesLost = this.moves.drain(this.resync);
    if (membershipLost || movesLost) this.rebuild();
    return this.buckets;
  }

  private rebuild(): void {
    const world = this.world;
    const entities = world.canonicalQuery(Settler, Position);
    const idLimit = world.nextEntityId;
    this.buckets.refill(world, entities);
    this.nodes.reset(idLimit);
    for (const e of entities) {
      const p = world.get(e, Position);
      this.nodes.set(e, nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y), idLimit);
    }
  }
}
const indexes = new WeakMap<World, SettlerNodes>();

export function settlersByNode(world: World): NodeBuckets {
  let index = indexes.get(world);
  if (index === undefined) {
    index = new SettlerNodes(world);
    indexes.set(world, index);
    world.registerCacheVerifier('settlerNodes', () => verify(world));
  }
  return index.catchUp();
}

function verify(world: World): string[] {
  const held = settlersByNode(world);
  const fresh = new NodeBuckets(world, world.canonicalQuery(Settler, Position));
  for (const buckets of [held, fresh]) {
    for (const { x, y } of buckets.buckets()) {
      const a = held.at(x, y),
        b = fresh.at(x, y);
      if (a.length !== b.length || a.some((e, i) => e !== b[i])) return [`settlerNodes stale at ${x},${y}`];
    }
  }
  return [];
}
