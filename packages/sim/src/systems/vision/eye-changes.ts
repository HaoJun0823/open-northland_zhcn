import {
  Building,
  Owner,
  Position,
  Settler,
  SettlerProgress,
  UnderConstruction,
  Upgrading,
  Vehicle,
} from '../../components/index.js';
import type { ChangeFeed, Component, Entity, World } from '../../ecs/world.js';
import { type NodeMoveFeed, watchNodeMoves } from '../spatial/node-moves.js';

// Everything an eye's footprint reads besides its node: which kinds it is, its owner, and its radius.
const EYE_MEMBERSHIP: readonly Component<unknown>[] = [
  Settler,
  Building,
  Vehicle,
  Owner,
  Position,
  UnderConstruction,
  Upgrading,
  SettlerProgress,
];
const EYE_VALUES: readonly Component<unknown>[] = [Settler, Building, Vehicle, Owner, SettlerProgress];

/**
 * The entities whose eye footprint may have changed since the last vision rebuild: a node move, or a
 * write to a store the footprint reads. A memoizing rebuild visits only these while the fog's eye memo
 * still holds every other eye; another rebuild drains them unread.
 */
export class EyeChanges {
  private readonly identity: ChangeFeed;
  private readonly moves: NodeMoveFeed;
  /** The fog's {@link FogState.eyeMemo} at the last memoizing rebuild, -1 before one. */
  private memoAt = -1;
  /** The changed entities of the rebuild in hand, reused; may repeat an entity. */
  private readonly changed: Entity[] = [];
  private readonly collect = (e: Entity): void => {
    this.changed.push(e);
  };

  constructor(world: World) {
    this.identity = world.watchChanges(EYE_MEMBERSHIP, EYE_VALUES);
    this.moves = watchNodeMoves(world);
  }

  /**
   * The entities to visit in this rebuild, or null when it must visit every eye: not memoizing, the
   * memo was dropped since the last memoizing rebuild, or a feed overflowed. Either way the feeds are
   * drained, and `memo` records the memo this rebuild leaves.
   */
  take(memoizing: boolean, memo: number): readonly Entity[] | null {
    this.changed.length = 0;
    const identityLost = this.identity.drain(this.collect);
    const movesLost = this.moves.drain(this.collect);
    const lost = identityLost || movesLost;
    const replay = memoizing && !lost && this.memoAt === memo;
    this.memoAt = memoizing ? memo : -1;
    return replay ? this.changed : null;
  }
}

const byWorld = new WeakMap<World, EyeChanges>();

export function eyeChangesOf(world: World): EyeChanges {
  let changes = byWorld.get(world);
  if (changes === undefined) {
    changes = new EyeChanges(world);
    byWorld.set(world, changes);
  }
  return changes;
}
