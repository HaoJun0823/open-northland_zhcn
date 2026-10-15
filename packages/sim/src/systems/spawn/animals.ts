import { ANIMAL_WATER_TRIBES } from '@open-northland/data';
import {
  AnimalFlags,
  addWildlife,
  Health,
  Livestock,
  MoveStepPeriod,
  Position,
  Settler,
  StayPoint,
  stampMissionId,
  stampOwner,
  WildHabitat,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { positionOfNode } from '../../nav/halfcell.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { evictSettlerFromBlockedSpawn } from '../movement/evict.js';
import { animalHitpoints, herdParams, isCatchableAnimal, locomotionOf } from '../readviews/index.js';
import { COMPASS_DIRECTIONS, entityNode } from '../spatial/nodes.js';
import { idleClipTicks } from '../wildlife/clips.js';
import { waterAnimalSpawnNode } from './water-animals.js';

/** The spread of a new animal's starting hunger, in ticks. */
const BIRTH_HUNGER_SPREAD = 400;

/** Upper bound on one spawn command's herd size - the real `maximumgroupsize` values are 2..6, so any
 *  count near this cap is corrupted input, not content. */
const HERD_COUNT_CAP = 100;

/**
 * Spawn a herd of an animal tribe around a birth point: `max(1, maximumgroupsize)` creatures, or the
 * command's clamped `count` override, each a {@link Settler} of the animal `tribe` at `jobType: null`
 * carrying its `hitpoints_adult` pool. Members scatter around (x,y) within `maximumdistancetobirthpoint`
 * and start leaderless: the herding drive groups them on its next pass, as the original does on each new
 * animal's first update. A tribe with no `animaltypes` record is bad input.
 *
 * Source basis: group size, HP pool, birth-point range, and `movespeed` are the verbatim extracted
 * `animaltypes.ini` params.
 *
 * Approximations: the scatter pattern, pushing a member off blocked ground, and spawning adult at
 * `jobType: null` with no weapon binding.
 *
 * Determinism: the scatter offsets are a fixed function of the member index, and the content reads are
 * pure.
 */
export function spawnAnimalHerd(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'spawnAnimalHerd' }>,
): void {
  const herd = herdParams(ctx.content, command.tribe);
  if (herd === null) return; // not an animal tribe (a civilization / unknown) - bad input, skip
  const hitpoints = animalHitpoints(ctx.content, command.tribe) ?? 0; // an animal record always has both
  // A `hitpoints 0` record (the real butterflies, bees, and mosquitos) is a decorative swarm rather than a
  // creature, and a living Settler minted from one would be born dead and reaped the same tick.
  // Approximation: no swarm-effect layer exists yet.
  if (hitpoints <= 0) return;

  // A solitary group still yields one creature, and the floor plus cap keep a malformed external count
  // (fractional, negative, absurd) from minting a map of creatures in one tick.
  const count = Math.min(HERD_COUNT_CAP, Math.max(1, Math.floor(command.count ?? herd.maxGroupSize)));
  const range = Math.max(0, herd.birthPointRange);
  // One claim set across the herd: each member records its final node, so neither a push nor a
  // radius-clamped scatter ends two members on one cell.
  const claimed = new Set<NodeId>();
  const water = ANIMAL_WATER_TRIBES.has(command.tribe);
  const terrain = ctx.terrain;
  if (water && terrain === undefined) return;
  const waterBlocks = water && terrain !== undefined ? dynamicBlockOverlay(world, ctx, terrain) : undefined;
  let waterComponent: number | undefined;
  for (let i = 0; i < count; i++) {
    const off = herdMemberOffset(i, range);
    let x = command.x + off.dx;
    let y = command.y + off.dy;
    if (waterBlocks !== undefined && terrain !== undefined) {
      const node = waterAnimalSpawnNode(terrain, x, y, waterBlocks, claimed, waterComponent);
      if (node === null) continue;
      waterComponent ??= terrain.componentOf(node);
      x = terrain.xOf(node);
      y = terrain.yOf(node);
    }
    const e = world.create();
    world.add(e, Position, positionOfNode(x, y));
    stampAnimalBody(world, ctx, e, command.tribe, hitpoints);
    // Every member of an authored herd answers to the same id: an id names a group, not one creature.
    stampMissionId(world, e, command.missionId);
    // A `setanimal` names the wild slot for game and a real player for a tended herd; only the latter
    // is a valid sim owner, so wildlife stays neutral.
    stampOwner(world, e, command.owner);
    stampAnimalFlags(world, e, command.flags ?? 0);
    settleWildRange(world, ctx, e, claimed);
  }
}

/**
 * Give a freshly placed animal its range: pushed off blocked or taken ground (`claimed` collects the nodes
 * already handed out this spawn), then its birth, stay and work-center points all on the node it ends up
 * on. Original behavior: a new animal starts with 0..399 ticks of hunger, no food budget, and an idle clip
 * before its first decision.
 */
export function settleWildRange(world: World, ctx: SystemContext, e: Entity, claimed: Set<NodeId>): void {
  // The birth point or a scatter offset may name blocked or already-taken ground, and no drive ever
  // re-tasks an idle animal off a blocked cell, so the push has to happen here.
  evictSettlerFromBlockedSpawn(world, ctx, e, claimed);
  stampWildRange(world, ctx, e);
}

/** Stamp a fresh wild range on the node `e` stands on: birth, stay and work-center points there, a new
 *  hunger spread, no food budget, and an idle clip before its next decision. */
export function stampWildRange(world: World, ctx: SystemContext, e: Entity): void {
  if (ctx.terrain === undefined) return;
  const node = entityNode(world, ctx.terrain, e);
  world.add(e, StayPoint, { cell: node });
  world.add(e, WildHabitat, {
    birth: node,
    workCenter: node,
    fedUntil: ctx.tick + ctx.rng.int(BIRTH_HUNGER_SPREAD),
    food: 0,
    nextStayAt: ctx.tick + idleClipTicks(ctx.content, ctx.rng, world.get(e, Settler)),
  });
}

/**
 * Stamp the parts every creature of `tribe` carries whatever spawned it: its {@link Settler} identity,
 * its hitpoint pool, its walking pace, and the {@link Livestock} marker mirroring the content's
 * `catchable` flag, so the husbandry systems query that small store rather than the whole population.
 *
 * The original advances one map-point step in `movespeed` ticks at a steady gait. The timing of
 * first steps and turns has not been confirmed against the running game with the current mod.
 */
export function stampAnimalBody(
  world: World,
  ctx: SystemContext,
  e: Entity,
  tribe: number,
  hitpoints: number,
): void {
  addWildlife(world, e, tribe);
  world.add(e, Health, { hitpoints, max: hitpoints });
  if (isCatchableAnimal(ctx.content, tribe)) world.add(e, Livestock, {});
  const walkSpeed = locomotionOf(ctx.content, tribe)?.walkSpeed ?? 0;
  if (walkSpeed > 0) world.add(e, MoveStepPeriod, { ticks: walkSpeed });
}

/** Stamp a nonzero `setanimal` flags word on `e`; none is stamped for 0. */
export function stampAnimalFlags(world: World, e: Entity, bits: number): void {
  if (bits !== 0) world.add(e, AnimalFlags, { bits });
}

/**
 * The deterministic tile offset for the `i`-th member of a herd, kept within `range` of the birth point.
 * Member 0 lands on the birth point and the rest spiral out along an expanding 8-direction ring whose radius
 * is clamped at `range`, a fixed function of `(i, range)` with no RNG.
 *
 * Past 9 members, or with `range` 0, the clamp re-uses ring directions and two members can be offset onto
 * the same tile; real `maximumgroupsize` values (3..6) never reach that, and the spawn's claim set fans the
 * later one aside. This is an approximated placement, not a packing guarantee.
 */
function herdMemberOffset(i: number, range: number): { dx: number; dy: number } {
  if (i === 0 || range <= 0) return { dx: 0, dy: 0 }; // the first (leader) sits on the birth point
  // COMPASS_DIRECTIONS is in a fixed canonical order, so the scatter reproduces exactly.
  const ring = Math.floor((i - 1) / COMPASS_DIRECTIONS.length) + 1; // 1, 2, 3, … as the rings fill
  const dir = COMPASS_DIRECTIONS[(i - 1) % COMPASS_DIRECTIONS.length];
  if (dir === undefined) return { dx: 0, dy: 0 }; // unreachable: a modulo index is always in range
  const radius = Math.min(ring, range); // never past the birth-point range
  return { dx: dir[0] * radius, dy: dir[1] * radius };
}
