import {
  isValidPlayer,
  Owner,
  Person,
  Position,
  Residence,
  Settler,
  Signpost,
  stampOwner,
} from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { releaseEmployment } from '../../economy/jobs/binding.js';
import { relinkSignpost } from '../../signposts/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { missionHouses, ownedBy, ownedInRange, scriptedHumans, withinRange } from '../targets.js';
import { type Handed, withOwners } from './seat-tribes.js';

/** How many animals one `ChangeAnimalPlayerIdInArea` may take, whatever it asks for (reading). */
const ANIMAL_HANDOVER_CAP = 50;

/** Hand every human stamped with the id to `player`, detaching each from the job and home it held
 *  under its old owner (reading). A unit keeps its form (`lifecycle/unit-form.ts`): a script's dragons
 *  stay dragons in the receiver's hands. Returns the humans handed. */
export function handHumansToPlayer(pass: MissionPass, id: number, player: number): readonly Handed[] {
  if (!isValidPlayer(player)) return [];
  const handed = withOwners(pass.world, scriptedHumans(pass.world, id));
  for (const { entity: e } of handed) {
    detachFromHouses(pass.world, pass.ctx, e);
    stampOwner(pass.world, e, player);
  }
  return handed;
}

/** Hand every house stamped with the id to `player`. Returns the houses handed. */
export function handHousesToPlayer(pass: MissionPass, id: number, player: number): readonly Handed[] {
  const handed = withOwners(pass.world, missionHouses(pass.world, id));
  for (const { entity } of handed) stampOwner(pass.world, entity, player);
  return handed;
}

/** Hand everything one player owns to another - units, houses, vehicles and animals alike. Nobody is
 *  evicted: a town changes flag whole, so every binding inside it still points at the same owner. */
export function handPlayerToPlayer(pass: MissionPass, from: number, to: number): readonly Handed[] {
  const { world } = pass;
  if (!isValidPlayer(from) || !isValidPlayer(to) || from === to) return [];
  const handed = withOwners(
    world,
    world.canonicalQuery(Owner).filter((e) => world.get(e, Owner).player === from),
  );
  for (const { entity } of handed) stampOwner(world, entity, to);
  relinkHandedSignposts(pass, handed);
  return handed;
}

/** Hand everything one player owns within `range` of the point to another; its humans leave the job
 *  and home they held, as under `ChangeHumanPlayerId` (reading). */
export function handAreaToPlayer(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'ChangePlayerIdInArea' }>,
): readonly Handed[] {
  if (!isValidPlayer(op.player) || !isValidPlayer(op.otherPlayer)) return [];
  const handed = withOwners(pass.world, ownedInRange(pass.world, op.player, op.point, op.range));
  for (const { entity: e } of handed) {
    if (pass.world.has(e, Person)) detachFromHouses(pass.world, pass.ctx, e);
    stampOwner(pass.world, e, op.otherPlayer);
  }
  relinkHandedSignposts(pass, handed);
  return handed;
}

/** Relink the signposts among `handed` once every one carries its new owner, so posts handed together
 *  link to each other as well as to the receiver's. */
function relinkHandedSignposts(pass: MissionPass, handed: readonly Handed[]): void {
  const terrain = pass.ctx.terrain;
  if (terrain === undefined) return;
  for (const { entity } of handed)
    if (pass.world.has(entity, Signpost)) relinkSignpost(pass.world, terrain, entity, pass.ctx.content);
}

/**
 * Hand animals of one species within `range` to another player: `amount` of them, or every match for
 * an amount of 0, and never more than {@link ANIMAL_HANDOVER_CAP} either way - the corpus asks for
 * 1,000 goats on a line the original serves 50 of. The wild slot names the creatures the sim leaves
 * ownerless, so a script can tame a herd nobody owned.
 */
export function handAnimalsToPlayer(
  pass: MissionPass,
  op: Extract<MissionResultOp, { opcode: 'ChangeAnimalPlayerIdInArea' }>,
): void {
  const { world } = pass;
  const wanted = op.amount > 0 ? Math.min(op.amount, ANIMAL_HANDOVER_CAP) : ANIMAL_HANDOVER_CAP;
  const herd = world
    .canonicalQuery(Settler, Position)
    .filter(
      (e) =>
        !world.has(e, Person) &&
        world.get(e, Settler).tribe === op.tribe &&
        ownedBy(world, e, op.player) &&
        withinRange(world, e, op.point, op.range),
    );
  for (const e of herd.slice(0, wanted)) stampOwner(world, e, op.otherPlayer);
}

function detachFromHouses(world: World, ctx: SystemContext, e: Entity): void {
  if (!world.has(e, Settler)) return;
  releaseEmployment(world, ctx, e);
  world.remove(e, Residence);
}
