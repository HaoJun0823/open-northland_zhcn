import { defineComponent, type Entity } from '../../ecs/world.js';
import type { HalfCellNode } from '../../nav/halfcell.js';

export interface MusterPlanState {
  /** Soldiers to gather before the wave marches. */
  waveSize: number;
  /** The tick this wave was drawn - the gathering window runs from here. */
  drawnAt: number;
  /** The tick the army first stood at its cap with this plan, or null: the men still walking in get one
   *  gather window from here, so the first capped wave leaves as whole as the later ones. */
  cappedAt: number | null;
}

/**
 * The wave one seat's barracks is gathering, held between decisions on the muster barracks itself, so it
 * dies with the door. The military decision mints it when a worthy band first stands there and retires it
 * when the wave marches, the army falls under a wave, or the campaign has no objective; a disabled military
 * leaves it in place, window and all.
 */
export const MusterPlan = defineComponent<MusterPlanState>('MusterPlan', 'players');

export interface WaveMarchState {
  /** The objective the wave was routed to; a new campaign target routes it again. */
  target: Entity;
  /** Where the route starts: the direction of the first leg. */
  origin: HalfCellNode;
  /** The leg ends along the route, one leg apart, the last one short of the objective. */
  waypoints: HalfCellNode[];
  /** The index of the leg end the wave is ordered to. */
  leg: number;
  /** The tick the current leg was ordered, the wave arrived, or it last charged or held for its catapults'
   *  fight: the leg and siege timeouts count from it. */
  legSince: number;
  /** Whether the wave has closed up on its last leg end and now besieges or assaults. */
  arrived: boolean;
  /** The tick the wave's catapults opened the fight it holds for on the way, null while none fights. */
  holdSince: number | null;
  /** The men and catapults the wave marched with, ascending id; the dead and the stragglers a leg timeout
   *  leaves behind drop out at the next leg, a catapult still fighting when the hold times out at once. */
  men: Entity[];
  catapults: Entity[];
}

/**
 * The wave a seat's barracks has launched, marching in legs toward its objective, held on the muster
 * barracks beside its {@link MusterPlan}. Minted at the launch, removed when the wave is spent or the
 * campaign loses its objective (`military/march.ts`).
 */
export const WaveMarch = defineComponent<WaveMarchState>('WaveMarch', 'players');

export interface StalledPlacementsState {
  /** The first tick each entry, by its index in the seat's build order, searches a spot again after a
   *  search that found nothing. */
  retryTicks: Map<number, number>;
  /** The entry whose failed search holds the list, or null while the list places freely: a passed-over
   *  serving entry or a lane that finds nothing holds nothing. */
  holding: number | null;
}

/**
 * The build-order spot searches that last found nothing, held on the seat's {@link AiControl} carrier so
 * they die with the seat. The build order skips an entry's search until its retry tick, drops the retry
 * once the entry places or stands met, and drops the holding entry's once another entry acts. Absent
 * while no search is pending.
 */
export const StalledPlacements = defineComponent<StalledPlacementsState>('StalledPlacements', 'players');

export interface BuildOrderFrontierState {
  /** The first unmet entry's index at the seat's last build-order decision. */
  entry: number;
  /** The first tick a razed building's entry, one below `entry`, may be raised again; null until such
   *  a regression is seen. */
  rebuildTick: number | null;
}

/**
 * How far the seat's build order had got, held on its {@link AiControl} carrier, so a razed building shows
 * as an entry falling back below it and waits out the rebuild delay instead of being re-placed at once.
 */
export const BuildOrderFrontier = defineComponent<BuildOrderFrontierState>('BuildOrderFrontier', 'players');

/**
 * The tick before which the seat's build order starts nothing on a free construction site, held on its
 * {@link AiControl} carrier: a lower difficulty's pause, removed by the next site or upgrade it starts.
 */
export const BuildOrderPause = defineComponent<{ untilTick: number }>('BuildOrderPause', 'players');

/**
 * The tick before which the seat's waves never march, held on its {@link AiControl} carrier: a lobby
 * match's peace time. A seat without it, such as a map's own computer player, may march from the start.
 */
export const ComputerPeace = defineComponent<{ untilTick: number }>('ComputerPeace', 'players');

export interface RoadTrafficState {
  /** The seat whose settlers walked here. */
  player: number;
  /** The bucket's index in the map's row-major grid of traffic buckets. */
  bucket: number;
  /** Off-road walks that entered the bucket, as of the start of half-life `epoch`. */
  walks: number;
  /** The sums of the half-cell node columns and rows those walks entered on, scaled down with `walks`
   *  so their mean, the walks' average entry node, holds. */
  sumX: number;
  sumY: number;
  /** The half-life period the counts were last brought up to; each one since halves them once. */
  epoch: number;
  /** The first tick the seat's road decision may route from this bucket again. */
  retryTick: number;
}

/**
 * How much one computer seat's settlers walk off-road through one square of the map, one entity per
 * (seat, bucket) the seat walks: counting touches only the bucket a step entered, so a tick's writes stay
 * as small as its steps. The road decision paves the busiest (`systems/computer-player/traffic.ts`).
 */
export const RoadTraffic = defineComponent<RoadTrafficState>('RoadTraffic', 'players');
