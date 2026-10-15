import { type ContentSet, parseContentSet } from '@open-northland/data';
import { Health, HerdMember, Position, StayPoint, WildHabitat } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { fx, positionOfNode, type Simulation } from '../../src/index.js';
import { combatContent } from './content/combat.js';
import { economyContent } from './content/economy.js';
import { TEST_MANIFEST } from './content/index.js';
import { societyContent } from './content/societies.js';
import { addSettlerOfTribe } from './settler.js';

/** A passive grazer that seeks a leader: herds of 4, 3 points from its leader, 4 from its stay point and
 *  10 from its birth point. */
export const STAG = 30;
/** A passive land animal that seeks no leader, in groups of 3. */
export const LYNX = 32;
export const WILD_HITPOINTS = 1000;
/** Fed for good: a fixture animal that should not stop to eat. */
const NEVER_HUNGRY = 1_000_000;
/** Food enough that a fixture leader does not move on by itself. */
const PLENTY_OF_FOOD = 1_000_000;

/** The test content plus the {@link STAG} and {@link LYNX} records. */
export function wildContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...economyContent,
    ...combatContent,
    ...societyContent,
    tribes: [...societyContent.tribes, { typeId: STAG, id: 'test_stag' }, { typeId: LYNX, id: 'test_lynx' }],
    animals: [
      ...societyContent.animals,
      {
        id: 'stag',
        tribeType: STAG,
        hitpointsAdult: WILD_HITPOINTS,
        maximumGroupSize: 4,
        searchForLeader: true,
        maximumLeaderDistance: 3,
        maximumDistanceToBirthPoint: 10,
        maximumDistanceToStayPoint: 4,
      },
      {
        id: 'lynx',
        tribeType: LYNX,
        hitpointsAdult: WILD_HITPOINTS,
        maximumGroupSize: 3,
        maximumLeaderDistance: 3,
        maximumDistanceToBirthPoint: 10,
        maximumDistanceToStayPoint: 4,
      },
    ],
  });
}

/**
 * A wild animal of `tribe` standing at node (x, y), its birth, stay and work-center points all there,
 * fed, stocked with food and due to decide at once. With `leader` it follows that animal.
 */
export function wildAt(sim: Simulation, tribe: number, x: number, y: number, leader?: Entity): Entity {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('fixture: a wild animal needs a map');
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  addSettlerOfTribe(sim, e, {
    tribe,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  const hitpoints = sim.content.animals.find((a) => a.tribeType === tribe)?.hitpointsAdult ?? WILD_HITPOINTS;
  sim.world.add(e, Health, { hitpoints, max: hitpoints });
  const node = terrain.nodeAt(x, y);
  sim.world.add(e, StayPoint, { cell: node });
  sim.world.add(e, WildHabitat, {
    birth: node,
    workCenter: node,
    fedUntil: NEVER_HUNGRY,
    food: PLENTY_OF_FOOD,
    nextStayAt: 0,
  });
  if (leader !== undefined) sim.world.add(e, HerdMember, { leader });
  return e;
}
