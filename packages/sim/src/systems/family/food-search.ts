import type { ContentSet } from '@open-northland/data';
import { Owner, ownerOf, ownersCompatible, Position, Stockpile } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition, nodeOfPosition } from '../../nav/halfcell.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { edibleGoodFormOf, isFoodIn } from '../readviews/index.js';
import { hasRoom } from '../settlers/drives/economy/store-policy.js';
import { interactionCell, unclaimedGoodsAt } from '../settlers/targets/index.js';
import { accessibleStockAmounts, type SupplyTally } from '../stores/index.js';
import { type FoodSources, foodSourcesOf } from './food-sources.js';

/**
 * The greatest Manhattan ring radius (half-cell nodes) {@link ExternalFoodIndex.nearest} expands to before
 * falling back to the linear scan. Authored performance cap: the fallback reproduces the exact linear
 * winner.
 */
const RING_MAX_RADIUS = 48;

/**
 * Candidate count at or below which {@link ExternalFoodIndex.nearest} goes straight to the linear scan.
 * Performance knob with an identical winner: the ring and the linear scan share the
 * (distance, entity-id) order. A full sweep reads about 2 * {@link RING_MAX_RADIUS}^2 nodes, more than
 * a few hundred candidates judged nearest-first.
 */
const RING_MIN_CANDIDATES = 256;

/**
 * One pass's view of the shared {@link FoodSources}, caught up when the pass makes it: each seeker pays a
 * bounded ring search over it, with her own side, signpost gate and failed goals applied per query.
 */
export class ExternalFoodIndex {
  private readonly sources: FoodSources;

  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly terrain: TerrainGraph | undefined,
    private readonly supply: SupplyTally,
  ) {
    this.sources = foodSourcesOf(world, ctx.content);
  }

  /**
   * The nearest external food source to `from` holding an unclaimed unit of a food `home`'s larder has
   * room for, or null when none exists anywhere. A food whose slot is full is skipped, since the delivery
   * would be refused and the unit carried straight back. `gate` is the seeker's signpost confinement (null
   * when unlimited), `avoid` her failed-goal veto, probed at the source's interaction cell, the node
   * `fetchFrom` walks to. `owner` is her player: she hauls only out of her own side's stores. The shared
   * candidate list is owner-blind, so her side is checked per seeker.
   */
  nearest(
    from: { hx: number; hy: number },
    owner: number | undefined,
    home: Entity,
    gate: SpatialGate | null,
    avoid?: (cell: NodeId) => boolean,
  ): { store: Entity; goodType: number } | null {
    const { candidates, buckets } = this.sources;
    if (candidates.length === 0) return null;
    if (!this.world.has(home, Stockpile)) return null;
    const roomy = this.foodsWithRoomAt(home);
    // No store can then offer her a unit, so the scan over every candidate is skipped.
    if (roomy.length === 0) return null;
    const accept = (e: Entity): boolean =>
      ownersCompatible(owner, ownerOf(this.world, e)) &&
      this.liftableFood(e, roomy) !== null &&
      this.inArea(e, gate) &&
      !this.standRetired(e, from, avoid);
    const hit =
      candidates.length <= RING_MIN_CANDIDATES
        ? null
        : buckets.nearest(from.hx, from.hy, 0, RING_MAX_RADIUS, accept);
    // A ring sweep that missed rejected every candidate inside its radius already.
    const swept = candidates.length <= RING_MIN_CANDIDATES ? -1 : RING_MAX_RADIUS;
    const store = hit?.entity ?? this.linearNearest(this.onSide(owner), from, accept, swept);
    if (store === null) return null;
    const goodType = this.liftableFood(store, roomy);
    // A null here would mean a mid-pass mutation drained the winner: fail the query rather than guess.
    return goodType === null ? null : { store, goodType };
  }

  /** The candidates `owner` may haul from, ascending id; `accept` still checks the side. */
  private onSide(owner: number | undefined): readonly Entity[] {
    return foodSourceSides(this.world).of(this.sources.candidates, owner);
  }

  /** The family foods, ascending, that `home`'s larder has room for. */
  private foodsWithRoomAt(home: Entity): number[] {
    const roomy: number[] = [];
    for (const goodType of familyFoods(this.ctx.content)) {
      if (hasRoom(this.world, this.ctx, home, goodType)) roomy.push(goodType);
    }
    return roomy;
  }

  /** The lowest of the ascending `roomy` foods `store` holds a unit of that no walker has claimed: the
   *  `lowestStockedFood` pick, probed per food rather than over the store's whole inventory. */
  private liftableFood(store: Entity, roomy: readonly number[]): number | null {
    const { world, supply } = this;
    const amounts = accessibleStockAmounts(world, store);
    if (amounts === undefined) return null;
    let unclaimed: ((goodType: number) => boolean) | undefined | null = null;
    for (let i = 0; i < roomy.length; i++) {
      const goodType = roomy[i];
      if (goodType === undefined || (amounts.get(goodType) ?? 0) <= 0) continue;
      if (unclaimed === null) unclaimed = unclaimedGoodsAt(world, this.ctx, supply, store);
      if (unclaimed === undefined || unclaimed(goodType)) return goodType;
    }
    return null;
  }

  /** Whether the seeker's `avoid` veto retires this source's interaction cell, her own stand exempt. */
  private standRetired(
    e: Entity,
    from: { hx: number; hy: number },
    avoid: ((cell: NodeId) => boolean) | undefined,
  ): boolean {
    if (avoid === undefined || this.terrain === undefined) return false;
    const here = this.terrain.nodeAtClamped(from.hx, from.hy);
    const cell = interactionCell(this.world, this.ctx, this.terrain, e, here);
    return cell !== here && avoid(cell);
  }

  /** Whether the store's own node lies inside the seeker's allowed area (no gate/terrain = everywhere). */
  private inArea(e: Entity, gate: SpatialGate | null): boolean {
    if (gate === null || this.terrain === undefined) return true;
    const p = this.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    return gate.allowsNode(this.terrain.nodeAtClamped(node.hx, node.hy));
  }

  /** The strictly-nearer pick over the ascending-id candidates beyond Manhattan distance `swept`. The
   *  distance is read first, so a candidate that could not win is never judged. */
  private linearNearest(
    candidates: readonly Entity[],
    from: { hx: number; hy: number },
    accept: (e: Entity) => boolean,
    swept: number,
  ): Entity | null {
    let best: Entity | null = null;
    let bestDist = 0;
    for (const e of candidates) {
      const p = this.world.get(e, Position);
      const dist = Math.abs(nodeHxOfPosition(p.x, p.y) - from.hx) + Math.abs(nodeHyOfPosition(p.y) - from.hy);
      if (dist <= swept || (best !== null && dist >= bestDist)) continue;
      if (accept(e)) {
        best = e;
        bestDist = dist;
      }
    }
    return best;
  }
}

/** Every good a family takes away as food (see `lowestStockedFood`), ascending, per content set. */
const familyFoodsByContent = new WeakMap<ContentSet, readonly number[]>();

function familyFoods(content: ContentSet): readonly number[] {
  let foods = familyFoodsByContent.get(content);
  if (foods === undefined) {
    foods = [...contentIndex(content).goods.keys()]
      .filter((goodType) => isFoodIn(content, edibleGoodFormOf(content, goodType)))
      .sort((a, b) => a - b);
    familyFoodsByContent.set(content, foods);
  }
  return foods;
}

/**
 * An ascending-id candidate list split by side: each player's entities merged with the neutral ones, so a
 * scan skips every other player's. Re-split when the list's members differ from the last split's or any
 * {@link Owner} is added, removed or written.
 */
export class CandidateSides {
  private readonly byOwner = new Map<number, Entity[]>();
  private neutral: Entity[] = [];
  private readonly split: Entity[] = [];
  private ownerMembership = -1;
  private ownerValues = -1;

  constructor(private readonly world: World) {}

  /** The `candidates` {@link ownersCompatible} with `owner`, ascending id. */
  of(candidates: readonly Entity[], owner: number | undefined): readonly Entity[] {
    if (owner === undefined) return candidates;
    const membership = this.world.componentGeneration(Owner);
    const values = this.world.componentValueGeneration(Owner);
    if (membership !== this.ownerMembership || values !== this.ownerValues || !this.splitFrom(candidates)) {
      this.resplit(candidates);
      this.ownerMembership = membership;
      this.ownerValues = values;
    }
    return this.byOwner.get(owner) ?? this.neutral;
  }

  private splitFrom(candidates: readonly Entity[]): boolean {
    const { split } = this;
    if (split.length !== candidates.length) return false;
    for (let i = 0; i < split.length; i++) if (split[i] !== candidates[i]) return false;
    return true;
  }

  private resplit(candidates: readonly Entity[]): void {
    this.byOwner.clear();
    this.neutral = [];
    this.split.length = 0;
    for (const e of candidates) {
      this.split.push(e);
      const owner = ownerOf(this.world, e);
      if (owner === undefined) {
        this.neutral.push(e);
        for (const list of this.byOwner.values()) list.push(e);
        continue;
      }
      let list = this.byOwner.get(owner);
      if (list === undefined) {
        list = this.neutral.slice();
        this.byOwner.set(owner, list);
      }
      list.push(e);
    }
  }
}

const sidesByWorld = new WeakMap<World, CandidateSides>();

function foodSourceSides(world: World): CandidateSides {
  let sides = sidesByWorld.get(world);
  if (sides === undefined) {
    sides = new CandidateSides(world);
    sidesByWorld.set(world, sides);
  }
  return sides;
}
