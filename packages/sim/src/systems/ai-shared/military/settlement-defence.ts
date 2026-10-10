import {
  AiControl,
  Building,
  computerModuleRuns,
  isPlayerDead,
  MapAiDefence,
  type MapAiDefenceState,
  Owner,
  WaveMarch,
} from '../../../components/index.js';
import { aiCommand, type PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { System, SystemContext } from '../../context.js';
import { hexNodeDistance } from '../../spatial/metric.js';
import { entityNode } from '../../spatial/nodes.js';
import { militaryDecisionDue } from '../cadence.js';
import { ownedBuildings } from '../seat-roster.js';
import { type ArmyCensus, takeCensus } from './census.js';
import {
  alarmOrders,
  enlistOrders,
  MAP_AI_DEFENCE_REACH_POINTS,
  raidOnTheSettlement,
  seatRaiders,
  sortieOrders,
  towerPostOrders,
} from './defence/index.js';
import {
  type Raider,
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
  watchBandOf,
} from './defence/threat.js';
import { mapAiSoldierClaims } from './ownership.js';

export interface SettlementDefence {
  readonly commands: readonly PlayerCommand[];
  readonly army: ArmyCensus;
  readonly available: readonly Entity[];
  readonly raid: Raider | null;
  readonly mapSorties: readonly { entity: Entity; state: MapAiDefenceState }[];
}

/** One allocation for both callers: map tasks and marching campaigns keep their soldiers; towers
 * take their posts, a nearby raid takes the remaining home force, and autonomous planning gets the rest. */
export function planSettlementDefence(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  autonomous = computerModuleRuns(world, player, 'military'),
): SettlementDefence {
  const owned = ownedBuildings(world, player);
  const claimed = mapAiSoldierClaims(world, player);
  const census = takeCensus(world, ctx, player);
  const army = {
    ready: census.ready.filter((e) => !claimed.has(e)),
    awaitingWeapon: census.awaitingWeapon.filter((e) => !claimed.has(e)),
  };
  const marching = new Set<Entity>();
  if (autonomous) {
    for (const carrier of world.query(WaveMarch, Owner)) {
      if (world.get(carrier, Owner).player !== player) continue;
      for (const e of world.get(carrier, WaveMarch).men) marching.add(e);
    }
  }
  const home = army.ready.filter((e) => !marching.has(e));
  const raiders = seatRaiders(world, ctx, terrain, player);
  const posts = towerPostOrders(
    world,
    ctx,
    terrain,
    owned,
    home,
    autonomous ? 'computer-player' : 'map-ai',
    () => raiders,
  );
  const free = home.filter((e) => !posts.claimed.has(e));
  const raid = raidOnTheSettlement(world, ctx, terrain, owned, raiders);
  // Approximation: a map-controlled camp answers with nearby free soldiers, using the same reach
  // as its extra tower guards. A distant camp must not empty merely because both share a player.
  const threatened =
    raid === null
      ? []
      : owned.filter(
          (building) =>
            hexNodeDistance(
              terrain,
              entityNode(world, terrain, building),
              terrain.nodeAtClamped(raid.x, raid.y),
            ) <= watchBandOf(world, ctx, building),
        );
  const responders = autonomous
    ? free
    : free.filter((soldier) =>
        threatened.some(
          (building) =>
            hexNodeDistance(
              terrain,
              entityNode(world, terrain, soldier),
              entityNode(world, terrain, building),
            ) <= MAP_AI_DEFENCE_REACH_POINTS,
        ),
      );
  const sortie = raid === null ? [] : sortieOrders(world, terrain, responders, raid);
  const mapSorties: { entity: Entity; state: MapAiDefenceState }[] = [];
  if (!autonomous && raid !== null) {
    for (const command of sortie) {
      if (command.kind !== 'attackMoveUnit') continue;
      const here = entityNode(world, terrain, command.entity);
      let camp: Entity | undefined;
      let distance = Number.POSITIVE_INFINITY;
      for (const building of threatened) {
        const near = hexNodeDistance(terrain, here, entityNode(world, terrain, building));
        if (near < distance || (near === distance && (camp === undefined || building < camp))) {
          camp = building;
          distance = near;
        }
      }
      if (camp === undefined) continue;
      const centre = terrain.coordsOf(entityNode(world, terrain, camp));
      const home = terrain.coordsOf(here);
      mapSorties.push({
        entity: command.entity,
        state: {
          player,
          centre: { hx: centre.x, hy: centre.y },
          home: { hx: home.x, hy: home.y },
          radius: threatWatchNodes(ctx, world.get(camp, Building).tribe) + THREAT_STAND_DOWN_MARGIN_NODES,
          threat: raid.entity,
          returning: false,
        },
      });
    }
  }
  return {
    army,
    available: raid === null ? free : [],
    raid,
    mapSorties,
    commands: [
      ...enlistOrders(world, ctx, player),
      ...alarmOrders(world, ctx, terrain, owned, raiders),
      ...posts.commands,
      ...sortie,
    ],
  };
}

/** Local protection remains active for map AI even when autonomous military planning is disabled. */
export const settlementDefenceSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const seats = [...world.query(AiControl)]
    .map((e) => world.get(e, AiControl))
    .sort((a, b) => a.player - b.player);
  for (const seat of seats) {
    if (!militaryDecisionDue(ctx.tick, seat.player) || isPlayerDead(world, seat.player)) continue;
    if (!seat.mapAiEnabled && !computerModuleRuns(world, seat.player, 'military')) continue;
    const plan = planSettlementDefence(world, ctx, terrain, seat.player);
    for (const { entity, state } of plan.mapSorties) world.add(entity, MapAiDefence, state);
    for (const command of plan.commands) {
      ctx.commands.enqueue(aiCommand(seat.player, command, 'settlement-defence'));
    }
  }
};
