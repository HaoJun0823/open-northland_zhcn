// The seat defending itself. The autonomous HAI exposes only `HAI_Disable*`, so the shape and the radii
// here are approximations.

export { alarmOrders } from './alarm.js';
export {
  assessSeatThreat,
  DEFEND_DANGER_THRESHOLD,
  desperateZones,
  type Intruder,
  isDesperate,
  OFFENDER_DANGER_MULTIPLIER,
  type SeatThreat,
  soldiersWanted,
  unitDanger,
  type ZoneThreat,
} from './danger.js';
export { enlistOrders } from './enlist.js';
export {
  MILITIA_HOLD_TICKS,
  MILITIA_PEOPLE_SHARE,
  MILITIA_PER_SEAT_MAX,
  MILITIA_PER_ZONE_MAX,
  musterMilitia,
} from './militia.js';
export { OFFENDER_SQUAD_MAX, type OffenderAnswer, offenderAnswers } from './offenders.js';
export {
  MAP_AI_DEFENCE_REACH_POINTS,
  MAP_AI_PEACE_ARCHERS_PER_CLASS,
  TOWER_GARRISON_ARCHERS,
  type TowerCrewRule,
  towerPostOrders,
} from './posts.js';
export { sortieOrders } from './sortie.js';
export {
  type EnemyFire,
  enemyFire,
  enemyPosts,
  raidOnTheSettlement,
  type Shooter,
  seatRaiders,
  THREAT_STAND_DOWN_MARGIN_NODES,
  threatWatchNodes,
} from './threat.js';
