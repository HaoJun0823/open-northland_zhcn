import {
  AiOrder,
  AttackOrder,
  computerModuleRuns,
  diplomacyStance,
  Engagement,
  Health,
  JobAssignment,
  MapAiDefence,
  type MapAiDefenceState,
  Owner,
  Position,
  Rider,
} from '../../../components/index.js';
import { aiCommand } from '../../../core/commands/index.js';
import type { DeepReadonly, Entity, World } from '../../../ecs/world.js';
import { hexDistanceBetween, nodeOfPosition } from '../../../nav/halfcell.js';
import type { System } from '../../context.js';
import { isTravelling } from '../../movement/nav-state.js';
import { withdrawAiEntityOrder } from '../../orders/ai-lifecycle.js';
import { setStance } from '../../orders/combat.js';
import { MILITARY_MODE } from '../../readviews/index.js';
import { mapAiSoldierClaims } from './ownership.js';

function insideCamp(world: World, entity: Entity, assignment: DeepReadonly<MapAiDefenceState>): boolean {
  const position = world.tryGet(entity, Position);
  if (position === undefined) return false;
  const at = nodeOfPosition(position.x, position.y);
  return hexDistanceBetween(at.hx, at.hy, assignment.centre.hx, assignment.centre.hy) <= assignment.radius;
}

function threatRemains(world: World, assignment: DeepReadonly<MapAiDefenceState>): boolean {
  const owner = world.tryGet(assignment.threat, Owner)?.player;
  return (
    owner !== undefined &&
    diplomacyStance(world, owner, assignment.player) === 'enemy' &&
    (world.tryGet(assignment.threat, Health)?.hitpoints ?? 0) > 0 &&
    insideCamp(world, assignment.threat, assignment)
  );
}

/** Check only active local sorties before movement. The decision cadence must not let an attack-move
 * acquire an unlimited chase between decisions; returning uses an ordinary move and a stationary stance. */
export const mapDefenceLeashSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return;
  for (const entity of world.query(MapAiDefence)) {
    const assignment = world.get(entity, MapAiDefence);
    const origin = world.tryGet(entity, AiOrder);
    if (
      origin?.source !== 'settlement-defence' ||
      origin.player !== assignment.player ||
      world.tryGet(entity, Owner)?.player !== assignment.player ||
      computerModuleRuns(world, assignment.player, 'military') ||
      mapAiSoldierClaims(world, assignment.player).has(entity) ||
      world.has(entity, JobAssignment) ||
      world.has(entity, Rider)
    ) {
      world.remove(entity, MapAiDefence);
      continue;
    }
    if (assignment.returning) {
      if (!isTravelling(world, entity)) {
        setStance(world, ctx, { kind: 'setStance', entity, mode: MILITARY_MODE.IGNORE });
        world.remove(entity, MapAiDefence);
      }
      continue;
    }
    const pursued = world.tryGet(entity, AttackOrder)?.target ?? world.tryGet(entity, Engagement)?.target;
    if (
      insideCamp(world, entity, assignment) &&
      threatRemains(world, assignment) &&
      (pursued === undefined || insideCamp(world, pursued, assignment))
    )
      continue;

    withdrawAiEntityOrder(world, ctx, entity);
    // Stop reacquiring a chase this tick, before the return order applies on the next one.
    setStance(world, ctx, { kind: 'setStance', entity, mode: MILITARY_MODE.IGNORE });
    world.mut(entity, MapAiDefence).returning = true;
    ctx.commands.enqueue(
      aiCommand(
        assignment.player,
        {
          kind: 'moveUnit',
          entity,
          x: assignment.home.hx,
          y: assignment.home.hy,
        },
        'settlement-defence',
      ),
    );
  }
};
