// The seat defending itself. The autonomous HAI exposes only `HAI_Disable*`, so the shape and the radii
// here are approximations.

export { alarmOrders } from './alarm.js';
export { enlistOrders } from './enlist.js';
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
