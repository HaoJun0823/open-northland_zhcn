import type { ContentSet } from '@open-northland/data';
import {
  computerModuleRuns,
  hasMissionBehaviour,
  isMachinePlayer,
  MISSION_BEHAVIOUR,
  Person,
  Settler,
  Stance,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { isFighterJob, isHunterJob, isScoutJob } from './jobs.js';
import { declaresNoTrades } from './tribes/civilizations.js';

/**
 * The ids are verbatim from `logicdefines.inc` `MILITARY_MODE_{NONE, ATTACK, DEFEND, IGNORE, FLEE}`. The
 * radii and leashes live with the combat engagement (`conflict/engagement.ts`).
 *
 *  - NONE: no assigned mode, treated as IGNORE so a stray value never becomes an aggressor.
 *  - ATTACK: look for an enemy around the unit, walk up to it and fight.
 *  - DEFEND: look for an enemy around the anchor, fight it until it strays too far from the anchor, then
 *    walk back.
 *  - IGNORE: never walk to a fight. A fighter strikes an enemy that stands inside its weapon's reach and
 *    lets it go once it strays too far from the anchor; a civilian never fights. An explicit attack order
 *    still works.
 *  - FLEE: run away from the nearest threat.
 *
 * Whoever is not a fighter runs from a blow on itself or beside it under IGNORE and FLEE alike; only ATTACK
 * or DEFEND set on it keeps it standing (`conflict/flee.ts`).
 */
export const MILITARY_MODE = {
  NONE: 0,
  ATTACK: 1,
  DEFEND: 2,
  IGNORE: 3,
  FLEE: 4,
} as const;

export type MilitaryMode = (typeof MILITARY_MODE)[keyof typeof MILITARY_MODE];

/** The validity gate `setStance` uses to reject a bad mode as recoverable input. */
export function isMilitaryMode(mode: number): mode is MilitaryMode {
  return (
    mode === MILITARY_MODE.NONE ||
    mode === MILITARY_MODE.ATTACK ||
    mode === MILITARY_MODE.DEFEND ||
    mode === MILITARY_MODE.IGNORE ||
    mode === MILITARY_MODE.FLEE
  );
}

/**
 * The stance stamped on an owned settler at spawn and on a profession change, until `setStance` overrides
 * it. Original behavior: every human starts in DEFEND, except a weresnake or werewolf fighter, which
 * starts in ATTACK unless its map gives it {@link MISSION_BEHAVIOUR.SPAWNS_DEFENDING}. The monsters are
 * told by data: a person whose tribe declares no trades. Approximation: a civilian starts in FLEE and a
 * scout or hunter in IGNORE, the modes this build's orders, flee and hunt rules read.
 */
export function defaultStance(
  world: World,
  content: ContentSet,
  e: Entity,
  jobType: number | null,
): MilitaryMode {
  if (jobType === null) return MILITARY_MODE.FLEE; // a jobless settler or child is a civilian
  if (isFighterJob(content, jobType)) {
    const tribe = world.tryGet(e, Settler)?.tribe;
    const monster = tribe !== undefined && world.has(e, Person) && declaresNoTrades(content, tribe);
    if (monster) {
      return hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.SPAWNS_DEFENDING)
        ? MILITARY_MODE.DEFEND
        : MILITARY_MODE.ATTACK;
    }
    return MILITARY_MODE.DEFEND;
  }
  if (isScoutJob(content, jobType)) return MILITARY_MODE.IGNORE;
  if (isHunterJob(content, jobType)) return MILITARY_MODE.IGNORE; // ignores humans; its hunt drive stays
  return MILITARY_MODE.FLEE;
}

/** Whether `player` is a machine seat whose soldiers the computer player does not command: a map AI camp
 *  or a seat the map closed. */
export function seatLeftToMapAi(world: World, player: number): boolean {
  return isMachinePlayer(world, player) && !computerModuleRuns(world, player, 'military');
}

/**
 * The mode a combatant acts under, falling back to the default stance when the component is missing. `NONE`
 * normalizes to the passive {@link MILITARY_MODE.IGNORE} so a stray value never becomes an aggressor.
 */
export function stanceMode(
  world: World,
  content: ContentSet,
  e: Entity,
  jobType: number | null,
): MilitaryMode {
  const s = world.tryGet(e, Stance);
  const mode = s === undefined ? defaultStance(world, content, e, jobType) : s.mode;
  return mode === MILITARY_MODE.NONE ? MILITARY_MODE.IGNORE : mode;
}

/**
 * Whether a unit under `mode` keeps an anchor in its {@link Stance}: the DEFEND or IGNORE leash anchor, or
 * the place an ATTACK fighter walks back to once nothing is left to fight. Original behavior: one point,
 * the soldier's work centre, serves all three, and a move order or an attack order moves it.
 */
export function keepsAnchor(content: ContentSet, mode: MilitaryMode, jobType: number | null): boolean {
  return (
    mode === MILITARY_MODE.DEFEND ||
    mode === MILITARY_MODE.IGNORE ||
    (mode === MILITARY_MODE.ATTACK && isFighterJob(content, jobType))
  );
}

/** Whether a unit under `mode` goes looking for a fight: ATTACK and DEFEND do. IGNORE at most strikes what
 *  comes into a fighter's reach, and FLEE never fights. */
export function stanceFights(mode: MilitaryMode): boolean {
  return mode === MILITARY_MODE.ATTACK || mode === MILITARY_MODE.DEFEND;
}
