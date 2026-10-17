import { hostileMaskOf, hostilePlayerMasks } from '../../../../components/index.js';
import type { Fixed } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { BlockOverlay } from '../../../../nav/block-overlay.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { dynamicBlockOverlay } from '../../../footprint/index.js';
import { type CalmZones, calmZonesByPlayer } from '../bodies.js';
import { playerSlotBit } from '../standing-posts.js';

/** A player id outside every slot, so its slot bit is zero; only for the type, as every listed post has
 *  an owner. */
const NO_PLAYER = -1;

/** The tick's gates, built on first ask so a tick where no pair interacts builds none. {@link reset} them
 *  every tick: the caches are snapshots, so a held answer would keep approving displacements onto ground
 *  blocked since, and keep answering the old calm zones and stances. */
export class SeparationGates {
  private zones: CalmZones | undefined;
  private blocked: BlockOverlay | undefined;
  private hostile: readonly number[] | undefined;

  constructor(
    private readonly world: World,
    private ctx: SystemContext,
    private terrain: TerrainGraph,
  ) {}

  /** Drop the previous tick's answers and bind this tick's context. */
  reset(ctx: SystemContext, terrain: TerrainGraph): void {
    this.ctx = ctx;
    this.terrain = terrain;
    this.zones = undefined;
    this.blocked = undefined;
    this.hostile = undefined;
  }

  /** Whether half-cell node `(hx, hy)` lies inside one of `player`'s calm zones. */
  isGhost(player: number, hx: number, hy: number): boolean {
    this.zones ??= calmZonesByPlayer(this.world, this.terrain);
    return this.terrain.inBounds(hx, hy) && this.zones.has(player, this.terrain.nodeAt(hx, hy));
  }

  /** Keep the first `count` of `posts`, owned by `players` and standing on `nodes`, that block a mover of
   *  `player`, in order; returns the new count. An enemy's post blocks it anywhere; its own side's and its
   *  allies' only on `goal`, so it walks through them but never comes to rest on one. */
  keepBlockingPosts(
    player: number,
    goal: NodeId | undefined,
    posts: Entity[],
    players: readonly number[],
    nodes: readonly number[],
    count: number,
  ): number {
    this.hostile ??= hostilePlayerMasks(this.world);
    const hostile = hostileMaskOf(this.hostile, player);
    let kept = 0;
    for (let i = 0; i < count; i++) {
      const post = posts[i];
      if (post === undefined) continue;
      const onGoal = goal !== undefined && nodes[i] === goal;
      if ((hostile & playerSlotBit(players[i] ?? NO_PLAYER)) !== 0 || onGoal) posts[kept++] = post;
    }
    return kept;
  }

  nodeAt(x: Fixed, y: Fixed): NodeId | undefined {
    const hx = nodeHxOfPosition(x, y);
    const hy = nodeHyOfPosition(y);
    return this.terrain.inBounds(hx, hy) ? this.terrain.nodeAt(hx, hy) : undefined;
  }

  allowsLanding(x: Fixed, y: Fixed): boolean {
    const hx = nodeHxOfPosition(x, y);
    const hy = nodeHyOfPosition(y);
    if (!this.terrain.inBounds(hx, hy)) return false;
    const node = this.terrain.nodeAt(hx, hy);
    if (!this.terrain.isWalkable(node)) return false;
    this.blocked ??= dynamicBlockOverlay(this.world, this.ctx, this.terrain);
    return !this.blocked.has(node);
  }
}
