import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { planSettlementDefence } from '../../ai-shared/military/settlement-defence.js';
import { ownedBuildings } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import type { ComputerModule } from '../index.js';

import { marchingWave } from './march/index.js';
import { runOffensive } from './offensive.js';
import { outfitGrantOrders } from './outfit.js';
import { siegeCrewOrders } from './siege-crew.js';

export {
  type ArmyCensus,
  fighterWeaponClass,
  TOWER_POST_STRENGTH,
  takeCensus,
  type WeaponMix,
  weaponMix,
} from '../../ai-shared/military/census.js';
export {
  enemyFire,
  MAP_AI_DEFENCE_REACH_POINTS,
  MAP_AI_PEACE_ARCHERS_PER_CLASS,
  seatRaiders,
  THREAT_STAND_DOWN_MARGIN_NODES,
  TOWER_GARRISON_ARCHERS,
  threatWatchNodes,
  towerPostOrders,
} from '../../ai-shared/military/defence/index.js';
export { campaignTarget } from './campaign.js';
export {
  CATAPULT_REGROUP_SLACK_NODES,
  CHARGE_ARMY_DIVISOR,
  CHARGE_MIN_ENEMIES,
  CHARGE_RADIUS_NODES,
  FIGHT_HOLD_TIMEOUT_TICKS,
  LEG_NODES,
  LEG_TIMEOUT_TICKS,
  RANKS_BEHIND_CATAPULTS_NODES,
  REGROUP_SLACK_NODES,
  SIEGE_MARCH_MIN_CATAPULTS,
  SIEGE_STANDOFF_NODES,
  SIEGE_TIMEOUT_TICKS,
  SIEGE_TOWER_RADIUS_NODES,
  SIEGE_TOWER_STANDOFF_NODES,
} from './march/index.js';
export {
  ASSAULT_RING_RADIUS_NODES,
  RALLY_HOLD_RADIUS_NODES,
  rallyAt,
  WAVE_MIN_SOLDIERS,
} from './muster.js';
export { SOLDIER_OUTFIT_GOOD_IDS } from './outfit.js';
export {
  ARMY_CAP_SOLDIERS,
  LATE_WAVE,
  OPENING_WAVE,
  WAVE_GATHER_TICKS,
  WAVE_RAMP_TICKS,
  waveBandAt,
} from './plan.js';
export {
  type CrewedCatapult,
  crewedCatapults,
  PARK_RING_MAX_NODES,
  PARK_RING_MIN_NODES,
  PARK_SPACING_NODES,
  parkingOrders,
} from './siege-crew.js';

/** Autonomous campaign and siege crews consume only the force left after authored assignments and
 * settlement defence. The shared defence system owns the home orders. Owner's ruling: the assistant arms
 * and dresses the army through the counters and grants the seat publishes, where the original's computer
 * player drafts and outfits its soldiers itself, matching its weapons and armour to its enemies' gear and
 * dressing armed men later. */
function runMilitary(world: World, ctx: SystemContext, player: number): readonly PlayerCommand[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return []; // mapless sim: no ground to march over
  const owned = ownedBuildings(world, player);
  const { army, available, raid } = planSettlementDefence(world, ctx, terrain, player, true);
  const wave = marchingWave(world, ctx, player);
  const siege = siegeCrewOrders(
    world,
    ctx,
    terrain,
    player,
    owned,
    available,
    wave?.catapults ?? NONE_MARCHING,
    raid,
  );
  const field = available.filter((e) => !siege.drafted.has(e));
  const campaign = runOffensive(world, ctx, terrain, player, {
    army: field,
    awaitingWeapon: army.awaitingWeapon,
    wave: wave === null ? [] : army.ready.filter((e) => wave.men.has(e)),
  });
  return [...siege.commands, ...campaign, ...outfitGrantOrders(world, ctx, player)];
}

const NONE_MARCHING: ReadonlySet<Entity> = new Set();

export const militaryModule: ComputerModule = {
  id: 'military',
  run: runMilitary,
};
